// Who may buy a ticket type (settings/ticketTypes[].eligibleBuyerIdentity).
// Keep in sync with functions/lib/constants.js
export const ELIGIBLE_IDENTITIES = {
  CAMPUS_STUDENTS: 'campus_students',
  ALL_USERS: 'all_users'
}

// orders.buyerType (staff only): 學生 = signed in with a school account
// (edu.tw), 社會人士 = anything else. Keep in sync with functions/lib/constants.js
export const BUYER_TYPES = { STUDENT: 'student', PUBLIC: 'public' }

export const BUYER_TYPE_LABELS = { student: '學生', public: '社會人士' }
