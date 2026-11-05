import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cancelBlockOf,
  lastNoticeAt,
  noticeCountsOf,
  overdueOrders,
  reasonBlockOf,
  retainedOf,
  summarizeCancellations
} from '../src/utils/cancellations.js'

const notice = (type, at) => ({ type, at: new Date(at) })
const order = (id, fields = {}) => ({ id, paid: false, delivered: false, finalTotal: 900, ...fields })

test('notices count by kind, 繳費暨取票 for both; the latest of a kind is found', () => {
  const notices = {
    a: notice('payment', '2026-11-10T12:00:00+08:00'),
    b: notice('both', '2026-11-12T12:00:00+08:00'),
    c: notice('pickup', '2026-11-15T12:00:00+08:00'),
    d: notice('custom', '2026-11-20T12:00:00+08:00')
  }
  assert.deepEqual(noticeCountsOf({ notices }), { payment: 2, pickup: 2 })
  assert.deepEqual(noticeCountsOf({}), { payment: 0, pickup: 0 })
  assert.equal(lastNoticeAt({ notices }, 'payment').toISOString(), '2026-11-12T04:00:00.000Z')
  assert.equal(lastNoticeAt({ notices }, 'pickup').toISOString(), '2026-11-15T04:00:00.000Z')
  assert.equal(lastNoticeAt({}, 'pickup'), null)
})

test('公關票, 路宣 and collected orders cannot be cancelled', () => {
  assert.equal(cancelBlockOf(order('a')), '')
  assert.match(cancelBlockOf(order('b', { complimentary: true })), /公關票/)
  assert.match(cancelBlockOf(order('c', { streetSale: true })), /路宣/)
  assert.match(cancelBlockOf(order('d', { delivered: true })), /已領票/)
})

test('逾期 reasons follow the notices; the others always apply', () => {
  const unpaidNotified = order('a', { notices: { x: notice('payment', '2026-11-10') } })
  assert.equal(reasonBlockOf(unpaidNotified, 'unpaid'), '')
  assert.match(reasonBlockOf(order('b'), 'unpaid'), /繳費通知/)
  assert.match(reasonBlockOf({ ...unpaidNotified, paid: true }, 'unpaid'), /已付款/)
  assert.match(reasonBlockOf(order('c', { notices: { x: notice('pickup', '2026-11-10') } }), 'uncollected'), /1 次/)
  for (const reason of ['buyer_request', 'violation', 'other']) assert.equal(reasonBlockOf(order('d'), reason), '')
})

test('逾期 lists only the orders that qualify, longest overdue first', () => {
  const three = (day) => ({
    a: notice('pickup', `2026-11-0${day}`), b: notice('pickup', '2026-11-01'), c: notice('both', '2026-11-01')
  })
  const orders = [
    order('late', { notices: three(9) }),
    order('early', { notices: three(5), paid: true }),
    order('two', { notices: { a: notice('pickup', '2026-11-01'), b: notice('pickup', '2026-11-02') } }),
    order('collected', { delivered: true, notices: three(3) }),
    order('guest', { complimentary: true, notices: three(3) })
  ]
  assert.deepEqual(overdueOrders(orders, 'uncollected').map((item) => item.id), ['early', 'late'])
  // the 'both' notices made these payment notices too; 'early' is paid
  assert.deepEqual(overdueOrders(orders, 'unpaid').map((item) => item.id), ['late'])
})

test('what is kept of a cancelled order, and the refunds owed and handed back', () => {
  const cancelled = [
    { paid: true, finalTotal: 1800, refundAmount: 1800, refundStatus: 'pending' },
    { paid: true, finalTotal: 900, refundAmount: 900, refundStatus: 'done' },
    { paid: true, finalTotal: 900, refundAmount: 300, refundStatus: 'pending' },
    { paid: true, finalTotal: 700, refundAmount: 0, refundStatus: 'none' },
    { paid: false, finalTotal: 900, refundAmount: 0, refundStatus: 'none' }
  ]
  assert.deepEqual(cancelled.map(retainedOf), [0, 0, 600, 700, 0])
  assert.deepEqual(summarizeCancellations(cancelled), { count: 5, pending: 2100, refunded: 900, retained: 1300 })
})
