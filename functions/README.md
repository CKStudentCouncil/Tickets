# Cloud Functions

Backend for the CK Party Night ticket system (Firebase Functions v1 API, imported from `firebase-functions/v1`, Node 22, region `asia-east1`). `createOrder` alone is a 2nd gen function (`firebase-functions/v2/https`), so one instance serves many checkouts at once.

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
│   ├── mailSender.js            # sender address and mail secrets
│   ├── mailer.js                # AWS SES transporter (loaded only when sending)
│   ├── turnstile.js             # Cloudflare Turnstile siteverify check
│   ├── orders.js                # checkout, stock release and confirmation enqueue
│   ├── checkoutLog.js           # one structured log line per createOrder call (monitoring/)
│   ├── orderActions.js          # atomic collection/payment updates and audit history
│   ├── mailQueue.js             # message rendering and scheduled shared worker
│   ├── mailQueueCore.js         # durable claims, rate reservation and outcomes
│   ├── notifications.js         # prepareOrderNotification, sendOrderNotification
│   ├── sellers.js               # registerSellerTickets, releaseSellerStock (學弟登記賣票)
│   ├── streetSales.js           # registerStreetSale (路宣登記, paper tickets sold for cash)
│   ├── orderPurge.js            # purgeOrders (清除所有訂單)
│   ├── salesArchive.js          # salesArchives summaries and sale rows, importSalesArchive
│   ├── guests.js                # 公關票: officer quotas, invite links, direct sends
│   ├── survey.js                # submitSurvey (購票系統問卷)
│   ├── partySurvey.js           # submitPartySurvey (舞會滿意度調查)
│   ├── reimbursements.js        # submitReimbursement, trashReimbursementInvoices (報帳)
│   ├── drive.js                 # the council's Google Drive for 報帳 invoices (plain REST, no SDK)
│   └── lineup.js                # uploadLineupImage, deleteLineupImage
├── scripts/
│   └── driveAuth.js             # one-time Google Drive grant (yarn drive:auth)
└── templates/
    ├── shared.js                # escapeHtml, colours, fonts
    ├── orderConfirmation.js     # purchase confirmation email
    ├── guestInvitation.js       # 公關票 invitation email (sent instead of the confirmation)
    └── notification.js          # payment / pickup / custom notification email
```

## Functions

| Function | Trigger | Who | Purpose |
|---|---|---|---|
| `createOrder` | callable | signed-in users with a verified email | Checks the Turnstile token when `ENFORCE_TURNSTILE` is on. Refuses orders before the site's opening time (`settings/shop`, staff excepted). Validates the order against `settings/ticketTypes` (price, sale window, eligibility incl. the `@gl.ck.tp.edu.tw` account for 本校學生 tickets, stock, per-person limit) in one transaction, saves it with `userId` and the account email, assigns a random order ID (`CKS20261105K7Q2MX`) and returns `{ id }`. A retried call with the same `requestId` returns the same order |
| `releaseOrderStock` | `orders/{id}` deleted | — | Returns the order's tickets to stock and to the buyer's allowance (once, via `stockReleases/{id}`) |
| `planStockShards` | `settings/ticketTypes` written | — | Plans how many tickets each stock shard may sell (`shardCaps`, see below) for every ticket type whose stock changed |
| `updateOrderDelivery` | callable | manager+ | Atomically collects an uncollected order after checking the scanned QR code and expected state. Admins can override QR verification or reset collection with a recorded reason. Records trusted actor UID/name and appends `orders/{id}/history/{eventId}` |
| `updateOrderPayment` | callable | admin+ | Atomically changes payment state with an expected-state check and trusted audit metadata |
| `sendOrderQRCode` | `orders/{id}` created | — | Enqueues one deterministic confirmation job; the QR links to `/admin/orders/{id}?c={ticketCode}` |
| `resendOrderEmail` | callable | admin+ | Enqueues a deliberate resend. Reuse `requestId` when retrying the same staff action |
| `submitSurvey` | callable | anyone | Checks the Turnstile token (action `survey`) when `ENFORCE_TURNSTILE` is on, validates the answers against the survey page's options and writes `surveyResponses` |
| `submitPartySurvey` | callable | signed-in users | Checks the answers against that year's questions and the Turnstile token (action `party_survey`), then writes `partySurveys/{year}/responses` without the account |
| `processMailQueue` | scheduled every minute | — | Shares one leased, paced worker across confirmations, resends and notification batches |
| `prepareOrderNotification` | callable | manager+ | Validates a payment / pickup / custom notice and saves its recipients (buyers, optionally of one school; 公關票 guests only for pickup and custom notices) as `notificationJobs/{jobId}` without sending; returns the jobId and recipient count |
| `sendOrderNotification` | callable | manager+ | Enqueues deterministic BCC batches for a prepared job. Repeating the same job ID resumes interrupted enqueue without resetting batches |
| `getOrderNotificationStatus` | callable | manager+ | Returns queued, accepted, failed and uncertain progress; the frontend polls this separately from enqueue |
| `registerSellerTickets` | callable | signed-in accounts on `sellers/{email}` | 學弟登記賣票: takes 1–200 tickets of the type in `settings/sellerProgram` (while `enabled`) from its stock shards, locking every shard, and saves `sellerRegistrations/{requestId}`. Ignores the sale window and per-person limit, never the stock. A retried call with the same `requestId` returns the same registration |
| `registerStreetSale` | callable | admin+ | 路宣登記: sells 1–20 tickets of the type in `settings/streetSale` (while `enabled`; never a 本校學生 type), handed over as paper tickets for cash. Creates a paid, collected order with `streetSale: true` (id `ST…`, school `路宣`, no buyer details, `promoterEmail` / `promoterName` of the admin) and its payment and delivery history entries, locking every stock shard. Ignores the sale window and the per-person limit, never the stock. Nothing is emailed: the mail queue skips street sales. A retried call with the same `requestId` returns the same order (`streetSaleRequests/{requestId}`) |
| `releaseSellerStock` | `sellerRegistrations/{id}` deleted | — | Returns a deleted registration's tickets to stock and the shared total (once, via `sellerReleases/{id}`) |
| `purgeOrders` | callable | super admin | 清除所有訂單 for exactly the order ids of the browser's Excel backup, with the typed `confirm` phrase. Archives every order to `salesArchives/{year}/archivedOrders` and writes the yearly summary and sale rows before deleting any; then deletes each order with its archived copy, its `stockReleases` marker and its stock / allowance release in one transaction (planned under 450 writes). Writes `systemLogs/purge_{purgeId}`. Progress is in `orderPurges/{purgeId}` (ids in its `orderIds` subcollection); one run at a time, held by a lease; call again with the same `purgeId` to resume |
| `importSalesArchive` | callable | super admin | 匯入往年資料: stores an earlier year's sale rows (read in the browser from an Excel export, without names, phones, emails, classes or seats) as `salesArchives/{year}`. Replaces an earlier import, never a purged year; logs to `systemLogs` |
| `sendGuestInvitation` | callable | super admin | 公關票 outside any quota: creates an NT$0, paid order with `complimentary: true` (id `PR…`, school `公關票`, no officer) for a guest given by name and email. Takes no stock and releases none when deleted. `sendOrderQRCode` then queues it, and the mail worker sends the invitation template instead of the confirmation, on resends too. A retried call with the same `requestId` returns the same order (`invitationRequests/{requestId}`) |
| `sendOfficerTicket` | callable | signed-in accounts on `officers/{email}` | 公關票 from the officer's quota, by name and email: the same order with `officerEmail` / `officerName`, adding its tickets to the officer's `used` in one transaction. An email that already has a 公關票 is refused with `already-exists` and details `{ duplicate: true }` unless `allowDuplicate`. Retries with the same `requestId` return the same order |
| `createOfficerInvite` | callable | signed-in accounts on `officers/{email}`; super admins with `council: true` | Makes a one-time invite link `officerInvites/{id}` (random 24-character id) for 1–10 tickets, holding them from the officer's quota at once; a super admin's council link has no officer and takes no quota. An optional `note` (up to 100 characters) goes to `officerInviteNotes/{id}`, which only that officer and super admins read. Retries by the same caller with the same `requestId` return the same link |
| `revokeOfficerInvite` | callable | the link's officer, or a super admin (council links: super admins only) | Deletes an unclaimed link and its note and gives its tickets back to the quota; a claimed one cannot be revoked |
| `claimOfficerInvite` | callable | signed-in, verified accounts | Claims an open link: creates the order for the caller's name and account email (`userId` the caller, `inviteId` the link) and marks the link claimed. The same account claiming again gets the same order; links of an officer since removed no longer work |
| `releaseOfficerQuota` | `orders/{id}` deleted | — | Gives a deleted officer ticket's tickets back to that officer's quota (once, via `officerReleases/{orderId}`) |
| `submitReimbursement` | callable | admin+ | 報帳: checks the claim (name, whole NT$ 1–1,000,000, a 科目 from `REIMBURSEMENT_CATEGORIES`, optional note, the party year) and 1–5 invoices (JPEG, PNG, WEBP or PDF, each checked by its first bytes, 7 MB together). Uploads the invoices to the council's Google Drive (see below), then creates `reimbursements/{requestId}` as `pending` with each file's Drive id and link. A failed upload trashes what went up and saves nothing; a retried call with the same `requestId` returns the same claim. A grant that no longer works returns `failed-precondition` |
| `trashReimbursementInvoices` | `reimbursements/{id}` deleted | — | Moves a withdrawn or deleted claim's invoices to the Drive's trash, where they can be restored for 30 days |
| `uploadLineupImage` | callable | super admin | Resizes an image to WebP and stores it under `lineup/` |
| `deleteLineupImage` | callable | super admin | Deletes an image under `lineup/` |

Avoid saving the ticket types on the management page during a sale opening: every checkout reads `settings/ticketTypes` in its transaction, so a save then makes them wait.

Stock is counted in 50 shard documents per ticket type, `ticketSales/{ticketTypeId}/shards/{0-49}`, so simultaneous checkouts do not all lock one counter. Each shard may sell up to its cap, stored in `ticketSales/{ticketTypeId}.shardCaps` together with the stock it was planned for. The caps add up to the stock and none is below what its shard has already sold, so lowering the stock or limiting a type that sold unlimited never oversells. When the stock changes (a save on the management page, or a deleted order placed before the shards), `planStockShards` plans the caps again from what each shard has sold; a checkout that finds them out of date plans them first, in a transaction of its own (and its order transaction would still do it, locking every shard, if they went out of date meanwhile). Before its transaction an order reads the shards and caps without locking them, turns the buyer away if the type is sold out, and otherwise locks one random shard that still has room. If that shard filled up meanwhile or another checkout won the lock, it looks again and picks a fresh random shard: the first tries are one transaction attempt each after a short random wait, the later ones let Firestore retry, which waits longer but keeps the checkout's place in the lock queue. It never locks every shard with room, which would collide with every other checkout. Each order records its shards in `stockShards`. `ticketSales/{ticketTypeId}.sold` only holds the legacy count of orders placed before the shards, which still counts against the stock. Per-person limits are tracked in `buyerPurchases/{sha256(email)}`. These collections, and `orderRequests/{requestId}`, `rateLimits/*`, `stockReleases/{orderId}`, `notificationJobs/{jobId}`, `turnstilePasses/{requestId}`, `invitationRequests/{requestId}`, `officerInvites/{id}`, `officerInviteNotes/{id}`, `officerReleases/{orderId}`, `reimbursements/{id}` (created only here; super admins then change the status or the 科目) and `reimbursementFolders/{year}`, are only written by the functions (the Firestore rules deny clients).

`orderRequests.createdAt`, `buyerPurchases.updatedAt` and `turnstilePasses.expiresAt` are left out of the indexes (`fieldOverrides` in `firestore.indexes.json`): every checkout writes them with the current time, and Firestore caps a collection whose indexed field only ever grows at 500 writes a second, which a sale opening can pass. Nothing queries them; index them again (or shard them) before adding a query that does.

Deleting a sharded order invalidates its type's stored caps in the same release transaction. The next checkout recalculates them under locks, so lowering stock below existing sales cannot create room for new sales merely by deleting an order.

`SHARD_COUNT` (`lib/orderValidation.js`) may be raised but never lowered once tickets have been sold, even between sales: the dropped shards keep their sales but are no longer read, so those tickets would be sold again. Raise it only when no sale is open (instances on the old and new count would keep planning the caps over each other), then save the ticket types once on the management page so `planStockShards` plans the caps for the new count before the sale opens.

Every `createOrder` call writes one structured log line (`lib/checkoutLog.js`): its outcome, the code the buyer got, the stock gate's answer and how long each phase took. `monitoring/` turns these into log-based metrics, a Cloud Monitoring dashboard and alerts for watching a sale opening; see `monitoring/README.md`.

Moving `createOrder` to 2nd gen: Firebase cannot change a deployed function from 1st to 2nd gen in place, so delete the old one first, when no sale is open (checkouts fail until the deploy finishes): `firebase functions:delete createOrder --region asia-east1`, then `firebase deploy --only functions`. The site calls it by name, so the frontend needs no change.

### Stock gate (Redis, optional)

With `STOCK_GATE=true`, `createOrder` first takes the tickets from a count kept in Redis ([Upstash](https://upstash.com), through its REST API), in one atomic call, before it reads anything of the stock in Firestore. When far more buyers arrive than there are tickets, those the count turns away get 售完 at once, without each reading every shard and fighting over them; only about as many checkouts as there are tickets reach the shards. The code is [lib/stockGate.js](lib/stockGate.js).

- The shards stay the only count that decides a sale: the gate can turn buyers away, never sell. So that it does not turn them away while tickets remain, its count is kept above what the shards show is left (5%, at least 10).
- Each type's count is set from the shards by the first checkout that finds it missing, and dropped whenever tickets come back or the stock may have changed: an order or a 賣二 registration deleted (`releaseOrderStock`, `releaseSellerStock`) or the ticket types saved (`planStockShards`). Counts also expire after 60 seconds (`COUNT_TTL_S`) and are set again from the shards, so whatever a count drifted by lasts at most that long. A checkout that looked at the shards before a reset cannot set the count from that look (each reset bumps the type's `stockGate:gen:` generation). Those three triggers fail, and are retried, when the reset cannot reach Redis.
- A checkout's retries (same `requestId`) are let through again without taking more, for 15 minutes. A checkout that ends without an order for any reason but lack of stock gives its tickets back, "try again" included (its retry takes them anew); one turned away for lack of stock does not, so the extra numbers above what is left run out once the type is sold out.
- When the gate is off, not set up, cannot be reached or takes over 0.8 s, checkouts go on to the shards as without it. Turning it on or off needs no data change; save the ticket types afterwards to start from fresh counts.
- If the storefront says 售完 while the shards still have tickets (counts lost to checkouts that gave up), save the ticket types: the counts are set again from the shards.

Setting it up: create a Redis database on Upstash in the region closest to `asia-east1` (Tokyo, `ap-northeast-1`), then set its REST URL and token as the secrets below and `STOCK_GATE=true` in `functions/.env`, and deploy.

Deploying the shards (PARTY-28) or rolling them back: do it when no sale is open. Until every instance runs the new code, old instances count only the legacy counter and new ones only the shards, so neither sees the other's sales. After deploying, save the ticket types once on the management page so `planStockShards` plans the caps before the sale opens. Do not roll back to a version without the shards once orders have `stockShards`: its `releaseOrderStock` would refund them to the legacy counter.

## Settings (`functions/.env`)

| Name | Default | Meaning |
|---|---|---|
| `CREATE_ORDER_MIN_INSTANCES` | `0` | Warm `createOrder` instances, each serving up to 250 checkouts at once; set 5-10 around the sale opening, back to 0 afterwards |
| `ORDER_LIMIT_PER_ACCOUNT` | `0` | Max orders per signed-in account per 10 minutes (0 = off). Per account because the client IP header can be forged by the caller |
| `SES_RECIPIENTS_PER_SECOND` | `14` | Your SES account's sending rate, shared across every email source; BCC batches count the council To recipient too |
| `ENFORCE_TURNSTILE` | `false` | Reject `createOrder`, `submitSurvey` and `submitPartySurvey` calls without a Turnstile token that Cloudflare accepts. Turn on only after `TURNSTILE_SITE_KEY` is set and the `TURNSTILE_SECRET` secret exists (see the root README) |
| `TURNSTILE_HOSTNAMES` | `tickets.cksc.tw` | Comma-separated site hostnames whose tokens are accepted. Never add `localhost` |
| `STOCK_GATE` | `false` | Let `createOrder` turn buyers away by a ticket count in Redis before reading the stock (see Stock gate above). Needs the Upstash secrets |

Change a value and redeploy the functions.

## Secrets

Email is sent through AWS SES. Set these as Secret Manager secrets:

```bash
firebase functions:secrets:set AWS_ACCESS_KEY_ID
firebase functions:secrets:set AWS_SECRET_ACCESS_KEY
firebase functions:secrets:set AWS_REGION
```

The sender is `no-reply@tickets.cksc.tw`, which must be allowed by the SES IAM policy.

`createOrder`, `submitSurvey` and `submitPartySurvey` also need the Turnstile widget's secret key, even while `ENFORCE_TURNSTILE` is off (a deploy fails while it is missing):

```bash
firebase functions:secrets:set TURNSTILE_SECRET
```

`createOrder`, `releaseOrderStock`, `releaseSellerStock` and `planStockShards` need the Upstash database's REST URL and token for the stock gate, even while `STOCK_GATE` is off (a deploy fails while they are missing; any value that is not an `https://` URL, e.g. `none`, leaves the gate off):

```bash
firebase functions:secrets:set UPSTASH_REDIS_REST_URL
firebase functions:secrets:set UPSTASH_REDIS_REST_TOKEN
```

Turnstile tokens are single-use, but the site retries a busy checkout with the same token and `requestId` (see checkout recovery below). A passed check is therefore remembered in `turnstilePasses/{requestId}` for 10 minutes, so the retry is let through while the same token on another checkout is not.

`submitReimbursement` and `trashReimbursementInvoices` need the three Google Drive secrets below.

### Google Drive (報帳 invoices)

The two 報帳 functions act as `ckhssc@gl.ck.tp.edu.tw` through an OAuth grant limited to the `drive.file` scope: they see only the folders and files they made, nothing else in that Drive. Invoices go into `CK Party Night 報帳發票 {year}` in that account's My Drive, made with the year's first claim; its id is kept in `reimbursementFolders/{year}`. The folder may be moved or renamed in Drive. If it is deleted, the next claim starts a new one.

Set it up once, before the next functions deploy (which fails while any of the three secrets is missing):

1. In the Google Cloud console of `cksc-ticket`, enable the **Google Drive API**.
2. **OAuth consent screen**: user type *External* (the project is not in the `gl.ck.tp.edu.tw` organisation), any app name and support email, and the scope `.../auth/drive.file`. Then **publish the app** (In production): an app left in *Testing* gets refresh tokens that expire after 7 days. `drive.file` is not a sensitive scope, so publishing needs no review by Google.
3. **Credentials → Create OAuth client ID → Desktop app**, in the same project. Store its ID and secret:
   ```bash
   firebase functions:secrets:set DRIVE_CLIENT_ID -P cksc-ticket
   firebase functions:secrets:set DRIVE_CLIENT_SECRET -P cksc-ticket
   ```
4. Grant access as the council account, on your own computer:
   ```bash
   cd functions
   DRIVE_CLIENT_ID=$(firebase functions:secrets:access DRIVE_CLIENT_ID -P cksc-ticket) \
   DRIVE_CLIENT_SECRET=$(firebase functions:secrets:access DRIVE_CLIENT_SECRET -P cksc-ticket) \
   yarn drive:auth
   ```
   Open the printed link and sign in as `ckhssc@gl.ck.tp.edu.tw` (choose *Use another account* if the browser is signed in to another one), then allow access. The script refuses any other account. It writes the refresh token to a file only you can read and prints the command that stores it; run it with `-P cksc-ticket`, then delete the file:
   ```bash
   firebase functions:secrets:set DRIVE_REFRESH_TOKEN --data-file "<the printed path>" -P cksc-ticket
   rm "<the printed path>"
   ```
   If Google says the app is blocked, the `gl.ck.tp.edu.tw` Workspace admin must trust the OAuth client ID (Admin console → Security → API controls → App access control).
5. Deploy the two functions and the rules:
   ```bash
   firebase deploy -P cksc-ticket --only firestore:rules,functions:submitReimbursement,functions:trashReimbursementInvoices
   ```
6. After the first claim, share the folder with whoever reviews the claims. 報帳管理 links each invoice to Drive, and only accounts with access to the folder can open it.

Whoever made the OAuth client does not matter: the account that signs in at step 4 is the one the functions act as, and it owns the invoices. If that grant stops working (password reset, the app removed from the account), claims fail with 「雲端硬碟的授權失效了」; repeat step 4 and redeploy the two functions.

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
yarn drive:auth          # grant the 報帳 functions access to the council's Google Drive (see above)
yarn serve               # functions emulator
yarn deploy              # firebase deploy --only functions
yarn logs
```
