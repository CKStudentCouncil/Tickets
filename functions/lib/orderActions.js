import * as functions from 'firebase-functions/v1'
import { Timestamp } from 'firebase-admin/firestore'

import { db, HttpsError } from './common.js'
import { REGION, ROLE_RANK } from './constants.js'
import { ORDER_ID_PATTERN } from './orderValidation.js'
import { cleanStudentId, requiresStudentCard, studentAccountEmail, ticketTypeMap } from './studentCards.js'

function actionInput(data, field, expectedField) {
  if (typeof data?.orderId !== 'string' || !ORDER_ID_PATTERN.test(data.orderId)) {
    throw new HttpsError('invalid-argument', '訂單編號無效')
  }
  if (typeof data[field] !== 'boolean' || typeof data[expectedField] !== 'boolean') {
    throw new HttpsError('invalid-argument', '請提供目前與新的訂單狀態')
  }
  return { orderId: data.orderId, value: data[field], expected: data[expectedField] }
}

export function staffName(profile, context) {
  // The client cannot choose attribution. Prefer the administrator-assigned
  // staff name, then the stored Google profile / signed token for legacy users.
  for (const candidate of [profile.name, profile.displayName, context.auth.token?.name]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 100)
  }
  return context.auth.uid
}

function metadata(order, field, prefix) {
  const timestamp = order[`${prefix}UpdatedAt`]
  return {
    [field]: order[field] === true,
    [`${prefix}UpdatedAt`]: typeof timestamp?.toDate === 'function' ? timestamp.toDate().toISOString() : null,
    [`${prefix}UpdatedByName`]: typeof order[`${prefix}UpdatedByName`] === 'string' ? order[`${prefix}UpdatedByName`] : '',
    [`${prefix}UpdatedByUid`]: typeof order[`${prefix}UpdatedByUid`] === 'string' ? order[`${prefix}UpdatedByUid`] : ''
  }
}

async function changeStatus(data, context, { field, expectedField, prefix, minRole, verify }) {
  if (!context.auth?.uid) throw new HttpsError('unauthenticated', '請先登入')
  const input = actionInput(data, field, expectedField)
  const orderRef = db.doc(`orders/${input.orderId}`)
  const actorRef = db.doc(`users/${context.auth.uid}`)
  const historyRef = orderRef.collection('history').doc()

  return db.runTransaction(async (tx) => {
    // Read the staff role in the same transaction as the order so revocation
    // cannot race an authorized write. Both status and audit commit together.
    const [actorSnap, orderSnap] = await tx.getAll(actorRef, orderRef)
    const profile = actorSnap.data() || {}
    const rank = Object.hasOwn(ROLE_RANK, profile.role) ? ROLE_RANK[profile.role] : 0
    if (rank < ROLE_RANK[minRole]) throw new HttpsError('permission-denied', '權限不足')
    if (!orderSnap.exists) throw new HttpsError('not-found', '找不到訂單')

    const order = orderSnap.data()
    const current = order[field] === true
    if (current !== input.expected || current === input.value) {
      const code = field === 'delivered' && input.value && current ? 'already-exists' : 'failed-precondition'
      throw new HttpsError(code, current && field === 'delivered' ? '此訂單已領票' : '訂單狀態已變更，請重新確認', metadata(order, field, prefix))
    }

    const verification = verify ? verify({ data, input, order, rank }) : {}
    const updatedAt = Timestamp.now()
    const actorName = staffName(profile, context)
    const patch = {
      [field]: input.value,
      [`${prefix}UpdatedAt`]: updatedAt,
      [`${prefix}UpdatedByName`]: actorName,
      [`${prefix}UpdatedByUid`]: context.auth.uid
    }
    tx.update(orderRef, patch)
    tx.create(historyRef, {
      action: prefix,
      previousValue: current,
      value: input.value,
      actorUid: context.auth.uid,
      actorName,
      occurredAt: updatedAt,
      ...verification
    })
    return metadata(patch, field, prefix)
  })
}

// Other ways staff may check who is collecting, when the student card can't
// be scanned (ID_CHECK_METHODS in src/data/pickup.js)
export const ID_CHECK_METHODS = new Set(['kuclass', 'other_id', 'other'])
export const ID_NOTE_MAX = 200

// { idVerification, idNote? } from data.idCheck, or null when none was given
function idCheckException(data) {
  const check = data.idCheck
  if (check === undefined || check === null) return null
  if (typeof check !== 'object' || !ID_CHECK_METHODS.has(check.method)) {
    throw new HttpsError('invalid-argument', '查驗方式無效')
  }
  const note = typeof check.note === 'string' ? check.note.trim() : ''
  if (note.length > ID_NOTE_MAX) throw new HttpsError('invalid-argument', `查驗說明最多 ${ID_NOTE_MAX} 字`)
  if (check.method === 'other' && !note) throw new HttpsError('failed-precondition', '選「其他」時請寫下怎麼查驗身分')
  return { idVerification: check.method, ...(note ? { idNote: note } : {}) }
}

// Collecting checks two things. The ticket: its QR code, or an admin's
// override. Who collects, for orders with a 限建中在學學生 type: the buyer's
// student card (學號 = the order's school account, photo checked by staff),
// another check staff record (酷課雲, another ID), or an admin's override.
// Either may come first at the desk; both arrive together here.
function verifyDelivery({ data, input, order, rank }, ticketTypes) {
  if (!input.value) {
    if (rank < ROLE_RANK.admin) throw new HttpsError('permission-denied', '只有管理員可以重設領票狀態')
    return { codeVerification: 'not_required', overrideReason: requireOverrideReason(data) }
  }

  // the money first: an unpaid order is marked paid (admins) before it is
  // collected, so nobody walks in on a ticket that was never paid for
  if (order.paid !== true && order.complimentary !== true) {
    throw new HttpsError('failed-precondition', '此訂單尚未付款：請先收款並標記已付款，再領票')
  }

  const isAdmin = rank >= ROLE_RANK.admin
  const studentId = cleanStudentId(data.studentId)
  const cardOk = !!studentId && data.studentCardChecked === true && order.customerEmail === studentAccountEmail(studentId)
  const override = isAdmin && typeof data.overrideReason === 'string' && data.overrideReason.trim()

  let code
  if (typeof data.ticketCode === 'string' && typeof order.ticketCode === 'string' && order.ticketCode && data.ticketCode === order.ticketCode) {
    code = { codeVerification: 'verified' }
  } else if (isAdmin && cardOk && data.skipQr === true) {
    // 忘了 QR Code: an admin lets the student card stand in for it
    code = { codeVerification: 'student_card' }
  } else if (isAdmin) {
    code = { codeVerification: 'admin_override', overrideReason: requireOverrideReason(data) }
  } else {
    throw new HttpsError('permission-denied', '請掃描有效的票券 QR Code；購票人忘了 QR Code 或驗證不符需由管理員處理')
  }

  const card = cardOk ? { idVerification: 'student_card', studentId } : null
  if (!requiresStudentCard(order, ticketTypes)) return { ...code, ...card }
  if (card) return { ...code, ...card }
  const exception = idCheckException(data)
  if (exception) return { ...code, ...exception }
  if (override) return { ...code, idVerification: 'admin_override', overrideReason: requireOverrideReason(data) }
  throw new HttpsError('failed-precondition', '此訂單含限建中在學學生的票種：請掃描購票人的學生證，或選擇其他查驗方式')
}

function requireOverrideReason(data) {
  if (typeof data.overrideReason !== 'string' || !data.overrideReason.trim() || data.overrideReason.length > 500) {
    throw new HttpsError('failed-precondition', '請填寫管理員核對身分及略過 QR 驗證的原因（最多 500 字）')
  }
  return data.overrideReason.trim()
}

export const updateOrderDelivery = functions.region(REGION).https.onCall(async (data, context) => {
  // which ticket types need the student card; read once, outside the
  // transaction, as createOrder's stock transactions read it too
  const ticketTypes = data?.delivered === true && context.auth?.uid
    ? ticketTypeMap((await db.doc('settings/ticketTypes').get()).data())
    : new Map()
  return changeStatus(data, context, {
    field: 'delivered',
    expectedField: 'expectedDelivered',
    prefix: 'delivery',
    minRole: 'manager',
    verify: (args) => verifyDelivery(args, ticketTypes)
  })
})

export const updateOrderPayment = functions.region(REGION).https.onCall((data, context) =>
  changeStatus(data, context, {
    field: 'paid', expectedField: 'expectedPaid', prefix: 'payment', minRole: 'admin'
  })
)
