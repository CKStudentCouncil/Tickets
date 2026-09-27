// Production site; QR codes point here (keep in sync with functions/lib/constants.js)
export const SITE_URL = 'https://tickets.cksc.tw'

// reCAPTCHA Enterprise site key for Firebase App Check (PARTY-15). Empty =
// App Check off. After filling it in and deploying the site, set
// ENFORCE_APP_CHECK=true in functions/.env and redeploy the functions.
export const APP_CHECK_SITE_KEY = '6LcPrdEtAAAAALTnztzn22Xswpru02nuB9HoySEl'

// Before the shop opens visitors (except staff) are redirected to /comingsoon.
// Super admins set the opening time on the management page (settings/shop);
// this is only the default used until they do.
export const SHOP_OPEN_AT = new Date('2026-11-05T12:00:00+08:00')
