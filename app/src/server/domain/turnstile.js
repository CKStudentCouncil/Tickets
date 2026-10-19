// Cloudflare Turnstile check for checkouts. The browser solves the widget on
// the product page and sends its token with the checkout; the token is checked
// here against Cloudflare's siteverify, never in the browser.
import { ApiError } from '../errors'

export const CHECKOUT_ACTION = 'checkout' // data-action of the product page widget

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const SITEVERIFY_TIMEOUT_MS = 10_000
const MAX_TOKEN_LENGTH = 2048

const failedError = () => new ApiError('permission-denied', '人機驗證失敗，請重新驗證後再送出')

export function parseHostnames(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((hostname) => hostname.trim())
      .filter(Boolean)
  )
}

// Resolves when Cloudflare accepts the token for `action` on one of
// `hostnames`, otherwise throws. Returns false instead of throwing when the
// token was already redeemed, so a retried checkout can be let through (see
// createOrder). Fails closed when siteverify cannot be reached.
export async function verifyTurnstile({ token, action, hostnames, secret, remoteip, fetchImpl = fetch }) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw failedError()
  }
  if (!secret || hostnames.size === 0) {
    console.error('[turnstile] TURNSTILE_SECRET or TURNSTILE_HOSTNAMES is not set')
    throw new ApiError('failed-precondition', '人機驗證尚未設定完成，請聯絡班聯會')
  }

  let result
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
      body: new URLSearchParams({ secret, response: token, ...(remoteip ? { remoteip } : {}) })
    })
    if (!response.ok) throw new Error(`siteverify ${response.status}`)
    result = await response.json()
  } catch (error) {
    console.error('[turnstile] siteverify failed:', error)
    throw new ApiError('unavailable', '人機驗證暫時無法使用，請稍後再試')
  }

  if (result?.success === true && result.action === action && hostnames.has(result.hostname)) return true
  if (result?.success !== true && result?.['error-codes']?.includes('timeout-or-duplicate')) return false
  if (result?.['error-codes']?.includes('invalid-input-secret')) {
    console.error('[turnstile] siteverify rejected TURNSTILE_SECRET')
  }
  throw failedError()
}
