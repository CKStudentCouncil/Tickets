// 學生 / 社會人士 on orders, for staff only. createOrder sets order.buyerType
// from the account email (a school account, edu.tw, is 學生) and marks items
// whose type is sold to students first with checkId. Orders made before that
// carry none and show nothing.
import { BUYER_TYPES, BUYER_TYPE_LABELS } from '../data/ticketTypes.js'

// 學生（切結）: no school account; signed the 學生身分切結書 instead
export function getBuyerTypeLabel(order) {
  const label = BUYER_TYPE_LABELS[order?.buyerType] || ''
  return label && order.studentDeclared === true ? `${label}（切結）` : label
}

// What door staff check when the tickets are collected, or null when none of
// the order's types is sold to students first. `student`: a school account
// bought it, so check the student ID (or 酷課雲); 社會人士 need no check.
export function getIdCheck(order) {
  const items = Array.isArray(order?.items) ? order.items : []
  if (!items.some((item) => item?.checkId)) return null
  return { student: order.buyerType === BUYER_TYPES.STUDENT }
}
