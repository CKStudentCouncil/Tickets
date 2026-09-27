// Pure values shared by the functions and the email templates (no Firebase
// initialisation here, so tests can import them freely).

export const REGION = 'asia-east1'

// Production site; QR codes and email links point here.
export const SITE_URL = 'https://tickets.cksc.tw'

// Opening time used until a super admin sets settings/shop.openAt; before it
// only staff can order. Keep in sync with src/config/app.js
export const SHOP_OPEN_AT = new Date('2026-11-05T12:00:00+08:00')

// Keep in sync with src/data/schools.js
export const SCHOOL_CODES = {
  建國中學: 'CKS',
  北一女中: 'TFG',
  中山女高: 'ZS',
  景美女中: 'JM',
  成功高中: 'CG',
  師大附中: 'HSNU',
  建中家長會: 'CKP',
  建中老師: 'CKT',
  其他學校或社會人士: 'O'
}

// 本校: tickets marked 本校學生 (campus_students) are for its students only,
// bought while signed in with a school Google account (verified email)
export const HOME_SCHOOL = '建國中學'
export const SCHOOL_ACCOUNT_DOMAIN = 'gl.ck.tp.edu.tw'

// Students of these schools give their class and seat number
export const CAMPUS_SCHOOLS = new Set([
  '建國中學',
  '北一女中',
  '中山女高',
  '景美女中',
  '成功高中',
  '師大附中'
])

export const ELIGIBLE_IDENTITIES = {
  CAMPUS_STUDENTS: 'campus_students',
  ALL_USERS: 'all_users'
}

export const ROLE_RANK = { manager: 1, admin: 2, super_admin: 3 }

// The buyer's order page; they sign in with the account they ordered with
export function getBuyerOrderUrl(orderId) {
  return `${SITE_URL}/orders/${encodeURIComponent(orderId)}`
}

// Ticket QR target for door staff. `ticketCode` is a random per-order code, so
// a QR code cannot be forged just by guessing an order id.
export function getAdminOrderUrl(orderId, ticketCode = '') {
  const url = `${SITE_URL}/admin/orders/${encodeURIComponent(orderId)}`
  return ticketCode ? `${url}?c=${encodeURIComponent(ticketCode)}` : url
}
