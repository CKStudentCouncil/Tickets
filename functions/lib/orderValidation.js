// Pure order validation used by createOrder (unit-tested in test/).
import { createHash } from 'node:crypto'
import { https } from 'firebase-functions'

import { SCHOOL_CODES, CAMPUS_SCHOOLS, ELIGIBLE_IDENTITIES } from './constants.js'
import { parseTaipeiDateTime } from './time.js'

const { HttpsError } = https

export const MAX_TICKETS_PER_ORDER = 20

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const TICKET_TYPE_ID_PATTERN = /^[\w-]{1,100}$/

function cleanString(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength)
}

// Per-person limits are counted per normalised email
export function getBuyerKey(email) {
  return createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex')
}

export function isCampusSchool(school) {
  return CAMPUS_SCHOOLS.has(school)
}

// Whitelists the buyer fields and ticket quantities; everything else the
// client sends (prices, totals, paid/delivered flags, userId...) is dropped.
export function sanitizeOrderInput(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new HttpsError('invalid-argument', '訂單資料格式錯誤')
  }

  const order = {
    customerName: cleanString(payload.customerName, 50),
    customerEmail: cleanString(payload.customerEmail, 254).toLowerCase(),
    customerPhone: cleanString(payload.customerPhone, 30),
    school: cleanString(payload.school, 30),
    class: cleanString(payload.class, 20),
    number: cleanString(payload.number, 10),
    office: cleanString(payload.office, 30)
  }

  if (!order.customerName || !order.customerPhone) {
    throw new HttpsError('invalid-argument', '請填寫姓名與電話')
  }

  if (!EMAIL_PATTERN.test(order.customerEmail)) {
    throw new HttpsError('invalid-argument', 'Email 格式不正確')
  }

  if (!SCHOOL_CODES[order.school]) {
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
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_TICKETS_PER_ORDER) {
      throw new HttpsError('invalid-argument', '票券數量必須為正整數')
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

export function getPurchaseLimit(ticketType) {
  return ticketType.unlimited ? null : Number(ticketType.purchaseLimitPerPerson) || null
}

// Throws when `quantity` more tickets of this type may not be sold now.
// `sold` and `alreadyBought` come from the counters read in the transaction.
export function checkTicketType(ticketType, quantity, { now, school, sold, alreadyBought }) {
  const start = parseTaipeiDateTime(ticketType.salesStartTime)
  const end = parseTaipeiDateTime(ticketType.salesEndTime)

  if (!start || !end || now < start) {
    throw new HttpsError('failed-precondition', `${ticketType.name}尚未開賣`)
  }

  if (now > end) {
    throw new HttpsError('failed-precondition', `${ticketType.name}已結束販售`)
  }

  if (
    ticketType.eligibleBuyerIdentity === ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS &&
    !isCampusSchool(school)
  ) {
    throw new HttpsError('permission-denied', `${ticketType.name}僅限校內學生購買`)
  }

  const total = Number(ticketType.totalTicketQuantity || 0)

  if (total > 0 && sold + quantity > total) {
    throw new HttpsError('resource-exhausted', `${ticketType.name}剩餘票量不足`)
  }

  const limit = getPurchaseLimit(ticketType)

  if (limit !== null && alreadyBought + quantity > limit) {
    throw new HttpsError('failed-precondition', `${ticketType.name}超過每人限購 ${limit} 張`)
  }
}
