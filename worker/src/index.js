// The stock gate in front of createOrder, at Cloudflare's edge. A buyer's
// browser asks here first, with its Firebase ID token and what it wants to
// buy; the Worker takes the tickets from the counts in Redis (Upstash) in one
// Lua call, the same script createOrder runs without it, and answers
//
//   200 { pass, expiresIn }   a pass (HS256 JWT, functions/lib/gatePass.js)
//                             that createOrder checks before it reads stock
//   409 { error: 'sold-out', ticketTypeId }
//
// so that buyers turned away never reach Cloud Functions, and those let
// through skip the function's own Redis call. When a sale opening brings far
// more buyers than tickets, Cloud Functions only sees about as many checkouts
// as there are tickets.
//
// Like the gate in createOrder it only filters: the stock shards in Firestore
// still decide every sale. Whenever Redis gives no answer (unreachable, slow)
// the Worker still signs a pass, marked not held, and createOrder reads the
// shards as without the gate.
//
// Each isolate remembers for SOLD_OUT_CACHE_MS that Redis turned a type away
// (soldOut below), and turns buyers asking as many or more of it away without
// calling Redis: once a type is sold out, Redis sees about one call per
// isolate per that long, however many buyers keep trying.
import {
  ADMIT_ONE_PER_ACCOUNT, HOLD_TTL_S, accountKey, gateKey, genKey, holdKey
} from '../../functions/lib/gateScripts.js'
import { PASS_TTL_S, signGatePass } from '../../functions/lib/gatePass.js'
import { AuthError, verifyFirebaseIdToken } from './firebaseAuth.js'

// Past this Redis is skipped for this call and the pass is not held
const REDIS_TIMEOUT_MS = 800
const DEFAULT_SOLD_OUT_CACHE_MS = 1000
// Same bounds as createOrder (functions/lib/orderValidation.js); it checks
// them again, these only keep junk away from Redis
const TICKET_TYPE_ID = /^[\w-]{1,100}$/
const REQUEST_ID = /^[\w-]{16,64}$/
const MAX_TICKETS_PER_ORDER = 20
const MAX_BODY_BYTES = 4096

// ticketTypeId -> { quantity, until }: Redis turned `quantity` of it away
const soldOut = new Map()

// The first type of `quantities` this isolate saw turned away for as many
// or fewer, recently; null when none.
export function soldOutLocally(quantities, now) {
  for (const [id, quantity] of Object.entries(quantities)) {
    const entry = soldOut.get(id)
    if (!entry) continue
    if (entry.until <= now) soldOut.delete(id)
    else if (quantity >= entry.quantity) return id
  }
  return null
}

function rememberSoldOut(id, quantity, now, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return
  const entry = soldOut.get(id)
  const current = entry && entry.until > now ? entry.quantity : Infinity
  soldOut.set(id, { quantity: Math.min(quantity, current), until: now + ms })
}

export function forgetSoldOut() {
  soldOut.clear()
}

class BadRequest extends Error {}

function readOrder(body) {
  const requestId = body?.requestId
  if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) throw new BadRequest('invalid requestId')
  const entries = Object.entries(body?.quantities && typeof body.quantities === 'object' ? body.quantities : {})
  if (entries.length === 0) throw new BadRequest('no tickets')
  let total = 0
  for (const [id, quantity] of entries) {
    if (!TICKET_TYPE_ID.test(id)) throw new BadRequest('invalid ticket type')
    if (!Number.isInteger(quantity) || quantity <= 0) throw new BadRequest('invalid quantity')
    total += quantity
  }
  if (total > MAX_TICKETS_PER_ORDER) throw new BadRequest(`單筆訂單最多 ${MAX_TICKETS_PER_ORDER} 張`)
  return { requestId, quantities: Object.fromEntries(entries) }
}

// One command through the Upstash REST API; null when it gives no answer
async function redis(env, args, fetchImpl) {
  if (!/^https:\/\/|^http:\/\/127\.0\.0\.1:/.test(env.UPSTASH_REDIS_REST_URL || '') || !env.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }
  try {
    const response = await fetchImpl(env.UPSTASH_REDIS_REST_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(REDIS_TIMEOUT_MS)
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
    return body.result
  } catch (error) {
    console.error('[gate] redis skipped:', error?.message || error)
    return null
  }
}

// Takes the tickets for this account's checkout. Returns
//   { admitted: true, held: true, missing: { [ticketTypeId]: generation } }
//   { admitted: true, held: false }     no answer from Redis
//   { admitted: false, ticketTypeId }   not enough left by the counts
async function admit(env, uid, requestId, quantities, fetchImpl) {
  const entries = Object.entries(quantities)
  const keys = [
    accountKey(uid),
    holdKey(requestId),
    ...entries.map(([id]) => gateKey(id)),
    ...entries.map(([id]) => genKey(id))
  ]
  const args = [HOLD_TTL_S, ...entries.map(([, n]) => n)]
  const result = await redis(env, ['EVAL', ADMIT_ONE_PER_ACCOUNT, keys.length, ...keys, ...args], fetchImpl)
  if (!Array.isArray(result)) return { admitted: true, held: false }

  const [admitted, ...rest] = result.map(Number)
  const typeAt = (position) => entries[position - 1]?.[0]
  if (admitted !== 1) return { admitted: false, ticketTypeId: typeAt(rest[0]) }
  const missing = {}
  for (let i = 0; i + 1 < rest.length; i += 2) {
    const id = typeAt(rest[i])
    if (id) missing[id] = rest[i + 1]
  }
  return { admitted: true, held: true, missing }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin')
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)
  return {
    ...(origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  }
}

const json = (status, body, headers) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })

// `deps` lets the tests and the local benchmark swap fetch and the clock
export async function handle(request, env, { fetchImpl = fetch, now = Date.now } = {}) {
  const cors = corsHeaders(request, env)
  const url = new URL(request.url)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (url.pathname === '/health') return json(200, { ok: true }, cors)
  if (url.pathname !== '/pass') return json(404, { error: 'not-found' }, cors)
  if (request.method !== 'POST') return json(405, { error: 'method-not-allowed' }, cors)
  if (!env.GATE_PASS_SECRET) {
    console.error('[gate] GATE_PASS_SECRET is not set')
    return json(500, { error: 'internal' }, cors)
  }

  let account
  try {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    account = await verifyFirebaseIdToken(token, {
      projectId: env.FIREBASE_PROJECT_ID, jwksUrl: env.FIREBASE_JWKS_URL || undefined, fetchImpl, now: now()
    })
  } catch (error) {
    if (error instanceof AuthError) return json(error.status, { error: 'unauthenticated', message: error.message }, cors)
    console.error('[gate] could not check the ID token:', error?.message || error)
    return json(503, { error: 'unavailable' }, cors)
  }

  let order
  try {
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) throw new BadRequest('body too large')
    order = readOrder(JSON.parse(text))
  } catch (error) {
    return json(400, { error: 'invalid-argument', message: error instanceof BadRequest ? error.message : 'invalid JSON' }, cors)
  }

  const cachedId = soldOutLocally(order.quantities, now())
  if (cachedId) return json(409, { error: 'sold-out', ticketTypeId: cachedId, cached: true }, cors)

  const answer = await admit(env, account.uid, order.requestId, order.quantities, fetchImpl)
  if (!answer.admitted) {
    if (answer.ticketTypeId) {
      const ms = Number(env.SOLD_OUT_CACHE_MS ?? DEFAULT_SOLD_OUT_CACHE_MS)
      rememberSoldOut(answer.ticketTypeId, order.quantities[answer.ticketTypeId], now(), ms)
    }
    return json(409, { error: 'sold-out', ticketTypeId: answer.ticketTypeId ?? null }, cors)
  }

  const pass = await signGatePass({
    uid: account.uid,
    requestId: order.requestId,
    quantities: order.quantities,
    held: answer.held,
    missing: answer.missing
  }, env.GATE_PASS_SECRET, now())
  return json(200, { pass, expiresIn: PASS_TTL_S, held: answer.held }, cors)
}

export default {
  fetch: (request, env) => handle(request, env)
}
