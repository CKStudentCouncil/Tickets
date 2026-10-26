import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'

import { db, HttpsError, assertRole } from './common.js'
import { GUEST_RELATIONS, MAX_GUEST_TICKETS, REGION } from './constants.js'
import { generateOrderId, isValidRequestId } from './orderValidation.js'
import { getTaiwanDateKey } from './time.js'

// 公關票: super admins send free tickets to guests (alumni, friends of the
// council), by name and email or to someone registered on /guest. Each one
// is an NT$0 order with `complimentary: true`, so its email (an invitation,
// see mailQueue.js), ticket QR code and check-in work as for any order. It
// takes nothing from the ticket types' stock and, without stockCounted,
// gives nothing back when deleted.
//
//   guestRegistrations/{uid}        a guest's details, written by the guest on
//                                   /guest (firestore.rules); sending adds
//                                   orderId, invitedAt and invitedByUid
//   invitationRequests/{requestId}  { orderId }: a retried send returns that
//                                   order (written only here)

// 公關票 order ids start with this instead of a school code
export const GUEST_ORDER_PREFIX = 'PR'
// in the school field, so the admin order list and the report tell them apart
export const GUEST_SCHOOL = '公關票'
const GUEST_TICKET_ID = 'guest'
const ORDER_ID_ATTEMPTS = 3
// a Firebase Auth uid
const REGISTRATION_ID_PATTERN = /^[A-Za-z0-9]{1,128}$/
const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/

class OrderIdTaken extends Error {}

const cleanString = (value, maxLength) => String(value ?? '').trim().slice(0, maxLength)

// The guest as stored on the order; also checks a stored registration
export function sanitizeGuest(data) {
  const guest = {
    name: cleanString(data?.name, 50),
    email: cleanString(data?.email, 254).toLowerCase(),
    relation: String(data?.relation || ''),
    relationDetail: cleanString(data?.relationDetail, 50)
  }

  if (!guest.name) throw new HttpsError('invalid-argument', '請填寫姓名')
  if (!EMAIL_PATTERN.test(guest.email)) throw new HttpsError('invalid-argument', 'Email 格式不正確')
  if (!GUEST_RELATIONS.includes(guest.relation)) throw new HttpsError('invalid-argument', '請選擇身分')
  if (!guest.relationDetail) {
    throw new HttpsError('invalid-argument', guest.relation === 'alumni' ? '請填寫屆數及幹位' : '請填寫是誰的親友及稱謂')
  }

  return guest
}

// Either { registrationId } (the guest comes from guestRegistrations) or the
// guest's own details
export function sanitizeGuestInput(data) {
  if (!isValidRequestId(data?.requestId)) {
    throw new HttpsError('invalid-argument', '寄送請求無效，請重新整理後再試')
  }

  const quantity = Number(data?.quantity ?? 1)
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_GUEST_TICKETS) {
    throw new HttpsError('invalid-argument', `張數必須是 1 到 ${MAX_GUEST_TICKETS} 的整數`)
  }

  if (data?.registrationId != null) {
    const registrationId = String(data.registrationId)
    if (!REGISTRATION_ID_PATTERN.test(registrationId)) {
      throw new HttpsError('invalid-argument', '登記資料無效，請重新整理後再試')
    }
    return { requestId: data.requestId, quantity, registrationId }
  }

  return { requestId: data.requestId, quantity, guest: sanitizeGuest(data) }
}

// The order of a 公關票, shaped like a checkout's (orders.js) so every
// order view, export and the sales report read it as one
export function guestOrderOf({ guest, quantity, userId, invitedByUid, ticketCode }) {
  return {
    customerName: guest.name,
    customerEmail: guest.email,
    customerPhone: '',
    school: GUEST_SCHOOL,
    class: '',
    number: '',
    office: '',
    items: [{ id: GUEST_TICKET_ID, ticketTypeId: GUEST_TICKET_ID, name: '公關票', price: 0, quantity }],
    originalTotal: 0,
    finalTotal: 0,
    complimentary: true,
    guest: { relation: guest.relation, relationDetail: guest.relationDetail },
    // a registered guest reads it under 已購門票, as a buyer would
    userId,
    invitedByUid,
    ticketCode,
    delivered: false,
    // nothing to pay, so it never shows up as owing
    paid: true,
    emailStatus: 'pending',
    createdAt: FieldValue.serverTimestamp()
  }
}

// Creates the order; sendOrderQRCode then queues the invitation email. A
// retried call with the same requestId returns the same order, and a
// registration is sent at most one ticket while that order exists.
export const sendGuestInvitation = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    await assertRole(context, 'super_admin')
    const { requestId, quantity, registrationId, guest: input } = sanitizeGuestInput(data)

    const requestRef = db.doc(`invitationRequests/${requestId}`)
    const registrationRef = registrationId ? db.doc(`guestRegistrations/${registrationId}`) : null
    const dateKey = getTaiwanDateKey()

    for (let attempt = 1; ; attempt++) {
      const orderRef = db.doc(`orders/${generateOrderId(GUEST_ORDER_PREFIX, dateKey)}`)

      try {
        return await db.runTransaction(async (tx) => {
          const refs = [requestRef, orderRef, ...(registrationRef ? [registrationRef] : [])]
          const [requestSnap, orderSnap, registrationSnap] = await tx.getAll(...refs)

          // the same send was already saved (e.g. the response was lost)
          if (requestSnap.exists) return { id: requestSnap.data().orderId }
          if (orderSnap.exists) throw new OrderIdTaken()

          let guest = input
          if (registrationRef) {
            if (!registrationSnap.exists) {
              throw new HttpsError('not-found', '找不到這筆登記，可能已被刪除')
            }
            const registration = registrationSnap.data()
            // a deleted order may be sent again
            if (registration.orderId && (await tx.get(db.doc(`orders/${registration.orderId}`))).exists) {
              throw new HttpsError('already-exists', `已寄過公關票給${registration.name || '這位來賓'}`)
            }
            guest = sanitizeGuest(registration)
          }

          tx.create(orderRef, guestOrderOf({
            guest,
            quantity,
            userId: registrationId || null,
            invitedByUid: context.auth.uid,
            ticketCode: randomBytes(9).toString('base64url')
          }))
          tx.create(requestRef, {
            orderId: orderRef.id,
            createdByUid: context.auth.uid,
            createdAt: FieldValue.serverTimestamp()
          })
          if (registrationRef) {
            tx.update(registrationRef, {
              orderId: orderRef.id,
              invitedAt: FieldValue.serverTimestamp(),
              invitedByUid: context.auth.uid
            })
          }

          return { id: orderRef.id }
        })
      } catch (error) {
        if (error instanceof OrderIdTaken && attempt < ORDER_ID_ATTEMPTS) continue
        if (error instanceof HttpsError) throw error
        console.error('[sendGuestInvitation] unexpected error:', error)
        throw new HttpsError('internal', '寄送失敗，請稍後再試')
      }
    }
  })
