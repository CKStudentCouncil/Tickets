// Who may buy a ticket type (settings/ticketTypes[].eligibleBuyerIdentity).
// Keep in sync with functions/lib/constants.js
export const ELIGIBLE_IDENTITIES = {
  CAMPUS_STUDENTS: 'campus_students',
  ALL_USERS: 'all_users',
  // 測試票: only staff (友校幹部 and above) see it on the storefront and
  // may buy it, to try out a sale before it opens
  ADMINS_ONLY: 'admins_only'
}

export function isAdminOnlyType(ticketType) {
  return ticketType?.eligibleBuyerIdentity === ELIGIBLE_IDENTITIES.ADMINS_ONLY
}

// 僅限建中及友校 (settings/ticketTypes[].friendSchoolsOnly): only students of
// 建國中學 and the 友校 may buy it, signed in with their school account and
// ordering as that school. Keep in sync with functions/lib/orderValidation.js
export function isFriendSchoolsOnlyType(ticketType) {
  return ticketType?.friendSchoolsOnly === true
}

// orders.buyerType (staff only): 學生 = signed in with a school account
// (edu.tw), 社會人士 = anything else. Keep in sync with functions/lib/constants.js
export const BUYER_TYPES = { STUDENT: 'student', PUBLIC: 'public' }

export const BUYER_TYPE_LABELS = { student: '學生', public: '社會人士' }
