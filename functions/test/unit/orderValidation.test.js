import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  ORDER_ID_PATTERN,
  SHARD_COUNT,
  allocateStock,
  getAvailable,
  getCurrentCaps,
  planShardCaps,
  planShards,
  generateOrderId,
  getStockLimit,
  isValidRequestId,
  sanitizeOrderInput,
  checkTicketType,
  getBuyerKey,
  isSchoolAccount,
  MAX_TICKETS_PER_ORDER
} from '../../lib/orderValidation.js'
import { parseTaipeiDateTime, getTaiwanDateKey } from '../../lib/time.js'

// the signed-in account's email, passed by createOrder
const ACCOUNT_EMAIL = ' Buyer@Example.com '

const BUYER = {
  customerName: '王小明',
  customerPhone: '0912345678',
  school: '建國中學',
  class: '329',
  number: '01'
}

const withItems = (items, extra = {}) => ({ ...BUYER, ...extra, items })
const sanitize = (payload, email = ACCOUNT_EMAIL) => sanitizeOrderInput(payload, email)

function expectHttpsError(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code)
    return true
  })
}

describe('sanitizeOrderInput', () => {
  test('accepts a valid order and normalises the email', () => {
    const { order, quantities } = sanitize(withItems([{ id: 'campus_ticket', quantity: 2 }]))
    assert.equal(order.customerEmail, 'buyer@example.com')
    assert.deepEqual([...quantities], [['campus_ticket', 2]])
  })

  test('the email is always the account email, never the payload', () => {
    const { order } = sanitize(withItems([{ id: 'a', quantity: 1 }], { customerEmail: 'victim@example.com' }))
    assert.equal(order.customerEmail, 'buyer@example.com')
  })

  test('stores numeric-string quantities as numbers', () => {
    const { quantities } = sanitize(withItems([{ id: 'a', quantity: '2' }]))
    assert.equal(quantities.get('a'), 2)
  })

  test('merges repeated ticket types', () => {
    const { quantities } = sanitize(
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
      expectHttpsError(() => sanitize(withItems(items)), 'invalid-argument')
    })
  }

  test(`rejects more than ${MAX_TICKETS_PER_ORDER} tickets per order`, () => {
    expectHttpsError(
      () => sanitize(withItems([{ id: 'a', quantity: 15 }, { id: 'b', quantity: 6 }])),
      'invalid-argument'
    )
  })

  test('rejects Object.prototype names as schools', () => {
    for (const school of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expectHttpsError(() => sanitize(withItems([{ id: 'a', quantity: 1 }], { school })), 'invalid-argument')
    }
  })

  test('an over-sized single item gets the per-order limit message', () => {
    assert.throws(
      () => sanitize(withItems([{ id: 'a', quantity: 21 }])),
      (error) => error.code === 'invalid-argument' && error.message.includes(String(MAX_TICKETS_PER_ORDER))
    )
  })

  test('rejects a bad email, unknown school and missing name', () => {
    expectHttpsError(() => sanitize(withItems([{ id: 'a', quantity: 1 }]), 'nope'), 'invalid-argument')
    expectHttpsError(() => sanitize(withItems([{ id: 'a', quantity: 1 }], { school: 'Hogwarts' })), 'invalid-argument')
    expectHttpsError(() => sanitize(withItems([{ id: 'a', quantity: 1 }], { customerName: ' ' })), 'invalid-argument')
    expectHttpsError(() => sanitize(null), 'invalid-argument')
  })

  test('drops every field that is not whitelisted (prices, totals, flags, userId)', () => {
    const { order } = sanitize(
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
    const { order } = sanitize(
      withItems([{ id: 'a', quantity: 1 }], { school: '建中老師', office: '莊三', class: '329', number: '01' })
    )
    assert.equal(order.office, '莊三')
    assert.equal(order.class, '')
    assert.equal(order.number, '')
  })

  test('students do not send an office', () => {
    const { order } = sanitize(withItems([{ id: 'a', quantity: 1 }], { office: '莊三' }))
    assert.equal(order.office, '')
    assert.equal(order.class, '329')
  })

  test('truncates over-long strings', () => {
    const { order } = sanitize(withItems([{ id: 'a', quantity: 1 }], { customerName: 'x'.repeat(500) }))
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
  const ok = { now, school: '北一女中', alreadyBought: 0 }

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

  test('本校學生 tickets need a @gl.ck.tp.edu.tw account and 建國中學', () => {
    const campus = { ...ticketType, eligibleBuyerIdentity: 'campus_students' }
    const student = { ...ok, school: '建國中學', email: 's1234@gl.ck.tp.edu.tw' }
    assert.doesNotThrow(() => checkTicketType(campus, 1, student))
    for (const school of ['北一女中', '師大附中', '建中老師', '建中家長會', '其他學校或社會人士']) {
      expectHttpsError(() => checkTicketType(campus, 1, { ...student, school }), 'permission-denied')
    }
    for (const email of ['s1234@gmail.com', 's1234@ck.tp.edu.tw', 'gl.ck.tp.edu.tw@gmail.com', 'x@evilgl.ck.tp.edu.tw', undefined]) {
      expectHttpsError(() => checkTicketType(campus, 1, { ...student, email }), 'permission-denied')
    }
  })

  test('isSchoolAccount matches the whole domain only', () => {
    assert.equal(isSchoolAccount('S1234@GL.CK.TP.EDU.TW'), true)
    assert.equal(isSchoolAccount('s1234@gl.ck.tp.edu.tw.evil.com'), false)
    assert.equal(isSchoolAccount('s1234@sub.gl.ck.tp.edu.tw'), false)
  })

  test('per-person limit counts earlier purchases; unlimited skips it', () => {
    expectHttpsError(() => checkTicketType(ticketType, 1, { ...ok, alreadyBought: 4 }), 'failed-precondition')
    expectHttpsError(() => checkTicketType(ticketType, 5, ok), 'failed-precondition')
    assert.doesNotThrow(() => checkTicketType({ ...ticketType, unlimited: true }, 20, { ...ok, alreadyBought: 50 }))
  })
})

describe('stock shards (PARTY-28)', () => {
  const each = (sold = 0) => Array(SHARD_COUNT).fill(sold)
  const sum = (values) => values.reduce((a, b) => a + b, 0)
  const total = (allocation) => sum(Object.values(allocation))

  // deterministic stand-in for randomInt
  function seeded(seed) {
    return (n) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
  }

  // createOrder's stock steps on one type, one order at a time: caps are
  // planned again whenever the stored ones do not match the stock (as
  // reserveStock and planStockShards do), unlimited sales drop them
  function sale(random) {
    const sold = each()
    let stored = null
    return {
      sold,
      setStock(stock) {
        this.stock = stock
      },
      buy(quantity) {
        if (this.stock === null) {
          sold[random(SHARD_COUNT)] += quantity
          stored = null
          return true
        }
        const available = getAvailable(this.stock, 0)
        let caps = getCurrentCaps(stored, available)
        if (!caps) {
          caps = planShardCaps(available, sold)
          stored = { available, caps }
        }
        const shards = planShards({ caps, sold, quantity, random })
        if (!shards) return false
        const allocation = allocateStock({ caps, shards, sold: shards.map((k) => sold[k]), quantity })
        Object.entries(allocation).forEach(([k, n]) => { sold[k] += n })
        return true
      },
      sellOut() {
        while (this.buy(1));
        return sum(sold)
      }
    }
  }

  test('caps add up to the stock, spread evenly, the remainder going to the first shards', () => {
    for (const available of [0, 1, 5, 19, 20, 21, 100, 1234]) {
      const caps = planShardCaps(available, each())
      assert.equal(sum(caps), available)
      assert.ok(Math.max(...caps) - Math.min(...caps) <= 1)
    }
    assert.equal(planShardCaps(21, each())[0], 2)
    assert.equal(planShardCaps(21, each())[1], 1)
  })

  test('caps never go below what a shard sold and share out only what is left', () => {
    const sold = [6, 0, 4, ...each(1).slice(3)] // 27 sold, unevenly
    const caps = planShardCaps(60, sold)
    assert.equal(sum(caps), 60)
    caps.forEach((cap, k) => assert.ok(cap >= sold[k]))

    // more sold than the stock now allows: nothing more to sell anywhere
    assert.deepEqual(planShardCaps(20, sold), sold)
  })

  test('stored caps are only used for the stock they were planned for', () => {
    const caps = planShardCaps(100, each())
    assert.equal(getCurrentCaps({ available: 100, caps }, 100), caps)
    assert.equal(getCurrentCaps({ available: 100, caps }, 60), null)
    assert.equal(getCurrentCaps({ available: 100, caps: caps.slice(1) }, 100), null)
    assert.equal(getCurrentCaps(undefined, 100), null)
  })

  test('the legacy counter takes its share off the stock', () => {
    assert.equal(getAvailable(100, 98), 2)
    assert.equal(getAvailable(100, 120), 0)
    assert.equal(getAvailable(100, undefined), 100)
  })

  test('allocateStock takes from the locked shards in order, each up to its cap', () => {
    const caps = planShardCaps(100, each()) // 5 per shard
    assert.deepEqual(allocateStock({ caps, shards: [7], sold: [0], quantity: 4 }), { 7: 4 })
    assert.deepEqual(allocateStock({ caps, shards: [19, 0], sold: [4, 3], quantity: 3 }), { 19: 1, 0: 2 })
    assert.equal(allocateStock({ caps, shards: [7], sold: [5], quantity: 1 }), null)
    assert.equal(allocateStock({ caps: planShardCaps(0, each()), shards: [0], sold: [0], quantity: 1 }), null)
  })

  test('sells exactly the stock and not one more', () => {
    const sold = each(5)
    sold[3] = 3 // 98 of 100 sold
    const caps = planShardCaps(100, each())
    const all = sold.map((_, k) => k)
    assert.deepEqual(allocateStock({ caps, shards: all, sold, quantity: 2 }), { 3: 2 })
    assert.equal(allocateStock({ caps, shards: all, sold, quantity: 3 }), null)
  })

  test('small stock: an order larger than one shard still fits across shards', () => {
    const caps = planShardCaps(5, each())
    const shards = planShards({ caps, sold: each(), quantity: 4, random: () => 0 })
    assert.equal(total(allocateStock({ caps, shards, sold: shards.map(() => 0), quantity: 4 })), 4)
    assert.equal(planShards({ caps, sold: each(), quantity: 6, random: () => 0 }), null)
  })

  test('planShards: sold out per the unlocked look means no shard is locked', () => {
    const caps = planShardCaps(100, each())
    const first = () => 0
    assert.equal(planShards({ caps, sold: each(5), quantity: 1, random: first }), null)
    assert.equal(planShards({ caps: planShardCaps(0, each()), sold: each(), quantity: 1, random: first }), null)
    const twoLeft = Object.assign(each(5), { 4: 4, 9: 4 })
    assert.equal(planShards({ caps, sold: twoLeft, quantity: 3, random: first }), null)
  })

  test('planShards: locks one random shard that can hold the whole order', () => {
    const caps = planShardCaps(100, each())
    const sold = Object.assign(each(5), { 4: 4, 9: 2, 15: 0 }) // room in 4 (1), 9 (3), 15 (5)
    assert.deepEqual(planShards({ caps, sold, quantity: 3, random: () => 0 }), [9])
    assert.deepEqual(planShards({ caps, sold, quantity: 3, random: () => 1 }), [15])
  })

  test('planShards: when no shard can hold the order, locks just enough shards with room', () => {
    const caps = planShardCaps(100, each())
    const sold = Object.assign(each(5), { 4: 4, 9: 4, 12: 3 }) // room: 4 (1), 9 (1), 12 (2)
    const shards = planShards({ caps, sold, quantity: 3, random: (n) => n - 1 })
    const room = { 4: 1, 9: 1, 12: 2 }
    assert.ok(shards.every((k) => k in room))
    assert.ok(sum(shards.map((k) => room[k])) >= 3)
    assert.equal(new Set(shards).size, shards.length)
  })

  test('planShards: spread locks every shard with room', () => {
    const caps = planShardCaps(100, each())
    const sold = Object.assign(each(5), { 4: 4, 9: 2, 15: 0 })
    assert.deepEqual(planShards({ caps, sold, quantity: 1, random: () => 0, spread: true }), [4, 9, 15])
  })

  test('lowering the stock mid-sale never oversells (review of PR #9)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const ticketSale = sale(seeded(seed))
      ticketSale.setStock(100)
      for (let i = 0; i < 40; i++) ticketSale.buy(1)
      ticketSale.setStock(60)
      assert.equal(ticketSale.sellOut(), 60)

      // lowered to what was sold: nothing more sells
      ticketSale.setStock(55)
      assert.equal(ticketSale.sellOut(), 60)
    }
  })

  test('limiting a type that sold unlimited never oversells (review of PR #9)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const ticketSale = sale(seeded(seed))
      ticketSale.setStock(null)
      for (let i = 0; i < 50; i++) ticketSale.buy(1)
      assert.ok(Math.max(...ticketSale.sold) > 5, 'unlimited sales land unevenly')
      ticketSale.setStock(100)
      assert.equal(ticketSale.sellOut(), 100)
    }
  })

  test('limited, then unlimited, then the same stock again still re-plans', () => {
    const ticketSale = sale(seeded(7))
    ticketSale.setStock(100)
    for (let i = 0; i < 10; i++) ticketSale.buy(1)
    ticketSale.setStock(null)
    for (let i = 0; i < 30; i++) ticketSale.buy(1)
    ticketSale.setStock(100)
    assert.equal(ticketSale.sellOut(), 100)
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

describe('order ids (PARTY-20)', () => {
  test('random suffix, valid pattern, no confusable characters', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => generateOrderId('CKS', '20261105')))
    assert.equal(ids.size, 2000)
    for (const id of ids) {
      assert.match(id, ORDER_ID_PATTERN)
      assert.doesNotMatch(id.slice(11), /[01IO]/)
    }
  })

  test('legacy serial ids still match; junk does not', () => {
    assert.match('CKS202611050001', ORDER_ID_PATTERN)
    assert.match('HSNU20261105K7Q2MX', ORDER_ID_PATTERN)
    assert.doesNotMatch('../settings/x', ORDER_ID_PATTERN)
    assert.doesNotMatch('CKS2026110', ORDER_ID_PATTERN)
  })

  test('request ids', () => {
    assert.ok(isValidRequestId('0f8c2b7e-1d2a-4c3b-9e8f-123456789abc'))
    assert.ok(!isValidRequestId('short'))
    assert.ok(!isValidRequestId('bad/../id-bad/../id'))
    assert.ok(!isValidRequestId(42))
  })

  test('getStockLimit', () => {
    assert.equal(getStockLimit({ totalTicketQuantity: 50 }), 50)
    assert.equal(getStockLimit({ totalTicketQuantity: 0 }), 0)
    assert.equal(getStockLimit({ totalTicketQuantity: 2.5 }), 0)
    assert.equal(getStockLimit({ unlimitedStock: true }), null)
  })
})
