import * as functions from 'firebase-functions/v1'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'

import { db, HttpsError } from './common.js'
import { ELIGIBLE_IDENTITIES, REGION, ROLE_RANK, STREET_SCHOOL } from './constants.js'
import {
  MAX_TICKETS_PER_ORDER,
  TICKET_TYPE_ID_PATTERN,
  generateOrderId,
  isFriendSchoolsOnlyType,
  isValidRequestId
} from './orderValidation.js'
import { isContention, legacyRef, reserveStock, settingsRef, shardRef, ticketTypeOf, ticketTypesOf } from './orders.js'
import { staffName } from './orderActions.js'
import { getTaiwanDateKey } from './time.js'

// 路宣登記: tickets sold in person while the council promotes the party on
// the street. An admin or super admin takes the buyer's cash, hands over the
// paper tickets on the spot and registers the sale on /admin/street. That
// makes an ordinary order of the ticket type chosen in settings/streetSale,
// already paid and collected, so nothing is emailed and nothing is asked of
// the buyer: no account, email, name or phone. Its school is STREET_SCHOOL
// (路宣), the identity it counts under in the admin lists and the sales
// report. Only super admins see the totals (/super_admin/street).
//
// It takes from the type's stock, never past it, but ignores the
// per-person limit (there is no buyer to count it against), the sale window
// and 學生優先購買: super admins open and close it with
// settings/streetSale.enabled, as for 學弟登記賣票. Deleting the order gives
// the stock back (releaseOrderStock).
//
//   orders/{id}                     streetSale: true, promoterEmail and
//                                   promoterName (who sold it), who is also
//                                   recorded as having taken the payment and
//                                   handed over the tickets (payment* /
//                                   delivery*, and both in its history)
//   streetSaleRequests/{requestId}  { promoterUid, orderId }: a retried
//                                   registration returns the same order.
//                                   Written only here (denied by the rules).

// street sale order ids start with this instead of a school code
export const STREET_ORDER_PREFIX = 'ST'
const ORDER_ID_ATTEMPTS = 3

class OrderIdTaken extends Error {}

const programRef = db.doc('settings/streetSale')
const requestRef = (id) => db.doc(`streetSaleRequests/${id}`)

// { requestId, quantity }: nothing about the buyer is recorded
export function sanitizeStreetSaleInput(data) {
  if (!isValidRequestId(data?.requestId)) {
    throw new HttpsError('invalid-argument', '登記請求無效，請重新整理後再試')
  }

  const quantity = Number(data?.quantity)
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_TICKETS_PER_ORDER) {
    throw new HttpsError('invalid-argument', `張數必須是 1 到 ${MAX_TICKETS_PER_ORDER} 的整數`)
  }

  return { requestId: data.requestId, quantity }
}

// The order of a street sale, shaped like a checkout's (orders.js) so every
// order view, export and the sales report read it as one. `promoter` is the
// staff member who sold it, { uid, email, name }; `soldAt` the Timestamp the
// cash was taken and the tickets handed over.
export function streetOrderOf({ quantity, ticketTypeId, ticketType, promoter, ticketCode, stockShards, soldAt }) {
  const price = Number(ticketType.price) || 0
  return {
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    school: STREET_SCHOOL,
    class: '',
    number: '',
    office: '',
    items: [{ id: ticketTypeId, ticketTypeId, name: String(ticketType.name || ''), price, quantity }],
    originalTotal: price * quantity,
    finalTotal: price * quantity,
    streetSale: true,
    promoterEmail: promoter.email,
    promoterName: promoter.name,
    // the buyer did not sign in, so no account reads it under 已購門票
    userId: null,
    ticketCode,
    stockCounted: true, // releaseOrderStock gives the stock back
    stockShards, // { [ticketTypeId]: { [shard]: n } }
    // paid in cash for paper tickets handed over at once
    paid: true,
    paymentUpdatedAt: soldAt,
    paymentUpdatedByName: promoter.name,
    paymentUpdatedByUid: promoter.uid,
    delivered: true,
    deliveryUpdatedAt: soldAt,
    deliveryUpdatedByName: promoter.name,
    deliveryUpdatedByUid: promoter.uid,
    // nothing to send (mailQueue.js skips street sales)
    emailStatus: 'skipped',
    createdAt: FieldValue.serverTimestamp()
  }
}

export const registerStreetSale = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) throw new HttpsError('unauthenticated', '請先登入')
    const uid = context.auth.uid
    const { requestId, quantity } = sanitizeStreetSaleInput(data)
    const dateKey = getTaiwanDateKey()

    for (let attempt = 1; ; attempt++) {
      const orderRef = db.doc(`orders/${generateOrderId(STREET_ORDER_PREFIX, dateKey)}`)

      try {
        return await db.runTransaction(async (tx) => {
          // the staff role is read with the rest, as in orderActions.js, so a
          // revoked admin cannot race a sale through
          const [requestSnap, actorSnap, programSnap, settingsSnap, orderSnap] = await tx.getAll(
            requestRef(requestId),
            db.doc(`users/${uid}`),
            programRef,
            settingsRef,
            orderRef
          )

          const profile = actorSnap.data() || {}
          const rank = Object.hasOwn(ROLE_RANK, profile.role) ? ROLE_RANK[profile.role] : 0
          if (rank < ROLE_RANK.admin) throw new HttpsError('permission-denied', '只有管理員可以登記路宣')

          // the same registration was already saved (e.g. the response was lost)
          if (requestSnap.exists) {
            const request = requestSnap.data()
            if (request.promoterUid !== uid) {
              throw new HttpsError('invalid-argument', '登記請求無效，請重新整理後再試')
            }
            // a super admin deleted it: a late retry must not sell it again
            if (!(await tx.get(db.doc(`orders/${request.orderId}`))).exists) {
              throw new HttpsError('failed-precondition', '這筆登記已被刪除，請重新整理後再登記')
            }
            return { id: request.orderId }
          }

          const program = programSnap.data() || {}
          const ticketTypeId = String(program.ticketTypeId || '')
          if (program.enabled !== true || !TICKET_TYPE_ID_PATTERN.test(ticketTypeId)) {
            throw new HttpsError('failed-precondition', '目前尚未開放路宣登記')
          }

          const ticketTypes = ticketTypesOf(settingsSnap)
          const ticketType = ticketTypeOf(ticketTypes, ticketTypeId)
          // 本校學生 tickets go to school accounts that signed in themselves
          if (ticketType.eligibleBuyerIdentity === ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS) {
            throw new HttpsError('failed-precondition', `${ticketType.name}僅限建中學生登入購買，不能路宣登記`)
          }
          // so are 僅限建中及友校 tickets, bought with a 建中 or 友校 account
          if (isFriendSchoolsOnlyType(ticketType)) {
            throw new HttpsError('failed-precondition', `${ticketType.name}僅限建中及友校學生登入購買，不能路宣登記`)
          }

          if (orderSnap.exists) throw new OrderIdTaken()

          // Every shard is locked, as for seller registrations: street sales
          // are rare, and this makes "not enough left" final
          const legacySnap = await tx.get(legacyRef(ticketTypeId))
          const stockShards = await reserveStock(tx, [{ id: ticketTypeId, quantity }], ticketTypes, [legacySnap], {})

          Object.entries(stockShards[ticketTypeId]).forEach(([k, n]) => {
            tx.set(shardRef(ticketTypeId, k), { sold: FieldValue.increment(n) }, { merge: true })
          })

          const soldAt = Timestamp.now()
          const promoter = {
            uid,
            email: String(context.auth.token?.email || '').toLowerCase(),
            name: staffName(profile, context)
          }
          tx.create(orderRef, streetOrderOf({
            quantity,
            ticketTypeId,
            ticketType,
            promoter,
            ticketCode: randomBytes(9).toString('base64url'),
            stockShards,
            soldAt
          }))
          // the audit entries the staff payment and pickup updates write
          // (orderActions.js)
          const history = { previousValue: false, value: true, actorUid: uid, actorName: promoter.name, occurredAt: soldAt }
          tx.create(orderRef.collection('history').doc(), { action: 'payment', ...history })
          tx.create(orderRef.collection('history').doc(), { action: 'delivery', ...history, codeVerification: 'paper_ticket' })
          tx.create(requestRef(requestId), {
            promoterUid: uid,
            orderId: orderRef.id,
            createdAt: FieldValue.serverTimestamp()
          })

          return { id: orderRef.id }
        }, { maxAttempts: 10 })
      } catch (error) {
        if (error instanceof OrderIdTaken && attempt < ORDER_ID_ATTEMPTS) continue
        // reserveStock reports a sold-out type as resource-exhausted
        if (error instanceof HttpsError) throw error
        if (isContention(error)) {
          throw new HttpsError('aborted', '目前購票人數眾多，請稍後再試一次')
        }
        console.error('[registerStreetSale] unexpected error:', error)
        throw new HttpsError('internal', '登記失敗，請稍後再試')
      }
    }
  })
