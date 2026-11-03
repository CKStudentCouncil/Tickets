// The stock gate (lib/stockGate.js) against a local Redis behind an
// Upstash-style REST front (test/redis/upstash.js; needs redis-server), and
// createOrder with the gate on, against the Firestore emulator.
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { HOUR, PROJECT_ID, db, fft, functions, iso, soldOf, isEmulator } from './setup.js'
import { hasRedisServer, startUpstash } from '../redis/upstash.js'
import {
  admitToStock, gateKey, gateSlack, giveBackToStock, holdKey, resetStockGate, seedStockGate
} from '../../lib/stockGate.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')
assert.ok(hasRedisServer(), 'the stock gate tests need redis-server (e.g. apt install redis-server)')

const callCreate = ((wrapped) => (data, context = {}) => wrapped({ data, ...context }))(fft.wrap(functions.createOrder))
const callRelease = fft.wrap(functions.releaseOrderStock)
const callPlan = fft.wrap(functions.planStockShards)

const TICKET_TYPES = [
  { id: 'small', name: '限量票', price: 500, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 5, purchaseLimitPerPerson: 2 },
  { id: 'open', name: '一階票', price: 900, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), unlimitedStock: true, purchaseLimitPerPerson: 4 }
]

const as = (email) => ({ auth: { uid: `uid-${email}`, token: { email, email_verified: true } } })
const order = (items, requestId) => ({
  orderPayload: { customerName: '測試', customerPhone: '0900000000', school: '北一女中', class: '101', number: '1', items },
  ...(requestId ? { requestId } : {})
})

let upstash
const env = {}
const setEnv = (values) => Object.entries(values).forEach(([key, value]) => {
  if (!(key in env)) env[key] = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
})
const gateOn = () => setEnv({
  STOCK_GATE: 'true', UPSTASH_REDIS_REST_URL: upstash.url, UPSTASH_REDIS_REST_TOKEN: upstash.token
})
const left = async (id) => {
  const value = await upstash.redis.call(['GET', gateKey(id)])
  return value === null ? null : Number(value)
}

before(async () => {
  upstash = await startUpstash()
})

after(async () => {
  setEnv(Object.fromEntries(Object.keys(env).map((key) => [key, env[key]])))
  await upstash.stop()
  fft.cleanup()
})

beforeEach(async () => {
  gateOn()
  await upstash.redis.call(['FLUSHALL'])
  const res = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  )
  assert.ok(res.ok)
  await db.doc('settings/ticketTypes').set({ types: TICKET_TYPES })
  await db.doc('settings/shop').set({ openAt: new Date(Date.now() - HOUR) })
})

describe('stock gate', () => {
  test('lets checkouts through while it has no count, and says which types lack one', async () => {
    assert.deepEqual(await admitToStock('req-a', { small: 1, open: 2 }), { admitted: true, holdId: 'req-a', missing: ['small', 'open'] })
  })

  test('takes from the counts until they run out, then turns checkouts away without taking', async () => {
    await seedStockGate([{ id: 'small', left: 0 }])
    assert.equal(await left('small'), gateSlack(0))
    await upstash.redis.call(['SET', gateKey('small'), 3])

    assert.equal((await admitToStock('req-a', { small: 2 })).admitted, true)
    assert.equal(await left('small'), 1)
    assert.deepEqual(await admitToStock('req-b', { small: 2 }), { admitted: false, ticketTypeId: 'small' })
    assert.equal(await left('small'), 1)
    assert.equal(await upstash.redis.call(['EXISTS', holdKey('req-b')]), 0)
  })

  test('lets a retry of the same checkout through again without taking more', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 2])
    assert.equal((await admitToStock('req-a', { small: 2 })).admitted, true)
    assert.equal((await admitToStock('req-a', { small: 2 })).admitted, true)
    assert.equal(await left('small'), 0)
  })

  test('takes nothing when one of the types is short', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 5])
    await upstash.redis.call(['SET', gateKey('open'), 1])
    assert.deepEqual(await admitToStock('req-a', { small: 1, open: 2 }), { admitted: false, ticketTypeId: 'open' })
    assert.equal(await left('small'), 5)
  })

  test('gives back what a checkout took, once, and never to a count that was reset', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 4])
    await upstash.redis.call(['SET', gateKey('open'), 4])
    await admitToStock('req-a', { small: 1, open: 3 })
    await giveBackToStock('req-a')
    await giveBackToStock('req-a')
    assert.deepEqual([await left('small'), await left('open')], [4, 4])

    await admitToStock('req-b', { small: 1, open: 1 })
    await resetStockGate(['open'])
    await giveBackToStock('req-b')
    assert.deepEqual([await left('small'), await left('open')], [4, null])
  })

  test('never overwrites a count when setting one', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 1])
    await seedStockGate([{ id: 'small', left: 100 }])
    assert.equal(await left('small'), 1)
  })

  test('is skipped when off, not set up or unreachable, but still resets while off', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 0])
    setEnv({ STOCK_GATE: 'false' })
    assert.equal(await admitToStock('req-a', { small: 1 }), null)
    await resetStockGate(['small'])
    assert.equal(await left('small'), null)

    setEnv({ STOCK_GATE: 'true', UPSTASH_REDIS_REST_URL: 'placeholder' })
    assert.equal(await admitToStock('req-a', { small: 1 }), null)

    setEnv({ UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:9' })
    assert.equal(await admitToStock('req-a', { small: 1 }), null)
  })
})

describe('createOrder with the stock gate', () => {
  test('the first checkout sets the count from the shards', async () => {
    await callCreate(order([{ id: 'small', quantity: 1 }], 'req-first-0123456789'), as('a@example.com'))
    // counted before this order took its ticket: 5 left, plus the slack
    assert.equal(await left('small'), 5 + gateSlack(5))
    assert.equal(await left('open'), null, 'unlimited types get no count')
  })

  test('concurrent checkouts sell exactly the stock; the rest are told 售完', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 5 + gateSlack(5)])
    // retried on "try again" with the same requestId, as the storefront does
    const checkout = async (i) => {
      const payload = order([{ id: 'small', quantity: 1 }], `req-many-${String(i).padStart(12, '0')}`)
      for (let tries = 1; ; tries++) {
        try {
          return await callCreate(payload, as(`b${i}@example.com`))
        } catch (error) {
          if (error?.code !== 'aborted' || tries >= 3) throw error
        }
      }
    }
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => checkout(i)))
    const codes = new Set(results.filter((r) => r.status === 'rejected').map((r) => r.reason?.code))
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5)
    assert.deepEqual([...codes], ['resource-exhausted'])
    assert.equal(await soldOf('small'), 5)
    // 25 checkouts took one number each, none given back: 10 were turned
    // away by the gate alone
    assert.equal(await left('small'), 0)
  })

  test('turned away by the gate, a checkout reads no stock and its rejection is final', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 0])
    const payload = order([{ id: 'small', quantity: 1 }], 'req-gated-0123456789')
    await assert.rejects(callCreate(payload, as('c@example.com')), { code: 'resource-exhausted' })
    assert.equal(await soldOf('small'), 0)
    assert.equal((await db.doc(`orderRequests/${payload.requestId}`).get()).data().status, 'rejected')
    // the same checkout again gets the same answer, from its marker
    await assert.rejects(callCreate(payload, as('c@example.com')), { code: 'resource-exhausted', details: { checkoutRejected: true } })

    // saving the ticket types drops the count: checkouts reach the shards again
    await callPlan(fft.makeChange(null, await db.doc('settings/ticketTypes').get()), {})
    assert.equal(await left('small'), null)
    await assert.doesNotReject(callCreate(order([{ id: 'small', quantity: 1 }], 'req-after-0123456789'), as('d@example.com')))
  })

  test('a checkout rejected for another reason gives its numbers back', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 10])
    await callCreate(order([{ id: 'small', quantity: 2 }], 'req-limit-a-0123456789'), as('e@example.com'))
    assert.equal(await left('small'), 8)
    // over the per-person limit of 2
    await assert.rejects(
      callCreate(order([{ id: 'small', quantity: 1 }], 'req-limit-b-0123456789'), as('e@example.com')),
      { code: 'failed-precondition' }
    )
    assert.equal(await left('small'), 8)
  })

  test('deleting an order drops the count, so its tickets can be sold again', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 1])
    const { id } = await callCreate(order([{ id: 'small', quantity: 1 }], 'req-delete-0123456789'), as('f@example.com'))
    assert.equal(await left('small'), 0)

    const snap = await db.doc(`orders/${id}`).get()
    await db.doc(`orders/${id}`).delete()
    await callRelease(snap, { params: { orderId: id } })
    assert.equal(await left('small'), null)
    await assert.doesNotReject(callCreate(order([{ id: 'small', quantity: 1 }], 'req-resold-0123456789'), as('g@example.com')))
  })
})
