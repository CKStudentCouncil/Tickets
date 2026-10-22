import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'

import { db, HttpsError } from './common.js'
import { MAX_SELLER_TICKETS, REGION } from './constants.js'
import { TICKET_TYPE_ID_PATTERN, isValidRequestId } from './orderValidation.js'
import {
  getBuyerAccount,
  isContention,
  legacyRef,
  reserveStock,
  settingsRef,
  shardRef,
  ticketTypeOf,
  ticketTypesOf
} from './orders.js'

// 學弟登記賣票: students on the seller list (sellers/{email}, kept by super
// admins) take tickets of the ticket type chosen in settings/sellerProgram
// (the 二售 type) to sell to their friends themselves. A registration takes
// the tickets from that type's stock at once, so the public sees fewer left,
// and cannot be undone by the seller: tickets taken must be sold. Admins may
// delete a mistaken registration, which gives the tickets back.
//
// Documents written only by these functions (denied to clients by the rules):
//   sellerRegistrations/{requestId}  the registration; admins may only flip
//                                    delivered / paid and delete it
//   sellerStats/summary              { total } tickets registered by everyone
//   sellerReleases/{registrationId}  marks a deleted registration as released

const programRef = db.doc('settings/sellerProgram')
const summaryRef = db.doc('sellerStats/summary')
const sellerRef = (email) => db.doc(`sellers/${email}`)
const registrationRef = (id) => db.doc(`sellerRegistrations/${id}`)
const releaseRef = (id) => db.doc(`sellerReleases/${id}`)

export function sanitizeSellerInput(data) {
  const quantity = Number(data?.quantity)
  const sellerName = String(data?.sellerName ?? '').trim().slice(0, 50)

  if (!isValidRequestId(data?.requestId)) {
    throw new HttpsError('invalid-argument', '登記請求無效，請重新整理後再試')
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new HttpsError('invalid-argument', '張數必須為正整數')
  }
  if (quantity > MAX_SELLER_TICKETS) {
    throw new HttpsError('invalid-argument', `一次最多登記 ${MAX_SELLER_TICKETS} 張`)
  }
  if (!sellerName) {
    throw new HttpsError('invalid-argument', '請填寫姓名')
  }

  return { requestId: data.requestId, quantity, sellerName }
}

// The registration as the seller sees it
const resultOf = (id, registration) => ({
  id,
  quantity: registration.quantity,
  ticketTypeName: registration.ticketTypeName
})

export const registerSellerTickets = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const account = getBuyerAccount(context)
    const { requestId, quantity, sellerName } = sanitizeSellerInput(data)
    const ref = registrationRef(requestId)

    try {
      return await db.runTransaction(async (tx) => {
        const [requestSnap, releasedSnap, sellerSnap, programSnap, settingsSnap] = await tx.getAll(
          ref,
          releaseRef(requestId),
          sellerRef(account.email),
          programRef,
          settingsRef
        )

        // the same registration was already saved (e.g. the response was lost)
        if (requestSnap.exists) {
          if (requestSnap.data().sellerUid !== account.uid) {
            throw new HttpsError('invalid-argument', '登記請求無效，請重新整理後再試')
          }
          return resultOf(requestSnap.id, requestSnap.data())
        }
        // an admin deleted it: a late retry must not register it again
        if (releasedSnap.exists) {
          throw new HttpsError('failed-precondition', '這筆登記已被刪除，請重新整理後再登記')
        }

        if (!sellerSnap.exists) {
          throw new HttpsError('permission-denied', '你不在賣票名單中，請聯絡總副召')
        }

        const program = programSnap.data() || {}
        const ticketTypeId = String(program.ticketTypeId || '')
        if (program.enabled !== true || !TICKET_TYPE_ID_PATTERN.test(ticketTypeId)) {
          throw new HttpsError('failed-precondition', '目前尚未開放登記賣票')
        }

        const ticketTypes = ticketTypesOf(settingsSnap)
        const ticketType = ticketTypeOf(ticketTypes, ticketTypeId)
        const legacySnap = await tx.get(legacyRef(ticketTypeId))

        // Every shard is locked: registrations are rare, and this makes
        // "not enough left" final. No sale window or per-person limit: the
        // seller is not the buyer, and sells before or during the sale.
        const stockShards = await reserveStock(
          tx,
          [{ id: ticketTypeId, quantity }],
          ticketTypes,
          [legacySnap],
          {}
        )

        Object.entries(stockShards[ticketTypeId]).forEach(([k, n]) => {
          tx.set(shardRef(ticketTypeId, k), { sold: FieldValue.increment(n) }, { merge: true })
        })

        const registration = {
          sellerUid: account.uid,
          sellerEmail: account.email,
          sellerName,
          ticketTypeId,
          ticketTypeName: String(ticketType.name || ''),
          price: Number(ticketType.price) || 0,
          quantity,
          stockShards, // { [ticketTypeId]: { [shard]: n } }, refunded by releaseSellerStock
          delivered: false,
          paid: false,
          createdAt: FieldValue.serverTimestamp()
        }
        tx.create(ref, registration)
        tx.set(
          summaryRef,
          { total: FieldValue.increment(quantity), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )

        return resultOf(ref.id, registration)
      }, { maxAttempts: 10 })
    } catch (error) {
      // reserveStock reports a sold-out type as resource-exhausted
      if (error instanceof HttpsError) throw error
      if (isContention(error)) {
        throw new HttpsError('aborted', '目前購票人數眾多，請稍後再試一次')
      }
      console.error('[registerSellerTickets] unexpected error:', error)
      throw new HttpsError('internal', '登記失敗，請稍後再試')
    }
  })

// When an admin deletes a registration, give its tickets back to the stock
// and take them off the shared total. The marker document makes this safe if
// the trigger is delivered more than once.
export const releaseSellerStock = functions
  .region(REGION)
  .runWith({ failurePolicy: true })
  .firestore.document('sellerRegistrations/{registrationId}')
  .onDelete(async (snap, context) => {
    const registration = snap.data() || {}
    const quantity = Number(registration.quantity)
    if (!Number.isInteger(quantity) || quantity <= 0) return

    const markerRef = releaseRef(context.params.registrationId)

    await db.runTransaction(async (tx) => {
      if ((await tx.get(markerRef)).exists) return

      Object.entries(registration.stockShards || {}).forEach(([id, allocation]) => {
        Object.entries(allocation || {}).forEach(([k, n]) => {
          if (Number.isInteger(n) && n > 0) {
            tx.set(shardRef(id, k), { sold: FieldValue.increment(-n) }, { merge: true })
          }
        })
        // as in releaseOrderStock: plan the caps again from the remaining sales
        tx.set(legacyRef(id), { shardCaps: FieldValue.delete() }, { merge: true })
      })

      tx.set(
        summaryRef,
        { total: FieldValue.increment(-quantity), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      )
      tx.create(markerRef, { releasedAt: FieldValue.serverTimestamp() })
    })
  })
