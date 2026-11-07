// 都掃不到: what staff typed to find a buyer's order. An order number opens
// it; a 學號, an email or a buyer's exact name are looked up
// (findStudentOrders, functions/lib/studentCards.js).
import { cleanStudentId } from '../data/schools.js'
import { ORDER_ID_PATTERN } from './ticketQr.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME_MAX = 50

// { kind: 'order', orderId } | { kind: 'studentId', studentId } |
// { kind: 'email', email } | { kind: 'name', name } | null
export function classifySearch(text) {
  const value = String(text ?? '').normalize('NFKC').trim()
  if (!value) return null
  const orderId = value.toUpperCase()
  if (ORDER_ID_PATTERN.test(orderId)) return { kind: 'order', orderId }
  const studentId = cleanStudentId(value)
  if (studentId) return { kind: 'studentId', studentId }
  if (value.includes('@')) return EMAIL_PATTERN.test(value) && value.length <= 254 ? { kind: 'email', email: value } : null
  const name = value.replace(/\s+/g, ' ')
  return name.length <= NAME_MAX ? { kind: 'name', name } : null
}

export function searchLabel(search) {
  if (!search) return ''
  if (search.kind === 'order') return `訂單 ${search.orderId}`
  if (search.kind === 'studentId') return `學號 ${search.studentId}`
  return search.kind === 'email' ? search.email : search.name
}

export function notFoundText(search) {
  if (search.kind === 'studentId') return `學號 ${search.studentId} 沒有訂單`
  if (search.kind === 'email') return `${search.email} 沒有訂單`
  return `找不到姓名是「${search.name}」的訂單（姓名要和訂單上的完全相同）`
}

// the order to open at once, or null when staff should pick one
export function pickOrder(orders) {
  const waiting = orders.filter((order) => !order.delivered)
  if (waiting.length === 1) return waiting[0]
  return orders.length === 1 ? orders[0] : null
}

// the orders listed to pick from: the ones not collected yet, if any
export function choices(orders) {
  const waiting = orders.filter((order) => !order.delivered)
  return waiting.length ? waiting : orders
}

export const SEARCH_HINT = '訂單編號、姓名、Email 或學號'
