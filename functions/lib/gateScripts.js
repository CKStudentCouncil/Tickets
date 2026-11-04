// The stock gate's Redis keys and the Lua script that takes tickets from its
// counts. Plain strings with no imports, so that both createOrder
// (lib/stockGate.js) and the Cloudflare Worker in /worker load the very same
// script: whichever of them lets a checkout through, the counts move alike.
// See lib/stockGate.js for what the counts mean.

const PREFIX = 'stockGate:'
export const gateKey = (ticketTypeId) => `${PREFIX}left:${ticketTypeId}`
export const genKey = (ticketTypeId) => `${PREFIX}gen:${ticketTypeId}`
export const holdKey = (holdId) => `${PREFIX}hold:${holdId}`
// The one hold an account may keep through the Worker (see ADMIT_ONE_PER_ACCOUNT)
export const accountKey = (uid) => `${PREFIX}account:${uid}`

// A checkout's retries (same requestId) within this long are let through again
export const HOLD_TTL_S = 15 * 60

// The part both scripts share. `base` is where the counts start in KEYS, `n`
// how many types, ARGV[2..n+1] the quantities. Returns { 0, position } when
// a count is short, otherwise takes the quantities from the counts there,
// records them in the hold and returns { 1, position, generation, ... } for
// the types with no count (1-based).
const TAKE = `
local missing = {}
for i = 1, n do
  local left = redis.call('GET', KEYS[base + i])
  if not left then
    table.insert(missing, i)
    table.insert(missing, tonumber(redis.call('GET', KEYS[base + i + n]) or '0'))
  elseif tonumber(left) < tonumber(ARGV[i + 1]) then
    return {0, i}
  end
end
local taken = {}
for i = 1, n do
  local key = KEYS[base + i]
  if redis.call('EXISTS', key) == 1 then
    redis.call('DECRBY', key, ARGV[i + 1])
    table.insert(taken, key .. '=' .. ARGV[i + 1])
  end
end
redis.call('SET', hold, table.concat(taken, ','), 'EX', ARGV[1])
local result = {1}
for _, value in ipairs(missing) do table.insert(result, value) end
return result
`

// Gives the tickets recorded in the hold named `held_key` back to the counts
// still there, and drops the hold.
const RELEASE = `
local function release(held_key)
  local held = redis.call('GET', held_key)
  if not held then return 0 end
  redis.call('DEL', held_key)
  for key, q in string.gmatch(held, '([^=,]+)=(%d+)') do
    if redis.call('EXISTS', key) == 1 then redis.call('INCRBY', key, q) end
  end
  return 1
end
`

// createOrder's own call. KEYS = hold, then one count per type, then one
// generation per type; ARGV = hold seconds, then the quantities. A hold that
// is already there (a retry) is let through without taking more.
export const ADMIT = `
local n = (#KEYS - 1) / 2
local base = 1
local hold = KEYS[1]
if redis.call('EXISTS', hold) == 1 then return {1} end
${TAKE}`

// The Worker's call. KEYS = account, hold, then the counts and generations as
// in ADMIT; ARGV as in ADMIT. The Worker hands out passes before createOrder
// runs any check, so a script could ask for checkout after checkout under
// new requestIds and never use them; one hold per account caps that: a new
// checkout of the same account first gives back the hold of its last one.
export const ADMIT_ONE_PER_ACCOUNT = `
${RELEASE}
local n = (#KEYS - 2) / 2
local base = 2
local hold = KEYS[2]
if redis.call('EXISTS', hold) == 1 then return {1} end
local previous = redis.call('GET', KEYS[1])
if previous and previous ~= hold then release(previous) end
redis.call('SET', KEYS[1], hold, 'EX', ARGV[1])
${TAKE}`

// KEYS[1] = hold. Gives its tickets back to the counts still there.
export const GIVE_BACK = `
${RELEASE}
return release(KEYS[1])
`
