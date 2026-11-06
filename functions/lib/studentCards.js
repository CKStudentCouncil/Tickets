// 掃描學生證: door staff read the 學號 off a 建中 student card and find the
// orders of that student's school account, ck{學號}@gl.ck.tp.edu.tw. Holding
// the card, they compare its photo with the person, which then stands in for
// the ticket QR code when the tickets are collected (orderActions.js).
import * as functions from 'firebase-functions/v1'

import { assertRole, db, HttpsError } from './common.js'
import { REGION, SCHOOL_ACCOUNT_DOMAIN, STUDENT_ACCOUNT_PREFIX, STUDENT_ID_PATTERN } from './constants.js'

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

// What staff need to pick the right order; the order page shows the rest
export function orderSummary(id, order) {
  const createdAt = order.createdAt
  return {
    id,
    customerName: typeof order.customerName === 'string' ? order.customerName : '',
    delivered: order.delivered === true,
    paid: order.paid === true,
    items: (Array.isArray(order.items) ? order.items : []).map((item) => ({
      name: typeof item?.name === 'string' ? item.name : '',
      quantity: Number(item?.quantity) || 0
    })),
    createdAt: typeof createdAt?.toDate === 'function' ? createdAt.toDate().toISOString() : null
  }
}

export async function findOrdersByStudentId(data, context) {
  // managers may open single orders, not search them (firestore.rules); this
  // looks up one account only
  await assertRole(context, 'manager')
  const studentId = cleanStudentId(data?.studentId)
  if (!studentId) throw new HttpsError('invalid-argument', '學號格式不正確')

  const email = studentAccountEmail(studentId)
  const snapshot = await db.collection('orders').where('customerEmail', '==', email).limit(ORDER_LIMIT).get()
  const orders = snapshot.docs
    .map((doc) => orderSummary(doc.id, doc.data()))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { studentId, email, orders }
}

export const findStudentOrders = functions.region(REGION).https.onCall(findOrdersByStudentId)
