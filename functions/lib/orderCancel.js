import * as functions from 'firebase-functions/v1'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'

import { db, HttpsError, assertRole } from './common.js'
import { CANCEL_REASONS, REGION, ROLE_RANK } from './constants.js'
import { ORDER_ID_PATTERN } from './orderValidation.js'
import { staffName } from './orderActions.js'
import { getTaiwanYear } from './time.js'
import { cancellationJobId, enqueueCancellationNotice } from './mailQueue.js'

// 取消訂單與退款 (src/data/cancellations.js keeps the same values).
//
// cancelOrders moves an order from orders/{id} to cancelledOrders/{id} in one
// transaction, with why, by whom and what is owed back. Deleting it from
// `orders` takes it out of every total, notice, report and purge, and
// releaseOrderStock gives its tickets back to the stock and to the buyer's
// allowance. Super admins (and developers) cancel and mark refunds handed back
// with updateRefundStatus; door staff only see a cancelled ticket as such.

export { CANCEL_REASONS }
export const NOTE_REQUIRED_REASONS = ['violation', 'other']
// 銷售條款 第三條 (通知限期補正) and 第四條 (經通知三次仍未領票)
export const PAYMENT_NOTICES_TO_CANCEL = 1
export const PICKUP_NOTICES_TO_CANCEL = 3
export const MAX_CANCEL_ORDERS = 100
export const MAX_CANCEL_NOTE = 200

// notices.{jobId}.type values counted as each kind (recordOrderNotices)
export const NOTICE_TYPES_COUNTED = {
  payment: ['payment', 'both'],
  pickup: ['pickup', 'both']
}
export const COUNTED_NOTICE_TYPES = [...new Set(Object.values(NOTICE_TYPES_COUNTED).flat())]

export const cancelledOrderRef = (orderId) => db.doc(`cancelledOrders/${orderId}`)

export function noticeCountsOf(order) {
  const notices = order?.notices && typeof order.notices === 'object'
    ? Object.values(order.notices).filter((notice) => notice && typeof notice === 'object')
    : []
  const count = (types) => notices.filter((notice) => types.includes(notice.type)).length
  return { payment: count(NOTICE_TYPES_COUNTED.payment), pickup: count(NOTICE_TYPES_COUNTED.pickup) }
}

// refund: 'full' | 'none', or a whole NT$ amount for a single order. Only
// paid orders have anything to give back; the amount is checked against each
// order in its transaction.
export function sanitizeCancelInput(data) {
  const ids = Array.isArray(data?.orderIds) ? [...new Set(data.orderIds)] : []
  if (!ids.length || ids.length > MAX_CANCEL_ORDERS || ids.some((id) => typeof id !== 'string' || !ORDER_ID_PATTERN.test(id))) {
    throw new HttpsError('invalid-argument', `請選擇 1–${MAX_CANCEL_ORDERS} 筆有效的訂單`)
  }

  const reason = String(data?.reason || '')
  if (!Object.hasOwn(CANCEL_REASONS, reason)) throw new HttpsError('invalid-argument', '請選擇取消原因')

  const note = typeof data?.note === 'string' ? data.note.trim() : ''
  if (note.length > MAX_CANCEL_NOTE) throw new HttpsError('invalid-argument', `說明最多 ${MAX_CANCEL_NOTE} 字`)
  if (NOTE_REQUIRED_REASONS.includes(reason) && !note) throw new HttpsError('invalid-argument', '這個取消原因需要填寫說明')

  let refund = data?.refund ?? null
  if (refund !== null && refund !== 'full' && refund !== 'none') {
    if (!Number.isInteger(refund) || refund < 0) throw new HttpsError('invalid-argument', '退款金額需為 0 以上的整數')
    if (ids.length !== 1) throw new HttpsError('invalid-argument', '自訂退款金額一次只能取消一筆訂單')
  }

  // 訂單取消通知 to each buyer with an email, unless turned off
  const notify = data?.notify !== false

  return { orderIds: ids, reason, note, refund, notify }
}

// What the order owes back, or throws when cancelling it is not allowed
export function checkCancellation(order, { reason, refund }) {
  if (order.complimentary === true) throw new HttpsError('failed-precondition', '公關票請直接刪除，張數會退回發出的幹部')
  if (order.streetSale === true) throw new HttpsError('failed-precondition', '路宣紙本票已當場交付，不能取消')
  if (order.delivered === true) {
    throw new HttpsError('failed-precondition', '已領票的訂單不能取消；若購票人退回紙本票，請先標記未領票並填寫原因')
  }

  const counts = noticeCountsOf(order)
  if (reason === 'unpaid') {
    if (order.paid === true) throw new HttpsError('failed-precondition', '此訂單已付款，不是逾期未繳費')
    if (counts.payment < PAYMENT_NOTICES_TO_CANCEL) throw new HttpsError('failed-precondition', '此訂單還沒有收到繳費通知')
  }
  if (reason === 'uncollected' && counts.pickup < PICKUP_NOTICES_TO_CANCEL) {
    throw new HttpsError('failed-precondition', `此訂單收到 ${counts.pickup} 次領票通知，需滿 ${PICKUP_NOTICES_TO_CANCEL} 次`)
  }

  if (order.paid !== true) return 0
  const total = Math.max(0, Number(order.finalTotal) || 0)
  if (refund === 'full') return total
  if (refund === 'none') return 0
  if (Number.isInteger(refund)) {
    if (refund > total) throw new HttpsError('invalid-argument', `退款金額不能超過已付的 NT$ ${total}`)
    return refund
  }
  throw new HttpsError('invalid-argument', '此訂單已付款，請選擇退款方式')
}

const createdAtOf = (order) => (typeof order.createdAt?.toDate === 'function' ? order.createdAt.toDate() : null)

async function cancelOne(orderId, input, context) {
  const orderRef = db.doc(`orders/${orderId}`)
  const cancelledRef = cancelledOrderRef(orderId)
  const actorRef = db.doc(`users/${context.auth.uid}`)

  return db.runTransaction(async (tx) => {
    // the role is read with the order, so a revoked admin cannot race it
    const [actorSnap, orderSnap, cancelledSnap] = await tx.getAll(actorRef, orderRef, cancelledRef)
    const profile = actorSnap.data() || {}
    const rank = Object.hasOwn(ROLE_RANK, profile.role) ? ROLE_RANK[profile.role] : 0
    if (rank < ROLE_RANK.super_admin) throw new HttpsError('permission-denied', '權限不足')
    if (!orderSnap.exists) {
      if (cancelledSnap.exists) return { status: 'already', refundAmount: Number(cancelledSnap.data().refundAmount) || 0 }
      throw new HttpsError('not-found', '找不到訂單')
    }

    const order = orderSnap.data()
    const refundAmount = checkCancellation(order, input)
    const now = Timestamp.now()
    // queued before the writes below: the queue reads its job document first
    const notify = input.notify && typeof order.customerEmail === 'string' && order.customerEmail.includes('@')
    if (notify) await enqueueCancellationNotice(tx, orderId, context.auth.uid)
    tx.set(cancelledRef, {
      ...order,
      cancelReason: input.reason,
      cancelNote: input.note,
      cancelledAt: now,
      cancelledByUid: context.auth.uid,
      cancelledByName: staffName(profile, context),
      // the party it belongs to, as 清除所有訂單 files orders
      cancelYear: getTaiwanYear(createdAtOf(order) || now.toDate()),
      refundAmount,
      refundStatus: refundAmount > 0 ? 'pending' : 'none',
      // the mail worker records the notice's outcome here (mailQueueCore.js)
      ...(notify
        ? { cancelEmailJobId: cancellationJobId(orderId), cancelEmailStatus: 'queued', cancelEmailUpdatedAt: now }
        : { cancelEmailStatus: 'skipped' })
    })
    tx.delete(orderRef)
    return { status: 'cancelled', refundAmount, emailQueued: notify }
  })
}

// One transaction per order, so one that changed meanwhile (paid, collected,
// already cancelled) is reported and the rest still go through.
export const cancelOrders = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
    await assertRole(context, 'super_admin')
    const input = sanitizeCancelInput(data)

    const results = []
    for (const orderId of input.orderIds) {
      try {
        results.push({ orderId, ...await cancelOne(orderId, input, context) })
      } catch (error) {
        if (error instanceof HttpsError && error.code === 'permission-denied') throw error
        if (!(error instanceof HttpsError)) console.error('[cancelOrders]', orderId, error)
        results.push({ orderId, status: 'skipped', message: error instanceof HttpsError ? error.message : '取消失敗，請重試' })
      }
    }
    return {
      results,
      cancelledCount: results.filter((result) => result.status === 'cancelled').length
    }
  })

function refundMetadata(order) {
  const at = order.refundedAt
  return {
    refundStatus: order.refundStatus || 'none',
    refundedAt: typeof at?.toDate === 'function' ? at.toDate().toISOString() : null,
    refundedByName: typeof order.refundedByName === 'string' ? order.refundedByName : ''
  }
}

// 標記已退款 / 改回待退款, with the state the admin saw
export const updateRefundStatus = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) throw new HttpsError('unauthenticated', '請先登入')
    if (typeof data?.orderId !== 'string' || !ORDER_ID_PATTERN.test(data.orderId)) {
      throw new HttpsError('invalid-argument', '訂單編號無效')
    }
    if (typeof data.refunded !== 'boolean' || typeof data.expectedRefunded !== 'boolean') {
      throw new HttpsError('invalid-argument', '請提供目前與新的退款狀態')
    }

    const ref = cancelledOrderRef(data.orderId)
    const actorRef = db.doc(`users/${context.auth.uid}`)
    return db.runTransaction(async (tx) => {
      const [actorSnap, snap] = await tx.getAll(actorRef, ref)
      const profile = actorSnap.data() || {}
      const rank = Object.hasOwn(ROLE_RANK, profile.role) ? ROLE_RANK[profile.role] : 0
      if (rank < ROLE_RANK.super_admin) throw new HttpsError('permission-denied', '權限不足')
      if (!snap.exists) throw new HttpsError('not-found', '找不到已取消的訂單')

      const order = snap.data()
      if (!(Number(order.refundAmount) > 0)) throw new HttpsError('failed-precondition', '此訂單沒有需要退的款項')
      const current = order.refundStatus === 'done'
      if (current !== data.expectedRefunded || current === data.refunded) {
        throw new HttpsError('failed-precondition', '退款狀態已變更，請重新確認', refundMetadata(order))
      }

      const patch = data.refunded
        ? { refundStatus: 'done', refundedAt: Timestamp.now(), refundedByName: staffName(profile, context), refundedByUid: context.auth.uid }
        : { refundStatus: 'pending', refundedAt: FieldValue.delete(), refundedByName: FieldValue.delete(), refundedByUid: FieldValue.delete() }
      tx.update(ref, patch)
      return data.refunded ? refundMetadata(patch) : { refundStatus: 'pending', refundedAt: null, refundedByName: '' }
    })
  })
