import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'

import { db, HttpsError, assertRole } from './common.js'
import { HOME_SCHOOL, REGION } from './constants.js'
import { getTaiwanDateKey, getTaiwanYear, parseTaipeiDateTime } from './time.js'
import { staffName } from './orderActions.js'

// salesArchives/{year}: one year's sale, as /super_admin/analytics compares
// it with this year's. purgeOrders writes it from the orders it archives;
// importSalesArchive from an Excel export of an earlier year.
//
// Documents written only by these functions (super admins may read them):
//   salesArchives/{year}           totals by school, ticket type and day, and the
//                                  sale's openDate / closeDate ("YYYY-MM-DD")
//   salesArchives/{year}/rows/{n}  ROW_CHUNK sale rows: what the charts need of each
//                                  order, without names, emails, phones, classes or seats
//   systemLogs/{id}                who imported which year

export const ROW_CHUNK = 2000
export const MAX_IMPORT_ROWS = 20_000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// A map key Firestore accepts for a stored value (school, ticket type id)
export function mapKey(value, fallback) {
  const key = String(value ?? '').trim().slice(0, 100)
  return key && !/^__.*__$/.test(key) ? key : fallback
}

// 建中 students' grade (1–3) from the class they typed, e.g. "329",
// "329/三數" or "高二"; 0 when it cannot be told or for anyone else.
// Keep in sync with gradeOf in src/utils/salesAnalytics.js
export function gradeOf(school, className) {
  if (school !== HOME_SCHOOL) return 0
  const text = String(className ?? '').normalize('NFKC').trim()
  const number = /^([123])\d{2}(?!\d)/.exec(text)
  if (number) return Number(number[1])
  const word = /^高?([一二三])/.exec(text)
  return word ? '一二三'.indexOf(word[1]) + 1 : 0
}

// A sale row: t time (ms), v order value, p paid, d collected, s school,
// g grade, i items { k ticket type, q quantity, u unit price }
export function saleRowOf(order) {
  const at = parseTaipeiDateTime(order.createdAt)
  return {
    t: at ? at.getTime() : null,
    v: Number(order.finalTotal) || 0,
    p: order.paid === true,
    d: order.delivered === true,
    s: mapKey(order.school, '未填寫'),
    g: gradeOf(order.school, order.class),
    i: (Array.isArray(order.items) ? order.items : []).filter(Boolean).map((item) => ({
      k: mapKey(item.ticketTypeId || item.id || item.name, '未知票種'),
      q: Number(item.quantity) || 0,
      u: Number(item.price) || 0
    }))
  }
}

// { [ticket type key]: the latest name it was sold under }
export function ticketTypeNamesOf(orders) {
  const names = {}
  orders.forEach((order) => {
    ;(Array.isArray(order.items) ? order.items : []).filter(Boolean).forEach((item) => {
      if (item.name) names[mapKey(item.ticketTypeId || item.id || item.name, '未知票種')] = String(item.name).slice(0, 100)
    })
  })
  return names
}

function addTo(totals, key, tickets, revenue) {
  const entry = (totals[key] ??= { orderCount: 0, ticketCount: 0, revenue: 0 })
  entry.orderCount += 1
  entry.ticketCount += tickets
  entry.revenue += revenue
}

const dayOf = (ms) => getTaiwanDateKey(new Date(ms)).replace(/^(\d{4})(\d{2})/, '$1-$2-')

// Totals of a year's sale rows. Order value (revenue) and collected payment
// (paidRevenue) stay distinct, as on /admin.
export function summarizeRows(rows, names = {}) {
  const summary = {
    orderCount: 0,
    ticketCount: 0,
    revenue: 0,
    paidRevenue: 0,
    paidOrderCount: 0,
    deliveredOrderCount: 0,
    bySchool: {},
    byTicketType: {},
    byDay: {},
    firstOrderAt: null,
    lastOrderAt: null
  }

  rows.forEach((row) => {
    const tickets = row.i.reduce((sum, item) => sum + item.q, 0)
    summary.orderCount += 1
    summary.ticketCount += tickets
    summary.revenue += row.v
    if (row.p) {
      summary.paidRevenue += row.v
      summary.paidOrderCount += 1
    }
    if (row.d) summary.deliveredOrderCount += 1

    addTo(summary.bySchool, row.s, tickets, row.v)
    if (row.t !== null) {
      // "YYYY-MM-DD", like getTaiwanDateKey in src/utils/datetime.js
      addTo(summary.byDay, dayOf(row.t), tickets, row.v)
      if (!summary.firstOrderAt || row.t < summary.firstOrderAt.getTime()) summary.firstOrderAt = new Date(row.t)
      if (!summary.lastOrderAt || row.t > summary.lastOrderAt.getTime()) summary.lastOrderAt = new Date(row.t)
    }

    row.i.forEach((item) => {
      const type = (summary.byTicketType[item.k] ??= { name: names[item.k] || item.k, ticketCount: 0, revenue: 0 })
      type.ticketCount += item.q
      type.revenue += item.u * item.q
    })
  })

  return summary
}

// The sale's first and last day: the shop's opening when it is in this
// year, else the first order's day; the last order's day
export function saleDatesOf(rows, year, shopOpenAt) {
  const times = rows.map((row) => row.t).filter((t) => t !== null)
  const first = times.length ? Math.min(...times) : null
  const open = shopOpenAt && getTaiwanYear(shopOpenAt) === Number(year) ? shopOpenAt.getTime() : first
  const openDate = open !== null ? dayOf(open) : `${year}-01-01`
  const closeDate = times.length ? dayOf(Math.max(...times)) : openDate
  return { openDate, closeDate: closeDate < openDate ? openDate : closeDate }
}

// Replaces the year's summary and sale rows in one batch
export async function writeYearArchive(year, { rows, names, openDate, closeDate, source, fields = {} }) {
  const yearRef = db.doc(`salesArchives/${year}`)
  const rowsRef = yearRef.collection('rows')
  const chunks = Math.ceil(rows.length / ROW_CHUNK)
  const existing = await rowsRef.select().get()
  const summary = summarizeRows(rows, names)
  const batch = db.batch()

  batch.set(yearRef, {
    year: Number(year),
    source,
    openDate,
    closeDate,
    ...summary,
    ...fields,
    rowChunks: chunks,
    updatedAt: FieldValue.serverTimestamp()
  })
  for (let n = 0; n < chunks; n++) {
    batch.set(rowsRef.doc(String(n).padStart(3, '0')), { rows: rows.slice(n * ROW_CHUNK, (n + 1) * ROW_CHUNK) })
  }
  existing.docs.filter((doc) => Number(doc.id) >= chunks).forEach((doc) => batch.delete(doc.ref))
  await batch.commit()
  return summary
}

function invalid(message) {
  return new HttpsError('invalid-argument', message)
}

const isAmount = (n, max) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max
const isKey = (value) => typeof value === 'string' && value !== '' && mapKey(value, '') === value

function validDate(value) {
  if (!DATE_PATTERN.test(value ?? '')) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

// Rows as the analytics page reads them from an Excel export; anything else is refused
export function sanitizeImport(data) {
  const { openDate, closeDate, rows, names } = data || {}
  if (!validDate(openDate) || !validDate(closeDate) || closeDate < openDate) {
    throw invalid('請確認開賣日與結束日')
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_IMPORT_ROWS) {
    throw invalid(`匯入的訂單須為 1 到 ${MAX_IMPORT_ROWS} 筆`)
  }

  const cleanRows = rows.map((row) => {
    const items = Array.isArray(row?.i) ? row.i : null
    if (
      !row || typeof row !== 'object' ||
      !(row.t === null || (Number.isSafeInteger(row.t) && row.t > 0)) ||
      !isAmount(row.v, 10_000_000) || typeof row.p !== 'boolean' || typeof row.d !== 'boolean' ||
      !isKey(row.s) || ![0, 1, 2, 3].includes(row.g) || !items || items.length > 50
    ) throw invalid('訂單資料格式不正確')

    return {
      t: row.t,
      v: row.v,
      p: row.p,
      d: row.d,
      s: row.s,
      g: row.g,
      i: items.map((item) => {
        if (!isKey(item?.k) || !Number.isInteger(item.q) || item.q < 1 || item.q > 1000 || !isAmount(item.u, 1_000_000)) {
          throw invalid('票券資料格式不正確')
        }
        return { k: item.k, q: item.q, u: item.u }
      })
    }
  })

  const cleanNames = {}
  if (names && typeof names === 'object') {
    Object.entries(names).slice(0, 200).forEach(([key, name]) => {
      if (isKey(key) && typeof name === 'string') cleanNames[key] = name.slice(0, 100)
    })
  }

  return { year: Number(openDate.slice(0, 4)), openDate, closeDate, rows: cleanRows, names: cleanNames }
}

// 匯入往年資料 on /super_admin/analytics: an earlier year's orders, read in
// the browser from the Excel export of that year. Replaces an earlier
// import of the same year, never a year purgeOrders archived.
export const importSalesArchive = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {
    await assertRole(context, 'super_admin')
    const input = sanitizeImport(data)
    const profile = (await db.doc(`users/${context.auth.uid}`).get()).data() || {}
    const actorName = staffName(profile, context)

    const current = await db.doc(`salesArchives/${input.year}`).get()
    if (current.exists && current.data().source !== 'import') {
      throw new HttpsError('failed-precondition', `${input.year} 年已有清除訂單時封存的資料，不能用匯入取代`)
    }

    const summary = await writeYearArchive(input.year, {
      rows: input.rows,
      names: input.names,
      openDate: input.openDate,
      closeDate: input.closeDate,
      source: 'import',
      fields: { importedByUid: context.auth.uid, importedByName: actorName, importedAt: FieldValue.serverTimestamp() }
    })
    await db.collection('systemLogs').add({
      type: 'sales.import',
      year: input.year,
      orderCount: summary.orderCount,
      replaced: current.exists,
      actorUid: context.auth.uid,
      actorName,
      occurredAt: FieldValue.serverTimestamp()
    })

    return { year: input.year, orderCount: summary.orderCount, revenue: summary.revenue }
  })
