import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sanitizeQuantityChange, takeFromAllocation } from '../../lib/sellers.js'

test('takeFromAllocation takes from the fullest shards first', () => {
  assert.deepEqual(takeFromAllocation({ 0: 2, 3: 5, 7: 1 }, 6), { next: { 0: 1, 7: 1 }, taken: { 3: 5, 0: 1 } })
  assert.deepEqual(takeFromAllocation({ 1: 4 }, 4), { next: {}, taken: { 1: 4 } })
  assert.equal(takeFromAllocation({ 1: 2 }, 3), null)
  assert.equal(takeFromAllocation(undefined, 1), null)
})

test('sanitizeQuantityChange accepts 1 to 200 tickets with the quantity seen', () => {
  const id = 'seller-request-00000001'
  assert.deepEqual(sanitizeQuantityChange({ registrationId: id, quantity: 200, expectedQuantity: 3 }), {
    registrationId: id,
    quantity: 200,
    expectedQuantity: 3
  })
  for (const bad of [
    { registrationId: id, quantity: 0, expectedQuantity: 3 },
    { registrationId: id, quantity: 201, expectedQuantity: 3 },
    { registrationId: id, quantity: 2 },
    { registrationId: 'x', quantity: 2, expectedQuantity: 3 }
  ]) {
    assert.throws(() => sanitizeQuantityChange(bad), { code: 'invalid-argument' })
  }
})
