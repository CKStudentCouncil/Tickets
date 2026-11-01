// 學生 / 社會人士 on orders, for staff only. createOrder sets order.buyerType
// from the account email (a school account, edu.tw, is 學生) and marks items
// whose type is sold to students first or has an age limit with checkId
// (and maxAge). Orders made before that carry none and show nothing.
import { BUYER_TYPES, BUYER_TYPE_LABELS } from '../data/ticketTypes.js'

export function getBuyerTypeLabel(order) {
  return BUYER_TYPE_LABELS[order?.buyerType] || ''
}

// What door staff check when the tickets are collected, or null when none of
// the order's types asks for it. `student`: show a student ID (or 酷課雲);
// `maxAge`: show an ID proving the buyer is younger than this (社會人士
// only; students are not age-limited).
export function getIdCheck(order) {
  const items = (Array.isArray(order?.items) ? order.items : []).filter((item) => item?.checkId)
  if (!items.length) return null

  const ages = items.map((item) => Number(item.maxAge)).filter((age) => Number.isInteger(age) && age > 0)

  const student = order.buyerType === BUYER_TYPES.STUDENT
  return { student, maxAge: !student && ages.length ? Math.min(...ages) : null }
}
