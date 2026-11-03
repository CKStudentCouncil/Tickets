import { test } from 'node:test'
import assert from 'node:assert/strict'

import { gradeOf, saleDatesOf, saleRowOf, sanitizeImport, summarizeRows, ticketTypeNamesOf } from '../../lib/salesArchive.js'

const ts = (iso) => ({ toDate: () => new Date(iso) })

const orders = [
  {
    school: '建國中學', class: '329/三數', number: '12', customerName: '王小明', customerEmail: 'a@gl.ck.tp.edu.tw',
    finalTotal: 1800, paid: true, delivered: true, createdAt: ts('2026-11-05T04:00:00Z'),
    items: [{ ticketTypeId: 'open', name: '一階票', price: 900, quantity: 2 }]
  },
  {
    school: '北一女中', class: '101', finalTotal: 1400, paid: false, createdAt: ts('2026-11-05T16:30:00Z'),
    // legacy items keep the type id in `id`
    items: [{ id: 'open', name: '一階票（新）', price: 900, quantity: 1 }, null, { id: 'free', name: '自由票', price: 500, quantity: 1 }]
  },
  { school: '', finalTotal: 'oops', items: 'none' }
]

test('a sale row keeps what the charts need and nothing that identifies the buyer', () => {
  // the whole row: no name, email, class or seat
  assert.deepEqual(saleRowOf(orders[0]), {
    t: Date.parse('2026-11-05T04:00:00Z'), v: 1800, p: true, d: true, s: '建國中學', g: 3,
    i: [{ k: 'open', q: 2, u: 900 }]
  })
  assert.deepEqual(saleRowOf(orders[2]), { t: null, v: 0, p: false, d: false, s: '未填寫', g: 0, i: [] })
  assert.deepEqual(ticketTypeNamesOf(orders), { open: '一階票（新）', free: '自由票' })
})

test('the grade of a 建中 student comes from the class they typed', () => {
  for (const [className, grade] of [['329', 3], ['329/三數', 3], ['１０５', 1], ['205班', 2], ['三數', 3], ['高二', 2], ['一年忠班', 1], ['', 0], ['數資', 0], ['4012', 0], ['2', 0]]) {
    assert.equal(gradeOf('建國中學', className), grade, className)
  }
  assert.equal(gradeOf('北一女中', '329'), 0)
})

test('summaries keep order value and collected payment apart, by school, ticket type and Taiwan day', () => {
  const summary = summarizeRows(orders.map(saleRowOf), ticketTypeNamesOf(orders))

  assert.equal(summary.orderCount, 3)
  assert.equal(summary.ticketCount, 4)
  assert.equal(summary.revenue, 3200)
  assert.equal(summary.paidRevenue, 1800)
  assert.equal(summary.paidOrderCount, 1)
  assert.equal(summary.deliveredOrderCount, 1)
  assert.deepEqual(summary.bySchool, {
    建國中學: { orderCount: 1, ticketCount: 2, revenue: 1800 },
    北一女中: { orderCount: 1, ticketCount: 2, revenue: 1400 },
    未填寫: { orderCount: 1, ticketCount: 0, revenue: 0 }
  })
  assert.deepEqual(summary.byTicketType, {
    open: { name: '一階票（新）', ticketCount: 3, revenue: 2700 },
    free: { name: '自由票', ticketCount: 1, revenue: 500 }
  })
  // 16:30 UTC is already the next day in Taiwan
  assert.deepEqual(Object.keys(summary.byDay), ['2026-11-05', '2026-11-06'])
  assert.equal(summary.firstOrderAt.toISOString(), '2026-11-05T04:00:00.000Z')
  assert.equal(summary.lastOrderAt.toISOString(), '2026-11-05T16:30:00.000Z')

  const empty = summarizeRows([])
  assert.deepEqual([empty.orderCount, empty.firstOrderAt, empty.byDay], [0, null, {}])
})

test("a sale runs from the shop's opening in that year, else the first order, to the last order", () => {
  const rows = orders.map(saleRowOf)
  const opening = new Date('2026-11-01T04:00:00Z')
  assert.deepEqual(saleDatesOf(rows, 2026, opening), { openDate: '2026-11-01', closeDate: '2026-11-06' })
  // an opening set for another year says nothing about this one
  assert.deepEqual(saleDatesOf(rows, 2026, new Date('2027-11-01T04:00:00Z')), { openDate: '2026-11-05', closeDate: '2026-11-06' })
  assert.deepEqual(saleDatesOf([], 2025, null), { openDate: '2025-01-01', closeDate: '2025-01-01' })
})

test('imports take sale rows only, from a valid sale period', () => {
  const row = { t: Date.parse('2025-11-03T04:00:00Z'), v: 900, p: true, d: false, s: '建國中學', g: 2, i: [{ k: '一階票', q: 1, u: 900 }] }
  const input = { openDate: '2025-11-03', closeDate: '2025-12-10', rows: [row], names: { 一階票: '一階票', 'bad/key': 3 } }

  const clean = sanitizeImport({ ...input, rows: [{ ...row, customerName: '王小明' }] })
  assert.equal(clean.year, 2025)
  assert.deepEqual(clean.rows, [row])
  assert.deepEqual(clean.names, { 一階票: '一階票' })

  for (const bad of [
    { ...input, openDate: '2025-02-30' },
    { ...input, closeDate: '2025-11-01' },
    { ...input, rows: [] },
    { ...input, rows: [{ ...row, v: -1 }] },
    { ...input, rows: [{ ...row, g: 4 }] },
    { ...input, rows: [{ ...row, s: '' }] },
    { ...input, rows: [{ ...row, t: 'yesterday' }] },
    { ...input, rows: [{ ...row, i: [{ k: '一階票', q: 0, u: 900 }] }] },
    { ...input, rows: [{ ...row, i: [{ k: '__name__', q: 1, u: 900 }] }] },
    null
  ]) {
    assert.throws(() => sanitizeImport(bad), { code: 'invalid-argument' })
  }
})
