export const ELIGIBLE_IDENTITIES = {
  CAMPUS_STUDENTS: 'campus_students',
  ALL_USERS: 'all_users'
}

export const TICKET_TYPE_LABELS = {
  campus_ticket: '校內票',
  first_release: '一階票',
  second_release: '二階票'
}

export const DEFAULT_TICKET_TYPES = [
  {
    id: 'campus_ticket',
    name: '校內票',
    eligibleBuyerIdentity: ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS,
    salesStartTime: null,
    salesEndTime: null,
    totalTicketQuantity: 1200,
    purchaseLimitPerPerson: 2
  },
  {
    id: 'first_release',
    name: '一階票',
    eligibleBuyerIdentity: ELIGIBLE_IDENTITIES.ALL_USERS,
    salesStartTime: null,
    salesEndTime: null,
    totalTicketQuantity: 1500,
    purchaseLimitPerPerson: 4
  },
  {
    id: 'second_release',
    name: '二階票',
    eligibleBuyerIdentity: ELIGIBLE_IDENTITIES.ALL_USERS,
    salesStartTime: null,
    salesEndTime: null,
    totalTicketQuantity: 1500,
    purchaseLimitPerPerson: null
  }
]
