import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'

import { db, HttpsError, assertRole, getRoleRank } from './common.js'
import { MAX_GUEST_TICKETS, MAX_INVITE_NOTE, REGION, ROLE_RANK } from './constants.js'
import { getBuyerAccount } from './orders.js'
import { generateOrderId, isValidRequestId } from './orderValidation.js'
import { getTaiwanDateKey } from './time.js'

// 公關票: free tickets for guests. Super admins keep a list of officers
// (幹部), each with a quota of tickets; an officer gives them out on
// /officer, by name and email or as a one-time invite link that the guest
// opens, signs in and claims. Super admins may also send one directly,
// outside any quota. Each ticket is an NT$0 order with `complimentary:
// true`, so its email (an invitation, see mailQueue.js), ticket QR code and
// check-in work as for any order. It takes nothing from the ticket types'
// stock and, without stockCounted, gives nothing back when deleted.
//
//   officers/{email}                { email, name, quota, used, createdAt }:
//                                   name and quota are written by super
//                                   admins (firestore.rules), `used` only
//                                   here: tickets the officer sent plus
//                                   those held by their open invites
//   officerInvites/{inviteId}       an invite link; the random id is the
//                                   secret in the link. { officerEmail,
//                                   officerName, officerSince, quantity,
//                                   status: 'open' | 'claimed', createdAt }
//                                   and, once claimed, orderId, claimedByUid,
//                                   claimedAt. Revoking an open one deletes it.
//                                   A super admin's link (council: true) has
//                                   no officer and takes no quota.
//   officerInviteNotes/{inviteId}   { note, officerEmail, createdAt }: what
//                                   the link is for, kept apart because
//                                   whoever holds the link reads the invite
//                                   (and later owns the order); only its
//                                   officer and super admins read it
//   invitationRequests/{requestId}  { kind, createdByUid, orderId | inviteId }:
//                                   the same caller retrying the same kind of
//                                   call gets the same ticket or link back
//
// Tickets and links record `officerSince`, the officer entry's createdAt:
// an officer taken off the list and added again starts a new entry with
// nothing used, so what the old one gave out neither works (open links) nor
// counts against it (revokes, deleted tickets).
//   officerReleases/{orderId}       marks a deleted officer ticket whose
//                                   tickets went back to the quota
//
// Every document here is written only by these functions, except the
// officers' name and quota.

// 公關票 order ids start with this instead of a school code
export const GUEST_ORDER_PREFIX = 'PR'
// in the school field, so the admin order list and the report tell them apart
export const GUEST_SCHOOL = '公關票'
const GUEST_TICKET_ID = 'guest'
const ORDER_ID_ATTEMPTS = 3
const INVITE_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/
const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/

class OrderIdTaken extends Error {}

const cleanString = (value, maxLength) => String(value ?? '').trim().slice(0, maxLength)

const officerRef = (email) => db.doc(`officers/${email}`)
const inviteRef = (id) => db.doc(`officerInvites/${id}`)
const requestRef = (id) => db.doc(`invitationRequests/${id}`)
const releaseRef = (orderId) => db.doc(`officerReleases/${orderId}`)
const noteRef = (inviteId) => db.doc(`officerInviteNotes/${inviteId}`)

export const newInviteId = () => randomBytes(18).toString('base64url')

// The officer entry a ticket or link was given out under still exists
export const isSameOfficer = (officerSnap, since) =>
  officerSnap.exists && Boolean(since) && officerSnap.data().createdAt?.isEqual?.(since) === true

// An earlier call with this requestId, or null. It must be the same caller
// making the same kind of call: a request id is only a retry key.
function replayed(request, kind, uid) {
  if (!request.exists) return null
  const data = request.data()
  if (data.kind !== kind || data.createdByUid !== uid) {
    throw new HttpsError('invalid-argument', '寄送請求無效，請重新整理後再試')
  }
  return data
}

// Tickets in a 公關票 order
export const ticketCountOf = (order) =>
  (Array.isArray(order?.items) ? order.items : []).reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0)

function checkRequestId(data) {
  if (!isValidRequestId(data?.requestId)) {
    throw new HttpsError('invalid-argument', '寄送請求無效，請重新整理後再試')
  }
  return data.requestId
}

export function sanitizeQuantity(data) {
  const quantity = Number(data?.quantity ?? 1)
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_GUEST_TICKETS) {
    throw new HttpsError('invalid-argument', `張數必須是 1 到 ${MAX_GUEST_TICKETS} 的整數`)
  }
  return quantity
}

function sanitizeName(data) {
  const name = cleanString(data?.name, 50)
  if (!name) throw new HttpsError('invalid-argument', '請填寫姓名')
  return name
}

// A send by name and email: { requestId, quantity, guest: { name, email } }
export function sanitizeGuestInput(data) {
  const requestId = checkRequestId(data)
  const quantity = sanitizeQuantity(data)
  const email = cleanString(data?.email, 254).toLowerCase()
  const name = sanitizeName(data)
  if (!EMAIL_PATTERN.test(email)) throw new HttpsError('invalid-argument', 'Email 格式不正確')

  return { requestId, quantity, guest: { name, email } }
}

// { requestId, quantity, note, council }: `council` is a super admin's link
export function sanitizeInviteInput(data) {
  return {
    requestId: checkRequestId(data),
    quantity: sanitizeQuantity(data),
    note: cleanString(data?.note, MAX_INVITE_NOTE),
    council: data?.council === true
  }
}

export function sanitizeInviteId(data) {
  const inviteId = String(data?.inviteId ?? '')
  if (!INVITE_ID_PATTERN.test(inviteId)) throw new HttpsError('not-found', '這個邀請連結無效或已失效')
  return inviteId
}

export function sanitizeClaimInput(data) {
  return { inviteId: sanitizeInviteId(data), name: sanitizeName(data) }
}

// The order of a 公關票, shaped like a checkout's (orders.js) so every
// order view, export and the sales report read it as one. `officer` is who
// gave it out ({ email, name, since }), null when a super admin sent it
// directly.
export function guestOrderOf({ guest, quantity, userId, invitedByUid, ticketCode, officer = null, inviteId = null }) {
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
    officerEmail: officer?.email || null,
    officerName: officer?.name || null,
    officerSince: officer?.since || null,
    inviteId,
    // whoever claimed an invite reads it under 已購門票, as a buyer would
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

// Tickets an officer may still give out
export const remainingOf = (officer) => Math.max(0, (Number(officer?.quota) || 0) - (Number(officer?.used) || 0))

function assertQuota(officer, quantity) {
  const remaining = remainingOf(officer)
  if (quantity > remaining) {
    throw new HttpsError('failed-precondition', remaining > 0 ? `額度只剩 ${remaining} 張` : '額度已用完')
  }
}

// The signed-in officer: { uid, email, name }
async function getOfficer(context) {
  const account = getBuyerAccount(context)
  const snap = await officerRef(account.email).get()
  if (!snap.exists) throw new HttpsError('permission-denied', '你不在幹部名單中')
  return { ...account, name: String(snap.data().name || '') }
}

// Runs `create(orderRef, tx)` with a fresh order id, retrying the rare id
// that is already taken. `create` returns what the call answers.
async function withNewOrder(label, create) {
  const dateKey = getTaiwanDateKey()
  for (let attempt = 1; ; attempt++) {
    const orderRef = db.doc(`orders/${generateOrderId(GUEST_ORDER_PREFIX, dateKey)}`)
    try {
      return await db.runTransaction(async (tx) => {
        if ((await tx.get(orderRef)).exists) throw new OrderIdTaken()
        return create(orderRef, tx)
      })
    } catch (error) {
      if (error instanceof OrderIdTaken && attempt < ORDER_ID_ATTEMPTS) continue
      if (error instanceof HttpsError) throw error
      console.error(`[${label}] unexpected error:`, error)
      throw new HttpsError('internal', '寄送失敗，請稍後再試')
    }
  }
}

const newTicketCode = () => randomBytes(9).toString('base64url')

// Super admins send a ticket by name and email, outside any quota. A
// retried call with the same requestId returns the same order.
export const sendGuestInvitation = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    await assertRole(context, 'super_admin')
    const { requestId, quantity, guest } = sanitizeGuestInput(data)

    return withNewOrder('sendGuestInvitation', async (orderRef, tx) => {
      // the same send was already saved (e.g. the response was lost)
      const earlier = replayed(await tx.get(requestRef(requestId)), 'direct', context.auth.uid)
      if (earlier) return { id: earlier.orderId }

      tx.create(orderRef, guestOrderOf({
        guest,
        quantity,
        userId: null,
        invitedByUid: context.auth.uid,
        ticketCode: newTicketCode()
      }))
      tx.create(requestRef(requestId), {
        kind: 'direct',
        orderId: orderRef.id,
        createdByUid: context.auth.uid,
        createdAt: FieldValue.serverTimestamp()
      })
      return { id: orderRef.id }
    })
  })

// An officer sends a ticket by name and email from their quota. Unless
// `allowDuplicate`, an email that already has a 公關票 is refused with
// already-exists and details { duplicate: true }, so the page can ask first.
export const sendOfficerTicket = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const officer = await getOfficer(context)
    const { requestId, quantity, guest } = sanitizeGuestInput(data)
    const allowDuplicate = data?.allowDuplicate === true

    return withNewOrder('sendOfficerTicket', async (orderRef, tx) => {
      const [request, officerSnap] = await tx.getAll(requestRef(requestId), officerRef(officer.email))
      const earlier = replayed(request, 'officer', officer.uid)
      if (earlier) return { id: earlier.orderId }
      if (!officerSnap.exists) throw new HttpsError('permission-denied', '你不在幹部名單中')
      assertQuota(officerSnap.data(), quantity)

      if (!allowDuplicate) {
        const earlier = await tx.get(
          db.collection('orders').where('customerEmail', '==', guest.email).where('complimentary', '==', true).limit(1)
        )
        if (!earlier.empty) {
          throw new HttpsError('already-exists', '這個 Email 已經收過公關票', { duplicate: true })
        }
      }

      tx.create(orderRef, guestOrderOf({
        guest,
        quantity,
        userId: null,
        invitedByUid: officer.uid,
        ticketCode: newTicketCode(),
        officer: { email: officer.email, name: officerSnap.data().name || officer.name, since: officerSnap.data().createdAt }
      }))
      tx.create(requestRef(requestId), {
        kind: 'officer',
        orderId: orderRef.id,
        createdByUid: officer.uid,
        createdAt: FieldValue.serverTimestamp()
      })
      tx.update(officerRef(officer.email), { used: FieldValue.increment(quantity) })
      return { id: orderRef.id }
    })
  })

// An officer makes a one-time invite link for `quantity` tickets; they come
// off the quota now and go back if the link is revoked before it is used.
// With `council`, a super admin makes one in the council's name, outside any
// quota. An optional `note` says who it is for.
export const createOfficerInvite = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const { requestId, quantity, note, council } = sanitizeInviteInput(data)
    let officer = null
    if (council) await assertRole(context, 'super_admin')
    else officer = await getOfficer(context)
    const uid = context.auth.uid
    const kind = council ? 'council-invite' : 'invite'
    const ref = inviteRef(newInviteId())

    try {
      return await db.runTransaction(async (tx) => {
        const [request, officerSnap] = await tx.getAll(requestRef(requestId), ...(officer ? [officerRef(officer.email)] : []))
        const earlier = replayed(request, kind, uid)
        if (earlier) return { id: earlier.inviteId }
        if (officer) {
          if (!officerSnap.exists) throw new HttpsError('permission-denied', '你不在幹部名單中')
          assertQuota(officerSnap.data(), quantity)
        }

        tx.create(ref, {
          officerEmail: officer?.email || null,
          officerName: officer ? officerSnap.data().name || officer.name : null,
          officerSince: officer ? officerSnap.data().createdAt : null,
          council,
          quantity,
          status: 'open',
          createdByUid: uid,
          createdAt: FieldValue.serverTimestamp()
        })
        if (note) {
          tx.create(noteRef(ref.id), {
            note,
            officerEmail: officer?.email || null,
            createdAt: FieldValue.serverTimestamp()
          })
        }
        tx.create(requestRef(requestId), {
          kind,
          inviteId: ref.id,
          createdByUid: uid,
          createdAt: FieldValue.serverTimestamp()
        })
        if (officer) tx.update(officerRef(officer.email), { used: FieldValue.increment(quantity) })
        return { id: ref.id }
      })
    } catch (error) {
      if (error instanceof HttpsError) throw error
      console.error('[createOfficerInvite] unexpected error:', error)
      throw new HttpsError('internal', '產生連結失敗，請稍後再試')
    }
  })

// The officer who made it, or a super admin, revokes an unclaimed link; its
// tickets go back to the quota, and its note goes with it. Revoking one
// already gone is a no-op.
export const revokeOfficerInvite = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const account = getBuyerAccount(context)
    const inviteId = sanitizeInviteId(data)
    const ref = inviteRef(inviteId)
    const isSuperAdmin = (await getRoleRank(account.uid)) >= ROLE_RANK.super_admin

    try {
      return await db.runTransaction(async (tx) => {
        const invite = await tx.get(ref)
        if (!invite.exists) return { revoked: false }
        const { status, officerEmail, officerSince, quantity } = invite.data()
        // a council link has no officer: only super admins revoke it
        if ((!officerEmail || officerEmail !== account.email) && !isSuperAdmin) {
          throw new HttpsError('permission-denied', '權限不足')
        }
        if (status !== 'open') throw new HttpsError('failed-precondition', '這個連結已經被領取，無法撤銷')

        const officer = officerEmail ? await tx.get(officerRef(officerEmail)) : null
        tx.delete(ref)
        tx.delete(noteRef(inviteId))
        if (officer && isSameOfficer(officer, officerSince)) {
          tx.update(officer.ref, { used: Math.max(0, (Number(officer.data().used) || 0) - quantity) })
        }
        return { revoked: true }
      })
    } catch (error) {
      if (error instanceof HttpsError) throw error
      console.error('[revokeOfficerInvite] unexpected error:', error)
      throw new HttpsError('internal', '撤銷失敗，請稍後再試')
    }
  })

// A guest opens the link, signs in and claims it: the ticket goes to their
// account email and they own the order. Claiming again from the same
// account returns the same ticket.
export const claimOfficerInvite = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const account = getBuyerAccount(context)
    const { inviteId, name } = sanitizeClaimInput(data)
    const ref = inviteRef(inviteId)

    return withNewOrder('claimOfficerInvite', async (orderRef, tx) => {
      const invite = await tx.get(ref)
      if (!invite.exists) throw new HttpsError('not-found', '這個邀請連結無效或已失效')
      const { status, council, officerEmail, officerName, officerSince, quantity, orderId, claimedByUid } = invite.data()

      if (status === 'claimed') {
        if (claimedByUid === account.uid) return { id: orderId }
        throw new HttpsError('failed-precondition', '這個邀請連結已經被領取')
      }
      // an officer taken off the list (even if added again): their links no
      // longer work
      if (council !== true && !(officerEmail && isSameOfficer(await tx.get(officerRef(officerEmail)), officerSince))) {
        throw new HttpsError('not-found', '這個邀請連結無效或已失效')
      }

      tx.create(orderRef, guestOrderOf({
        guest: { name, email: account.email },
        quantity,
        userId: account.uid,
        invitedByUid: invite.data().createdByUid || null,
        ticketCode: newTicketCode(),
        officer: council === true ? null : { email: officerEmail, name: officerName, since: officerSince },
        inviteId
      }))
      tx.update(ref, {
        status: 'claimed',
        orderId: orderRef.id,
        claimedByUid: account.uid,
        claimedAt: FieldValue.serverTimestamp()
      })
      return { id: orderRef.id }
    })
  })

// When an officer's ticket is deleted (by an admin or purgeOrders), its
// tickets go back to that officer's quota, once (not to a later entry for
// the same email).
export const releaseOfficerQuota = functions
  .region(REGION)
  .runWith({ failurePolicy: true }) // retried on failure; its marker makes it a no-op once done
  .firestore.document('orders/{orderId}')
  .onDelete(async (snap, context) => {
    const order = snap.data()
    if (order.complimentary !== true || typeof order.officerEmail !== 'string' || !order.officerEmail) return

    const marker = releaseRef(context.params.orderId)
    const officer = officerRef(order.officerEmail)
    await db.runTransaction(async (tx) => {
      const [released, officerSnap] = await tx.getAll(marker, officer)
      if (released.exists) return
      if (isSameOfficer(officerSnap, order.officerSince)) {
        tx.update(officer, { used: Math.max(0, (Number(officerSnap.data().used) || 0) - ticketCountOf(order)) })
      }
      tx.create(marker, { officerEmail: order.officerEmail, createdAt: FieldValue.serverTimestamp() })
    })
  })
