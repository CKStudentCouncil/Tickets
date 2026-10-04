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
| `planStockShards` | `settings/ticketTypes` written | — | Plans how many tickets each stock shard may sell (`shardCaps`, see below) for every ticket type whose stock changed |
| `sendOrderQRCode` | `orders/{id}` created | — | Emails the confirmation with a QR code linking to `/admin/orders/{id}?c={ticketCode}`; records `emailStatus` on the order and retries failures for an hour |
| `resendOrderEmail` | callable | admin+ | Resends the confirmation email (button in the admin order list) |
| `prepareOrderNotification` | callable | manager+ | Validates a payment / pickup / custom notice and saves its recipients (buyers, optionally of one school) as `notificationJobs/{jobId}` without sending; returns the jobId and recipient count |
| `sendOrderNotification` | callable | manager+ | Sends a prepared job as BCC batches paced by recipients per second. Progress is saved after every batch and the job is leased to one call at a time, so a retry or a second staff member resumes it instead of sending anyone the notice twice |
| `uploadLineupImage` | callable | super admin | Resizes an image to WebP and stores it under `lineup/` |
| `deleteLineupImage` | callable | super admin | Deletes an image under `lineup/` |

Avoid saving the ticket types on the management page during a sale opening: every checkout reads `settings/ticketTypes` in its transaction, so a save then makes them wait.

Stock is counted in 20 shard documents per ticket type, `ticketSales/{ticketTypeId}/shards/{0-19}`, so simultaneous checkouts do not all lock one counter. Each shard may sell up to its cap, stored in `ticketSales/{ticketTypeId}.shardCaps` together with the stock it was planned for. The caps add up to the stock and none is below what its shard has already sold, so lowering the stock or limiting a type that sold unlimited never oversells. When the stock changes (a save on the management page, or a deleted order placed before the shards), `planStockShards` plans the caps again from what each shard has sold; a checkout that finds them out of date does the same itself, locking every shard. Before its transaction an order reads the shards and caps without locking them, turns the buyer away if the type is sold out, and otherwise locks one random shard that still has room, looking again if it filled up meanwhile (after a few tries it locks every shard with room). Each order records its shards in `stockShards`. `ticketSales/{ticketTypeId}.sold` only holds the legacy count of orders placed before the shards, which still counts against the stock. Per-person limits are tracked in `buyerPurchases/{sha256(email)}`. These collections, and `orderRequests/{requestId}`, `rateLimits/*`, `stockReleases/{orderId}` and `notificationJobs/{jobId}`, are only written by the functions (the Firestore rules deny clients).

`SHARD_COUNT` (`lib/orderValidation.js`) may be raised but never lowered once tickets have been sold, even between sales: the dropped shards keep their sales but are no longer read, so those tickets would be sold again.

Deploying the shards (PARTY-28) or rolling them back: do it when no sale is open. Until every instance runs the new code, old instances count only the legacy counter and new ones only the shards, so neither sees the other's sales. After deploying, save the ticket types once on the management page so `planStockShards` plans the caps before the sale opens. Do not roll back to a version without the shards once orders have `stockShards`: its `releaseOrderStock` would refund them to the legacy counter.

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
yarn install
yarn test                # unit tests (also run before every functions deploy)
yarn test:emulator       # emulator tests, needs Java
yarn test:load           # many simultaneous checkouts on the emulator (not in CI)
yarn serve               # functions emulator
yarn deploy              # firebase deploy --only functions
yarn logs
```
