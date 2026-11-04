// Stock gate: a count of tickets left per limited type, kept in Redis
// (Upstash, through its REST API), that createOrder takes from before it
// touches Firestore. When a sale opening brings far more buyers than
// tickets, the ones it turns away are told 售完 in one Redis call instead of
// each reading every stock shard.
//
// The gate only filters. The shards in Firestore stay the only count that
// decides a sale, so the gate can never oversell; it is kept a little above
// what is really left (GATE_SLACK) so that it does not turn buyers away while
// tickets remain. Whenever it cannot say (off, not set up, unreachable, slow,
// or no count yet for a type), checkouts go to Firestore as without it. A
// count too high only lets more checkouts reach the shards; a count too low
// turns buyers away while tickets remain, so every doubt is settled upwards
// and the counts are set again from the shards often (COUNT_TTL_S).
//
//   stockGate:left:{ticketTypeId}  tickets the gate still lets through; set
//                                  from the shards by the first checkout that
//                                  finds it missing, expires after COUNT_TTL_S
//   stockGate:gen:{ticketTypeId}   bumped by every reset, so a checkout that
//                                  looked at the shards before tickets came
//                                  back cannot set the count from that look
//   stockGate:hold:{requestId}     what one checkout took ("key=n,key=n"), so
//                                  its retries are not counted again and a
//                                  checkout that fails can give it back
//
// The counts are dropped (and set again from the shards) whenever tickets come
// back or the ticket types are saved: releaseOrderStock, releaseSellerStock
// and planStockShards call resetStockGate.
import { randomUUID } from 'node:crypto'
import { GATE_PASS, STOCK_GATE } from './params.js'
import { ADMIT, GIVE_BACK, HOLD_TTL_S, gateKey, genKey, holdKey } from './gateScripts.js'

export const UPSTASH_URL_SECRET = 'UPSTASH_REDIS_REST_URL'
export const UPSTASH_TOKEN_SECRET = 'UPSTASH_REDIS_REST_TOKEN'
export const STOCK_GATE_SECRETS = [UPSTASH_URL_SECRET, UPSTASH_TOKEN_SECRET]

export { accountKey, gateKey, genKey, holdKey } from './gateScripts.js'

// A count lives this long and is then set again from the shards, so whatever
// it drifted by (tickets of a checkout that ended without giving them back, a
// reset that did not reach Redis) lasts at most this long
export const COUNT_TTL_S = 60
// A type's generation outlives any checkout that could still hold an old one
const GEN_TTL_S = 7 * 24 * 60 * 60
// Past this the gate is skipped for this call: a checkout should not wait on it
const TIMEOUT_MS = 800
// Triggers are not waited on by buyers: their resets get longer (a cold start
// can make the first call slow) before they fail and are retried
const TRIGGER_TIMEOUT_MS = 5000

// How far the gate stays above what is left. It covers tickets taken by
// checkouts that were let through and then gave up without giving them back
// (a retry that never came); it is also how many buyers still reach
// Firestore after a type really sold out, until those numbers are used up.
export const gateSlack = (left) => Math.max(10, Math.ceil(left * 0.05))

// KEYS = count, generation; ARGV = count, seconds, generation seen ('' = do
// not check). Sets the count unless one is there or the type was reset since.
const SEED = `
if ARGV[3] ~= '' and tonumber(redis.call('GET', KEYS[2]) or '0') ~= tonumber(ARGV[3]) then return 0 end
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then return 1 end
return 0
`

// KEYS = the counts, then their generations; ARGV[1] = generation seconds.
// Drops the counts and bumps the generations.
const RESET = `
local n = #KEYS / 2
for i = 1, n do
  redis.call('DEL', KEYS[i])
  redis.call('INCR', KEYS[i + n])
  redis.call('EXPIRE', KEYS[i + n], ARGV[1])
end
return n
`

// On with STOCK_GATE, and with GATE_PASS: then the Worker takes the tickets,
// and createOrder still sets the counts it lacks and gives tickets back here.
export const stockGateOn = () => STOCK_GATE.value() || GATE_PASS.value()

function settings({ evenWhenOff = false } = {}) {
  if (!evenWhenOff && !stockGateOn()) return null
  const url = process.env[UPSTASH_URL_SECRET]
  const token = process.env[UPSTASH_TOKEN_SECRET]
  // the deploy needs the secrets even while the gate is off; placeholders
  // that are not a URL leave it off (plain http only to this machine, for
  // the tests' stand-in)
  if (!/^(https:\/\/|http:\/\/127\.0\.0\.1:)/.test(url || '') || !token) return null
  return { url, token }
}

// One command through the Upstash REST API; null when the gate is off, or
// unreachable or slow (logged, or thrown with `throwOnError`).
async function command(args, label, { throwOnError = false, ...options } = {}) {
  const config = settings(options)
  if (!config) return null
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(throwOnError ? TRIGGER_TIMEOUT_MS : TIMEOUT_MS)
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`)
    return { result: body.result }
  } catch (error) {
    if (throwOnError) throw new Error(`[stockGate] ${label} failed: ${error?.message || error}`)
    console.error(`[stockGate] ${label} skipped:`, error?.message || error)
    return null
  }
}

// Takes `quantities` ({ ticketTypeId: n }) for one checkout. Returns
//   { admitted: true, holdId, missing: [ticketTypeIds without a count],
//     generations: { [missing ticketTypeId]: generation } }
//   { admitted: false, ticketTypeId }  not enough left by the gate's count
//   null                               no answer: go on as without the gate
// The same holdId (the checkout's requestId) is let through again without
// taking more.
export async function admitToStock(holdId, quantities) {
  const entries = Object.entries(quantities)
  if (entries.length === 0) return null
  const id = holdId || randomUUID()
  const keys = [
    holdKey(id),
    ...entries.map(([ticketTypeId]) => gateKey(ticketTypeId)),
    ...entries.map(([ticketTypeId]) => genKey(ticketTypeId))
  ]
  const args = [HOLD_TTL_S, ...entries.map(([, n]) => n)]
  const answer = await command(['EVAL', ADMIT, keys.length, ...keys, ...args], 'admit')
  if (!answer || !Array.isArray(answer.result)) return null

  const [admitted, ...rest] = answer.result.map(Number)
  const typeAt = (position) => entries[position - 1]?.[0]
  if (admitted !== 1) return { admitted: false, ticketTypeId: typeAt(rest[0]) }

  const missing = []
  const generations = {}
  for (let i = 0; i + 1 < rest.length; i += 2) {
    const ticketTypeId = typeAt(rest[i])
    if (!ticketTypeId) continue
    missing.push(ticketTypeId)
    generations[ticketTypeId] = rest[i + 1]
  }
  return { admitted: true, holdId: id, missing, generations }
}

// A checkout that was let through but did not sell for a reason other than
// 售完 gives its tickets back. Best effort.
export async function giveBackToStock(holdId) {
  if (holdId) await command(['EVAL', GIVE_BACK, 1, holdKey(holdId)], 'give back')
}

// A checkout the Worker let through sold its tickets: its hold keeps letting
// retries through but no longer has anything to give back, so that the
// account's next checkout (ADMIT_ONE_PER_ACCOUNT gives back the last hold)
// does not put sold tickets back in the counts. Best effort: if it fails,
// the counts are that much too high until they are set again.
export async function settleHold(holdId) {
  if (holdId) await command(['SET', holdKey(holdId), '', 'XX', 'KEEPTTL'], 'settle')
}

// Sets the counts the gate did not have, from what the shards show is left
// ([{ id, left, generation }]). Never overwrites a count: another checkout
// may have set it and others taken from it since. With `generation` (what
// admitToStock reported when the look began) nothing is set if the type was
// reset since: tickets may have come back after that look.
export async function seedStockGate(looks) {
  await Promise.all(
    looks.map(({ id, left, generation }) =>
      command([
        'EVAL', SEED, 2, gateKey(id), genKey(id),
        Math.max(0, left) + gateSlack(left), COUNT_TTL_S, Number.isInteger(generation) ? generation : ''
      ], 'seed')
    )
  )
}

// Drops the counts of these types; the next checkout sets them again from the
// shards. Called when tickets come back or the stock may have changed, also
// while the gate is off, so that turning it on finds no outdated count. With
// `throwOnError` a failure throws (so a trigger is retried) instead of being
// logged; a gate that is not set up is never a failure.
export async function resetStockGate(ticketTypeIds, { throwOnError = false } = {}) {
  const ids = [...new Set(ticketTypeIds)].filter(Boolean)
  if (ids.length === 0) return
  const keys = [...ids.map(gateKey), ...ids.map(genKey)]
  await command(['EVAL', RESET, keys.length, ...keys, GEN_TTL_S], 'reset', { evenWhenOff: true, throwOnError })
}
