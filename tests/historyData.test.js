import test from 'node:test'
import assert from 'node:assert/strict'
import { archiveNamesOf, historyFileName, historyYears, ordersFromSaleRows, recordsOf, taiwanYearOf, yearFromQuery } from '../src/utils/historyData.js'
import { buildStatement, summarizeOrders } from '../src/utils/partyStatement.js'

const ts = (iso) => ({ toDate: () => new Date(iso) })

const records = {
  archives: [
    { id: '2025', source: 'purge', orderCount: 1500, revenue: 1_200_000 },
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
    archive: { source: 'purge', orderCount: 1500, revenue: 1_200_000 },
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
  assert.equal(y2023.archivedOrders, 0)
  assert.deepEqual(historyYears(), [])
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
