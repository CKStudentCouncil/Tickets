// The pass the stock gate Worker (/worker) hands a buyer it let through, and
// createOrder checks: an HS256 JWT signed with a secret only the two share
// (GATE_PASS_SECRET). Written for WebCrypto and the web globals (atob, btoa,
// TextEncoder) alone, so the Worker and Cloud Functions run this same file.
//
// Claims:
//   iss, aud   'cksc-gate', 'createOrder'
//   sub        the buyer's Firebase uid
//   rid        the checkout's requestId: a pass serves one checkout, and
//              createOrder resolves a requestId only once
//   q          { [ticketTypeId]: quantity } exactly as the order asks
//   held       true when the Worker took the tickets from the counts in
//              Redis (its hold is named by rid); false when Redis gave no
//              answer and the buyer goes to the shards as without the gate
//   miss       { [ticketTypeId]: generation } the types the gate had no count
//              for: createOrder sets those counts from its look at the shards
//   iat, exp   seconds; a pass lives PASS_TTL_S

export const PASS_ISSUER = 'cksc-gate'
export const PASS_AUDIENCE = 'createOrder'
// Long enough for the browser to call createOrder right after; a retry asks
// the Worker again (its hold lets the same requestId through again)
export const PASS_TTL_S = 120
// Clock difference between Cloudflare and Google allowed on iat
const SKEW_S = 30
const MAX_TOKEN_LENGTH = 4096

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class GatePassError extends Error {}

function base64url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(text) {
  if (!/^[\w-]*$/.test(text)) throw new GatePassError('malformed')
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

const encodeJson = (value) => base64url(encoder.encode(JSON.stringify(value)))
const HEADER = encodeJson({ alg: 'HS256', typ: 'JWT' })

// importKey is the slow part of an HMAC; a Worker isolate or a function
// instance keeps the key for every later pass
const keys = new Map()
function hmacKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new GatePassError('GATE_PASS_SECRET must be at least 32 characters')
  }
  if (!keys.has(secret)) {
    keys.set(secret, crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
    ))
  }
  return keys.get(secret)
}

export async function signGatePass({ uid, requestId, quantities, held, missing = {} }, secret, now = Date.now()) {
  const iat = Math.floor(now / 1000)
  const body = `${HEADER}.${encodeJson({
    iss: PASS_ISSUER, aud: PASS_AUDIENCE, sub: uid, rid: requestId, q: quantities,
    held: held === true, miss: missing, iat, exp: iat + PASS_TTL_S
  })}`
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body))
  return `${body}.${base64url(new Uint8Array(signature))}`
}

// Returns the claims of a pass this secret signed that has not expired;
// throws GatePassError otherwise. crypto.subtle.verify compares in constant
// time.
export async function verifyGatePass(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) throw new GatePassError('missing')
  const parts = token.split('.')
  if (parts.length !== 3) throw new GatePassError('malformed')
  const [header, payload, signature] = parts
  // only the one header this file signs with: no alg to choose
  if (header !== HEADER) throw new GatePassError('unexpected header')
  const valid = await crypto.subtle.verify(
    'HMAC', await hmacKey(secret), fromBase64url(signature), encoder.encode(`${header}.${payload}`)
  )
  if (!valid) throw new GatePassError('bad signature')

  let claims
  try {
    claims = JSON.parse(decoder.decode(fromBase64url(payload)))
  } catch {
    throw new GatePassError('malformed')
  }
  const seconds = now / 1000
  if (claims?.iss !== PASS_ISSUER || claims.aud !== PASS_AUDIENCE) throw new GatePassError('wrong issuer')
  if (!Number.isInteger(claims.exp) || claims.exp <= seconds) throw new GatePassError('expired')
  if (!Number.isInteger(claims.iat) || claims.iat > seconds + SKEW_S) throw new GatePassError('issued in the future')
  return claims
}

// The same quantities, whatever order the keys are in
export function sameQuantities(a, b) {
  const left = Object.entries(a || {})
  return left.length === Object.keys(b || {}).length &&
    left.every(([id, n]) => Object.hasOwn(b, id) && Number(b[id]) === Number(n))
}
