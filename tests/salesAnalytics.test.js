import test from 'node:test'
import assert from 'node:assert/strict'
import {
  archivedSale,
  bucketLabels,
  buildReport,
  channelShares,
  currentSale,
  defaultGranularity,
  formatCompact,
  formatCount,
  formatCurrency,
  formatDay,
  formatDecimal,
  formatPercent,
  formatPeriod,
  gradeOf,
  granularityOptions,
  inRange,
  niceTicks,
  periodSeries,
  resolvePeriod,
  rowsFromArchive,
  saleRowOf,
  summarize,
  taipeiDate,
  taipeiDayStart
} from '../src/utils/salesAnalytics.js'

const at = (iso) => new Date(iso).getTime()
const ts = (iso) => ({ toDate: () => new Date(iso) })

const order = (iso, extra = {}) => saleRowOf({
  createdAt: ts(iso), school: '建國中學', class: '205', finalTotal: 900,
  items: [{ ticketTypeId: 'open', name: '一階票', price: 900, quantity: 1 }], ...extra
})

// This year: opens 2026-11-05 12:00, today is day 3 (11/7 15:30)
const NOW = at('2026-11-07T15:30:00+08:00')
const thisYear = (rows) => currentSale({ openAt: new Date('2026-11-05T12:00:00+08:00'), eventDate: '2026-12-13', now: NOW, rows })
// Last year: 11/3 – 11/12
const lastYear = (rows) => archivedSale({ year: 2025, openDate: '2025-11-03', closeDate: '2025-11-12' }, rows)

const current = [
  // a staff test order before the opening: day 1
  order('2026-11-01T10:00:00+08:00', { finalTotal: 0, items: [{ id: 'open', name: '一階票', price: 0, quantity: 1 }] }),
  order('2026-11-05T12:01:00+08:00', { paid: true, finalTotal: 1800, items: [{ ticketTypeId: 'open', name: '一階票', price: 900, quantity: 2 }] }),
  order('2026-11-05T21:30:00+08:00', { school: '北一女中', class: '101' }),
  order('2026-11-07T09:10:00+08:00', { class: '三數', paid: true })
]
const previous = rowsFromArchive([
  { t: at('2025-11-03T12:05:00+08:00'), v: 1000, p: true, d: true, s: '建國中學', g: 1, i: [{ k: 'early', q: 1, u: 1000 }] },
  { t: at('2025-11-05T14:00:00+08:00'), v: 2000, p: true, d: false, s: '建國中學', g: 3, i: [{ k: 'early', q: 2, u: 1000 }] },
  // after this moment of its sale (day 3, 15:30): only in 全期
  { t: at('2025-11-05T18:00:00+08:00'), v: 3000, p: false, d: false, s: '其他學校或社會人士', g: 0, i: [{ k: 'late', q: 3, u: 1000 }] },
  // after its last day: counts on the last day
  { t: at('2025-11-20T10:00:00+08:00'), v: 1000, p: true, d: false, s: '建中老師', g: 0, i: [{ k: 'late', q: 1, u: 1000 }] }
], { early: { name: '早鳥票' }, late: { name: '晚鳥票' } })

const kpi = (report, key) => report.kpis.find((item) => item.key === key)

test('the grade of a 建中 student comes from the class they typed', () => {
  for (const [className, grade] of [['329', 3], ['329/三數', 3], ['１０５', 1], ['205班', 2], ['三數', 3], ['高二', 2], ['', 0], ['數資', 0], ['4012', 0]]) {
    assert.equal(gradeOf('建國中學', className), grade, className)
  }
  assert.equal(gradeOf('北一女中', '329'), 0)
})

test('a sale counts its days from the opening day in Taiwan', () => {
  const sale = thisYear([])
  assert.deepEqual([sale.year, sale.openDate, sale.days], [2026, '2026-11-05', 3])
  assert.equal(sale.start, at('2026-11-05T00:00:00+08:00'))
  assert.ok(sale.elapsed > 0)

  const before = currentSale({ openAt: new Date('2026-11-05T12:00:00+08:00'), eventDate: '2026-12-13', now: at('2026-10-25T23:00:00+08:00'), rows: [] })
  assert.equal(before.days, 0)
  assert.ok(before.elapsed < 0)
  assert.equal(lastYear([]).days, 10)
  assert.equal(taipeiDate(at('2026-11-05T23:59:00+08:00')), '2026-11-05')
  assert.equal(taipeiDayStart('nope'), null)
  assert.equal(formatDay(new Date('2026-11-05T16:30:00Z')), '11/6（五）')
})

test('KPIs compare with the whole earlier sale, or with the same moment of it', () => {
  const full = buildReport({ current: thisYear(current), previous: lastYear(previous), basis: 'full', now: NOW })
  assert.equal(full.sameTime, false)
  assert.equal(full.ongoing, true)
  assert.deepEqual(kpi(full, 'revenue'), { key: 'revenue', value: 3600, previous: 7000, previousFull: null })
  assert.equal(kpi(full, 'orders').value, 4)
  // the NT$0 test order is left out of the average
  assert.equal(kpi(full, 'aov').value, 1200)
  assert.equal(kpi(full, 'tickets').value, 5)
  assert.equal(kpi(full, 'ticketsPerOrder').value, 1.25)
  assert.equal(kpi(full, 'paidRate').value, 2700 / 3600)

  const same = buildReport({ current: thisYear(current), previous: lastYear(previous), basis: 'same', now: NOW })
  assert.equal(same.sameTime, true)
  assert.deepEqual(kpi(same, 'revenue'), { key: 'revenue', value: 3600, previous: 3000, previousFull: 7000 })
  assert.equal(kpi(same, 'orders').previous, 2)

  const alone = buildReport({ current: thisYear(current), previous: null, basis: 'same', now: NOW })
  assert.deepEqual([alone.hasPrevious, alone.sameTime, kpi(alone, 'revenue').previous], [false, false, null])
  assert.equal(alone.timeline.previous, null)
})

test('the timeline lines up sale days; early and late orders fall on the first and last day', () => {
  const full = buildReport({ current: thisYear(current), previous: lastYear(previous), basis: 'full', now: NOW })
  assert.equal(full.timeline.days, 10)
  assert.deepEqual(full.timeline.current.revenue, [2700, 0, 900])
  assert.deepEqual(full.timeline.current.orders, [3, 0, 1])
  assert.deepEqual(full.timeline.current.cumulative, [2700, 2700, 3600])
  assert.deepEqual(full.timeline.current.aov, [1350, null, 900])
  assert.deepEqual(full.timeline.previous.revenue, [1000, 0, 5000, 0, 0, 0, 0, 0, 0, 1000])
  assert.equal(full.timeline.dayStart(lastYear([]), 2).getTime(), at('2025-11-05T00:00:00+08:00'))

  const same = buildReport({ current: thisYear(current), previous: lastYear(previous), basis: 'same', now: NOW })
  assert.equal(same.timeline.days, 3)
  assert.deepEqual(same.timeline.previous.cumulative, [1000, 1000, 3000])

  // before the opening, test orders still show on day 1
  const early = currentSale({ openAt: new Date('2026-11-05T12:00:00+08:00'), eventDate: '2026-12-13', now: at('2026-11-02T08:00:00+08:00'), rows: current.slice(0, 1) })
  assert.deepEqual(buildReport({ current: early, previous: null, basis: 'full', now: early.start }).timeline.current.orders, [1])
})

test('hours, identities, grades, bands and ticket types cover both years', () => {
  const report = buildReport({ current: thisYear(current), previous: lastYear(previous), basis: 'full', now: NOW })

  assert.equal(report.hours.current[12].count, 1)
  assert.equal(report.hours.current[21].share, 0.25)
  assert.equal(report.hours.previous.length, 24)

  assert.deepEqual(report.identities.map((row) => row.label), ['建國中學', '北一女中', '建中老師', '其他學校或社會人士'])
  assert.deepEqual(report.identities[0].current, { revenue: 2700, orders: 3, tickets: 4, aov: 1350 })
  assert.deepEqual(report.identities[1].previous, { revenue: 0, orders: 0, tickets: 0, aov: null })

  assert.deepEqual(report.grades.map((row) => [row.label, row.current.orders, row.previous.orders]), [
    ['高一', 0, 1], ['高二', 2, 0], ['高三', 1, 1]
  ])

  assert.deepEqual(report.values.map((row) => row.label), ['0', '1–999', '1,000–1,999', '2,000–2,999', '3,000–4,999'])
  assert.deepEqual(report.values[1].current, { count: 2, share: 0.5 })
  assert.deepEqual(report.units.map((row) => [row.label, row.current.count, row.previous.count]), [
    ['1 張', 3, 2], ['2 張', 1, 1], ['3 張', 0, 1]
  ])

  assert.deepEqual(report.ticketTypes.current, [{ label: '一階票', units: 5, amount: 3600 }])
  assert.deepEqual(report.ticketTypes.previous.map((type) => [type.label, type.units]), [['晚鳥票', 4], ['早鳥票', 3]])
})

test('identity groups, the week grid, sale stages and repeat buyers', () => {
  const rows = [
    ...current,
    saleRowOf({ createdAt: ts('2026-11-06T20:10:00+08:00'), userId: 'buyer-b', school: '北一女中', finalTotal: 900, items: [{ id: 'open', name: '一階票', price: 900, quantity: 1 }] })
  ]
  rows[2].buyer = 'buyer-b'
  const report = buildReport({ current: thisYear(rows), previous: lastYear(previous), basis: 'full', now: NOW })

  assert.deepEqual(report.identityGroups.current.map((group) => [group.key, group.orders, group.revenue]), [
    ['home', 3, 2700], ['tfg', 2, 1800], ['zs', 0, 0], ['jm', 0, 0], ['cg', 0, 0],
    ['hsnu', 0, 0], ['parent', 0, 0], ['teacher', 0, 0], ['other', 0, 0]
  ])
  assert.equal(report.identityGroups.current[0].share, 0.6)
  assert.equal(report.identityGroups.previous.find((group) => group.key === 'teacher').orders, 1)

  // Thursday 11/5 12:01 and 21:30, Friday 11/6 20:10 (Monday is row 0)
  assert.equal(report.weekHours[3][12], 1)
  assert.equal(report.weekHours[3][21], 1)
  assert.equal(report.weekHours[4][20], 1)
  assert.equal(report.weekHours.flat().reduce((sum, n) => sum + n, 0), 5)
  assert.deepEqual(report.weekdays.map((day) => day.current.count), [0, 0, 0, 2, 1, 1, 1])
  assert.equal(report.weekdays[3].label, '週四')

  // tickets by stage: the test order and the opening day, then day 2–3
  assert.deepEqual(report.stages.map((stage) => [stage.label, stage.current.count, stage.previous.count]), [
    ['開賣首日', 4, 1], ['第 2–3 天', 2, 5], ['第 15 天以後', 0, 1]
  ])

  assert.equal(report.repeat.buyers, 1)
  assert.deepEqual(report.repeat.bands.map((band) => band.count), [0, 1, 0])
})

test('得知管道 counts each respondent once per channel they named', () => {
  const { respondents, rows } = channelShares([
    { channels: ['班聯會官方 Instagram', '同學或朋友分享'] },
    { channels: ['班聯會官方 Instagram'] },
    { channels: ['不在選項中'] },
    {}
  ])
  assert.equal(respondents, 4)
  assert.deepEqual(rows.slice(0, 2), [
    { label: '班聯會官方 Instagram', count: 2, share: 0.5 },
    { label: '同學或朋友分享', count: 1, share: 0.25 }
  ])
  assert.equal(rows.length, 7)
})

test('a window is compared with the same part of the window before it', () => {
  const today = resolvePeriod('today', { now: NOW })
  assert.deepEqual(today, {
    start: at('2026-11-07T00:00:00+08:00'), end: NOW,
    previous: { start: at('2026-11-06T00:00:00+08:00'), end: at('2026-11-06T15:30:00+08:00') }
  })
  const week = resolvePeriod('7d', { now: NOW })
  assert.deepEqual(week.previous, { start: at('2026-10-25T00:00:00+08:00'), end: at('2026-10-31T15:30:00+08:00') })
  // March 31 against a 28-day February stops where February ends
  const march = resolvePeriod('month', { now: at('2026-03-31T12:00:00+08:00') })
  assert.deepEqual(march.previous, { start: at('2026-02-01T00:00:00+08:00'), end: at('2026-03-01T00:00:00+08:00') })
  assert.deepEqual(resolvePeriod('all', { now: NOW, earliest: at('2026-11-01T10:00:00+08:00') }), {
    start: at('2026-11-01T00:00:00+08:00'), end: NOW, previous: null
  })

  assert.deepEqual(granularityOptions(today).map((option) => option.key), ['hour', 'day', 'month'])
  assert.deepEqual(granularityOptions(resolvePeriod('30d', { now: NOW })).map((option) => option.key), ['day', 'month'])
  assert.equal(defaultGranularity(today), 'hour')
  assert.equal(defaultGranularity(week), 'day')

  const series = periodSeries(current, resolvePeriod('7d', { now: NOW }), 'day')
  assert.equal(series.length, 7)
  // the staff test order on 11/1 opens the window
  assert.deepEqual(series.map((point) => point.current.orders), [1, 0, 0, 0, 2, 0, 1])
  assert.equal(series[4].title, '11/5（四）')
  assert.equal(series[4].previous.title, '10/29（四）')
  assert.equal(series[4].current.aov, 1350)
  assert.equal(inRange(current, today).length, 1)
  assert.equal(summarize(inRange(current, today)).revenue, 900)

  const hourly = periodSeries(current, today, 'hour')
  assert.equal(hourly.length, 16)
  assert.equal(hourly[9].label, '09:00')
  assert.equal(periodSeries([], resolvePeriod('7d', { now: NOW }), 'hour')[0].label, '11/1 00:00')
  assert.equal(formatPeriod(week, NOW), '11/1 – 11/7')
  assert.equal(formatPeriod({ start: at('2025-12-30T00:00:00+08:00'), end: at('2026-01-06T00:00:00+08:00') }, at('2026-01-05T00:00:00+08:00')), '2025/12/30 – 1/5')
  assert.equal(bucketLabels(at('2025-12-01T00:00:00+08:00'), 'month').title, '2025 年 12 月')
})

test('numbers are formatted for tiles, tables and axes', () => {
  assert.equal(formatCurrency(1284600), 'NT$ 1,284,600')
  assert.equal(formatCurrency(null), '—')
  assert.equal(formatCount(1432.4), '1,432')
  assert.equal(formatPercent(0.125), '12.5%')
  assert.equal(formatDecimal(1.25), '1.25')
  assert.deepEqual([0, 950, 1000, 1200, 12000, 1250000].map(formatCompact), ['0', '950', '1K', '1.2K', '12K', '1.3M'])
  assert.deepEqual(niceTicks(1800), [0, 500, 1000, 1500, 2000])
  assert.deepEqual(niceTicks(3, { integer: true }), [0, 1, 2, 3])
  assert.deepEqual(niceTicks(0), [0, 1])
})
