// The Worker's handler against a real redis-server behind the Upstash-style
// REST front the functions' tests use (needs redis-server), with ID tokens
// signed by a local key.
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { forgetSoldOut, handle } from '../src/index.js'
import { resetKeyCache } from '../src/firebaseAuth.js'
import { JWKS_URL, PROJECT_ID, createIssuer } from './idTokens.js'
import { hasRedisServer, startUpstash } from '../../functions/test/redis/upstash.js'
import { verifyGatePass } from '../../functions/lib/gatePass.js'
import { accountKey, gateKey, genKey, holdKey } from '../../functions/lib/gateScripts.js'

assert.ok(hasRedisServer(), 'the Worker tests need redis-server (e.g. apt install redis-server)')

const SECRET = 'test-gate-pass-secret-0123456789abcdef'
const ORIGIN = 'https://tickets.cksc.tw'
let upstash
let issuer
let env
let redisCalls = 0

const fetchImpl = (url, init) => {
  if (String(url) === upstash?.url) redisCalls++
  return issuer.fetchWith()(url, init)
}

const rid = (n) => `request-${String(n).padStart(8, '0')}`
async function ask(uid, quantities, requestId = rid(1), { token, headers = {}, method = 'POST', path = '/pass', envOverride } = {}) {
  const response = await handle(new Request(`https://gate.test${path}`, {
    method,
    headers: { Origin: ORIGIN, Authorization: `Bearer ${token ?? await issuer.sign(uid)}`, ...headers },
    ...(method === 'POST' ? { body: JSON.stringify({ requestId, quantities }) } : {})
  }), envOverride || env, { fetchImpl })
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) }
}
const left = async (id) => {
  const value = await upstash.redis.call(['GET', gateKey(id)])
  return value === null ? null : Number(value)
}

before(async () => {
  upstash = await startUpstash()
  issuer = await createIssuer()
  env = {
    FIREBASE_PROJECT_ID: PROJECT_ID,
    FIREBASE_JWKS_URL: JWKS_URL,
    ALLOWED_ORIGINS: ORIGIN,
    SOLD_OUT_CACHE_MS: '1000',
    UPSTASH_REDIS_REST_URL: upstash.url,
    UPSTASH_REDIS_REST_TOKEN: upstash.token,
    GATE_PASS_SECRET: SECRET
  }
})

after(async () => {
  await upstash.stop()
})

beforeEach(async () => {
  await upstash.redis.call(['FLUSHALL'])
  forgetSoldOut()
  redisCalls = 0
})

describe('signing in', () => {
  test('turns away a call without an ID token, or with one for another project', async () => {
    assert.equal((await ask('a', { small: 1 }, rid(1), { token: '' })).status, 401)
    assert.equal((await ask('a', { small: 1 }, rid(1), { token: await issuer.sign('a', { aud: 'other' }) })).status, 401)
    assert.equal((await ask('a', { small: 1 }, rid(1), { token: await issuer.sign('a', { exp: 1 }) })).status, 401)
  })

  test('turns away a token whose signature does not match', async () => {
    const token = await issuer.sign('a')
    const [header, , signature] = token.split('.')
    const forged = `${header}.${Buffer.from(JSON.stringify({ sub: 'b' })).toString('base64url')}.${signature}`
    assert.equal((await ask('a', { small: 1 }, rid(1), { token: forged })).status, 401)
  })

  test('turns away an account whose email is not verified, before touching Redis', async () => {
    const result = await ask('a', { small: 1 }, rid(1), { token: await issuer.sign('a', { email_verified: false }) })
    assert.equal(result.status, 403)
    assert.equal(redisCalls, 0)
  })

  test('fetches the signing keys once per isolate', async () => {
    resetKeyCache()
    const before = issuer.jwksFetches
    await Promise.all([ask('a', { small: 1 }, rid(1)), ask('b', { small: 1 }, rid(2)), ask('c', { small: 1 }, rid(3))])
    await ask('d', { small: 1 }, rid(4))
    assert.equal(issuer.jwksFetches - before, 1)
  })
})

describe('the pass', () => {
  test('lets a checkout through while the gate has no count, and says which types lack one', async () => {
    await upstash.redis.call(['SET', genKey('small'), 3])
    const result = await ask('a', { small: 2, open: 1 })
    assert.equal(result.status, 200)
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), ORIGIN)
    const claims = await verifyGatePass(result.body.pass, SECRET)
    assert.deepEqual(
      { sub: claims.sub, rid: claims.rid, q: claims.q, held: claims.held, miss: claims.miss },
      { sub: 'a', rid: rid(1), q: { small: 2, open: 1 }, held: true, miss: { small: 3, open: 0 } }
    )
  })

  test('takes from the counts, and turns the checkout away once they run short', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 3])
    assert.equal((await ask('a', { small: 2 }, rid(1))).status, 200)
    assert.equal(await left('small'), 1)
    const turned = await ask('b', { small: 2 }, rid(2))
    assert.deepEqual([turned.status, turned.body.ticketTypeId], [409, 'small'])
    assert.equal(await left('small'), 1)
    assert.equal((await ask('c', { small: 1 }, rid(3))).status, 200)
    assert.equal(await left('small'), 0)
  })

  test('lets the same checkout through again without taking more', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 3])
    assert.equal((await ask('a', { small: 2 }, rid(1))).status, 200)
    const again = await ask('a', { small: 2 }, rid(1))
    assert.equal(again.status, 200)
    assert.equal((await verifyGatePass(again.body.pass, SECRET)).held, true)
    assert.equal(await left('small'), 1)
  })

  test('keeps one hold per account: a new checkout gives back the last one first', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 10])
    for (let i = 1; i <= 5; i++) assert.equal((await ask('a', { small: 2 }, rid(i))).status, 200)
    assert.equal(await left('small'), 8)
    assert.equal(await upstash.redis.call(['GET', accountKey('a')]), holdKey(rid(5)))
    assert.equal(await upstash.redis.call(['EXISTS', holdKey(rid(1))]), 0)
  })

  test('still signs a pass, not held, when Redis gives no answer', async () => {
    const result = await ask('a', { small: 1 }, rid(1), {
      envOverride: { ...env, UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:1' }
    })
    assert.equal(result.status, 200)
    assert.equal((await verifyGatePass(result.body.pass, SECRET)).held, false)
  })

  test('checks what it is asked for', async () => {
    assert.equal((await ask('a', { small: 1 }, 'short')).status, 400)
    assert.equal((await ask('a', { 'bad id!': 1 })).status, 400)
    assert.equal((await ask('a', { small: 0 })).status, 400)
    assert.equal((await ask('a', { small: 1.5 })).status, 400)
    assert.equal((await ask('a', { small: 21 })).status, 400)
    assert.equal((await ask('a', {})).status, 400)
    assert.equal(redisCalls, 0)
  })
})

describe('the sold-out memory', () => {
  test('turns the same or larger asks away without Redis, smaller ones still ask', async () => {
    await upstash.redis.call(['SET', gateKey('small'), 1])
    assert.equal((await ask('a', { small: 2 }, rid(1))).status, 409)
    redisCalls = 0
    for (let i = 2; i < 12; i++) {
      const result = await ask(`u${i}`, { small: 2 + (i % 3) }, rid(i))
      assert.deepEqual([result.status, result.body.cached], [409, true])
    }
    assert.equal(redisCalls, 0)
    assert.equal((await ask('b', { small: 1 }, rid(20))).status, 200)
    assert.equal(redisCalls, 1)
  })

  test('forgets after SOLD_OUT_CACHE_MS, and never with it set to 0', async () => {
    const at = (t) => (request, e) => handle(request, e, { fetchImpl, now: () => t })
    await upstash.redis.call(['SET', gateKey('small'), 0])
    const call = async (t, uid, n, e = env) => (await at(t)(new Request('https://gate.test/pass', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await issuer.sign(uid, {}, { now: t })}` },
      body: JSON.stringify({ requestId: rid(n), quantities: { small: 1 } })
    }), e)).json()

    const t0 = Date.now()
    assert.equal((await call(t0, 'a', 1)).cached, undefined)
    assert.equal((await call(t0 + 500, 'b', 2)).cached, true)
    assert.equal((await call(t0 + 1500, 'c', 3)).cached, undefined)

    forgetSoldOut()
    const off = { ...env, SOLD_OUT_CACHE_MS: '0' }
    await call(t0, 'd', 4, off)
    assert.equal((await call(t0 + 1, 'e', 5, off)).cached, undefined)
  })
})

describe('http', () => {
  test('answers the CORS preflight for the site only', async () => {
    const preflight = await handle(new Request('https://gate.test/pass', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env)
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN)
    const other = await handle(new Request('https://gate.test/pass', { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } }), env)
    assert.equal(other.headers.get('Access-Control-Allow-Origin'), null)
  })

  test('has only /pass and /health', async () => {
    assert.equal((await ask('a', {}, rid(1), { path: '/other' })).status, 404)
    assert.equal((await ask('a', {}, rid(1), { method: 'GET' })).status, 405)
    assert.equal((await ask('a', {}, rid(1), { method: 'GET', path: '/health' })).status, 200)
  })
})
