// `yarn bench`: how much the Worker costs per checkout, and a sale opening on
// this machine. The handler runs in Node (the same code and WebCrypto calls
// as on Cloudflare) against a real redis-server behind the Upstash-style REST
// front of the functions' tests, with ID tokens signed by a local key.
//
//   BUYERS=20000 CONCURRENCY=500 STOCK=2800 yarn bench
//
// 1. Time per request, one at a time, for each way a checkout can end: what
//    one Cloudflare isolate spends on it (Workers bill and limit CPU time,
//    not the time spent waiting on Redis).
// 2. The sale: BUYERS checkouts, CONCURRENCY at a time, for STOCK tickets.
//    The handler runs on one Node thread (Redis and its REST front in a
//    process of their own), so its throughput is what one isolate could do:
//    Cloudflare runs as many isolates as the traffic needs.
//
// `wrangler dev` is no help for throughput: its local proxy alone tops out
// at about 1000 requests a second on a small machine, even for /health.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { performance } from 'node:perf_hooks'

import { forgetSoldOut, handle } from '../src/index.js'
import { createIssuer, JWKS_URL, PROJECT_ID } from '../test/idTokens.js'
import { hasRedisServer } from '../../functions/test/redis/upstash.js'
import { gateKey } from '../../functions/lib/gateScripts.js'

const BUYERS = Number(process.env.BUYERS || 20000)
const CONCURRENCY = Number(process.env.CONCURRENCY || 500)
const STOCK = Number(process.env.STOCK || 2800)
const SAMPLES = 2000
const TYPE = 'bench'

if (!hasRedisServer()) throw new Error('the benchmark needs redis-server')

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
const ms = (value) => `${value.toFixed(2)} ms`
const latencies = (list) => {
  const sorted = list.map((r) => r.ms).sort((a, b) => a - b)
  return sorted.length
    ? `p50 ${ms(percentile(sorted, 0.5))}, p95 ${ms(percentile(sorted, 0.95))}, p99 ${ms(percentile(sorted, 0.99))}`
    : '-'
}

// Redis in its own process (bench/redisFront.js); `redis.call` sends one
// command through its REST front
const front = spawn(process.execPath, [new URL('./redisFront.js', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'inherit'] })
const [line] = await once(createInterface({ input: front.stdout }), 'line')
const { url, token } = JSON.parse(line)
const upstash = {
  url,
  token,
  redis: {
    call: async (args) => (await (await fetch(url, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(args)
    })).json()).result
  },
  stop: async () => {
    front.stdin.end()
    await once(front, 'exit')
  }
}
const issuer = await createIssuer()
const fetchImpl = issuer.fetchWith()
const env = {
  FIREBASE_PROJECT_ID: PROJECT_ID,
  FIREBASE_JWKS_URL: JWKS_URL,
  UPSTASH_REDIS_REST_URL: upstash.url,
  UPSTASH_REDIS_REST_TOKEN: upstash.token,
  GATE_PASS_SECRET: 'local-benchmark-secret-0123456789abcdef',
  SOLD_OUT_CACHE_MS: process.env.SOLD_OUT_CACHE_MS || '1000'
}

const requestFor = (token, i) => new Request('https://gate.test/pass', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ requestId: `bench-request-${String(i).padStart(10, '0')}`, quantities: { [TYPE]: 1 } })
})
async function call(token, i, callEnv = env) {
  const started = performance.now()
  const response = await handle(requestFor(token, i), callEnv, { fetchImpl })
  const body = await response.json()
  return { status: response.status, body, ms: performance.now() - started, at: performance.now() }
}

try {
  const count = Math.max(BUYERS, SAMPLES)
  console.log(`signing ${count} ID tokens...`)
  const tokens = []
  for (let i = 0; i < count; i++) tokens.push(await issuer.sign(`buyer-${i}`))

  // 1. CPU per request
  const cpu = async (label, callEnv, setup) => {
    await setup?.()
    await call(tokens[0], 0, callEnv) // warm: keys fetched and imported
    const t0 = performance.now()
    for (let i = 1; i <= SAMPLES; i++) await call(tokens[i], i, callEnv)
    const each = (performance.now() - t0) / SAMPLES
    console.log(`  ${label.padEnd(34)} ${ms(each)}  (${(1000 / each).toFixed(0)}/s on one thread)`)
  }
  console.log('\nTime per checkout, one at a time (the first two are all CPU; the third waits on Redis):')
  await cpu('售完 from the isolate memory', env, async () => {
    forgetSoldOut()
    await upstash.redis.call(['SET', gateKey(TYPE), 0])
  })
  await cpu('pass, Redis not asked (no answer)', { ...env, UPSTASH_REDIS_REST_URL: 'none' })
  await cpu('pass, with the local Redis call', env, async () => {
    forgetSoldOut()
    await upstash.redis.call(['FLUSHALL'])
    await upstash.redis.call(['SET', gateKey(TYPE), 10 * SAMPLES])
  })

  // 2. The sale
  forgetSoldOut()
  await upstash.redis.call(['FLUSHALL'])
  await upstash.redis.call(['SET', gateKey(TYPE), STOCK])
  await upstash.redis.call(['CONFIG', 'RESETSTAT'])
  console.log(`\nSale: ${BUYERS} buyers, ${CONCURRENCY} at a time, ${STOCK} tickets`)
  const results = []
  let next = 0
  const t0 = performance.now()
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < BUYERS) {
      const i = next++
      results.push(await call(tokens[i], i))
    }
  }))
  const seconds = (performance.now() - t0) / 1000

  const stats = await upstash.redis.call(['INFO', 'commandstats'])
  const evalCalls = Number(/cmdstat_eval:calls=(\d+)/.exec(stats)?.[1] || 0)
  const admitted = results.filter((r) => r.status === 200)
  const unheld = admitted.filter((r) => !r.body.held)
  const turned = results.filter((r) => r.status === 409)
  const cached = turned.filter((r) => r.body.cached)
  const other = results.filter((r) => r.status !== 200 && r.status !== 409)
  const lastAdmit = admitted.length ? Math.max(...admitted.map((r) => r.at)) : t0

  console.log(`  throughput      ${(BUYERS / seconds).toFixed(0)} checkouts/s (${seconds.toFixed(2)} s for all)`)
  console.log(`  passes          ${admitted.length} of ${STOCK} tickets, the last after ${((lastAdmit - t0) / 1000).toFixed(2)} s`)
  if (unheld.length) console.log(`                  ${unheld.length} of them not held (REDIS_FAIL_OPEN)`)
  console.log(`  售完            ${turned.length}, ${cached.length} of them from the isolate memory`)
  console.log(`  busy (503)      ${other.filter((r) => r.status === 503).length}, to be tried again by the storefront`)
  console.log(`  other answers   ${other.filter((r) => r.status !== 503).length}`)
  console.log(`  Redis calls     ${evalCalls} for ${BUYERS} checkouts`)
  console.log(`  latency, pass   ${latencies(admitted)}`)
  console.log(`  latency, 售完   ${latencies(turned)}`)
  console.log(`  Redis left      ${await upstash.redis.call(['GET', gateKey(TYPE)])}`)
} finally {
  await upstash.stop()
}
