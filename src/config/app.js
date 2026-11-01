// Production site; QR codes point here (keep in sync with functions/lib/constants.js)
export const SITE_URL = 'https://tickets.cksc.tw'

// reCAPTCHA Enterprise site key for Firebase App Check (PARTY-15). Empty =
// App Check off. After filling it in and deploying the site, set
// ENFORCE_APP_CHECK=true in functions/.env and redeploy the functions.
export const APP_CHECK_SITE_KEY = '6LcPrdEtAAAAALTnztzn22Xswpru02nuB9HoySEl'

// Cloudflare Turnstile sitekey for the checkout check on the product page.
// Empty = no widget. After filling it in and deploying the site, set the
// TURNSTILE_SECRET secret and ENFORCE_TURNSTILE=true in functions/.env and
// redeploy the functions (see functions/README.md).
export const TURNSTILE_SITE_KEY = '0x4AAAAAAFWXF__M6iNt9Yf9'

// Before the shop opens visitors (except staff) are redirected to /comingsoon
// and createOrder refuses orders. Super admins set the opening time on the
// management page (settings/shop); this is only the default used until they
// do. Keep in sync with functions/lib/constants.js
export const SHOP_OPEN_AT = new Date('2026-11-05T12:00:00+08:00')

// Party date and venue shown on the home page and receipts.
export const EVENT_DATE = '2026/12/13'
export const EVENT_DATE_LONG = '2026 年 12 月 13 日'
export const EVENT_VENUE = '建中明道樓後停車場'

// Typed by a super admin to confirm 清除所有訂單 on /admin; purgeOrders
// checks it too. Keep in sync with functions/lib/orderPurge.js
export const PURGE_CONFIRM_PHRASE = 'DELETE ALL ORDERS'
