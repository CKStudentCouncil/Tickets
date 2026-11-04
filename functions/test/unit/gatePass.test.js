import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GatePassError, PASS_TTL_S, sameQuantities, signGatePass, verifyGatePass } from '../../lib/gatePass.js'

const SECRET = 'unit-test-gate-pass-secret-0123456789'
const claims = { uid: 'uid-a', requestId: 'request-0000000001', quantities: { small: 2 }, held: true, missing: { small: 4 } }

test('a pass carries what the Worker signed', async () => {
  const pass = await signGatePass(claims, SECRET, 1_000_000)
  const read = await verifyGatePass(pass, SECRET, 1_000_000)
  assert.deepEqual(
    { sub: read.sub, rid: read.rid, q: read.q, held: read.held, miss: read.miss, ttl: read.exp - read.iat },
    { sub: 'uid-a', rid: 'request-0000000001', q: { small: 2 }, held: true, miss: { small: 4 }, ttl: PASS_TTL_S }
  )
})

test('refuses passes that were changed, signed with another secret or other header, or expired', async () => {
  const now = Date.now()
  const pass = await signGatePass(claims, SECRET, now)
  const [header, payload, signature] = pass.split('.')
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), q: { small: 20 } })).toString('base64url')
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')

  for (const [token, secret, at] of [
    [`${header}.${changed}.${signature}`, SECRET, now],
    [`${none}.${payload}.`, SECRET, now],
    [`${none}.${payload}.${signature}`, SECRET, now],
    [pass, `${SECRET}-other`, now],
    [pass, SECRET, now + PASS_TTL_S * 1000 + 1],
    [await signGatePass(claims, SECRET, now + 120_000), SECRET, now],
    ['', SECRET, now],
    [undefined, SECRET, now],
    ['a.b', SECRET, now]
  ]) {
    await assert.rejects(verifyGatePass(token, secret, at), GatePassError)
  }
})

test('refuses a short secret', async () => {
  await assert.rejects(signGatePass(claims, 'too-short'), GatePassError)
  await assert.rejects(verifyGatePass('a.b.c', undefined), GatePassError)
})

test('compares quantities whatever the key order', () => {
  assert.equal(sameQuantities({ a: 1, b: 2 }, { b: 2, a: 1 }), true)
  assert.equal(sameQuantities({ a: 1 }, { a: 2 }), false)
  assert.equal(sameQuantities({ a: 1 }, { a: 1, b: 1 }), false)
  assert.equal(sameQuantities({ a: 1, b: 1 }, { a: 1, c: 1 }), false)
  assert.equal(sameQuantities({ toString: 1 }, {}), false)
})
