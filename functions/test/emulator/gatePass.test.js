// createOrder with GATE_PASS on, end to end: the stock gate Worker
// (/worker/src/index.js, run here in Node) takes the tickets from a local
// Redis behind the Upstash-style front and signs a pass; createOrder checks
// it against the Firestore emulator. Needs redis-server.
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { HOUR, PROJECT_ID, db, fft, functions, iso, soldOf, isEmulator } from './setup.js'
import { hasRedisServer, startUpstash } from '../redis/upstash.js'
import { gateKey, gateSlack } from '../../lib/stockGate.js'
import { signGatePass } from '../../lib/gatePass.js'
import { forgetSoldOut, handle } from '../../../worker/src/index.js'
import { JWKS_URL, PROJECT_ID as TOKEN_PROJECT, createIssuer } from '../../../worker/test/idTokens.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')
assert.ok(hasRedisServer(), 'the gate pass tests need redis-server (e.g. apt install redis-server)')

const callCreate = ((wrapped) => (data, context = {}) => wrapped({ data, ...context }))(fft.wrap(functions.createOrder))

const SECRET = 'emulator-gate-pass-secret-0123456789abcdef'
const TICKET_TYPES = [
  { id: 'small', name: '限量票', price: 500, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 5, purchaseLimitPerPerson: 2 },
  { id: 'open', name: '一階票', price: 900, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), unlimitedStock: true, purchaseLimitPerPerson: 4 }
]

const uidOf = (name) => `uid-${name}`
const as = (name) => ({ auth: { uid: uidOf(name), token: { email: `${name}@example.com`, email_verified: true } } })
const rid = (label) => `req-${label}-0123456789`
const order = (items, requestId, gatePass) => ({
  orderPayload: { customerName: '測試', customerPhone: '0900000000', school: '北一女中', class: '101', number: '1', items },
  requestId,
  ...(gatePass ? { gatePass } : {})
})

let upstash
let issuer
let workerEnv
const env = {}
const setEnv = (values) => Object.entries(values).forEach(([key, value]) => {
  if (!(key in env)) env[key] = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
})
const left = async (id) => {
  const value = await upstash.redis.call(['GET', gateKey(id)])
  return value === null ? null : Number(value)
}

// What the storefront does: ask the Worker, then call createOrder with the pass
async function askWorker(name, items, requestId) {
  const quantities = Object.fromEntries(items.map(({ id, quantity }) => [id, quantity]))
  const response = await handle(new Request('https://gate.test/pass', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await issuer.sign(uidOf(name))}` },
    body: JSON.stringify({ requestId, quantities })
  }), workerEnv, { fetchImpl: issuer.fetchWith() })
  return { status: response.status, ...(await response.json()) }
}
// retried on "try again" with the same requestId (and a fresh pass), as the
// storefront does
async function checkout(name, items, label) {
  const requestId = rid(label)
  for (let tries = 1; ; tries++) {
    const answer = await askWorker(name, items, requestId)
    if (answer.status !== 200) return { worker: answer.status }
    try {
      return await callCreate(order(items, requestId, answer.pass), as(name))
    } catch (error) {
      if (error?.code !== 'aborted' || tries >= 3) throw error
    }
  }
}

before(async () => {
  upstash = await startUpstash()
  issuer = await createIssuer()
  workerEnv = {
    FIREBASE_PROJECT_ID: TOKEN_PROJECT,
    FIREBASE_JWKS_URL: JWKS_URL,
    SOLD_OUT_CACHE_MS: '0',
    UPSTASH_REDIS_REST_URL: upstash.url,
    UPSTASH_REDIS_REST_TOKEN: upstash.token,
    GATE_PASS_SECRET: SECRET
  }
})

after(async () => {
  setEnv(Object.fromEntries(Object.keys(env).map((key) => [key, env[key]])))
  await upstash.stop()
  fft.cleanup()
})

beforeEach(async () => {
  setEnv({
    GATE_PASS: 'true',
    STOCK_GATE: 'false',
    GATE_PASS_SECRET: SECRET,
    UPSTASH_REDIS_REST_URL: upstash.url,
    UPSTASH_REDIS_REST_TOKEN: upstash.token
  })
  forgetSoldOut()
  await upstash.redis.call(['FLUSHALL'])
  const res = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  )
  assert.ok(res.ok)
  await db.doc('settings/ticketTypes').set({ types: TICKET_TYPES })
  await db.doc('settings/shop').set({ openAt: new Date(Date.now() - HOUR) })
})

describe('createOrder with the Worker pass', () => {
  test('creates the order, and sets the count the Worker lacked from the shards', async () => {
    const result = await checkout('a', [{ id: 'small', quantity: 1 }, { id: 'open', quantity: 1 }], 'first')
    assert.equal(result.status, 201)
    assert.equal(await soldOf('small'), 1)
    assert.equal(await left('small'), 5 + gateSlack(5))
    assert.equal(await left('open'), null, 'unlimited types get no count')
  })

  test('many buyers at once: the stock is sold exactly, the rest never reach the function', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 5 + gateSlack(5)])
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) => checkout(`b${i}`, [{ id: 'small', quantity: 1 }], `many-${i}`))
    )
    const created = results.filter((r) => r.status === 'fulfilled' && r.value.status === 201).length
    const workerTurnedAway = results.filter((r) => r.status === 'fulfilled' && r.value.worker === 409).length
    const soldOutAtShards = results.filter((r) => r.status === 'rejected' && r.reason?.code === 'resource-exhausted').length
    assert.equal(created, 5)
    assert.equal(created + workerTurnedAway + soldOutAtShards, 40, JSON.stringify(results.filter((r) => r.status === 'rejected').map((r) => r.reason?.code)))
    // a checkout that lost the race for a shard gives its numbers back before
    // it tries again, so a few more than 5 + slack may reach the function
    assert.ok(workerTurnedAway >= 20, `${workerTurnedAway} turned away at the Worker`)
    assert.equal(await soldOf('small'), 5)
  })

  test('a retry of a checkout that committed gets its order back', async () => {
    const first = await checkout('c', [{ id: 'small', quantity: 1 }], 'retry')
    const again = await checkout('c', [{ id: 'small', quantity: 1 }], 'retry')
    assert.deepEqual(again, { status: 200, id: first.id })
    assert.equal(await soldOf('small'), 1)
  })

  test('without a pass the checkout is told 售完, and reads no stock', async () => {
    await assert.rejects(callCreate(order([{ id: 'small', quantity: 1 }], rid('nopass')), as('d')), { code: 'resource-exhausted' })
    assert.equal(await soldOf('small'), 0)
  })

  test('refuses a pass for another account, checkout or quantities, or signed with another secret', async () => {
    const items = [{ id: 'small', quantity: 1 }]
    const { pass } = await askWorker('e', items, rid('mine'))
    await assert.rejects(callCreate(order(items, rid('mine'), pass), as('f')), { code: 'permission-denied' })
    await assert.rejects(callCreate(order(items, rid('other'), pass), as('e')), { code: 'permission-denied' })
    await assert.rejects(callCreate(order([{ id: 'small', quantity: 2 }], rid('more'), pass), as('e')), { code: 'permission-denied' })
    const forged = await signGatePass(
      { uid: uidOf('e'), requestId: rid('forged'), quantities: { small: 1 }, held: false }, `${SECRET}-guessed`
    )
    await assert.rejects(callCreate(order(items, rid('forged'), forged), as('e')), { code: 'permission-denied' })
    assert.equal(await soldOf('small'), 0)
  })

  test('a checkout rejected for another reason gives the Worker its tickets back', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 10])
    assert.equal((await checkout('g', [{ id: 'small', quantity: 2 }], 'limit-a')).status, 201)
    assert.equal(await left('small'), 8)
    // over the per-person limit of 2
    await assert.rejects(checkout('g', [{ id: 'small', quantity: 1 }], 'limit-b'), { code: 'failed-precondition' })
    // the sold hold of limit-a had nothing left to give back
    assert.equal(await left('small'), 8)
  })

  test('a sold checkout keeps letting its retries through without taking more', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 10])
    const first = await checkout('i', [{ id: 'small', quantity: 1 }], 'sold')
    assert.deepEqual(await checkout('i', [{ id: 'small', quantity: 1 }], 'sold'), { status: 200, id: first.id })
    assert.equal(await left('small'), 9)
  })

  test('a pass signed while Redis gave no answer goes to the shards as without the gate', async () => {
    const pass = await signGatePass(
      { uid: uidOf('h'), requestId: rid('unheld'), quantities: { small: 1 }, held: false }, SECRET
    )
    assert.equal((await callCreate(order([{ id: 'small', quantity: 1 }], rid('unheld'), pass), as('h'))).status, 201)
    assert.equal(await left('small'), null)
  })
})
