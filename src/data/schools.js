// Keep in sync with functions/lib/constants.js
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

export const SCHOOLS = Object.keys(SCHOOL_CODES)

// 路宣登記: the school of every street sale (not chosen at checkout), its own
// identity in the admin lists and the sales report. Keep in sync with
// functions/lib/constants.js
export const STREET_SCHOOL = '路宣'

// 本校: tickets marked 本校學生 (campus_students) are for its students only,
// bought while signed in with a school Google account
export const HOME_SCHOOL = '建國中學'
export const SCHOOL_ACCOUNT_DOMAIN = 'gl.ck.tp.edu.tw'

// A 建中 student's school account is ck{學號}@gl.ck.tp.edu.tw: scanning a
// student card at the door finds that account's orders. Keep in sync with
// functions/lib/constants.js
export const STUDENT_ACCOUNT_PREFIX = 'ck'
export const STUDENT_ID_LENGTH = [6, 8]
export const STUDENT_ID_PATTERN = /^[0-9]{6,8}$/

// The 學號 typed or read off a card, or '' when it is not one
export function cleanStudentId(value) {
  const id = String(value ?? '').normalize('NFKC').replace(/\s+/g, '')
  return STUDENT_ID_PATTERN.test(id) ? id : ''
}

export function studentAccountEmail(studentId) {
  const id = cleanStudentId(studentId)
  return id ? `${STUDENT_ACCOUNT_PREFIX}${id}@${SCHOOL_ACCOUNT_DOMAIN}` : ''
}

// Students of these schools give their class and seat number
export const CAMPUS_SCHOOLS = [
  '建國中學',
  '北一女中',
  '中山女高',
  '景美女中',
  '成功高中',
  '師大附中'
]

export function isCampusSchool(school) {
  return CAMPUS_SCHOOLS.includes(school)
}

export function isSchoolAccount(email) {
  return String(email || '').trim().toLowerCase().endsWith(`@${SCHOOL_ACCOUNT_DOMAIN}`)
}

// Any school's account (學生優先購買, and orders' 學生 / 社會人士): the domain
// is edu.tw or ends in .edu.tw (anyone may register a name like fakeedu.tw,
// so the label must be whole). Keep in sync with functions/lib/orderValidation.js
const EDU_ACCOUNT_PATTERN = /@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*edu\.tw$/

export function isEduAccount(email) {
  return EDU_ACCOUNT_PATTERN.test(String(email || '').trim().toLowerCase())
}
