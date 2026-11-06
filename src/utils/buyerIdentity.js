// 學生 / 社會人士 on orders, for staff only. createOrder sets order.buyerType
// from the account email (a school account, edu.tw, is 學生) and marks items
// whose type is sold to students first with checkId. Orders made before that
// carry none and show nothing.
import { BUYER_TYPES, BUYER_TYPE_LABELS, ELIGIBLE_IDENTITIES } from '../data/ticketTypes.js'
import { HOME_SCHOOL, isSchoolAccount } from '../data/schools.js'

// 學生（切結）: no school account; signed the 學生身分切結書 instead
export function getBuyerTypeLabel(order) {
  const label = BUYER_TYPE_LABELS[order?.buyerType] || ''
  return label && order.studentDeclared === true ? `${label}（切結）` : label
}

// What door staff check when the tickets are collected, or null when nothing
// needs checking. `campus`: bought by a 建國中學 student with their school
// account (本校學生 types such as 一售票 can only be bought this way), so
// check the 建中 student ID. `student`: a school account bought a type sold to
// students first, so check the student ID (or 酷課雲); 社會人士 need no check.
export function getIdCheck(order) {
  if (order?.school === HOME_SCHOOL && isSchoolAccount(order.customerEmail)) {
    return { student: true, campus: true }
  }
  const items = Array.isArray(order?.items) ? order.items : []
  if (!items.some((item) => item?.checkId)) return null
  return { student: order.buyerType === BUYER_TYPES.STUDENT }
}

// Collecting needs the buyer's student card when the order has a ticket of a
// 限建中在學學生 type (一售票、早鳥票), as the types are set now. A type since
// removed counts when a 建中 student bought with their school account.
// `ticketTypes`: settings/ticketTypes' list. Same rule as functions/lib/studentCards.js
export function requiresStudentCard(order, ticketTypes = []) {
  if (!order || order.complimentary || order.streetSale) return false
  const types = new Map(ticketTypes.filter((type) => type?.id).map((type) => [String(type.id), type]))
  const campusBuyer = order.school === HOME_SCHOOL && isSchoolAccount(order.customerEmail)
  return (Array.isArray(order.items) ? order.items : []).some((item) => {
    const type = types.get(String(item?.ticketTypeId || item?.id || ''))
    return type ? type.eligibleBuyerIdentity === ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS : campusBuyer
  })
}
