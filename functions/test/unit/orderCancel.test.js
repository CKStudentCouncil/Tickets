import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_CANCEL_ORDERS,
  checkCancellation,
  noticeCountsOf,
  sanitizeCancelInput
} from '../../lib/orderCancel.js'

const ID = 'CKS20261105ABC234'
const notices = (...types) => Object.fromEntries(types.map((type, i) => [`job${i}`, { type, at: null }]))
const order = (fields = {}) => ({ paid: false, delivered: false, finalTotal: 900, ...fields })

test('notices count by kind; 繳費暨取票 counts for both', () => {
  assert.deepEqual(noticeCountsOf({}), { payment: 0, pickup: 0 })
  assert.deepEqual(noticeCountsOf({ notices: notices('payment', 'both', 'pickup', 'pickup') }), { payment: 2, pickup: 3 })
  assert.deepEqual(noticeCountsOf({ notices: { a: null, b: 'pickup', c: { type: 'custom' } } }), { payment: 0, pickup: 0 })
})

test('cancel input: ids, reason, note and refund are checked', () => {
  const ok = { orderIds: [ID, ID], reason: 'buyer_request' }
  assert.deepEqual(sanitizeCancelInput(ok), { orderIds: [ID], reason: 'buyer_request', note: '', refund: null, notify: true })
  assert.equal(sanitizeCancelInput({ ...ok, notify: false }).notify, false)
  for (const orderIds of [[], ['../x'], [123], Array.from({ length: MAX_CANCEL_ORDERS + 1 }, (_, i) => `CKS20261105${String(i).padStart(4, '0')}`)]) {
    assert.throws(() => sanitizeCancelInput({ ...ok, orderIds }), { code: 'invalid-argument' })
  }
  assert.throws(() => sanitizeCancelInput({ ...ok, reason: 'whim' }), { code: 'invalid-argument' })
  assert.throws(() => sanitizeCancelInput({ ...ok, reason: 'other' }), { code: 'invalid-argument' }, 'other needs a note')
  assert.equal(sanitizeCancelInput({ ...ok, reason: 'other', note: '  重複下單  ' }).note, '重複下單')
  assert.throws(() => sanitizeCancelInput({ ...ok, note: 'x'.repeat(201) }), { code: 'invalid-argument' })
  assert.throws(() => sanitizeCancelInput({ ...ok, refund: -1 }), { code: 'invalid-argument' })
  assert.throws(() => sanitizeCancelInput({ ...ok, refund: 1.5 }), { code: 'invalid-argument' })
  assert.throws(() => sanitizeCancelInput({ orderIds: [ID, 'CKS20261105ABC235'], reason: 'other', note: 'x', refund: 100 }), { code: 'invalid-argument' })
  assert.equal(sanitizeCancelInput({ ...ok, refund: 300 }).refund, 300)
})

test('complimentary, street and collected orders are never cancelled', () => {
  for (const fields of [{ complimentary: true, paid: true }, { streetSale: true, paid: true, delivered: true }, { delivered: true }]) {
    assert.throws(() => checkCancellation(order(fields), { reason: 'buyer_request', refund: 'full' }), { code: 'failed-precondition' })
  }
})

test('逾期未繳費 needs an unpaid order with a payment notice', () => {
  const input = { reason: 'unpaid', refund: null }
  assert.throws(() => checkCancellation(order(), input), { code: 'failed-precondition' })
  assert.throws(() => checkCancellation(order({ paid: true, notices: notices('payment') }), input), { code: 'failed-precondition' })
  assert.equal(checkCancellation(order({ notices: notices('both') }), input), 0)
})

test('逾期未領票 needs three pickup notices', () => {
  const input = { reason: 'uncollected', refund: 'none' }
  assert.throws(() => checkCancellation(order({ notices: notices('pickup', 'both') }), input), /2 次/)
  assert.equal(checkCancellation(order({ notices: notices('pickup', 'both', 'pickup') }), input), 0)
  assert.equal(checkCancellation(order({ paid: true, notices: notices('pickup', 'both', 'pickup') }), input), 0)
})

test('only paid orders owe a refund, and never more than was paid', () => {
  const paid = order({ paid: true })
  assert.equal(checkCancellation(order(), { reason: 'buyer_request', refund: 'full' }), 0)
  assert.equal(checkCancellation(paid, { reason: 'buyer_request', refund: 'full' }), 900)
  assert.equal(checkCancellation(paid, { reason: 'buyer_request', refund: 'none' }), 0)
  assert.equal(checkCancellation(paid, { reason: 'buyer_request', refund: 400 }), 400)
  assert.throws(() => checkCancellation(paid, { reason: 'buyer_request', refund: 901 }), { code: 'invalid-argument' })
  assert.throws(() => checkCancellation(paid, { reason: 'buyer_request', refund: null }), { code: 'invalid-argument' })
})

test('the 訂單取消通知 says what is refunded, or that nothing is, and keeps the admin note internal', async () => {
  const { generateCancellationHTML } = await import('../../templates/orderCancellation.js')
  const base = {
    customerName: '<b>王</b>', items: [{ name: '一階票', price: 900, quantity: 2 }], finalTotal: 1800,
    cancelledAt: new Date('2026-11-20T01:00:00Z'), cancelNote: '內部備註：黃牛'
  }
  const refunded = generateCancellationHTML(ID, { ...base, paid: true, cancelReason: 'buyer_request', refundAmount: 1800 })
  assert.match(refunded, /退款金額/)
  assert.match(refunded, /購票人申請取消/)
  assert.match(refunded, /2026\/11\/20/, 'in Taiwan time')
  assert.doesNotMatch(refunded, /<b>王<\/b>/)
  assert.doesNotMatch(refunded, /內部備註/)

  const kept = generateCancellationHTML(ID, { ...base, paid: true, cancelReason: 'uncollected', refundAmount: 0 })
  assert.match(kept, /不予退還/)
  assert.match(kept, /第四條/)
  assert.doesNotMatch(kept, /退款金額/, 'no refund of NT$ 0')

  const unpaid = generateCancellationHTML(ID, { ...base, paid: false, cancelReason: 'unpaid', refundAmount: 0 })
  assert.match(unpaid, /無須付款/)
  assert.doesNotMatch(unpaid, /退還|退款金額/)
})
