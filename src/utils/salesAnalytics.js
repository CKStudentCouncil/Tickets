// The sales report of /super_admin/analytics: this year's live orders
// against an earlier year's sale (salesArchives), day by day from each
// sale's opening. Pure (no Firebase), so tests/salesAnalytics.test.js runs
// it with node.
import { HOME_SCHOOL, SCHOOLS } from '../data/schools.js'
import { CHANNEL_OPTIONS, IDENTITY_OPTIONS } from '../data/surveyQuestions.js'
import { parseDate } from './datetime.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
// Taiwan is UTC+08:00 all year (no daylight saving)
const TAIPEI_MS = 8 * HOUR_MS
const WEEKDAYS = '日一二三四五六'

const GRADE_LABELS = { 1: '高一', 2: '高二', 3: '高三', 0: '無法判斷' }
const GRADE_ORDER = ['高一', '高二', '高三', '無法判斷']

// Order value bands (NT$), and tickets per order
const VALUE_BANDS = [
  { label: '0', max: 0 },
  { label: '1–999', max: 999 },
  { label: '1,000–1,999', max: 1999 },
  { label: '2,000–2,999', max: 2999 },
  { label: '3,000–4,999', max: 4999 },
  { label: '5,000 以上', max: Infinity }
]
const UNIT_BANDS = ['1 張', '2 張', '3 張', '4 張', '5 張以上']

// Stages of a sale by the day of it (0 = the opening day)
const SALE_STAGES = [
  { label: '開賣首日', last: 0 },
  { label: '第 2–3 天', last: 2 },
  { label: '第 4–7 天', last: 6 },
  { label: '第 8–14 天', last: 13 },
  { label: '第 15 天以後', last: Infinity }
]
const REPEAT_BANDS = ['1 筆', '2 筆', '3 筆以上']
// Monday first, as rows of report.weekHours
export const WEEKDAY_LABELS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日']

// 購買者身分: the school or identity chosen at checkout, grouped. Each group
// keeps its colour slot (IDENTITY_GROUPS order) whatever a year sold.
export const IDENTITY_GROUPS = [
  { key: 'home', label: '本校學生', schools: [HOME_SCHOOL] },
  { key: 'tfg', label: '北一女中', schools: ['北一女中'] },
  { key: 'zs', label: '中山女高', schools: ['中山女高'] },
  { key: 'jm', label: '景美女中', schools: ['景美女中'] },
  { key: 'cg', label: '成功高中', schools: ['成功高中'] },
  { key: 'hsnu', label: '師大附中', schools: ['師大附中'] },
  { key: 'parent', label: '家長', schools: ['建中家長會'] },
  { key: 'teacher', label: '教師', schools: ['建中老師'] },
  { key: 'other', label: '其他', schools: [] }
]
const GROUP_OF_SCHOOL = new Map(IDENTITY_GROUPS.flatMap((group) => group.schools.map((school) => [school, group.key])))
export const groupOf = (school) => GROUP_OF_SCHOOL.get(school) || 'other'
const groupIndexOf = (school) => IDENTITY_GROUPS.findIndex((group) => group.key === groupOf(school))

const identitySchoolOf = (school) =>
  SCHOOLS.includes(school) ? school : '其他學校或社會人士'

/* ---------- dates ---------- */

// "YYYY-MM-DD" in Taiwan
export const taipeiDate = (ms) => new Date(ms + TAIPEI_MS).toISOString().slice(0, 10)
// that day's start in Taiwan, or null
export function taipeiDayStart(date) {
  const ms = Date.parse(`${date}T00:00:00+08:00`)
  return Number.isNaN(ms) ? null : ms
}

// "11/5（三）"
export function formatDay(date) {
  const day = new Date(date.getTime() + TAIPEI_MS)
  return `${day.getUTCMonth() + 1}/${day.getUTCDate()}（${WEEKDAYS[day.getUTCDay()]}）`
}

/* ---------- rows ---------- */

// 建中 students' grade (1–3) from the class they typed, e.g. "329",
// "329/三數" or "高二"; 0 when it cannot be told or for anyone else.
// Keep in sync with gradeOf in functions/lib/salesArchive.js
export function gradeOf(school, className) {
  if (school !== HOME_SCHOOL) return 0
  const text = String(className ?? '').normalize('NFKC').trim()
  const number = /^([123])\d{2}(?!\d)/.exec(text)
  if (number) return Number(number[1])
  const word = /^高?([一二三])/.exec(text)
  return word ? '一二三'.indexOf(word[1]) + 1 : 0
}

// A live order as the report reads it. `buyer` (the account) only counts
// orders per buyer; archived rows have none.
export function saleRowOf(order) {
  return {
    at: parseDate(order?.createdAt)?.getTime() ?? null,
    total: Number(order?.finalTotal) || 0,
    paid: order?.paid === true,
    buyer: order?.userId || order?.customerEmail || null,
    school: String(order?.school || '').trim() || '未填寫',
    grade: gradeOf(order?.school, order?.class),
    items: (Array.isArray(order?.items) ? order.items : []).filter(Boolean).map((item) => ({
      // legacy items keep the ticket type id in `id`
      key: String(item.ticketTypeId || item.id || item.name || '未知票種'),
      name: String(item.name || item.ticketTypeId || item.id || '未知票種'),
      quantity: Number(item.quantity) || 0,
      price: Number(item.price) || 0
    }))
  }
}

// salesArchives/{year}/rows ({ t, v, p, d, s, g, i: [{ k, q, u }] }), named
// by the year's byTicketType
export function rowsFromArchive(rows, byTicketType = {}) {
  return rows.map((row) => ({
    at: row.t ?? null,
    total: row.v || 0,
    paid: row.p === true,
    buyer: null,
    school: row.s || '未填寫',
    grade: row.g || 0,
    items: (row.i || []).map((item) => ({
      key: item.k,
      name: byTicketType[item.k]?.name || item.k,
      quantity: item.q || 0,
      price: item.u || 0
    }))
  }))
}

const ticketsOf = (row) => row.items.reduce((sum, item) => sum + item.quantity, 0)

/* ---------- the two sales ---------- */

// This year's sale: day 1 is the day the shop opens, and it lasts until the party
export function currentSale({ openAt, eventDate, now, rows }) {
  const openDate = taipeiDate(openAt.getTime())
  const start = taipeiDayStart(openDate)
  return {
    year: Number(openDate.slice(0, 4)),
    openDate,
    closeDate: eventDate,
    start,
    // before the opening moment the sale has not begun
    elapsed: now - openAt.getTime(),
    // today is day `days`; 0 before the opening day
    days: now < start ? 0 : Math.floor((now - start) / DAY_MS) + 1,
    rows
  }
}

// An archived year's sale, from salesArchives/{year}
export function archivedSale(summary, rows) {
  const start = taipeiDayStart(summary.openDate)
  const end = taipeiDayStart(summary.closeDate)
  return {
    year: Number(summary.year),
    openDate: summary.openDate,
    closeDate: summary.closeDate,
    start,
    days: Math.max(1, Math.round((end - start) / DAY_MS) + 1),
    rows
  }
}

/* ---------- the report ---------- */

function totalsOf(rows) {
  let revenue = 0
  let tickets = 0
  let paidRevenue = 0
  let valued = 0
  let valuedOrders = 0

  rows.forEach((row) => {
    revenue += row.total
    tickets += ticketsOf(row)
    if (row.paid) paidRevenue += row.total
    // NT$0 orders (comps) would pull the average down
    if (row.total > 0) {
      valued += row.total
      valuedOrders += 1
    }
  })

  return {
    revenue,
    orders: rows.length,
    aov: valuedOrders ? valued / valuedOrders : null,
    tickets,
    ticketsPerOrder: rows.length ? tickets / rows.length : null,
    paidRate: revenue ? paidRevenue / revenue : null
  }
}

// Per sale day: orders before the opening count on day 1, after the sale's
// last day on its last day
function dailyOf(rows, start, days) {
  const revenue = Array(days).fill(0)
  const orders = Array(days).fill(0)
  const tickets = Array(days).fill(0)
  const valued = Array(days).fill(0)
  const valuedOrders = Array(days).fill(0)

  rows.forEach((row) => {
    if (row.at === null || !days) return
    const day = Math.min(days - 1, Math.max(0, Math.floor((row.at - start) / DAY_MS)))
    revenue[day] += row.total
    orders[day] += 1
    tickets[day] += ticketsOf(row)
    if (row.total > 0) {
      valued[day] += row.total
      valuedOrders[day] += 1
    }
  })

  let running = 0
  return {
    revenue,
    orders,
    tickets,
    aov: valued.map((value, day) => (valuedOrders[day] ? value / valuedOrders[day] : null)),
    cumulative: revenue.map((value) => (running += value)),
    cumulativeTickets: tickets.reduce((result, value) => {
      result.push((result.at(-1) || 0) + value)
      return result
    }, [])
  }
}

function sharesOf(counts) {
  const total = counts.reduce((sum, count) => sum + count, 0)
  return counts.map((count) => ({ count, share: total ? count / total : 0 }))
}

function hoursOf(rows) {
  const counts = Array(24).fill(0)
  rows.forEach((row) => {
    if (row.at !== null) counts[new Date(row.at + TAIPEI_MS).getUTCHours()] += 1
  })
  return sharesOf(counts)
}

// each row counts once, or by `weightOf` (e.g. its tickets)
function bandsOf(rows, bandOf, size, weightOf = () => 1) {
  const counts = Array(size).fill(0)
  rows.forEach((row) => { counts[bandOf(row)] += weightOf(row) })
  return sharesOf(counts)
}

const valueBand = (row) => VALUE_BANDS.findIndex((band) => row.total <= band.max)
const unitBand = (row) => Math.min(UNIT_BANDS.length - 1, Math.max(0, ticketsOf(row) - 1))

// Bands in both years, without bands neither year has
function bandRows(labels, current, previous) {
  return labels
    .map((label, i) => ({ label, current: current[i], previous: previous[i] }))
    .filter((row) => row.current.count || row.previous.count)
}

function summaryOf(rows) {
  const totals = totalsOf(rows)
  return { revenue: totals.revenue, orders: totals.orders, tickets: totals.tickets, aov: totals.aov }
}

// Rows of both years by `labelOf`, in `order`, only labels either year has
function groupRows(currentRows, previousRows, labelOf, order) {
  const group = (rows) => rows.reduce((groups, row) => {
    const label = labelOf(row)
    if (label !== null) (groups.get(label) || groups.set(label, []).get(label)).push(row)
    return groups
  }, new Map())
  const now = group(currentRows)
  const before = group(previousRows)
  const labels = [...new Set([...order, ...now.keys(), ...before.keys()])]

  return labels
    .filter((label) => now.has(label) || before.has(label))
    .map((label) => ({ label, current: summaryOf(now.get(label) || []), previous: summaryOf(before.get(label) || []) }))
}

function ticketTypesOf(rows) {
  const types = new Map()
  rows.forEach((row) => row.items.forEach((item) => {
    const type = types.get(item.key) || types.set(item.key, { label: item.name, units: 0, amount: 0 }).get(item.key)
    type.label = item.name
    type.units += item.quantity
    type.amount += item.quantity * item.price
  }))
  return [...types.values()].sort((a, b) => b.units - a.units || b.amount - a.amount)
}

// `share` of revenue, `ticketShare` of tickets
function identityGroupsOf(rows) {
  const totals = new Map(IDENTITY_GROUPS.map((group) => [group.key, { revenue: 0, orders: 0, tickets: 0 }]))
  rows.forEach((row) => {
    const group = totals.get(groupOf(row.school))
    group.revenue += row.total
    group.orders += 1
    group.tickets += ticketsOf(row)
  })
  const revenue = rows.reduce((sum, row) => sum + row.total, 0)
  const tickets = rows.reduce((sum, row) => sum + ticketsOf(row), 0)
  return IDENTITY_GROUPS.map(({ key, label }) => ({
    key,
    label,
    ...totals.get(key),
    share: revenue ? totals.get(key).revenue / revenue : 0,
    ticketShare: tickets ? totals.get(key).tickets / tickets : 0
  }))
}

// Each identity group's orders by Taiwan hour, without groups that have none
function groupHoursOf(rows) {
  const counts = IDENTITY_GROUPS.map(() => Array(24).fill(0))
  rows.forEach((row) => {
    if (row.at !== null) counts[groupIndexOf(row.school)][new Date(row.at + TAIPEI_MS).getUTCHours()] += 1
  })
  return IDENTITY_GROUPS
    .map(({ key, label }, i) => ({ key, label, orders: counts[i].reduce((sum, n) => sum + n, 0), hours: sharesOf(counts[i]) }))
    .filter((group) => group.orders)
}

// Orders by Taiwan weekday (Monday first) and hour
function weekHoursOf(rows) {
  const counts = Array.from({ length: 7 }, () => Array(24).fill(0))
  rows.forEach((row) => {
    if (row.at === null) return
    const date = new Date(row.at + TAIPEI_MS)
    counts[(date.getUTCDay() + 6) % 7][date.getUTCHours()] += 1
  })
  return counts
}

function weekdaysOf(rows) {
  return sharesOf(weekHoursOf(rows).map((hours) => hours.reduce((sum, n) => sum + n, 0)))
}

// The stage of a sale an order falls in; orders before the opening are in the first
function stageOf(row, start) {
  const day = Math.max(0, Math.floor((row.at - start) / DAY_MS))
  return SALE_STAGES.findIndex((stage) => day <= stage.last)
}

// Tickets sold in each stage of a sale
function stagesOf(rows, start) {
  const counts = Array(SALE_STAGES.length).fill(0)
  rows.forEach((row) => {
    if (row.at !== null) counts[stageOf(row, start)] += ticketsOf(row)
  })
  return sharesOf(counts)
}

// Tickets of each identity group (IDENTITY_GROUPS order) in each stage of a
// sale, without stages that sold none
function stageGroupsOf(rows, start) {
  const counts = SALE_STAGES.map(() => Array(IDENTITY_GROUPS.length).fill(0))
  rows.forEach((row) => {
    if (row.at === null) return
    counts[stageOf(row, start)][groupIndexOf(row.school)] += ticketsOf(row)
  })
  return SALE_STAGES
    .map((stage, i) => ({
      label: stage.label,
      tickets: counts[i].reduce((sum, n) => sum + n, 0),
      groups: sharesOf(counts[i]).map((entry, j) => ({ key: IDENTITY_GROUPS[j].key, label: IDENTITY_GROUPS[j].label, ...entry }))
    }))
    .filter((stage) => stage.tickets)
}

// How many orders each buyer (account) placed; only live orders know theirs
function repeatOf(rows) {
  const perBuyer = new Map()
  rows.forEach((row) => {
    if (row.buyer) perBuyer.set(row.buyer, (perBuyer.get(row.buyer) || 0) + 1)
  })
  const counts = Array(REPEAT_BANDS.length).fill(0)
  perBuyer.forEach((orders) => { counts[Math.min(REPEAT_BANDS.length - 1, orders - 1)] += 1 })
  const shares = sharesOf(counts)
  return { buyers: perBuyer.size, bands: REPEAT_BANDS.map((label, i) => ({ label, ...shares[i] })) }
}

// Revenue concentration: buyers (accounts) by revenue, highest first;
// `curve[i]` is the share of revenue from the top i × 5% of them
function concentrationOf(rows) {
  const perBuyer = new Map()
  rows.forEach((row) => {
    if (row.buyer) perBuyer.set(row.buyer, (perBuyer.get(row.buyer) || 0) + row.total)
  })
  const totals = [...perBuyer.values()].sort((a, b) => b - a)
  const revenue = totals.reduce((sum, n) => sum + n, 0)
  let running = 0
  const cumulative = [0, ...totals.map((n) => (running += n))]
  return {
    buyers: totals.length,
    curve: Array.from({ length: 21 }, (_, i) => (revenue ? cumulative[Math.round((i / 20) * totals.length)] / revenue : null))
  }
}

// Each day's mean of up to `span` days before it; null on the first day
export function trailingMean(values, span = 7) {
  return values.map((_, i) => {
    const before = values.slice(Math.max(0, i - span), i)
    return before.length ? before.reduce((sum, n) => sum + n, 0) / before.length : null
  })
}

// The days most above their trailing mean, the biggest gain first
export function peakDays(values, baseline, count = 5) {
  return values
    .map((value, day) => ({ day, value, baseline: baseline[day] }))
    .filter((entry) => entry.baseline !== null && entry.value > entry.baseline)
    .sort((a, b) => (b.value - b.baseline) - (a.value - a.baseline))
    .slice(0, count)
}

// 得知管道: the share of survey respondents who named each channel (one
// respondent may name several), most named first; `identities` splits it by
// the identity each respondent chose, channels in the same order
export function channelShares(responses) {
  const countsOf = (group) => {
    const counts = new Map(CHANNEL_OPTIONS.map((option) => [option, 0]))
    group.forEach((response) => {
      new Set(Array.isArray(response.channels) ? response.channels : []).forEach((channel) => {
        if (counts.has(channel)) counts.set(channel, counts.get(channel) + 1)
      })
    })
    return counts
  }
  const rows = [...countsOf(responses)]
    .map(([label, count]) => ({ label, count, share: responses.length ? count / responses.length : 0 }))
    .sort((a, b) => b.count - a.count)

  const byIdentity = new Map()
  responses.forEach((response) => {
    const identity = response.identity || '未填寫'
    ;(byIdentity.get(identity) || byIdentity.set(identity, []).get(identity)).push(response)
  })
  const identities = [...new Set([...IDENTITY_OPTIONS, ...byIdentity.keys()])]
    .filter((label) => byIdentity.has(label))
    .map((label) => {
      const group = byIdentity.get(label)
      const counts = countsOf(group)
      return {
        label,
        respondents: group.length,
        channels: rows.map((row) => ({ count: counts.get(row.label), share: counts.get(row.label) / group.length }))
      }
    })

  return { respondents: responses.length, rows, identities }
}

const KPI_KEYS = ['revenue', 'orders', 'aov', 'tickets', 'ticketsPerOrder', 'paidRate']

// basis 'full' compares with the earlier year's whole sale; 'same' only up
// to the same day and time of its sale as now
export function buildReport({ current, previous, basis, now }) {
  const hasPrevious = Boolean(previous)
  const sameTime = hasPrevious && basis === 'same'
  const cutoff = sameTime ? previous.start + (now - current.start) : Infinity
  const compared = hasPrevious
    ? previous.rows.filter((row) => !sameTime || (row.at !== null && row.at < cutoff))
    : []

  const totals = totalsOf(current.rows)
  const previousTotals = hasPrevious ? totalsOf(compared) : null
  const previousFull = sameTime ? totalsOf(previous.rows) : null

  // pre-opening (test) orders still show, on day 1
  const currentDays = Math.max(current.days, current.rows.length ? 1 : 0)
  const previousDays = hasPrevious ? (sameTime ? Math.min(currentDays, previous.days) : previous.days) : 0
  const currentHours = hoursOf(current.rows)
  const previousHours = hoursOf(compared)
  const currentDaily = dailyOf(current.rows, current.start, currentDays)
  const baseline = trailingMean(currentDaily.orders)

  return {
    hasPrevious,
    sameTime,
    // this year's sale has not finished: its totals are still growing
    ongoing: now < (taipeiDayStart(current.closeDate) ?? Infinity) + DAY_MS,
    kpis: KPI_KEYS.map((key) => ({
      key,
      value: totals[key],
      previous: previousTotals ? previousTotals[key] : null,
      previousFull: previousFull ? previousFull[key] : null
    })),
    timeline: {
      days: Math.max(currentDays, previousDays),
      current: currentDaily,
      previous: hasPrevious ? dailyOf(compared, previous.start, previousDays) : null,
      dayStart: (sale, i) => new Date(sale.start + i * DAY_MS)
    },
    hours: { current: currentHours, previous: previousHours },
    identities: groupRows(current.rows, compared, (row) => identitySchoolOf(row.school), SCHOOLS),
    grades: groupRows(current.rows, compared, (row) => (row.school === HOME_SCHOOL ? GRADE_LABELS[row.grade] : null), GRADE_ORDER),
    values: bandRows(VALUE_BANDS.map((band) => band.label),
      bandsOf(current.rows, valueBand, VALUE_BANDS.length), bandsOf(compared, valueBand, VALUE_BANDS.length)),
    units: bandRows(UNIT_BANDS, bandsOf(current.rows, unitBand, UNIT_BANDS.length), bandsOf(compared, unitBand, UNIT_BANDS.length)),
    // the tickets orders of each size sold, not how many orders
    unitTickets: bandRows(UNIT_BANDS,
      bandsOf(current.rows, unitBand, UNIT_BANDS.length, ticketsOf), bandsOf(compared, unitBand, UNIT_BANDS.length, ticketsOf)),
    ticketTypes: { current: ticketTypesOf(current.rows), previous: ticketTypesOf(compared) },
    identityGroups: { current: identityGroupsOf(current.rows), previous: hasPrevious ? identityGroupsOf(compared) : null },
    weekHours: weekHoursOf(current.rows),
    groupHours: groupHoursOf(current.rows),
    // this year's days against the 7 before each
    peaks: { baseline, days: peakDays(currentDaily.orders, baseline) },
    weekdays: (() => {
      const now = weekdaysOf(current.rows)
      const before = weekdaysOf(compared)
      return WEEKDAY_LABELS.map((label, i) => ({ label, current: now[i], previous: before[i] }))
    })(),
    stages: bandRows(
      SALE_STAGES.map((stage) => stage.label),
      stagesOf(current.rows, current.start),
      stagesOf(compared, hasPrevious ? previous.start : 0)
    ),
    stageGroups: stageGroupsOf(current.rows, current.start),
    repeat: repeatOf(current.rows),
    concentration: concentrationOf(current.rows)
  }
}

/* ---------- a window of this year's sale ---------- */

export const PERIODS = [
  { key: 'today', label: '今天' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: 'month', label: '本月' },
  { key: 'all', label: '全部' }
]

export const GRANULARITIES = [
  { key: 'hour', label: '每小時' },
  { key: 'day', label: '每日' },
  { key: 'month', label: '每月' }
]

export const startOfTaipeiDay = (ms) => Math.floor((ms + TAIPEI_MS) / DAY_MS) * DAY_MS - TAIPEI_MS

function startOfTaipeiMonth(ms, addMonths = 0) {
  const date = new Date(ms + TAIPEI_MS)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + addMonths, 1) - TAIPEI_MS
}

// [start, end) and the window it is compared with: as long, just before it,
// and cut at the same moment, so half a day is compared with half the day before
export function resolvePeriod(key, { now, earliest = null }) {
  const today = startOfTaipeiDay(now)
  const before = (start, length) => ({ start: start - length, end: start - length + (now - start) })

  if (key === 'today') return { start: today, end: now, previous: before(today, DAY_MS) }
  if (key === '7d' || key === '30d') {
    const days = key === '7d' ? 7 : 30
    const start = today - (days - 1) * DAY_MS
    return { start, end: now, previous: before(start, days * DAY_MS) }
  }
  if (key === 'month') {
    const start = startOfTaipeiMonth(now)
    const previousStart = startOfTaipeiMonth(now, -1)
    // a longer month is cut where the shorter one before it ends
    return { start, end: now, previous: { start: previousStart, end: Math.min(previousStart + (now - start), start) } }
  }
  // all of this year's orders, nothing before them to compare with
  return { start: startOfTaipeiDay(earliest ?? now), end: now, previous: null }
}

export const inRange = (rows, range) =>
  range ? rows.filter((row) => row.at !== null && row.at >= range.start && row.at < range.end) : []

export { totalsOf as summarize }

export function granularityOptions(period) {
  const span = period.end - period.start
  return GRANULARITIES.filter(({ key }) =>
    key === 'month' || (key === 'day' ? span <= 400 * DAY_MS : span <= 7 * DAY_MS))
}

export function defaultGranularity(period) {
  const span = period.end - period.start
  if (span <= 2 * DAY_MS) return 'hour'
  return span <= 92 * DAY_MS ? 'day' : 'month'
}

const pad = (n) => String(n).padStart(2, '0')

// "11/5", or "2025/12/31" in another year than `reference`
function dayLabel(ms, reference = ms) {
  const date = new Date(ms + TAIPEI_MS)
  const sameYear = date.getUTCFullYear() === new Date(reference + TAIPEI_MS).getUTCFullYear()
  return `${sameYear ? '' : `${date.getUTCFullYear()}/`}${date.getUTCMonth() + 1}/${date.getUTCDate()}`
}

// "11/19 – 11/25" for [start, end)
export function formatPeriod(range, reference = Date.now()) {
  if (!range || range.end <= range.start) return ''
  const first = dayLabel(range.start, reference)
  const last = dayLabel(range.end - 1, reference)
  return first === last ? first : `${first} – ${last}`
}

// axis label and tooltip title of the bucket starting at `ms`
export function bucketLabels(ms, granularity, { multiDay = false, reference = ms } = {}) {
  const date = new Date(ms + TAIPEI_MS)
  if (granularity === 'month') {
    return { label: `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}`, title: `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月` }
  }
  const day = `${dayLabel(ms, reference)}（${WEEKDAYS[date.getUTCDay()]}）`
  if (granularity === 'day') return { label: dayLabel(ms, reference), title: day }
  const hour = `${pad(date.getUTCHours())}:00`
  return { label: multiDay ? `${dayLabel(ms, reference)} ${hour}` : hour, title: `${day} ${hour}` }
}

function nextBucket(ms, granularity) {
  if (granularity === 'hour') return ms + HOUR_MS
  if (granularity === 'day') return ms + DAY_MS
  return startOfTaipeiMonth(ms, 1)
}

function floorBucket(ms, granularity) {
  if (granularity === 'hour') return Math.floor(ms / HOUR_MS) * HOUR_MS
  if (granularity === 'day') return startOfTaipeiDay(ms)
  return startOfTaipeiMonth(ms)
}

// [{ start, end }] covering [range.start, range.end), cut to it
export function bucketRanges(range, granularity) {
  const buckets = []
  for (let start = floorBucket(range.start, granularity); start < range.end; start = nextBucket(start, granularity)) {
    buckets.push({ start: Math.max(start, range.start), end: Math.min(nextBucket(start, granularity), range.end) })
  }
  return buckets
}

function totalsPerBucket(rows, buckets) {
  const grouped = buckets.map(() => [])
  if (buckets.length) {
    rows.forEach((row) => {
      if (row.at === null || row.at < buckets[0].start || row.at >= buckets.at(-1).end) return
      let low = 0
      let high = buckets.length - 1
      while (low < high) {
        const mid = (low + high + 1) >> 1
        if (buckets[mid].start <= row.at) low = mid
        else high = mid - 1
      }
      grouped[low].push(row)
    })
  }
  return grouped.map(totalsOf)
}

// One point per bucket of the window, paired with the bucket at the same
// position in the window before it (null where that one is shorter)
export function periodSeries(rows, period, granularity, reference = period.end) {
  const current = bucketRanges(period, granularity)
  const previous = period.previous ? bucketRanges(period.previous, granularity) : []
  const currentTotals = totalsPerBucket(rows, current)
  const previousTotals = totalsPerBucket(rows, previous)
  const multiDay = period.end - period.start > DAY_MS

  return current.map((bucket, i) => ({
    start: bucket.start,
    ...bucketLabels(bucket.start, granularity, { multiDay, reference }),
    current: currentTotals[i],
    previous: previous[i]
      ? { ...previousTotals[i], title: bucketLabels(previous[i].start, granularity, { reference }).title }
      : null
  }))
}

/* ---------- numbers ---------- */

const missing = (n) => n === null || n === undefined || Number.isNaN(n)

export const formatCount = (n) => (missing(n) ? '—' : Math.round(n).toLocaleString('zh-TW'))
export const formatCurrency = (n) => (missing(n) ? '—' : `NT$ ${Math.round(n).toLocaleString('zh-TW')}`)
export const formatPercent = (ratio) => (missing(ratio) ? '—' : `${(ratio * 100).toFixed(1)}%`)
export const formatDecimal = (n) => (missing(n) ? '—' : n.toFixed(2))

// axis ticks: 0 / 950 / 1.2K / 12K / 1.2M
export function formatCompact(n) {
  const abs = Math.abs(n)
  const [divisor, suffix] = abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, '']
  const value = n / divisor
  return `${Number.isInteger(value) ? value : Number(value.toFixed(1))}${suffix}`
}

// About `count` evenly spaced round ticks from 0 to at least `max`
export function niceTicks(max, { count = 4, integer = false } = {}) {
  if (!(max > 0)) return [0, 1]
  const rough = max / count
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10]
    .map((m) => m * magnitude)
    .find((s) => s >= rough && (!integer || Number.isInteger(s))) || Math.ceil(rough)
  const steps = Math.ceil(max / step - 1e-9)
  return Array.from({ length: steps + 1 }, (_, i) => Number((i * step).toFixed(10)))
}
