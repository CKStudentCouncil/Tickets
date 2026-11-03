import test from 'node:test'
import assert from 'node:assert/strict'
import { backupFileName, backupTotals, buildOrderBackup, toPlain } from '../src/utils/orderBackup.js'

const ts = (iso) => ({ toDate: () => new Date(iso) })

const orders = [
  {
    id: 'CKS20261105K7Q2MX', createdAt: ts('2026-11-05T04:03:00Z'), school: '建國中學', customerName: '王小明',
    customerPhone: '0912345678', customerEmail: 's1@gl.ck.tp.edu.tw', class: '305', number: '12',
    items: [{ ticketTypeId: 'open', name: '一階票', price: 900, quantity: 2 }, { id: 'free', name: '自由票', price: 500, quantity: 1 }],
    finalTotal: 2300, paid: true, paymentUpdatedAt: ts('2026-11-06T02:00:00Z'), paymentUpdatedByName: '收款人員',
    delivered: false, emailStatus: 'accepted', userId: 'uid-1', ticketCode: 'secret', stockShards: { open: { 3: 2 } }
  },
  // a legacy order missing most fields
  { id: 'CKS202611050001', items: [null, { id: 'open', quantity: '1' }] }
]

test('every order, its line items and all its raw fields are in the backup', () => {
  const [summary, orderSheet, itemSheet, rawSheet] = buildOrderBackup(orders, {
    exportedAt: new Date('2026-12-20T02:00:00Z'), exportedBy: '總召'
  })
  assert.deepEqual([summary, orderSheet, itemSheet, rawSheet].map((sheet) => sheet.name), ['摘要', '訂單', '票券明細', '原始資料'])
  for (const sheet of [summary, orderSheet, itemSheet, rawSheet]) {
    const keys = sheet.columns.map((column) => column.key)
    sheet.rows.forEach((row) => assert.deepEqual(Object.keys(row), keys, sheet.name))
  }

  assert.equal(orderSheet.rows.length, 2)
  const first = orderSheet.rows[0]
  assert.equal(first.id, 'CKS20261105K7Q2MX')
  assert.match(first.createdAt, /2026/)
  assert.equal(first.items, '一階票 ×2（NT$ 900）、自由票 ×1（NT$ 500）')
  assert.equal(first.tickets, 3)
  assert.equal(first.paid, '已付款')
  assert.equal(first.emailStatus, '郵件服務已接受')
  assert.deepEqual([orderSheet.rows[1].createdAt, orderSheet.rows[1].items, orderSheet.rows[1].finalTotal], ['', 'open ×1（NT$ 0）', 0])

  assert.deepEqual(itemSheet.rows.map((row) => [row.id, row.ticketTypeId, row.quantity, row.subtotal]), [
    ['CKS20261105K7Q2MX', 'open', 2, 1800],
    ['CKS20261105K7Q2MX', 'free', 1, 500],
    ['CKS202611050001', 'open', 1, 0]
  ])

  const raw = JSON.parse(rawSheet.rows[0].json)
  assert.equal(raw.createdAt, '2026-11-05T04:03:00.000Z')
  assert.equal(raw.ticketCode, 'secret')
  assert.deepEqual(raw.stockShards, { open: { 3: 2 } })
  assert.equal(raw.id, undefined)

  assert.equal(summary.rows.find((row) => row.label === '訂單應收金額').value, 2300)
  assert.equal(summary.rows.find((row) => row.label === '備份者').value, '總召')
})

test('totals keep order value and collected payment apart', () => {
  assert.deepEqual(backupTotals(orders), { orders: 2, tickets: 4, revenue: 2300, paidRevenue: 2300, deliveredOrders: 0 })
  assert.deepEqual(toPlain({ a: [ts('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z'), null] }), {
    a: ['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', null]
  })
})

test('the file is named after the Taiwan date and the order count', () => {
  assert.equal(backupFileName(1432, new Date('2026-12-20T17:00:00Z')), '訂單完整備份_2026-12-21_1432筆.xlsx')
})
