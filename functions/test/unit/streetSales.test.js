import { test } from 'node:test'
import assert from 'node:assert/strict'

import { STREET_ORDER_PREFIX, sanitizeStreetSaleInput, streetOrderOf } from '../../lib/streetSales.js'
import { enqueueManualOrderResend, enqueueOrderConfirmation } from '../../lib/mailQueue.js'
import { needsNotice, readRecipientFilters } from '../../lib/notifications.js'
import { stockReleaseOf } from '../../lib/orders.js'
import { ORDER_ID_PATTERN, generateOrderId } from '../../lib/orderValidation.js'
import { STREET_SCHOOL } from '../../lib/constants.js'

const REQUEST_ID = 'street-request-0001'
const SALE = { requestId: REQUEST_ID, quantity: 2 }

const code = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.code
  }
  return null
}

const TYPE = { name: '一般票', price: 900, eligibleBuyerIdentity: 'all_users', studentOnlyUntil: '2026-11-10T12:00:00+08:00' }
const PROMOTER = { uid: 'admin-uid', email: 'admin@example.com', name: '林管理' }
const SOLD_AT = { toDate: () => new Date('2026-11-06T10:00:00+08:00') }

const orderOf = (overrides = {}) => streetOrderOf({
  quantity: 2,
  ticketTypeId: 'open',
  ticketType: TYPE,
  promoter: PROMOTER,
  ticketCode: 'code',
  stockShards: { open: { 3: 2 } },
  soldAt: SOLD_AT,
  ...overrides
})

test('a sale is only its quantity: nothing about the buyer is kept', () => {
  assert.deepEqual(
    sanitizeStreetSaleInput({ ...SALE, name: '陳小華', phone: '0912', email: 'a@b.co', school: '北一女中', price: 0, paid: false }),
    { requestId: REQUEST_ID, quantity: 2 }
  )
})

test('malformed sales are refused', () => {
  const cases = [
    { ...SALE, requestId: undefined },
    { ...SALE, requestId: 'short' },
    { ...SALE, quantity: 0 },
    { ...SALE, quantity: 21 },
    { ...SALE, quantity: 1.5 },
    { ...SALE, quantity: '2x' }
  ]
  cases.forEach((data) => assert.equal(code(() => sanitizeStreetSaleInput(data)), 'invalid-argument', JSON.stringify(data)))
})

test('a street sale is paid and collected at once, under 路宣, with no buyer details', () => {
  const order = orderOf()

  assert.equal(order.school, STREET_SCHOOL)
  assert.equal(order.streetSale, true)
  assert.equal(order.userId, null)
  assert.equal(order.customerName, '')
  assert.equal(order.customerEmail, '')
  assert.equal(order.customerPhone, '')
  // no student ID check at the door: the paper tickets were handed over
  assert.deepEqual(order.items, [{ id: 'open', ticketTypeId: 'open', name: '一般票', price: 900, quantity: 2 }])
  assert.equal(order.buyerType, undefined)
  assert.equal(order.finalTotal, 1800)
  assert.equal(order.originalTotal, 1800)
  for (const [flag, prefix] of [['paid', 'payment'], ['delivered', 'delivery']]) {
    assert.equal(order[flag], true, flag)
    assert.equal(order[`${prefix}UpdatedAt`], SOLD_AT)
    assert.equal(order[`${prefix}UpdatedByName`], '林管理')
    assert.equal(order[`${prefix}UpdatedByUid`], 'admin-uid')
  }
  assert.equal(order.promoterEmail, 'admin@example.com')
  assert.equal(order.promoterName, '林管理')
  assert.equal(order.emailStatus, 'skipped')
  assert.equal(order.complimentary, undefined)
})

test('deleting a street sale gives back its stock, and no allowance it never took', () => {
  const release = stockReleaseOf(orderOf())
  assert.deepEqual([...release.quantities], [['open', 2]])
  assert.deepEqual(release.stockShards, { open: { 3: 2 } })
  assert.equal(release.buyerKey, null)
})

test('street sale order ids are valid order ids', () => {
  assert.match(generateOrderId(STREET_ORDER_PREFIX, '20261106'), ORDER_ID_PATTERN)
})

test('nothing is emailed for a street sale, and no notice asks it to pay or collect', async () => {
  const order = orderOf()
  // even with an email on it, the confirmation is skipped without a queue job
  assert.deepEqual(await enqueueOrderConfirmation('ST20261106K7Q2MX', { ...order, customerEmail: 'x@example.com' }), {
    jobId: null, status: 'skipped', emailStatus: 'skipped'
  })
  assert.equal(code(() => enqueueManualOrderResend('ST20261106K7Q2MX', order, 'admin-uid')), 'failed-precondition')
  assert.equal(needsNotice(order, 'payment'), false)
  assert.equal(needsNotice(order, 'pickup'), false)
  // the order list's 路宣 filter may carry over into a notice
  assert.deepEqual(readRecipientFilters({ filters: { schools: [STREET_SCHOOL] } }, 'custom').schools, [STREET_SCHOOL])
})
