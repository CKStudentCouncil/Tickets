import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CHECKOUT_ACTION, parseHostnames, verifyTurnstile } from '../../lib/turnstile.js'

const hostnames = parseHostnames(' tickets.cksc.tw , ')

function siteverify(result, { ok = true } = {}) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: Object.fromEntries(init.body) })
    return { ok, status: ok ? 200 : 500, json: async () => result }
  }
  return { calls, fetchImpl }
}

const verify = (fetchImpl, overrides = {}) =>
  verifyTurnstile({
    token: 'token',
    action: CHECKOUT_ACTION,
    hostnames,
    secret: 'secret',
    remoteip: '203.0.113.7',
    fetchImpl,
    ...overrides
  })

const passing = { success: true, action: CHECKOUT_ACTION, hostname: 'tickets.cksc.tw' }

test('parseHostnames trims and drops empty entries', () => {
  assert.deepEqual([...hostnames], ['tickets.cksc.tw'])
})

test('a token Cloudflare accepts for the checkout on the site passes', async () => {
  const { calls, fetchImpl } = siteverify(passing)

  assert.equal(await verify(fetchImpl), true)
  assert.equal(calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
  assert.deepEqual(calls[0].body, { secret: 'secret', response: 'token', remoteip: '203.0.113.7' })
})

test('a missing or oversized token is rejected without calling siteverify', async () => {
  const { calls, fetchImpl } = siteverify(passing)

  for (const token of [undefined, '', 42, 'x'.repeat(2049)]) {
    await assert.rejects(verify(fetchImpl, { token }), { code: 'permission-denied' })
  }
  assert.equal(calls.length, 0)
})

test('a token for another action or hostname is rejected', async () => {
  for (const result of [
    { ...passing, action: 'login' },
    { ...passing, hostname: 'localhost' },
    { success: false, 'error-codes': ['invalid-input-response'] }
  ]) {
    await assert.rejects(verify(siteverify(result).fetchImpl), { code: 'permission-denied' })
  }
})

test('an already redeemed token is reported, not thrown, so retries can be let through', async () => {
  const { fetchImpl } = siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] })

  assert.equal(await verify(fetchImpl), false)
})

test('fails closed when siteverify cannot be reached', async () => {
  await assert.rejects(verify(siteverify(passing, { ok: false }).fetchImpl), { code: 'unavailable' })
  await assert.rejects(
    verify(async () => {
      throw new Error('network down')
    }),
    { code: 'unavailable' }
  )
})

test('refuses every order when the secret or hostnames are not set', async () => {
  const { fetchImpl } = siteverify(passing)

  await assert.rejects(verify(fetchImpl, { secret: undefined }), { code: 'failed-precondition' })
  await assert.rejects(verify(fetchImpl, { hostnames: new Set() }), { code: 'failed-precondition' })
})
