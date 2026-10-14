import test from 'node:test'
import assert from 'node:assert/strict'
import { createCheckoutRecovery, submitRecoveredCheckout } from '../src/utils/checkoutRecovery.js'

function fixture() {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
  let nextId = 0
  const make = () => createCheckoutRecovery({ storage, createId: () => `request-${++nextId}` })
  return { make, storage }
}

const payload = { school: '建國中學', customerName: '測試', items: [{ id: 'general', quantity: 1 }] }
const failure = (code) => Object.assign(new Error(code), { code })

test('lost responses, manual retry and reload preserve the same account request ID', async () => {
  const { make } = fixture()
  const ids = []
  const run = (recovery, invoke) => submitRecoveredCheckout({
    recovery, uid: 'buyer', payload, retryable: ['functions/unavailable'],
    wait: async () => {}, invoke
  })
  await assert.rejects(run(make(), async (_, id) => {
    ids.push(id)
    throw failure('functions/unavailable')
  }))
  const reloaded = make()
  assert.equal(reloaded.get('buyer').uncertain, true)
  const result = await run(reloaded, async (_, id) => { ids.push(id); return { id: 'saved-order' } })
  assert.equal(result.id, 'saved-order')
  assert.deepEqual(ids, ['request-1', 'request-1', 'request-1', 'request-1'])
  assert.equal(reloaded.get('buyer'), null)
})

test('unresolved checkout blocks changed payload but accepts canonical key order', () => {
  const { make } = fixture()
  const recovery = make()
  const first = recovery.begin('buyer', payload)
  assert.equal(recovery.begin('buyer', { items: payload.items, customerName: '測試', school: '建國中學' }).requestId, first.requestId)
  assert.throws(() => recovery.begin('buyer', { ...payload, customerName: '其他' }), { code: 'checkout/pending-unresolved' })
})

test('definite first rejection clears checkout; later rejection after uncertainty does not', () => {
  const { make } = fixture()
  const recovery = make()
  let pending = recovery.begin('buyer', payload)
  recovery.failed('buyer', pending.requestId, failure('functions/invalid-argument'))
  assert.equal(recovery.get('buyer'), null)
  pending = recovery.begin('buyer', payload)
  recovery.failed('buyer', pending.requestId, failure('functions/deadline-exceeded'))
  recovery.failed('buyer', pending.requestId, failure('functions/failed-precondition'))
  assert.equal(recovery.get('buyer').requestId, pending.requestId)
})

test('account keys are isolated and disabled storage prevents submission', async () => {
  const { make } = fixture()
  const recovery = make()
  assert.notEqual(recovery.begin('a', payload).requestId, recovery.begin('b', payload).requestId)
  let called = false
  const blocked = createCheckoutRecovery({ storage: { getItem() { throw new Error('blocked') } }, createId: () => 'id' })
  await assert.rejects(submitRecoveredCheckout({
    recovery: blocked, uid: 'buyer', payload, retryable: [], wait: async () => {},
    invoke: async () => { called = true }
  }), { code: 'checkout/storage-unavailable' })
  assert.equal(called, false)
})


test('server terminal rejection resolves an uncertain checkout and permits changed details', () => {
  const { make } = fixture()
  const recovery = make()
  const pending = recovery.begin('buyer', payload)
  recovery.failed('buyer', pending.requestId, failure('functions/unavailable'))
  recovery.failed('buyer', pending.requestId, Object.assign(failure('functions/resource-exhausted'), {
    details: { checkoutRejected: true }
  }))
  assert.equal(recovery.get('buyer'), null)
  const next = recovery.begin('buyer', { ...payload, customerName: '改正後姓名' })
  assert.notEqual(next.requestId, pending.requestId)
})
