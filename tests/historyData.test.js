import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPENSE_CATEGORIES,
  archiveNamesOf,
  balanceOf,
  paceStats,
  expensesByCategory,
  historyFileName,
  historyYears,
  identityTicketsOf,
  ordersFromSaleRows,
  recordsOf,
  salePaces,
  taiwanYearOf,
  yearFromQuery
} from '../src/utils/historyData.js'
import { UNCATEGORIZED } from '../src/data/reimbursements.js'
import { buildStatement, summarizeOrders } from '../src/utils/partyStatement.js'
import { IDENTITY_GROUPS } from '../src/utils/salesAnalytics.js'

const ts = (iso) => ({ toDate: () => new Date(iso) })

const records = {
  archives: [
    { id: '2025', source: 'purge', orderCount: 1500, ticketCount: 2100, revenue: 1_200_000 },
    { id: '2023', source: 'import', orderCount: 900, revenue: 700_000, byTicketType: { open: { name: '一階票' }, x: {} } }
  ],
  archivedCounts: { 2025: 1498, 2023: 0 },
  partySurveys: [{ id: '2025', year: 2025 }, { id: 'draft' }],
  partySurveyCounts: { 2025: 42 },
  surveyResponses: [
    // 2024-12-31 16:30 UTC is already 2025 in Taiwan
    { id: 's1', createdAt: ts('2024-12-31T16:30:00Z') },
    { id: 's2', createdAt: ts('2026-11-01T00:00:00Z') },
    { id: 'no-time' }
  ],
  reimbursements: [
    { id: 'r1', year: 2025, amount: 500, status: 'paid', invoices: [{ fileId: 'a' }, null, { fileId: 'b' }] },
    { id: 'r2', year: 2025, amount: 300, status: 'rejected' },
    { id: 'r3', year: 2026, amount: 100, status: 'pending' }
  ],
  sellers: [{ id: 'a@x', createdAt: ts('2025-10-01T00:00:00Z') }],
  sellerRegistrations: [{ id: 'g1', createdAt: ts('2025-11-01T00:00:00Z') }, { id: 'g2', createdAt: ts('2026-11-02T00:00:00Z') }]
}

test('records go under the Taiwan year they were made in', () => {
  assert.equal(taiwanYearOf(ts('2024-12-31T16:30:00Z')), 2025)
  assert.equal(taiwanYearOf(ts('2024-12-31T15:59:00Z')), 2024)
  assert.equal(taiwanYearOf('2025-03-01T10:00'), 2025)
  assert.equal(taiwanYearOf(null), null)
})

test('every year with any record is listed, latest first, with what it holds', () => {
  const years = historyYears(records)
  assert.deepEqual(years.map((item) => item.year), [2026, 2025, 2023])

  const [y2026, y2025, y2023] = years
  assert.deepEqual(y2025, {
    year: 2025,
    archive: { source: 'purge', orderCount: 1500, ticketCount: 2100, revenue: 1_200_000 },
    archivedOrders: 1498,
    surveyResponses: 1,
    partySurveyResponses: 42,
    reimbursements: 2,
    spent: 500,
    invoices: 2,
    sellers: 1,
    sellerRegistrations: 1
  })
  assert.equal(y2026.archive, null)
  assert.equal(y2026.partySurveyResponses, null)
  assert.deepEqual([y2026.surveyResponses, y2026.reimbursements, y2026.spent, y2026.sellerRegistrations], [1, 1, 0, 1])
  assert.equal(y2023.archive.source, 'import')
  assert.equal(y2023.archive.ticketCount, 0)
  assert.equal(y2023.archivedOrders, 0)
  assert.deepEqual(historyYears(), [])
})

test('a sale\'s tickets add up day by day from its opening, latest years first', () => {
  const day = (ticketCount) => ({ orderCount: 1, ticketCount, revenue: 0 })
  const paces = salePaces([
    { id: '2023', openDate: '2023-10-01', closeDate: '2023-10-02', byDay: { '2023-10-02': day(4) } },
    {
      id: '2025',
      openDate: '2025-10-01',
      closeDate: '2025-10-04',
      // the day before the opening counts as day 1, the day after the close as the last
      byDay: { '2025-09-30': day(1), '2025-10-01': day(10), '2025-10-03': day(5), '2025-10-05': day(2), bad: day(99) }
    },
    { id: '2024', openDate: '2024-10-01', closeDate: '2024-10-01', byDay: {} },
    { id: '2022', openDate: '2022-10-01', closeDate: '2022-10-01', byDay: { '2022-10-01': day(7) } },
    // no sale dates, or ones out of order
    { id: '2026', byDay: { '2026-10-01': day(3) } },
    { id: '2021', openDate: '2021-10-05', closeDate: '2021-10-01' }
  ])

  assert.deepEqual(paces.map((pace) => pace.year), [2025, 2024, 2023])
  assert.deepEqual(paces[0].daily, [11, 0, 5, 2])
  assert.deepEqual(paces[0].tickets, [11, 11, 16, 18])
  // opening day midnight in Taiwan
  assert.equal(paces[0].start, Date.parse('2025-09-30T16:00:00Z'))
  assert.deepEqual(paces[1].tickets, [0])
  assert.deepEqual(paces[2].tickets, [0, 4])
  assert.deepEqual(salePaces([{ id: '2022', openDate: '2022-10-01', closeDate: '2022-10-01', byDay: { '2022-10-01': day(7) } }]), [
    { year: 2022, start: Date.parse('2022-09-30T16:00:00Z'), daily: [7], tickets: [7] }
  ])
  assert.equal(salePaces([{ id: '2025', openDate: '2025-10-01', closeDate: '2025-10-01' }, { id: '2024', openDate: '2024-10-01', closeDate: '2024-10-01' }], 1).length, 1)
  assert.deepEqual(salePaces(), [])
})

test('how front-loaded a sale was', () => {
  // 10 days: 40 on day 1, then 5 a day, 20 on the last; 90 of 100 only by day 10
  const daily = [40, 5, 5, 5, 5, 5, 5, 5, 5, 20]
  let sold = 0
  const stats = paceStats({ daily, tickets: daily.map((n) => (sold += n)) })
  assert.deepEqual(stats, { firstDay: 0.4, firstWeek: 0.7, half: 3, most: 10 })
  // a sale shorter than a week sold all of it in its first week
  assert.equal(paceStats({ daily: [3, 1], tickets: [3, 4] }).firstWeek, 1)
  assert.equal(paceStats({ daily: [0, 0], tickets: [0, 0] }), null)
  assert.equal(paceStats(), null)
})

test('an archived year\'s tickets per 購買者身分, as the sales report groups them', () => {
  const tickets = identityTicketsOf({
    bySchool: {
      建國中學: { orderCount: 10, ticketCount: 30, revenue: 0 },
      北一女中: { orderCount: 5, ticketCount: 12, revenue: 0 },
      路宣: { orderCount: 2, ticketCount: 4, revenue: 0 },
      某某高中: { orderCount: 1, ticketCount: 2, revenue: 0 },
      未填寫: { orderCount: 1, ticketCount: 1, revenue: 0 }
    }
  })
  assert.equal(tickets.length, IDENTITY_GROUPS.length)
  const of = (key) => tickets[IDENTITY_GROUPS.findIndex((group) => group.key === key)]
  assert.deepEqual([of('home'), of('tfg'), of('street'), of('other')], [30, 12, 4, 3])
  assert.equal(tickets.reduce((a, b) => a + b, 0), 49)
  assert.deepEqual(identityTicketsOf(null), IDENTITY_GROUPS.map(() => 0))
})

test('a year\'s expenses per 科目 are its approved and paid claims, as the 收支表 counts them', () => {
  const claims = [
    { year: 2025, amount: 500, status: 'paid', category: '場地' },
    { year: 2025, amount: 200, status: 'approved', category: '場地' },
    { year: 2025, amount: 90, status: 'paid', category: '餐食' },
    // before 科目 existed, or one no longer listed
    { year: 2025, amount: 40, status: 'paid' },
    { year: 2025, amount: 10, status: 'approved', category: '舊科目' },
    { year: 2025, amount: 999, status: 'pending', category: '場地' },
    { year: 2025, amount: 999, status: 'rejected', category: '場地' },
    { year: 2024, amount: 999, status: 'paid', category: '場地' }
  ]
  const amounts = expensesByCategory(claims, 2025)
  assert.deepEqual(EXPENSE_CATEGORIES.at(-1), UNCATEGORIZED)
  assert.deepEqual(Object.fromEntries(EXPENSE_CATEGORIES.map((name, i) => [name, amounts[i]]).filter(([, amount]) => amount)), {
    場地: 700,
    餐食: 90,
    [UNCATEGORIZED]: 50
  })
  // the same total as the year's 報帳支出
  assert.equal(amounts.reduce((a, b) => a + b, 0), historyYears({ reimbursements: claims }).find((item) => item.year === 2025).spent)
  assert.deepEqual(expensesByCategory([], 2025), EXPENSE_CATEGORIES.map(() => 0))
})

test('a year\'s 收支 is the 收支 page\'s 目前利潤, from the archive without reading its orders', () => {
  const data = {
    archives: [{ id: '2025', revenue: 10_000, paidRevenue: 9_000 }],
    sellerRegistrations: [
      { id: 'g1', price: 500, quantity: 2, paid: true, createdAt: ts('2025-11-01T00:00:00Z') },
      { id: 'g2', price: 500, quantity: 1, paid: false, createdAt: ts('2025-11-02T00:00:00Z') },
      { id: 'g3', price: 500, quantity: 4, paid: true, createdAt: ts('2026-11-01T00:00:00Z') }
    ],
    reimbursements: [
      { year: 2025, amount: 3_000, status: 'paid', category: '場地' },
      { year: 2025, amount: 500, status: 'approved', category: '餐食' },
      { year: 2025, amount: 9_999, status: 'pending', category: '場地' },
      { year: 2026, amount: 9_999, status: 'paid', category: '場地' }
    ]
  }
  const balance = balanceOf(data, 2025)
  assert.deepEqual(
    { ...balance, expenses: undefined },
    { orders: 9_000, sellers: 1_000, expenses: undefined, income: 10_000, expense: 3_500, balance: 6_500 }
  )
  assert.equal(balance.expenses[EXPENSE_CATEGORIES.indexOf('場地')], 3_000)
  assert.equal(balance.expenses[EXPENSE_CATEGORIES.indexOf('餐食')], 500)

  // the 收支表 reads the same year's orders: the paid ones' finalTotal
  const orders = [{ finalTotal: 9_000, paid: true, items: [] }, { finalTotal: 1_000, paid: false, items: [] }]
  assert.equal(summarizeOrders(orders).paidAmount, balance.orders)
  // no archived orders, no 收支
  assert.equal(balanceOf(data, 2026), null)
  assert.equal(balanceOf({}, 2025), null)
})

test('a year takes only its records; every year takes them all', () => {
  const year = recordsOf(records, 2025)
  assert.deepEqual(Object.fromEntries(Object.entries(year).map(([key, list]) => [key, list.map((item) => item.id)])), {
    surveyResponses: ['s1'],
    reimbursements: ['r1', 'r2'],
    sellers: ['a@x'],
    sellerRegistrations: ['g1']
  })
  const all = recordsOf(records)
  assert.equal(all.surveyResponses.length, 3)
  assert.equal(all.reimbursements.length, 3)
  assert.deepEqual(recordsOf({}, 2025), { surveyResponses: [], reimbursements: [], sellers: [], sellerRegistrations: [] })
})

test('names and file names', () => {
  assert.deepEqual(archiveNamesOf(records.archives[1]), { open: '一階票', x: 'x' })
  assert.deepEqual(archiveNamesOf(null), {})
  const at = new Date('2030-01-01T17:00:00Z')
  assert.equal(historyFileName(2025, at), '2025年資料_2030-01-02.xlsx')
  assert.equal(historyFileName(null, at), '歷年資料_2030-01-02.xlsx')
})

test('only a plain four-digit year is taken from the address', () => {
  assert.equal(yearFromQuery('2025'), 2025)
  assert.equal(yearFromQuery(['2024', '2025']), 2024)
  for (const value of [undefined, null, '', '25', '2025a', ' 2025', '1999', '20255', 'abcd']) {
    assert.equal(yearFromQuery(value), null, String(value))
  }
})

test('imported sale rows become orders the 收支表 can read', () => {
  const orders = ordersFromSaleRows([
    { t: Date.parse('2024-11-05T04:03:00Z'), v: 1800, p: true, d: false, s: '建國中學', g: 2, i: [{ k: 'open', q: 2, u: 900 }] },
    { t: null, v: 500, p: false, d: false, s: '北一女中', g: 0, i: [{ k: 'late', q: 1, u: 500 }] },
    null
  ], { open: '一階票' })
  assert.equal(orders.length, 2)
  assert.deepEqual(orders[0].items, [{ ticketTypeId: 'open', name: '一階票', price: 900, quantity: 2 }])
  assert.equal(orders[1].createdAt, null)
  assert.equal(orders[1].items[0].name, 'late')
  assert.deepEqual(summarizeOrders(orders), { bookedAmount: 2300, paidAmount: 1800 })

  const statement = buildStatement({ orders, basis: 'realized' })
  assert.equal(statement.income, 1800)
  assert.ok(statement.rows.some((row) => row.name === '一階票' && row.income === 1800))
})
