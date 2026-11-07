import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeTestOrdersInput, testOrderKind } from '../../lib/testOrders.js'

const TEST_TYPES = new Set(['trial'])
const order = (...items) => ({ items: items.map(([id, quantity]) => ({ id, ticketTypeId: id, quantity })) })

test('an order is a test order only when every ticket on it is a 測試票', () => {
  assert.equal(testOrderKind(order(['trial', 2]), TEST_TYPES), 'test')
  assert.equal(testOrderKind(order(['trial', 1], ['trial', 1]), TEST_TYPES), 'test')
  assert.equal(testOrderKind(order(['trial', 1], ['open', 1]), TEST_TYPES), 'mixed')
  assert.equal(testOrderKind(order(['open', 1]), TEST_TYPES), null)
  // lines without tickets do not count either way
  assert.equal(testOrderKind(order(['trial', 1], ['open', 0]), TEST_TYPES), 'test')
  assert.equal(testOrderKind(order(['trial', 0]), TEST_TYPES), null)
  assert.equal(testOrderKind({}, TEST_TYPES), null)
  assert.equal(testOrderKind(order(['trial', 1]), new Set()), null)
  // older orders kept the type id in `id` only
  assert.equal(testOrderKind({ items: [{ id: 'trial', quantity: 1 }] }, TEST_TYPES), 'test')
})

test('deleting needs confirm: true; a dry run deletes nothing', () => {
  assert.deepEqual(sanitizeTestOrdersInput({ dryRun: true }), { dryRun: true })
  assert.deepEqual(sanitizeTestOrdersInput({ confirm: true }), { dryRun: false })
  for (const data of [null, {}, { confirm: 'true' }, { confirm: 1 }, { dryRun: 'true' }]) {
    assert.throws(() => sanitizeTestOrdersInput(data), { code: 'invalid-argument' })
  }
})
