# Cloud Functions

Backend for the CK Party Night ticket system (Firebase Functions v1 API, imported from `firebase-functions/v1`, Node 22, region `asia-east1`).

## Layout

```text
functions/
├── index.js                     # entry point, re-exports every function
├── lib/
│   ├── common.js                # admin SDK init, assertRole
│   ├── params.js                # deploy-time settings (see Settings)
│   ├── constants.js             # region, SITE_URL, schools, roles
│   ├── time.js                  # Taiwan-time parsing
│   ├── orderValidation.js       # pure order checks (unit-tested)
│   ├── mailer.js                # AWS SES transporter and sender address
│   ├── orders.js                # createOrder, releaseOrderStock, sendOrderQRCode, resendOrderEmail
│   ├── notifications.js         # prepareOrderNotification, sendOrderNotification
│   └── lineup.js                # uploadLineupImage, deleteLineupImage
└── templates/
    ├── shared.js                # escapeHtml, colours, fonts
    ├── orderConfirmation.js     # purchase confirmation email
    └── notification.js          # payment / pickup / custom notification email
```

## Functions

| Function | Trigger | Who | Purpose |
|---|---|---|---|
| `createOrder` | callable | signed-in users with a verified email | Refuses orders before the site's opening time (`settings/shop`, staff excepted). Validates the order against `settings/ticketTypes` (price, sale window, eligibility incl. the `@gl.ck.tp.edu.tw` account for 本校學生 tickets, stock, per-person limit) in one transaction, saves it with `userId` and the account email, assigns a random order ID (`CKS20261105K7Q2MX`) and returns `{ id }`. A retried call with the same `requestId` returns the same order |
| `releaseOrderStock` | `orders/{id}` deleted | — | Returns the order's tickets to stock and to the buyer's allowance (once, via `stockReleases/{id}`) |
| `sendOrderQRCode` | `orders/{id}` created | — | Emails the confirmation with a QR code linking to `/admin/orders/{id}?c={ticketCode}`; records `emailStatus` on the order and retries failures for an hour |
| `resendOrderEmail` | callable | admin+ | Resends the confirmation email (button in the admin order list) |
| `prepareOrderNotification` | callable | manager+ | Validates a payment / pickup / custom notice and saves its recipients (buyers, optionally of one school) as `notificationJobs/{jobId}` without sending; returns the jobId and recipient count |
| `sendOrderNotification` | callable | manager+ | Sends a prepared job as BCC batches paced by recipients per second. Progress is saved after every batch and the job is leased to one call at a time, so a retry or a second staff member resumes it instead of sending anyone the notice twice |
| `uploadLineupImage` | callable | super admin | Resizes an image to WebP and stores it under `lineup/` |
| `deleteLineupImage` | callable | super admin | Deletes an image under `lineup/` |

Stock and purchase limits are tracked in `ticketSales/{ticketTypeId}` and `buyerPurchases/{sha256(email)}`. These collections, and `orderRequests/{requestId}`, `rateLimits/*`, `stockReleases/{orderId}` and `notificationJobs/{jobId}`, are only written by the functions (the Firestore rules deny clients).

## Settings (`functions/.env`)

| Name | Default | Meaning |
|---|---|---|
| `ENFORCE_APP_CHECK` | `false` | Reject `createOrder` calls without a valid App Check token. Turn on only after App Check is set up (see the root README) |
| `CREATE_ORDER_MIN_INSTANCES` | `0` | Warm `createOrder` instances; set 2-3 around the sale opening, back to 0 afterwards |
| `ORDER_LIMIT_PER_ACCOUNT` | `0` | Max orders per signed-in account per 10 minutes (0 = off). Per account because the client IP header can be forged by the caller |
| `SES_RECIPIENTS_PER_SECOND` | `14` | Your SES account's sending rate, used to pace notifications |

Change a value and redeploy the functions.

## Secrets

Email is sent through AWS SES. Set these as Secret Manager secrets:

```bash
firebase functions:secrets:set AWS_ACCESS_KEY_ID
firebase functions:secrets:set AWS_SECRET_ACCESS_KEY
firebase functions:secrets:set AWS_REGION
```

The sender is `no-reply@tickets.cksc.tw`, which must be allowed by the SES IAM policy.

## Commands

```bash
npm install
npm test                 # unit tests (also run before every functions deploy)
npm run test:emulator    # emulator tests, needs Java
npm run serve            # functions emulator
npm run deploy   # firebase deploy --only functions
npm run logs
```
