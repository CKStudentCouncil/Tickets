import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  sanitizeOrderInput,
  checkTicketType,
  getBuyerKey,
  MAX_TICKETS_PER_ORDER
} from '../../lib/orderValidation.js'
import { parseTaipeiDateTime, getTaiwanDateKey } from '../../lib/time.js'

const BUYER = {
  customerName: '王小明',
  customerEmail: ' Buyer@Example.com ',
  customerPhone: '0912345678',
  school: '建國中學',
  class: '329',
  number: '01'
}

const withItems = (items, extra = {}) => ({ ...BUYER, ...extra, items })

function expectHttpsError(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code)
    return true
  })
}

describe('sanitizeOrderInput', () => {
  test('accepts a valid order and normalises the email', () => {
    const { order, quantities } = sanitizeOrderInput(withItems([{ id: 'campus_ticket', quantity: 2 }]))
    assert.equal(order.customerEmail, 'buyer@example.com')
    assert.deepEqual([...quantities], [['campus_ticket', 2]])
  })

  test('stores numeric-string quantities as numbers', () => {
    const { quantities } = sanitizeOrderInput(withItems([{ id: 'a', quantity: '2' }]))
    assert.equal(quantities.get('a'), 2)
  })

  test('merges repeated ticket types', () => {
    const { quantities } = sanitizeOrderInput(
      withItems([{ id: 'a', quantity: 1 }, { ticketTypeId: 'a', quantity: 2 }])
    )
    assert.equal(quantities.get('a'), 3)
  })

  for (const [label, items] of [
    ['negative quantity hidden by another item', [{ id: 'a', quantity: 5 }, { id: 'a', quantity: -3 }]],
    ['fractional quantity', [{ id: 'a', quantity: 0.5 }]],
    ['zero quantity', [{ id: 'a', quantity: 0 }]],
    ['NaN quantity', [{ id: 'a', quantity: 'abc' }]],
    ['no items', []],
    ['invalid ticket type id', [{ id: '../settings', quantity: 1 }]]
  ]) {
    test(`rejects ${label}`, () => {
      expectHttpsError(() => sanitizeOrderInput(withItems(items)), 'invalid-argument')
    })
  }

  test(`rejects more than ${MAX_TICKETS_PER_ORDER} tickets per order`, () => {
    expectHttpsError(
      () => sanitizeOrderInput(withItems([{ id: 'a', quantity: 15 }, { id: 'b', quantity: 6 }])),
      'invalid-argument'
    )
  })

  test('rejects a bad email, unknown school and missing name', () => {
    expectHttpsError(() => sanitizeOrderInput(withItems([{ id: 'a', quantity: 1 }], { customerEmail: 'nope' })), 'invalid-argument')
    expectHttpsError(() => sanitizeOrderInput(withItems([{ id: 'a', quantity: 1 }], { school: 'Hogwarts' })), 'invalid-argument')
    expectHttpsError(() => sanitizeOrderInput(withItems([{ id: 'a', quantity: 1 }], { customerName: ' ' })), 'invalid-argument')
    expectHttpsError(() => sanitizeOrderInput(null), 'invalid-argument')
  })

  test('drops every field that is not whitelisted (prices, totals, flags, userId)', () => {
    const { order } = sanitizeOrderInput(
      withItems([{ id: 'a', quantity: 1, price: 0 }], {
        finalTotal: 0,
        originalTotal: 0,
        paid: true,
        delivered: true,
        prPackageUsed: true,
        isAdminOrder: true,
        userId: 'someone-else',
        accessToken: 'x'
      })
    )
    assert.deepEqual(Object.keys(order).sort(), [
      'class', 'customerEmail', 'customerName', 'customerPhone', 'number', 'office', 'school'
    ])
  })

  test('teachers keep their office but not class / seat number', () => {
    const { order } = sanitizeOrderInput(
      withItems([{ id: 'a', quantity: 1 }], { school: '建中老師', office: '莊三', class: '329', number: '01' })
    )
    assert.equal(order.office, '莊三')
    assert.equal(order.class, '')
    assert.equal(order.number, '')
  })

  test('students do not send an office', () => {
    const { order } = sanitizeOrderInput(withItems([{ id: 'a', quantity: 1 }], { office: '莊三' }))
    assert.equal(order.office, '')
    assert.equal(order.class, '329')
  })

  test('truncates over-long strings', () => {
    const { order } = sanitizeOrderInput(withItems([{ id: 'a', quantity: 1 }], { customerName: 'x'.repeat(500) }))
    assert.equal(order.customerName.length, 50)
  })
})

describe('checkTicketType', () => {
  const now = new Date('2026-11-05T05:00:00Z') // 13:00 in Taiwan
  const ticketType = {
    name: '一階票',
    eligibleBuyerIdentity: 'all_users',
    salesStartTime: '2026-11-05T12:00:00+08:00',
    salesEndTime: '2026-11-30T23:59:00+08:00',
    totalTicketQuantity: 100,
    purchaseLimitPerPerson: 4
  }
  const ok = { now, school: '北一女中', sold: 0, alreadyBought: 0 }

  test('passes inside the sale window', () => {
    assert.doesNotThrow(() => checkTicketType(ticketType, 4, ok))
  })

  test('treats offset-less times as Taiwan time (not UTC)', () => {
    const naive = { ...ticketType, salesStartTime: '2026-11-05T12:00' }
    assert.doesNotThrow(() => checkTicketType(naive, 1, ok))
    expectHttpsError(
      () => checkTicketType(naive, 1, { ...ok, now: new Date('2026-11-05T03:59:00Z') }),
      'failed-precondition'
    )
  })

  test('rejects before the start, after the end, or without a window', () => {
    expectHttpsError(() => checkTicketType(ticketType, 1, { ...ok, now: new Date('2026-11-05T03:00:00Z') }), 'failed-precondition')
    expectHttpsError(() => checkTicketType(ticketType, 1, { ...ok, now: new Date('2026-12-01T00:00:00Z') }), 'failed-precondition')
    expectHttpsError(() => checkTicketType({ ...ticketType, salesStartTime: null }, 1, ok), 'failed-precondition')
  })

  test('campus-only tickets require a campus school', () => {
    const campus = { ...ticketType, eligibleBuyerIdentity: 'campus_students' }
    assert.doesNotThrow(() => checkTicketType(campus, 1, { ...ok, school: '建國中學' }))
    expectHttpsError(() => checkTicketType(campus, 1, { ...ok, school: '其他學校或社會人士' }), 'permission-denied')
    expectHttpsError(() => checkTicketType(campus, 1, { ...ok, school: '建中老師' }), 'permission-denied')
  })

  test('stock: exactly sold out passes, one more fails, 0 means unlimited', () => {
    assert.doesNotThrow(() => checkTicketType(ticketType, 2, { ...ok, sold: 98 }))
    expectHttpsError(() => checkTicketType(ticketType, 3, { ...ok, sold: 98 }), 'resource-exhausted')
    assert.doesNotThrow(() => checkTicketType({ ...ticketType, totalTicketQuantity: 0 }, 4, { ...ok, sold: 10000 }))
  })

  test('per-person limit counts earlier purchases; unlimited skips it', () => {
    expectHttpsError(() => checkTicketType(ticketType, 1, { ...ok, alreadyBought: 4 }), 'failed-precondition')
    expectHttpsError(() => checkTicketType(ticketType, 5, ok), 'failed-precondition')
    assert.doesNotThrow(() => checkTicketType({ ...ticketType, unlimited: true }, 20, { ...ok, alreadyBought: 50 }))
  })
})

describe('time helpers', () => {
  test('parseTaipeiDateTime', () => {
    assert.equal(parseTaipeiDateTime('2026-11-05T12:00').toISOString(), '2026-11-05T04:00:00.000Z')
    assert.equal(parseTaipeiDateTime('2026-11-05T12:00:00+08:00').toISOString(), '2026-11-05T04:00:00.000Z')
    assert.equal(parseTaipeiDateTime('2026-11-05T04:00:00Z').toISOString(), '2026-11-05T04:00:00.000Z')
    assert.equal(parseTaipeiDateTime({ toDate: () => new Date(0) }).getTime(), 0)
    assert.equal(parseTaipeiDateTime('garbage'), null)
    assert.equal(parseTaipeiDateTime(''), null)
  })

  test('getTaiwanDateKey rolls over at Taiwan midnight', () => {
    assert.equal(getTaiwanDateKey(new Date('2026-11-04T15:59:59Z')), '20261104')
    assert.equal(getTaiwanDateKey(new Date('2026-11-04T16:00:00Z')), '20261105')
  })

  test('getBuyerKey ignores case and surrounding spaces', () => {
    assert.equal(getBuyerKey(' A@B.com '), getBuyerKey('a@b.com'))
    assert.match(getBuyerKey('a@b.com'), /^[0-9a-f]{64}$/)
  })
})
