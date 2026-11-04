// Firebase-style ID tokens signed by a key made here, and a fetch that serves
// its JWKS, for the tests and the local benchmark: the Worker checks them
// exactly as it checks Google's.
const encoder = new TextEncoder()
const base64url = (bytes) => Buffer.from(bytes).toString('base64url')
const encodeJson = (value) => base64url(encoder.encode(JSON.stringify(value)))

export const PROJECT_ID = 'demo-cksc-ticket'
export const JWKS_URL = 'https://jwks.test/keys'

export async function createIssuer({ kid = 'test-key' } = {}) {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']
  )
  const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid, alg: 'RS256', use: 'sig' }
  let jwksFetches = 0

  return {
    get jwksFetches() { return jwksFetches },
    // Signs an ID token for `uid`; `claims` override the defaults
    async sign(uid, claims = {}, { now = Date.now(), header = {} } = {}) {
      const iat = Math.floor(now / 1000)
      const body = `${encodeJson({ alg: 'RS256', kid, typ: 'JWT', ...header })}.${encodeJson({
        iss: `https://securetoken.google.com/${PROJECT_ID}`, aud: PROJECT_ID, sub: uid,
        email: `${uid}@gmail.com`, email_verified: true, iat, auth_time: iat, exp: iat + 3600, ...claims
      })}`
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, encoder.encode(body))
      return `${body}.${base64url(new Uint8Array(signature))}`
    },
    // fetch that answers JWKS_URL itself and passes the rest on
    fetchWith(next = fetch) {
      return (url, init) => {
        if (String(url) === JWKS_URL) {
          jwksFetches++
          return Promise.resolve(new Response(JSON.stringify({ keys: [jwk] }), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
          }))
        }
        return next(url, init)
      }
    }
  }
}
