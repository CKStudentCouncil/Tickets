// 掃描學生證: door staff read the 學號 off a 建中 student card and find the
// orders of that student's school account, ck{學號}@gl.ck.tp.edu.tw. Orders
// with a 限建中在學學生 type (一售票、早鳥票) need the card as well as the
// ticket QR code when the tickets are collected (orderActions.js).
import * as functions from 'firebase-functions/v1'

import { assertRole, db, HttpsError } from './common.js'
import {
  ELIGIBLE_IDENTITIES,
  HOME_SCHOOL,
  REGION,
  SCHOOL_ACCOUNT_DOMAIN,
  STUDENT_ACCOUNT_PREFIX,
  STUDENT_ID_PATTERN
} from './constants.js'

// how many orders one account can have is small; this only bounds the read
const ORDER_LIMIT = 20

export function cleanStudentId(value) {
  if (typeof value !== 'string') return ''
  const id = value.normalize('NFKC').replace(/\s+/g, '')
  return STUDENT_ID_PATTERN.test(id) ? id : ''
}

export function studentAccountEmail(studentId) {
  const id = cleanStudentId(studentId)
  return id ? `${STUDENT_ACCOUNT_PREFIX}${id}@${SCHOOL_ACCOUNT_DOMAIN}` : ''
}

// settings/ticketTypes as { id: type }
export function ticketTypeMap(settings) {
  const types = Array.isArray(settings?.types) ? settings.types : []
  return new Map(types.filter((type) => type?.id).map((type) => [String(type.id), type]))
}

// Collecting needs the buyer's student card when the order has a ticket of a
// 限建中在學學生 type, as the ticket types are set now (orders don't store
// it). A type since removed from the settings counts when the order was
// bought by a 建中 student with their school account, as those types are.
// Same rule as requiresStudentCard in src/utils/buyerIdentity.js
// 公關票 and 路宣 paper-ticket orders never have those types.
export function requiresStudentCard(order, ticketTypes) {
  if (order?.complimentary || order?.streetSale) return false
  const items = Array.isArray(order?.items) ? order.items : []
  const campusBuyer = order?.school === HOME_SCHOOL &&
    String(order?.customerEmail || '').trim().toLowerCase().endsWith(`@${SCHOOL_ACCOUNT_DOMAIN}`)
  return items.some((item) => {
    const type = ticketTypes.get(String(item?.ticketTypeId || item?.id || ''))
    return type ? type.eligibleBuyerIdentity === ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS : campusBuyer
  })
}

// What staff need to pick the right order; the order page shows the rest
export function orderSummary(id, order) {
  const createdAt = order.createdAt
  return {
    id,
    customerName: typeof order.customerName === 'string' ? order.customerName : '',
    // tells two buyers with the same name apart
    school: typeof order.school === 'string' ? order.school : '',
    delivered: order.delivered === true,
    paid: order.paid === true,
    items: (Array.isArray(order.items) ? order.items : []).map((item) => ({
      name: typeof item?.name === 'string' ? item.name : '',
      quantity: Number(item?.quantity) || 0
    })),
    createdAt: typeof createdAt?.toDate === 'function' ? createdAt.toDate().toISOString() : null
  }
}

// a buyer's name as typed at the desk: the whole name, as on the order
export const NAME_MAX = 50
export function cleanName(value) {
  if (typeof value !== 'string') return ''
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return name.length >= 1 && name.length <= NAME_MAX ? name : ''
}

// an email as typed at the desk; orders keep it lowercased, guests' as given
export function cleanEmail(value) {
  if (typeof value !== 'string') return ''
  const email = value.normalize('NFKC').trim()
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function summaries(snapshot) {
  return snapshot.docs
    .map((doc) => orderSummary(doc.id, doc.data()))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

// { studentId }: the orders of that 建中 student's school account (a card
// read at the desk, or a 學號 typed). { name } / { email }: the orders with
// exactly that buyer name or email, when the buyer has neither QR code nor
// card at hand
export async function findOrdersByStudentId(data, context) {
  // managers may open single orders, not search them (firestore.rules); this
  // looks up one account, or one exact name, only
  await assertRole(context, 'manager')
  if (data?.email !== undefined) {
    const email = cleanEmail(data.email)
    if (!email) throw new HttpsError('invalid-argument', 'Email 格式不正確')
    const emails = [...new Set([email.toLowerCase(), email])]
    const snapshot = await db.collection('orders').where('customerEmail', 'in', emails).limit(ORDER_LIMIT).get()
    return { email: email.toLowerCase(), orders: summaries(snapshot) }
  }
  if (data?.name !== undefined) {
    const name = cleanName(data.name)
    if (!name) throw new HttpsError('invalid-argument', '姓名格式不正確')
    const snapshot = await db.collection('orders').where('customerName', '==', name).limit(ORDER_LIMIT).get()
    return { name, orders: summaries(snapshot) }
  }
  const studentId = cleanStudentId(data?.studentId)
  if (!studentId) throw new HttpsError('invalid-argument', '學號格式不正確')

  const email = studentAccountEmail(studentId)
  const snapshot = await db.collection('orders').where('customerEmail', '==', email).limit(ORDER_LIMIT).get()
  return { studentId, email, orders: summaries(snapshot) }
}

export const findStudentOrders = functions.region(REGION).https.onCall(findOrdersByStudentId)
