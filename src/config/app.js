// Production site; QR codes point here (keep in sync with functions/lib/constants.js)
export const SITE_URL = 'https://tickets.cksc.tw'

// Cloudflare Turnstile sitekey for the bot check on the product page
// (checkout) and both survey pages. Empty = no widget. After filling it in
// and deploying the site, set the TURNSTILE_SECRET secret and
// ENFORCE_TURNSTILE=true in functions/.env and redeploy the functions (see
// functions/README.md).
export const TURNSTILE_SITE_KEY = '0x4AAAAAAFWXF__M6iNt9Yf9'

// Stock gate Worker (/worker) the storefront asks before each checkout, e.g.
// 'https://cksc-gate.<account>.workers.dev'. Empty = createOrder is called
// directly. Fill it in together with GATE_PASS=true in functions/.env (see
// worker/README.md): createOrder then refuses checkouts without its pass.
export const GATE_WORKER_URL = ''

// Before the shop opens visitors (except staff) are redirected to /comingsoon
// and createOrder refuses orders. Super admins set the opening time on the
// management page (settings/shop); this is only the default used until they
// do. Keep in sync with functions/lib/constants.js
export const SHOP_OPEN_AT = new Date('2026-11-05T12:00:00+08:00')

// true = the shop counts as open without reading settings/shop, so the shop
// pages don't wait for Firestore before they show. Set it only once sales
// have started: createOrder still checks settings/shop on its own, so orders
// are refused until that opening time has passed. false = read
// settings/shop as above.
export const SHOP_ALWAYS_OPEN = true

// Party date and venue shown on the home page and receipts.
export const EVENT_DATE = '2026/12/13'
export const EVENT_DATE_LONG = '2026 年 12 月 13 日'
export const EVENT_VENUE = '建中明道樓後停車場'

// Typed by a super admin to confirm 清除所有訂單 on /admin; purgeOrders
// checks it too. Keep in sync with functions/lib/orderPurge.js
export const PURGE_CONFIRM_PHRASE = 'DELETE ALL ORDERS'
