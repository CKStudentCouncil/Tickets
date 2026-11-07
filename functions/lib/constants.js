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

// 路宣登記 (streetSales.js): the school of every street sale, so the admin
// order list, notices and the sales report tell them apart as an identity
// of their own. Keep in sync with src/data/schools.js
export const STREET_SCHOOL = '路宣'

// 本校: tickets marked 本校學生 (campus_students) are for its students only,
// bought while signed in with a school Google account (verified email)
export const HOME_SCHOOL = '建國中學'
export const SCHOOL_ACCOUNT_DOMAIN = 'gl.ck.tp.edu.tw'

// A 建中 student's school account is ck{學號}@gl.ck.tp.edu.tw, so door staff
// find a student's orders from the ID read off their student card
// (studentCards.js). Keep in sync with src/data/schools.js
export const STUDENT_ACCOUNT_PREFIX = 'ck'
export const STUDENT_ID_PATTERN = /^[0-9]{6,8}$/

// 友校: their students' school Google account domains, for tickets sold to
// 建中及友校 only (friendSchoolsOnly). Keep in sync with src/data/schools.js
export const FRIEND_SCHOOL_DOMAINS = {
  北一女中: 'gapps.fg.tp.edu.tw',
  中山女高: 'm2.csghs.tp.edu.tw',
  景美女中: 'cmgsh.tp.edu.tw',
  成功高中: 'gafe.cksh.tp.edu.tw',
  師大附中: 'gs.hs.ntnu.edu.tw'
}

// Students of these schools give their class and seat number
export const CAMPUS_SCHOOLS = new Set([
  '建國中學',
  '北一女中',
  '中山女高',
  '景美女中',
  '成功高中',
  '師大附中'
])

// Keep in sync with src/data/ticketTypes.js
export const ELIGIBLE_IDENTITIES = {
  CAMPUS_STUDENTS: 'campus_students',
  ALL_USERS: 'all_users',
  // 測試票: only staff (友校幹部 and above) may buy it
  ADMINS_ONLY: 'admins_only'
}

// orders.buyerType, set by createOrder from the account email and shown to
// staff only: a school account (edu.tw) is 學生, anything else 社會人士.
// Keep in sync with src/data/ticketTypes.js
export const BUYER_TYPES = { STUDENT: 'student', PUBLIC: 'public' }

// super_admin is shown as 舞會總副召; developer can do everything a
// super_admin can. Keep in sync with src/data/roles.js and firestore.rules
export const ROLE_RANK = { manager: 1, admin: 2, super_admin: 3, developer: 4 }

// 學弟登記賣票: tickets one registration may take (a seller sold 120 last
// year), and one pickup may record (sellerPickups). Keep in sync with
// src/data/sellerGuide.js and firestore.rules
export const MAX_SELLER_TICKETS = 200

// 公關票: tickets one send or invite link may carry, and the largest quota
// an officer (幹部) may be given. Keep in sync with src/data/guests.js and
// firestore.rules
export const MAX_GUEST_TICKETS = 10
export const MAX_OFFICER_QUOTA = 500
// characters in an invite link's note (officerInviteNotes)
export const MAX_INVITE_NOTE = 100
// 公關票登記連結: characters in a sign-up link's name (shown to whoever signs
// up) and in what a guest writes about themselves for the review
export const MAX_SIGNUP_TITLE = 50
export const MAX_SIGNUP_NOTE = 100

// How a guest invited before the officer quotas knew the council, kept on
// their order: "建班大學長・80 屆 主席" / "親友・副主席 鄭詠齊不存在的女朋友".
// Keep in sync with src/data/guests.js
export function guestRelationText(guest) {
  const detail = String(guest?.relationDetail || '').trim()
  if (guest?.relation === 'alumni') return detail ? `建班大學長・${detail}` : '建班大學長'
  if (guest?.relation === 'friend') return detail ? `親友・${detail}` : '親友'
  return ''
}

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

// 取消訂單 reasons (orderCancel.js, the cancellation email); the page keeps
// the same in src/data/cancellations.js
export const CANCEL_REASONS = {
  unpaid: '逾期未繳費',
  uncollected: '逾期未領票',
  buyer_request: '購票人申請取消',
  violation: '違反銷售條款',
  other: '其他'
}
