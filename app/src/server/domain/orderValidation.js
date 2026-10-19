// Pure order validation used by checkout (unit-tested in test/unit).
// Ported from functions/lib/orderValidation.js; the stock shards are gone,
// D1 checks stock and per-person limits in the checkout batch instead.
import { ApiError } from '../errors'
import { SCHOOL_CODES, CAMPUS_SCHOOLS, HOME_SCHOOL, SCHOOL_ACCOUNT_DOMAIN, ELIGIBLE_IDENTITIES } from './constants.js'
import { parseTaipeiDateTime } from './time.js'

export const MAX_TICKETS_PER_ORDER = 20

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const TICKET_TYPE_ID_PATTERN = /^[\w-]{1,100}$/

// Order ids: school code + Taiwan date + random suffix, e.g. CKS20261105K7Q2MX.
// Legacy ids end in a 4-digit serial.
const ORDER_SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
export const ORDER_ID_PATTERN = /^[A-Z]{1,4}\d{8}(\d{4}|[A-HJ-NP-Z2-9]{6})$/

// Uniform integer in [0, max) from the Web Crypto RNG
export function randomInt(max) {
  const limit = Math.floor(0x100000000 / max) * max
  const buffer = new Uint32Array(1)
  do crypto.getRandomValues(buffer)
  while (buffer[0] >= limit)
  return buffer[0] % max
}

export function generateOrderId(schoolCode, dateKey) {
  let suffix = ''
  for (let i = 0; i < 6; i++) {
    suffix += ORDER_SUFFIX_ALPHABET[randomInt(ORDER_SUFFIX_ALPHABET.length)]
  }
  return `${schoolCode}${dateKey}${suffix}`
}

// Random per-order code in the ticket QR, so a QR cannot be forged from an order id
export function generateTicketCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Client-generated id that makes a retried checkout return the same order
export function isValidRequestId(value) {
  return typeof value === 'string' && /^[\w-]{16,64}$/.test(value)
}

function cleanString(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

// Per-person limits are counted per normalised account email
export async function getBuyerKey(email) {
  const data = new TextEncoder().encode(String(email || '').trim().toLowerCase())
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function isCampusSchool(school) {
  return CAMPUS_SCHOOLS.has(school)
}

export function isSchoolAccount(email) {
  return String(email || '').trim().toLowerCase().endsWith(`@${SCHOOL_ACCOUNT_DOMAIN}`)
}

// Whitelists the buyer fields and ticket quantities; everything else the
// client sends (prices, totals, paid/delivered flags, userId, email...) is
// dropped. The email is always the signed-in account's (`accountEmail`).
export function sanitizeOrderInput(payload, accountEmail) {
  if (!payload || typeof payload !== 'object') {
    throw new ApiError('invalid-argument', '訂單資料格式錯誤')
  }

  const order = {
    customerName: cleanString(payload.customerName, 50),
    customerEmail: cleanString(accountEmail, 254).toLowerCase(),
    customerPhone: cleanString(payload.customerPhone, 30),
    school: cleanString(payload.school, 30),
    class: cleanString(payload.class, 20),
    number: cleanString(payload.number, 10),
    office: cleanString(payload.office, 30)
  }

  if (!order.customerName || !order.customerPhone) {
    throw new ApiError('invalid-argument', '請填寫姓名與電話')
  }

  if (!EMAIL_PATTERN.test(order.customerEmail)) {
    throw new ApiError('invalid-argument', 'Email 格式不正確')
  }

  if (!Object.hasOwn(SCHOOL_CODES, order.school)) {
    throw new ApiError('invalid-argument', '請選擇學校或身分')
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
      throw new ApiError('invalid-argument', '票種資料無效')
    }

    // checked per item, so [{ qty: 5 }, { qty: -3 }] or 0.5 are rejected
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new ApiError('invalid-argument', '票券數量必須為正整數')
    }

    if (quantity > MAX_TICKETS_PER_ORDER) {
      throw new ApiError('invalid-argument', `單筆訂單最多 ${MAX_TICKETS_PER_ORDER} 張`)
    }

    quantities.set(id, (quantities.get(id) || 0) + quantity)
  }

  if (quantities.size === 0) {
    throw new ApiError('invalid-argument', '訂單內容為空')
  }

  const totalQuantity = [...quantities.values()].reduce((sum, n) => sum + n, 0)

  if (totalQuantity > MAX_TICKETS_PER_ORDER) {
    throw new ApiError('invalid-argument', `單筆訂單最多 ${MAX_TICKETS_PER_ORDER} 張`)
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

// Throws when this type is not on sale now or not for this buyer. `email` is
// the verified account email. Also checked before the checkout batch, so a
// buyer is told this rather than that the type is sold out.
export function checkSaleOpen(ticketType, { now, school, email }) {
  const start = parseTaipeiDateTime(ticketType.salesStartTime)
  const end = parseTaipeiDateTime(ticketType.salesEndTime)

  if (!start || !end || now < start) {
    throw new ApiError('failed-precondition', `${ticketType.name}尚未開賣`)
  }

  if (now > end) {
    throw new ApiError('failed-precondition', `${ticketType.name}已結束販售`)
  }

  // 本校學生 tickets: 建國中學 students only (not the partner schools),
  // signed in with their school account
  if (ticketType.eligibleBuyerIdentity === ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS) {
    if (!isSchoolAccount(email)) {
      throw new ApiError(
        'permission-denied',
        `${ticketType.name}僅限使用 @${SCHOOL_ACCOUNT_DOMAIN} 帳號登入購買`
      )
    }
    if (school !== HOME_SCHOOL) {
      throw new ApiError('permission-denied', `${ticketType.name}僅限建中在學學生購買`)
    }
  }
}

// Throws when this buyer may not buy `quantity` tickets of this type now.
// `alreadyBought` is read before the batch; the batch's CHECK constraint
// catches a buyer racing their own checkouts.
export function checkTicketType(ticketType, quantity, { now, school, email, alreadyBought }) {
  checkSaleOpen(ticketType, { now, school, email })

  const limit = getPurchaseLimit(ticketType)

  if (limit !== null && alreadyBought + quantity > limit) {
    throw new ApiError('failed-precondition', `${ticketType.name}超過每人限購 ${limit} 張`)
  }
}
