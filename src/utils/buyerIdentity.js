// Who an order's tickets were sold to, for the check-in desk. createOrder
// copies each type's eligibleBuyerIdentity onto its item; orders made before
// that carry none and show nothing.
import { ELIGIBLE_IDENTITIES } from '../data/ticketTypes.js'

export const IDENTITY_LABELS = {
  [ELIGIBLE_IDENTITIES.EDU_STUDENTS]: '學生票',
  [ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS]: '建中學生票',
  [ELIGIBLE_IDENTITIES.ALL_USERS]: '社會人士票'
}

export function getItemIdentityLabel(item) {
  return IDENTITY_LABELS[item?.eligibleBuyerIdentity] || ''
}

// { known, studentTickets, generalOnly }: `known` when any item says who it
// was sold to; `studentTickets` counts the 學生 (edu.tw) tickets whose buyer
// must show a student ID at pickup; `generalOnly` when every item says it
// was sold to anyone (社會人士)
export function getOrderIdentity(order) {
  const items = Array.isArray(order?.items) ? order.items : []
  let known = false
  let studentTickets = 0
  let generalOnly = items.length > 0

  for (const item of items) {
    const identity = item?.eligibleBuyerIdentity
    if (identity !== ELIGIBLE_IDENTITIES.ALL_USERS) generalOnly = false
    if (!IDENTITY_LABELS[identity]) continue
    known = true
    if (identity === ELIGIBLE_IDENTITIES.EDU_STUDENTS) {
      studentTickets += Math.max(0, Number(item.quantity) || 0)
    }
  }

  return { known, studentTickets, generalOnly }
}
