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
│   ├── orders.js                # checkout, stock release and confirmation enqueue
│   ├── orderActions.js          # atomic collection/payment updates and audit history
│   ├── mailQueue.js             # message rendering and scheduled shared worker
│   ├── mailQueueCore.js         # durable claims, rate reservation and outcomes
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
| `updateOrderDelivery` | callable | manager+ | Atomically collects an uncollected order after checking the scanned QR code and expected state. Admins can override QR verification or reset collection with a recorded reason. Records trusted actor UID/name and appends `orders/{id}/history/{eventId}` |
| `updateOrderPayment` | callable | admin+ | Atomically changes payment state with an expected-state check and trusted audit metadata |
| `sendOrderQRCode` | `orders/{id}` created | — | Enqueues one deterministic confirmation job; the QR links to `/admin/orders/{id}?c={ticketCode}` |
| `resendOrderEmail` | callable | admin+ | Enqueues a deliberate resend. Reuse `requestId` when retrying the same staff action |
| `processMailQueue` | scheduled every minute | — | Shares one leased, paced worker across confirmations, resends and notification batches |
| `prepareOrderNotification` | callable | manager+ | Validates a payment / pickup / custom notice and saves its recipients (buyers, optionally of one school) as `notificationJobs/{jobId}` without sending; returns the jobId and recipient count |
| `sendOrderNotification` | callable | manager+ | Enqueues deterministic BCC batches for a prepared job. Repeating the same job ID resumes interrupted enqueue without resetting batches |
| `getOrderNotificationStatus` | callable | manager+ | Returns queued, accepted, failed and uncertain progress; the frontend polls this separately from enqueue |
| `uploadLineupImage` | callable | super admin | Resizes an image to WebP and stores it under `lineup/` |
| `deleteLineupImage` | callable | super admin | Deletes an image under `lineup/` |

Avoid saving the ticket types on the management page during a sale opening: every checkout reads `settings/ticketTypes` in its transaction, so a save then makes them wait.

Stock is counted in 20 shard documents per ticket type, `ticketSales/{ticketTypeId}/shards/{0-19}`, so simultaneous checkouts do not all lock one counter. Each shard may sell up to its cap, stored in `ticketSales/{ticketTypeId}.shardCaps` together with the stock it was planned for. The caps add up to the stock and none is below what its shard has already sold, so lowering the stock or limiting a type that sold unlimited never oversells. When the stock changes (a save on the management page, or a deleted order placed before the shards), `planStockShards` plans the caps again from what each shard has sold; a checkout that finds them out of date does the same itself, locking every shard. Before its transaction an order reads the shards and caps without locking them, turns the buyer away if the type is sold out, and otherwise locks one random shard that still has room, looking again if it filled up meanwhile (after a few tries it locks every shard with room). Each order records its shards in `stockShards`. `ticketSales/{ticketTypeId}.sold` only holds the legacy count of orders placed before the shards, which still counts against the stock. Per-person limits are tracked in `buyerPurchases/{sha256(email)}`. These collections, and `orderRequests/{requestId}`, `rateLimits/*`, `stockReleases/{orderId}` and `notificationJobs/{jobId}`, are only written by the functions (the Firestore rules deny clients).

Deleting a sharded order invalidates its type's stored caps in the same release transaction. The next checkout recalculates them under locks, so lowering stock below existing sales cannot create room for new sales merely by deleting an order.

`SHARD_COUNT` (`lib/orderValidation.js`) may be raised but never lowered once tickets have been sold, even between sales: the dropped shards keep their sales but are no longer read, so those tickets would be sold again.

Deploying the shards (PARTY-28) or rolling them back: do it when no sale is open. Until every instance runs the new code, old instances count only the legacy counter and new ones only the shards, so neither sees the other's sales. After deploying, save the ticket types once on the management page so `planStockShards` plans the caps before the sale opens. Do not roll back to a version without the shards once orders have `stockShards`: its `releaseOrderStock` would refund them to the legacy counter.

## Settings (`functions/.env`)

| Name | Default | Meaning |
|---|---|---|
| `ENFORCE_APP_CHECK` | `false` | Reject `createOrder` calls without a valid App Check token. Turn on only after App Check is set up (see the root README) |
| `CREATE_ORDER_MIN_INSTANCES` | `0` | Warm `createOrder` instances; set 2-3 around the sale opening, back to 0 afterwards |
| `ORDER_LIMIT_PER_ACCOUNT` | `0` | Max orders per signed-in account per 10 minutes (0 = off). Per account because the client IP header can be forged by the caller |
| `SES_RECIPIENTS_PER_SECOND` | `14` | Your SES account's sending rate, shared across every email source; BCC batches count the council To recipient too |

Change a value and redeploy the functions.

## Secrets

Email is sent through AWS SES. Set these as Secret Manager secrets:

```bash
firebase functions:secrets:set AWS_ACCESS_KEY_ID
firebase functions:secrets:set AWS_SECRET_ACCESS_KEY
firebase functions:secrets:set AWS_REGION
```

The sender is `no-reply@tickets.cksc.tw`, which must be allowed by the SES IAM policy.

## Order actions and checkout recovery

Clients cannot directly update orders or write their audit history. Collection and payment use callables that read the staff role and order in the same transaction. A stale second scan returns `already-exists` without replacing the first collector. Managers need a valid ticket QR; only admins can reset collection or override QR verification, with a reason of 1–500 characters. Payment requires an admin.

The browser persists the pending checkout payload and request ID per account before sending. Automatic retries, manual retries and reloads reuse that ID. A successful request is resolved before checking current shop/sale/rate limits. Definitive logical failures persist an owned rejection marker, fencing a late in-flight request, and return `checkoutRejected: true` so the browser can safely clear an uncertain checkout. Do not delete these markers while buyers may still replay a checkout.

## Queued email outcomes

`mailQueue/{id}` stores each confirmation/resend or notification batch, and `mailQueueControl/global` stores the worker lease and next allowed send time. Both are backend-only. Prepared campaign recipients live in bounded `notificationJobs/{id}/batches/{offset}` documents rather than a growing parent array. The scheduled worker starts each minute, with a 100-second processing budget and a 180-second shared lease, so new mail may wait approximately a minute before processing, plus any backlog. Closing the admin page does not stop delivery.

- `queued` / `pending` / `retry`: waiting for the worker. Explicit SES client rejections (HTTP 4xx except 408) retry with exponential backoff, up to five attempts; generic server errors remain uncertain.
- `accepted`: SES returned a provider message ID. This does **not** prove inbox delivery; the queue records `deliveryStatus: unconfirmed`. Legacy `sent` has the same acceptance interpretation.
- `uncertain`: a timeout, lost response, interrupted send, or failed acceptance checkpoint. Automatic sends stop for this batch. Review SES using the recorded message ID where available before deliberately resending; a resend may duplicate mail already accepted.
- `failed` / `skipped`: retry exhausted, invalid message, or deleted order/missing email.

The SES SDK also disables its own automatic retry. Queue leases and deterministic IDs prevent ordinary concurrent duplicate sends; SES and Firestore do not provide a shared transaction, so exactly-once delivery is not guaranteed.

## Releasing these changes

Deploy the indexes and wait until they are ready, deploy the functions (including `processMailQueue`), then release the frontend and tightened rules during a maintenance window. Older frontends write order status directly and will fail once the new rules are active. Ensure Cloud Scheduler and Pub/Sub are enabled for the scheduled worker and verify its first invocation before reopening sales. Pause older in-flight notification sends before moving to the queue; legacy interrupted sends require manual outcome review.

```bash
firebase deploy --only firestore:indexes
firebase deploy --only functions
firebase deploy --only firestore:rules
```

The frontend continues to publish through the existing GitHub Pages workflow. Checkout/rules/mail queue emulator tests use the demo project and injected email transport; they do not send real mail.

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
