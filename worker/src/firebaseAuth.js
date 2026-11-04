// Checks a Firebase Auth ID token in the Worker, as the Admin SDK would:
// RS256, signed by one of Google's securetoken keys, for this project, not
// expired, with a verified email (createOrder takes the order email from it).
// The keys are fetched once per isolate and kept for as long as Google's
// Cache-Control allows, so a check costs one RSA verify (about 0.1 ms of CPU).
// https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library

export const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'

const MAX_TOKEN_LENGTH = 8192
// Clock difference between Cloudflare and Google allowed on iat / auth_time
const SKEW_S = 60
// Keys kept when Google sends no max-age
const DEFAULT_KEYS_TTL_MS = 60 * 60 * 1000
// A token with a key id not in the cache refetches the keys at most this often
const REFETCH_MS = 60 * 1000

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message)
    this.status = status
  }
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

function fromBase64url(text) {
  if (!/^[\w-]*$/.test(text)) throw new AuthError('malformed token')
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

const decodeJson = (part) => {
  try {
    return JSON.parse(decoder.decode(fromBase64url(part)))
  } catch {
    throw new AuthError('malformed token')
  }
}

// { url, keys: Map(kid -> Promise<CryptoKey>), expiresAt, fetchedAt }
let cache = null
// The fetch under way: every request of a cold isolate waits on the same one
let loading = null

function maxAgeMs(response) {
  const match = /max-age=(\d+)/.exec(response.headers.get('cache-control') || '')
  return match ? Number(match[1]) * 1000 : DEFAULT_KEYS_TTL_MS
}

async function loadKeys(url, fetchImpl, now) {
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`JWKS HTTP ${response.status}`)
  const { keys = [] } = await response.json()
  const imported = new Map(
    keys
      .filter((jwk) => jwk.kid && jwk.kty === 'RSA')
      .map((jwk) => [jwk.kid, crypto.subtle.importKey(
        'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
      )])
  )
  cache = { url, keys: imported, expiresAt: now + maxAgeMs(response), fetchedAt: now }
}

async function keyFor(kid, { url, fetchImpl, now }) {
  const fresh = cache?.url === url && cache.expiresAt > now
  // Google rotates its keys: a key id not seen yet may be a new one
  if (!fresh || (!cache.keys.has(kid) && now - cache.fetchedAt > REFETCH_MS)) {
    loading ??= loadKeys(url, fetchImpl, now).finally(() => { loading = null })
    await loading
  }
  const key = cache.keys.get(kid)
  if (!key) throw new AuthError('unknown signing key')
  return key
}

// Resolves to { uid, email } or throws AuthError
export async function verifyFirebaseIdToken(token, {
  projectId, jwksUrl = GOOGLE_JWKS_URL, fetchImpl = fetch, now = Date.now()
}) {
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set')
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) throw new AuthError('missing token')
  const parts = token.split('.')
  if (parts.length !== 3) throw new AuthError('malformed token')
  const [headerPart, payloadPart, signaturePart] = parts
  const header = decodeJson(headerPart)
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AuthError('unexpected header')

  const key = await keyFor(header.kid, { url: jwksUrl, fetchImpl, now })
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', await key, fromBase64url(signaturePart), encoder.encode(`${headerPart}.${payloadPart}`)
  )
  if (!valid) throw new AuthError('bad signature')

  const claims = decodeJson(payloadPart)
  const seconds = now / 1000
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new AuthError('token for another project')
  }
  if (!(claims.exp > seconds)) throw new AuthError('token expired')
  if (!(claims.iat <= seconds + SKEW_S) || !(claims.auth_time <= seconds + SKEW_S)) {
    throw new AuthError('token issued in the future')
  }
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw new AuthError('no uid')
  if (!claims.email || claims.email_verified !== true) {
    throw new AuthError('此帳號的 Email 尚未驗證，請改用 Google 帳號登入', 403)
  }
  return { uid: claims.sub, email: String(claims.email).toLowerCase() }
}

// For the tests: forget the keys
export function resetKeyCache() {
  cache = null
  loading = null
}
