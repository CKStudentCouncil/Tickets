// Production site; QR codes point here (keep in sync with src/server/domain/constants.js)
export const SITE_URL = 'https://tickets.cksc.tw'

// Cloudflare Turnstile sitekey for the checkout check on the product page.
// Empty = no widget. The Worker checks the token with the TURNSTILE_SECRET
// secret when ENFORCE_TURNSTILE is "true" (wrangler.jsonc, DEPLOY.md).
// PUBLIC_TURNSTILE_SITE_KEY overrides it at build time, e.g. Cloudflare's
// always-passing test key 1x00000000000000000000AA for local runs.
export const TURNSTILE_SITE_KEY = import.meta.env?.PUBLIC_TURNSTILE_SITE_KEY ?? '0x4AAAAAAFWXF__M6iNt9Yf9'

// Before the shop opens visitors (except staff) are redirected to /comingsoon
// and the checkout refuses orders. Super admins set the opening time on the
// management page; this is only the default used until they
// do. Keep in sync with src/server/domain/constants.js
export const SHOP_OPEN_AT = new Date('2026-11-05T12:00:00+08:00')

// Party date and venue shown on the home page and receipts.
export const EVENT_DATE = '2026/12/13'
export const EVENT_DATE_LONG = '2026 年 12 月 13 日'
export const EVENT_VENUE = '建中明道樓後停車場'
