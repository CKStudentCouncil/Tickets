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

// 友校: their students' school Google account domains, for the 友校帳號
// sign-in and tickets sold to 建中及友校 only (friendSchoolsOnly). Keep in
// sync with functions/lib/constants.js
export const TFG_DOMAIN = 'gapps.fg.tp.edu.tw'
export const ZS_DOMAIN = 'm2.csghs.tp.edu.tw'
export const JM_DOMAIN = 'cmgsh.tp.edu.tw'
export const CG_DOMAIN = 'gafe.cksh.tp.edu.tw'
export const HSNU_DOMAIN = 'gs.hs.ntnu.edu.tw'

export const FRIEND_SCHOOL_DOMAINS = {
  北一女中: TFG_DOMAIN,
  中山女高: ZS_DOMAIN,
  景美女中: JM_DOMAIN,
  成功高中: CG_DOMAIN,
  師大附中: HSNU_DOMAIN
}

export const FRIEND_SCHOOLS = Object.keys(FRIEND_SCHOOL_DOMAINS)

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

// The school (建國中學 or a 友校) whose student account this is, or '' for
// any other account. The whole domain must match. Keep in sync with
// functions/lib/orderValidation.js
export function accountSchoolOf(email) {
  const address = String(email || '').trim().toLowerCase()
  const at = address.lastIndexOf('@')
  if (at < 1) return ''
  const domain = address.slice(at + 1)
  if (domain === SCHOOL_ACCOUNT_DOMAIN) return HOME_SCHOOL
  return FRIEND_SCHOOLS.find((school) => FRIEND_SCHOOL_DOMAINS[school] === domain) || ''
}

// Any school's account (學生優先購買, and orders' 學生 / 社會人士): the domain
// is edu.tw or ends in .edu.tw (anyone may register a name like fakeedu.tw,
// so the label must be whole). Keep in sync with functions/lib/orderValidation.js
const EDU_ACCOUNT_PATTERN = /@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*edu\.tw$/

export function isEduAccount(email) {
  return EDU_ACCOUNT_PATTERN.test(String(email || '').trim().toLowerCase())
}
