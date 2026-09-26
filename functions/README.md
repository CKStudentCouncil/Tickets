# Cloud Functions

Backend for the CK Party Night ticket system (Firebase Functions v1 API, Node 20, region `asia-east1`).

## Layout

```text
functions/
├── index.js                     # entry point, re-exports every function
├── lib/
│   ├── common.js                # admin SDK, roles, schools, Taiwan-time helpers
│   ├── mailer.js                # AWS SES transporter and sender address
│   ├── orders.js                # createOrder, getOrders, sendOrderQRCode
│   ├── notifications.js         # sendOrderNotification
│   └── lineup.js                # uploadLineupImage, deleteLineupImage
└── templates/
    ├── shared.js                # escapeHtml, colours, fonts
    ├── orderConfirmation.js     # purchase confirmation email
    └── notification.js          # payment / pickup / custom notification email
```

## Functions

| Function | Trigger | Who | Purpose |
|---|---|---|---|
| `createOrder` | callable | anyone | Validates the order against `settings/ticketTypes` (price, sale window, eligibility, stock, per-person limit) in one transaction, assigns the order ID and returns `{ id, token }` |
| `getOrders` | callable | anyone with a token | Returns the orders whose `{ id, token }` pairs match (buyers have no account) |
| `sendOrderQRCode` | `orders/{id}` created | — | Emails the confirmation with a QR code linking to `/admin/orders/{id}` |
| `sendOrderNotification` | callable | manager+ | BCC mail-out to buyers (optionally one school) |
| `uploadLineupImage` | callable | super admin | Resizes an image to WebP and stores it under `lineup/` |
| `deleteLineupImage` | callable | super admin | Deletes an image under `lineup/` |

Stock and purchase limits are tracked in `ticketSales/{ticketTypeId}` and `buyerPurchases/{sha256(email)}`; order serial numbers in `orderCounters/{YYYYMMDD}`. These collections are only written by `createOrder`.

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
npm run serve    # functions emulator
npm run deploy   # firebase deploy --only functions
npm run logs
```
