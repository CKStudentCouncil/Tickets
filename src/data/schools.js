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

// 本校: tickets marked 本校學生 (campus_students) are for its students only,
// bought while signed in with a school Google account
export const HOME_SCHOOL = '建國中學'
export const SCHOOL_ACCOUNT_DOMAIN = 'gl.ck.tp.edu.tw'

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
