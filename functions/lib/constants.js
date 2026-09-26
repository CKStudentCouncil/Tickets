// Pure values shared by the functions and the email templates (no Firebase
// initialisation here, so tests can import them freely).

export const REGION = 'asia-east1'

// Production site; QR codes and email links point here.
export const SITE_URL = 'https://tickets.cksc.tw'

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

export function getAdminOrderUrl(orderId) {
  return `${SITE_URL}/admin/orders/${encodeURIComponent(orderId)}`
}
