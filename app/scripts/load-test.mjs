#!/usr/bin/env node
// Checkout load test against a running Worker (local `wrangler dev` or the
// staging deployment), replacing functions/test/load.
//
//   node scripts/load-test.mjs --target local   [--buyers 300] [--stock 100]
//   node scripts/load-test.mjs --target staging --base https://<staging host> [...]
//
// It seeds a "loadtest" ticket type and N buyer accounts with sessions
// straight into D1 (wrangler d1 execute), signs their session cookies with
// BETTER_AUTH_SECRET (from the environment, or .dev.vars for local), fires
// every checkout at once and checks that nothing oversold. Staging must run
// with ENFORCE_TURNSTILE=false while testing. Never run it on production:
// --target accepts only local and staging.
import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({
  options: {
    target: { type: 'string', default: 'local' },
    base: { type: 'string' },
    buyers: { type: 'string', default: '300' },
    stock: { type: 'string', default: '10000' },
    quantity: { type: 'string', default: '1' },
    cleanup: { type: 'boolean', default: false }
  }
})

if (!['local', 'staging'].includes(args.target)) {
  console.error('--target must be local or staging')
  process.exit(1)
}
const base = (args.base || (args.target === 'local' ? 'http://127.0.0.1:8787' : '')).replace(/\/$/, '')
if (!base && !args.cleanup) {
  console.error('--base is required for staging')
  process.exit(1)
}
const buyers = Number(args.buyers)
const stock = Number(args.stock)
const quantity = Number(args.quantity)

function secret() {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET
  if (args.target === 'local') {
    const line = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('BETTER_AUTH_SECRET='))
    if (line) return line.slice('BETTER_AUTH_SECRET='.length).trim()
  }
  console.error('Set BETTER_AUTH_SECRET to the target Worker\'s secret')
  process.exit(1)
}

function d1(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'loadtest-'))
  const file = join(dir, 'seed.sql')
  writeFileSync(file, sql)
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', args.target === 'local' ? '--local' : '--remote', '--file', file, '--yes'], {
    cwd: new URL('..', import.meta.url), stdio: ['ignore', 'ignore', 'inherit']
  })
}

function d1Json(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', args.target === 'local' ? '--local' : '--remote', '--command', sql, '--json'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']
  })
  return JSON.parse(out)[0].results
}

const cleanupSql = `
DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id LIKE 'loadtest-%');
DELETE FROM mail_jobs WHERE order_id IN (SELECT id FROM orders WHERE user_id LIKE 'loadtest-%');
DELETE FROM orders WHERE user_id LIKE 'loadtest-%';
DELETE FROM order_requests WHERE user_id LIKE 'loadtest-%';
DELETE FROM buyer_purchases WHERE ticket_type_id = 'loadtest';
DELETE FROM session WHERE userId LIKE 'loadtest-%';
DELETE FROM user WHERE id LIKE 'loadtest-%';
DELETE FROM ticket_types WHERE id = 'loadtest';`

if (args.cleanup) {
  d1(cleanupSql)
  console.log('load test data removed')
  process.exit(0)
}

const now = Date.now()
const iso = (offset) => new Date(now + offset).toISOString()
const type = {
  id: 'loadtest', name: '壓力測試票', price: 1, eligibleBuyerIdentity: 'all_users',
  salesStartTime: iso(-3600e3), salesEndTime: iso(3600e3), totalTicketQuantity: stock, purchaseLimitPerPerson: 20
}
const users = Array.from({ length: buyers }, (_, i) => ({ id: `loadtest-${i}`, token: `loadtest-${randomUUID()}` }))
let sql = cleanupSql + `
INSERT INTO ticket_types (id, sort, active, config, stock, sold, updated_at) VALUES ('loadtest', 999, 1, '${JSON.stringify(type)}', ${stock}, 0, ${now});
INSERT INTO settings (key, value, updated_at) VALUES ('shop', '{"openAt":"${iso(-3600e3)}"}', ${now})
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;
`
for (const u of users) {
  sql += `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('${u.id}', '${u.id}', '${u.id}@loadtest.invalid', 1, '${iso(0)}', '${iso(0)}');\n`
  sql += `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES ('${u.id}', '${iso(3600e3)}', '${u.token}', '${iso(0)}', '${iso(0)}', '${u.id}');\n`
}
console.log(`seeding ${buyers} buyers and ${stock} tickets on ${args.target}…`)
d1(sql)

const key = secret()
// better-auth prefixes the cookie with __Secure- when SITE_URL is https
const cookieName = base.startsWith('https://') ? '__Secure-better-auth.session_token' : 'better-auth.session_token'
const cookie = (token) => `${cookieName}=${encodeURIComponent(`${token}.${createHmac('sha256', key).update(token).digest('base64')}`)}`

const payload = (i) => ({
  orderPayload: {
    customerName: `壓測 ${i}`, customerPhone: '0900000000', school: '其他學校或社會人士',
    items: [{ id: 'loadtest', quantity }]
  },
  requestId: randomUUID()
})

// Every buyer has their own connection, as every browser does (fetch would
// put all checkouts on one HTTP/2 connection and queue the ones over its
// stream limit, which is the test client's delay, not the site's)
const transport = base.startsWith('https://') ? https : http
function request(agent, method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = transport.request(`${base}${path}`, { method, agent, headers: { origin: base, ...headers } }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(body)
  })
}

// Buyers open the shop before it opens: that visit (/api/me) sets the
// session cache cookie the checkout then sends, and leaves the connection
// open, as a browser would
console.log(`opening the shop for ${buyers} buyers…`)
const cookies = new Map()
const agents = new Map(users.map((u) => [u.id, new transport.Agent({ keepAlive: true, maxSockets: 1 })]))
for (let i = 0; i < users.length; i += 20) {
  await Promise.all(users.slice(i, i + 20).map(async (u) => {
    const res = await request(agents.get(u.id), 'GET', '/api/me', { cookie: cookie(u.token) })
    const set = [res.headers['set-cookie'] ?? []].flat().map((c) => c.split(';')[0])
    cookies.set(u.id, [cookie(u.token), ...set.filter((c) => !c.startsWith(`${cookieName}=`))].join('; '))
  }))
}

console.log(`firing ${buyers} checkouts at ${base}…`)
const started = performance.now()
const results = await Promise.all(users.map(async (u, i) => {
  const t0 = performance.now()
  try {
    const res = await request(agents.get(u.id), 'POST', '/api/orders',
      { 'content-type': 'application/json', cookie: cookies.get(u.id) }, JSON.stringify(payload(i)))
    let body = {}
    try { body = JSON.parse(res.text) } catch {}
    // where the server spent its time: session;dur=12, read;dur=80, gate;dur=300
    const server = Object.fromEntries(String(res.headers['server-timing'] || '').split(',').filter(Boolean)
      .map((entry) => { const [name, dur] = entry.trim().split(';dur='); return [name, Number(dur)] }))
    return { status: res.status, code: body.code, ms: performance.now() - t0, server }
  } catch (error) {
    return { status: 0, code: String(error.cause?.code || error.message), ms: performance.now() - t0 }
  }
}))
const wall = performance.now() - started

const percentile = (values, p) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]) : null
}
const latencies = results.map((r) => r.ms)
const pct = (p) => percentile(latencies, p)
// p50 / p95 of each server step, from the Server-Timing header
const serverSteps = Object.fromEntries(['session', 'read', 'gate'].map((step) => {
  const values = results.map((r) => r.server?.[step])
  return [step, `${percentile(values, 50)} / ${percentile(values, 95)}`]
}))
const byOutcome = {}
for (const r of results) {
  const k = r.status === 201 ? 'created' : `${r.status} ${r.code || ''}`.trim()
  byOutcome[k] = (byOutcome[k] || 0) + 1
}
const [{ sold }] = d1Json(`SELECT sold FROM ticket_types WHERE id = 'loadtest'`)
const [{ n: orders }] = d1Json(`SELECT count(*) AS n FROM orders WHERE user_id LIKE 'loadtest-%' AND deleted_at IS NULL`)
const created = byOutcome.created || 0
const expected = Math.min(buyers, Math.floor(stock / quantity))
const serverErrors = results.filter((r) => r.status >= 500 || r.status === 0).length

console.log(JSON.stringify({ buyers, stock, quantity, wallMs: Math.round(wall), p50: pct(50), p95: pct(95), p99: pct(99), max: pct(100), serverMs: serverSteps, byOutcome, sold, orders }, null, 2))
const failures = []
if (sold > stock) failures.push(`oversold: ${sold} > ${stock}`)
if (sold !== created * quantity || orders !== created) failures.push(`counts disagree: sold ${sold}, orders ${orders}, created ${created}`)
if (created !== expected) failures.push(`expected ${expected} orders, got ${created}`)
if (serverErrors) failures.push(`${serverErrors} server or network errors`)
// Local wrangler dev runs every request on one thread, so its latency means
// nothing; the 1.5 s goal applies to staging (real D1)
if (args.target === 'staging' && pct(95) > 1500) failures.push(`p95 ${pct(95)}ms over 1500ms`)
console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'PASS')
console.log('remove the test data with: node scripts/load-test.mjs --cleanup --target ' + args.target)
process.exit(failures.length ? 1 : 0)
