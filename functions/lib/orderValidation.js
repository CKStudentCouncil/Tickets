// Pure order validation used by createOrder (unit-tested in test/).
import { createHash, randomInt } from 'node:crypto'
import { https } from 'firebase-functions/v1'

import {
  SCHOOL_CODES,
  CAMPUS_SCHOOLS,
  HOME_SCHOOL,
  SCHOOL_ACCOUNT_DOMAIN,
  FRIEND_SCHOOL_DOMAINS,
  ELIGIBLE_IDENTITIES,
  BUYER_TYPES,
  ROLE_RANK
} from './constants.js'
import { parseTaipeiDateTime } from './time.js'

const { HttpsError } = https

export const MAX_TICKETS_PER_ORDER = 20

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const TICKET_TYPE_ID_PATTERN = /^[\w-]{1,100}$/

// Order ids: school code + Taiwan date + random suffix, e.g. CKS20261105K7Q2MX.
// A random suffix (instead of a shared daily serial) keeps every checkout off
// one hot counter document. Legacy ids end in a 4-digit serial.
const ORDER_SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
export const ORDER_ID_PATTERN = /^[A-Z]{1,4}\d{8}(\d{4}|[A-HJ-NP-Z2-9]{6})$/

export function generateOrderId(schoolCode, dateKey) {
  let suffix = ''
  for (let i = 0; i < 6; i++) {
    suffix += ORDER_SUFFIX_ALPHABET[randomInt(ORDER_SUFFIX_ALPHABET.length)]
  }
  return `${schoolCode}${dateKey}${suffix}`
}

// Client-generated id that makes a retried checkout return the same order
export function isValidRequestId(value) {
  return typeof value === 'string' && /^[\w-]{16,64}$/.test(value)
}

function cleanString(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

// Per-person limits are counted per normalised account email
export function getBuyerKey(email) {
  return createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex')
}

export function isCampusSchool(school) {
  return CAMPUS_SCHOOLS.has(school)
}

export function isSchoolAccount(email) {
  return String(email || '').trim().toLowerCase().endsWith(`@${SCHOOL_ACCOUNT_DOMAIN}`)
}

// The school (建國中學 or a 友校) whose student account this is, or '' for
// any other account. The whole domain must match. Keep in sync with
// src/data/schools.js
export function accountSchoolOf(email) {
  const address = String(email || '').trim().toLowerCase()
  const at = address.lastIndexOf('@')
  if (at < 1) return ''
  const domain = address.slice(at + 1)
  if (domain === SCHOOL_ACCOUNT_DOMAIN) return HOME_SCHOOL
  return Object.keys(FRIEND_SCHOOL_DOMAINS).find((school) => FRIEND_SCHOOL_DOMAINS[school] === domain) || ''
}

// 僅限建中及友校: only students of 建國中學 and the 友校 may buy the type,
// signed in with their school account
export function isFriendSchoolsOnlyType(ticketType) {
  return ticketType?.friendSchoolsOnly === true
}

// A Taiwanese school account: the domain is edu.tw or ends in .edu.tw.
// Anyone may register a name like fakeedu.tw, so the label must be whole.
const EDU_ACCOUNT_PATTERN = /@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*edu\.tw$/

export function isEduAccount(email) {
  return EDU_ACCOUNT_PATTERN.test(String(email || '').trim().toLowerCase())
}

// 學生 or 社會人士, from the verified account email (staff see it on orders)
// 學生: a school account, or another account that signed the 學生身分切結書
// (`studentDeclared`) to buy a type sold to students first
export function getBuyerType(email, studentDeclared = false) {
  return isEduAccount(email) || studentDeclared === true ? BUYER_TYPES.STUDENT : BUYER_TYPES.PUBLIC
}

// 測試票: only admins (建班幹部 and above) see and buy it
export function isAdminOnlyType(ticketType) {
  return ticketType?.eligibleBuyerIdentity === ELIGIBLE_IDENTITIES.ADMINS_ONLY
}

// 學生優先購買至: before this time only school accounts may buy the type
export function getStudentOnlyUntil(ticketType) {
  return parseTaipeiDateTime(ticketType?.studentOnlyUntil)
}

// Whitelists the buyer fields and ticket quantities; everything else the
// client sends (prices, totals, paid/delivered flags, userId, email...) is
// dropped. The email is always the signed-in account's (`accountEmail`).
export function sanitizeOrderInput(payload, accountEmail) {
  if (!payload || typeof payload !== 'object') {
    throw new HttpsError('invalid-argument', '訂單資料格式錯誤')
  }

  const order = {
    customerName: cleanString(payload.customerName, 50),
    customerEmail: cleanString(accountEmail, 254).toLowerCase(),
    customerPhone: cleanString(payload.customerPhone, 30),
    school: cleanString(payload.school, 30),
    class: cleanString(payload.class, 20),
    number: cleanString(payload.number, 10),
    office: cleanString(payload.office, 30),
    // 「我確認我是在學學生…」, needed from school accounts buying a type sold
    // to students first
    studentConfirmed: payload.studentConfirmed === true,
    // 學生身分切結書: lets other accounts buy such a type during 學生優先購買
    studentDeclared: payload.studentDeclared === true
  }

  // the 切結書 is only taken with its details: a bare studentDeclared would
  // let any account through 學生優先購買 with nothing for staff to check
  if (order.studentDeclared) {
    const declaration = payload.studentDeclaration
    const reasons = new Set(['school_no_edu', 'email_disabled', 'freshman', 'other'])
    const details = {
      name: cleanString(declaration?.name, 50),
      school: cleanString(declaration?.school, 100),
      studentId: cleanString(declaration?.studentId, 50),
      reason: cleanString(declaration?.reason, 30)
    }
    if (!details.name || !details.school || !details.studentId || !reasons.has(details.reason)) {
      throw new HttpsError('invalid-argument', '請完成學生身分切結書資料')
    }
    order.studentDeclaration = details
  }

  if (!order.customerName || !order.customerPhone) {
    throw new HttpsError('invalid-argument', '請填寫姓名與電話')
  }

  if (!EMAIL_PATTERN.test(order.customerEmail)) {
    throw new HttpsError('invalid-argument', 'Email 格式不正確')
  }

  if (!Object.hasOwn(SCHOOL_CODES, order.school)) {
    throw new HttpsError('invalid-argument', '請選擇學校或身分')
  }

  // Only students give class / seat number, only teachers an office
  if (!isCampusSchool(order.school)) {
    order.class = ''
    order.number = ''
  }
  if (order.school !== '建中老師') {
    order.office = ''
  }

  const quantities = new Map()

  for (const item of Array.isArray(payload.items) ? payload.items : []) {
    const id = String(item?.ticketTypeId || item?.id || '')
    const quantity = Number(item?.quantity)

    if (!TICKET_TYPE_ID_PATTERN.test(id)) {
      throw new HttpsError('invalid-argument', '票種資料無效')
    }

    // checked per item, so [{ qty: 5 }, { qty: -3 }] or 0.5 are rejected
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new HttpsError('invalid-argument', '票券數量必須為正整數')
    }

    if (quantity > MAX_TICKETS_PER_ORDER) {
      throw new HttpsError('invalid-argument', `單筆訂單最多 ${MAX_TICKETS_PER_ORDER} 張`)
    }

    quantities.set(id, (quantities.get(id) || 0) + quantity)
  }

  if (quantities.size === 0) {
    throw new HttpsError('invalid-argument', '訂單內容為空')
  }

  const totalQuantity = [...quantities.values()].reduce((sum, n) => sum + n, 0)

  if (totalQuantity > MAX_TICKETS_PER_ORDER) {
    throw new HttpsError('invalid-argument', `單筆訂單最多 ${MAX_TICKETS_PER_ORDER} 張`)
  }

  return { order, quantities }
}

// null = unlimited. Unlimited stock must be switched on explicitly
// (unlimitedStock); a missing or 0 total means nothing can be sold.
export function getStockLimit(ticketType) {
  if (ticketType.unlimitedStock === true) return null
  const total = Number(ticketType.totalTicketQuantity)
  return Number.isInteger(total) && total > 0 ? total : 0
}

export function getPurchaseLimit(ticketType) {
  return ticketType.unlimited ? null : Number(ticketType.purchaseLimitPerPerson) || null
}

// Each ticket type's sales are counted in SHARD_COUNT documents
// (ticketSales/{typeId}/shards/{k}) so simultaneous checkouts do not all
// lock one counter (PARTY-28). 1,000 buyers at once on 20 shards put about
// 50 on each and spent most of their wait retrying lost locks, hence 50.
// Raising it is safe when no sale is open (save the ticket types afterwards
// so planStockShards plans the caps for the new count); never lower it once
// tickets have been sold, even between sales: the dropped shards keep their
// sales but are no longer read, so those tickets would be sold again.
export const SHARD_COUNT = 50

// What a type's shards may sell: the stock minus the legacy counter
export function getAvailable(stock, legacySold) {
  return Math.max(0, stock - (Number(legacySold) || 0))
}

// Shares `available` tickets out as one cap per shard, given what each shard
// has sold (`sold`, SHARD_COUNT numbers). No cap is below its shard's sales
// and the caps add up to `available` (or to the sales, when more were sold
// than is available now). So as long as no shard sells past its cap, the type
// cannot oversell, whatever the shards sold before: they may be uneven after
// the stock was lowered or the type was unlimited. The room left is spread
// evenly, the remainder going to the first shards.
export function planShardCaps(available, sold) {
  const room = Math.max(0, available - sold.reduce((sum, n) => sum + n, 0))
  const base = Math.floor(room / SHARD_COUNT)
  return sold.map((n, k) => n + base + (k < room % SHARD_COUNT ? 1 : 0))
}

// The caps stored in ticketSales/{typeId}.shardCaps ({ available, caps }), or
// null when they were worked out for another stock and must be planned again.
export function getCurrentCaps(shardCaps, available) {
  const caps = shardCaps?.available === available ? shardCaps.caps : null
  return Array.isArray(caps) && caps.length === SHARD_COUNT ? caps : null
}

// Takes `quantity` tickets from `shards` in order, each up to its cap.
// `sold[i]` is what shards[i] has sold. Returns { [k]: n }, or null when
// these shards cannot hold them.
export function allocateStock({ caps, shards, sold, quantity }) {
  const allocation = {}
  let remaining = quantity

  shards.forEach((k, i) => {
    const take = Math.min(remaining, Math.max(0, caps[k] - sold[i]))
    if (take > 0) {
      allocation[k] = take
      remaining -= take
    }
  })

  return remaining === 0 ? allocation : null
}

// Chooses the shards to lock from an unlocked look at all of them (`sold`,
// read before the transaction). Returns null when they cannot hold `quantity`
// (sold out), otherwise one random shard that can hold the whole order or,
// when none can, random shards with room until they add up. A checkout that
// lost the race for its shards looks again and gets a fresh random pick;
// locking every shard with room instead would collide with every other
// checkout. Shards only fill up (except when an order is deleted), so a
// shard seen full stays full.
export function planShards({ caps, sold, quantity, random }) {
  const free = (k) => caps[k] - sold[k]
  const open = Array.from({ length: SHARD_COUNT }, (_, k) => k).filter((k) => free(k) > 0)

  if (open.reduce((sum, k) => sum + free(k), 0) < quantity) return null

  const whole = open.filter((k) => free(k) >= quantity)
  if (whole.length > 0) return [whole[random(whole.length)]]

  for (let i = open.length - 1; i > 0; i--) {
    const j = random(i + 1)
    ;[open[i], open[j]] = [open[j], open[i]]
  }

  const shards = []
  let room = 0
  for (const k of open) {
    shards.push(k)
    room += free(k)
    if (room >= quantity) break
  }
  return shards
}

// Throws when this type is not on sale now or not for this buyer. `email` is
// the verified account email, `roleRank` the buyer's staff rank (ROLE_RANK,
// 0 for buyers who are not staff; only needed for 測試票). Also checked
// before the transaction, so a buyer is told this rather than that the type
// is sold out.
export function checkSaleOpen(ticketType, { now, school, email, studentConfirmed, studentDeclared, roleRank = 0 }) {
  // 測試票: checked first, so other buyers learn nothing about its sale
  // window; the storefront doesn't list it for them either
  if (isAdminOnlyType(ticketType) && !(Number.isInteger(roleRank) && roleRank >= ROLE_RANK.admin)) {
    throw new HttpsError('permission-denied', `${ticketType.name}為測試票，僅限管理員購買`)
  }

  const start = parseTaipeiDateTime(ticketType.salesStartTime)
  const end = parseTaipeiDateTime(ticketType.salesEndTime)

  if (!start || !end || now < start) {
    throw new HttpsError('failed-precondition', `${ticketType.name}尚未開賣`)
  }

  if (now > end) {
    throw new HttpsError('failed-precondition', `${ticketType.name}已結束販售`)
  }

  // 本校學生 tickets: 建國中學 students only (not the partner schools),
  // signed in with their school account
  if (ticketType.eligibleBuyerIdentity === ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS) {
    if (!isSchoolAccount(email)) {
      throw new HttpsError(
        'permission-denied',
        `${ticketType.name}僅限使用 @${SCHOOL_ACCOUNT_DOMAIN} 帳號登入購買`
      )
    }
    if (school !== HOME_SCHOOL) {
      throw new HttpsError('permission-denied', `${ticketType.name}僅限建中在學學生購買`)
    }
  }

  // 僅限建中及友校: a 建中 or 友校 student account, ordering as a student of
  // that same school (not the 學生身分切結書: the account is the proof)
  if (isFriendSchoolsOnlyType(ticketType)) {
    const accountSchool = accountSchoolOf(email)
    if (!accountSchool) {
      throw new HttpsError(
        'permission-denied',
        `${ticketType.name}僅限建中及友校學生以學校帳號登入購買`
      )
    }
    if (school !== accountSchool) {
      throw new HttpsError(
        'permission-denied',
        `你登入的是${accountSchool}帳號，學校請選擇「${accountSchool}」`
      )
    }
  }

  // 學生優先購買: until studentOnlyUntil only school accounts (edu.tw), or
  // others who signed the 學生身分切結書 (their student ID is checked at pickup)
  const studentOnlyUntil = getStudentOnlyUntil(ticketType)
  if (studentOnlyUntil && now < studentOnlyUntil && !isEduAccount(email) && studentDeclared !== true) {
    throw new HttpsError(
      'permission-denied',
      `${ticketType.name}目前僅開放學生以學校帳號（結尾為 edu.tw）購買`
    )
  }

  // school accounts confirm they are students and will bring a student ID
  if (studentOnlyUntil && isEduAccount(email) && studentConfirmed !== true) {
    throw new HttpsError('failed-precondition', `購買${ticketType.name}請先勾選確認你是在學學生`)
  }
}

// Throws when this buyer may not buy `quantity` tickets of this type now.
// `alreadyBought` comes from the counter read in the transaction. Stock is
// checked by allocateStock.
export function checkTicketType(ticketType, quantity, { now, school, email, studentConfirmed, studentDeclared, roleRank, alreadyBought }) {
  checkSaleOpen(ticketType, { now, school, email, studentConfirmed, studentDeclared, roleRank })

  const limit = getPurchaseLimit(ticketType)

  if (limit !== null && alreadyBought + quantity > limit) {
    throw new HttpsError('failed-precondition', `${ticketType.name}超過每人限購 ${limit} 張`)
  }
}
