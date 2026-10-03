# CK Party Night Tickets

CK Tickets is the official Quasar/Vue 3 ticketing site for CK Party Night, run by the Taipei Municipal Chien Kuo High School Student Council.

Everyone signs in with Google on `/login` to buy tickets, and sees their orders again by signing in with the same account on any device. Invited staff (managers, admins and super admins) use the same login to check tickets in, manage orders, send notifications and edit site content.

## Highlights

- Ticket types (price, sale window, eligibility, stock, per-person limit) configured in the admin UI
- Server-side order validation in a Cloud Function transaction, so tickets cannot be oversold
- Confirmation email with a QR code that door staff scan into the admin order view
- Role-based administration for managers, admins, and super admins
- Bulk payment / pickup notification emails through AWS SES
- Party introduction, lineup pages and a user survey managed from the admin UI
- Launch gate that redirects visitors to `/comingsoon` before the sale opens

## Tech Stack

- Vue 3, Quasar 2, Vue Router, Pinia
- Firebase Authentication, Cloud Firestore, Cloud Storage, Cloud Functions, Hosting, Analytics
- AWS SES for email delivery
- exceljs, file-saver, html2pdf.js, qrcode

## Project Structure

```text
src/
├── pages/          # Route-level screens
├── layouts/        # MainLayout (header, navigation, footer)
├── components/     # AppToast, CountdownText
├── composables/    # useAdminOrders (admin order list, stats, Excel export), useNow
├── services/       # orderService, ticketTypeService, shopService, contentService (Firestore / callable access)
├── stores/         # auth (user + role), shop (opening time), toast
├── data/           # schools, survey questions, ticket eligibility
├── utils/          # datetime, text, qrcode, pdf, analytics, redirect, debounce
├── config/         # site URL, App Check key, default opening time, party date and venue
└── router/         # routes and navigation guard

functions/          # Cloud Functions, see functions/README.md
firestore.rules     # Firestore security rules
public/             # Static assets (logo, GitHub Pages 404 redirect)
```

## Requirements

- Node.js 22 or 24
- Yarn 1.x (`corepack enable`)
- Firebase CLI for Firebase deployment
<!--
## Local Development

### 1. Install Dependencies

```bash
yarn install
```

### 2. Start the Development Server

```bash
yarn dev
```

This launches the Quasar/Vite development server.

## Production Build

Create a production build with:

```bash
yarn build
```
-->
## Local Development With Docker

The Docker image runs the Quasar **dev server** for local development only; production is the static build in `dist/spa` served by Firebase Hosting / GitHub Pages.

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
docker compose up --build
```

Open http://localhost:9000. The source folder is mounted into the container, so edits hot-reload. Stop with `Ctrl+C`; after changing dependencies, rebuild with `docker compose up --build -V` (`-V` recreates the container's `node_modules`).

## Production Build

Create a production build with:

```bash
docker compose run --rm app yarn build
```

The output lands in your local folder:

```text
dist/spa
```


## Tests

```bash
cd functions && yarn test             # order validation, time handling, SES mailer (no emulator needed)
yarn test:rules                        # Firestore rules, needs Java for the emulator
cd functions && yarn test:emulator    # createOrder transaction / oversell test, needs Java
cd functions && yarn test:load        # load test: hundreds of simultaneous checkouts, needs Java
```

## Firebase Configuration

The application is configured to use Firebase through:

```text
src/boot/firebase.js
```

If you are using a different Firebase project, update the Firebase configuration and make sure the correct project alias is configured in:

```text
.firebaserc
```

Example:

```json
{
  "projects": {
    "default": "cksc-ticket"
  }
}
```

Before running Firebase commands, authenticate and select the appropriate project:

```bash
firebase login
firebase use <your-project>
```

## Cloud Functions & Email

See [functions/README.md](functions/README.md) for the function list and the AWS SES secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) they need. Ordering does not work without the functions deployed.

## Ticket Eligibility and Purchase Limits

All checks run on the server (`functions/lib/orderValidation.js`). `createOrder` only accepts signed-in callers with a verified email, and the order email is always the account's email (the form has no email field).

- **本校學生 (campus-only) tickets** need a Google account on `@gl.ck.tp.edu.tw` (`SCHOOL_ACCOUNT_DOMAIN`) **and** the school 建國中學 (`HOME_SCHOOL`). Any other account, and students of the partner schools, teachers and parents, are refused.
- **Per-person limits** are counted per account email (`buyerPurchases/{sha256(email)}`). For 本校學生 tickets that is one school account per student; for other tickets a buyer with a second Google account can still buy again.

Staff still check student IDs at pickup and at the door. The sales policy (`SalesPolicyPage.vue`, 第二條第二、六、七款 and 第四條第五、六款) says so, and buyers must tick 同意條款 before ordering.

Buyers read their orders straight from Firestore: `orders/{id}.userId` is the buyer's uid, and the rules allow a signed-in user to read only orders with their own `userId` (lists must filter on it).

## Bot Protection (App Check)

`createOrder` can be called by scripts. To make the functions accept only requests from this site:

1. Firebase console → App Check → register the web app with **reCAPTCHA Enterprise** and copy the site key. The key's allowed domains must include `tickets.cksc.tw`.
2. Put the key in `APP_CHECK_SITE_KEY` in `src/config/app.js` and deploy the site.
3. Watch App Check metrics for a day, then set `ENFORCE_APP_CHECK=true` in `functions/.env` and redeploy the functions.
4. Optionally enforce App Check for Cloud Firestore as well (Firebase console → App Check → APIs). Anyone can submit the survey without signing in, so this is what stops scripts from flooding `surveyResponses`.

reCAPTCHA does not work on `localhost`, so `quasar dev` uses the App Check debug provider instead (`src/boot/firebase.js`). Until its debug token is registered, every Firebase call fails, Google sign-in included, with `AppCheck: Fetch server returned an HTTP error status. HTTP status: 403 (appCheck/fetch-status-error)`.

- Either register the token the browser console prints (`App Check debug token: …`) in Firebase console → App Check → Apps → ⋮ → Manage debug tokens. Each browser profile, and each origin (`localhost` vs `127.0.0.1`, Docker), makes up its own.
- Or add one token there once (e.g. a UUID from `uuidgen`) and start the dev server with it: `APP_CHECK_DEBUG_TOKEN=<token> yarn dev`, or `APP_CHECK_DEBUG_TOKEN=<token> docker compose up`. Production builds never include it.

A debug token lets any request pass App Check, so keep it out of the repository.

## Staff Accounts

The first super admin must be created by hand: in the Firebase console add `users/{uid}` with `role: "super_admin"`, using the uid shown under Authentication.

A super admin invites staff on `/admin/account` (stored as `pendingUsers/{email}`). The invited person then signs in with Google on `/login` using that email, which activates the account with the invited role. (`/admin/login` still redirects to `/login`.) Anyone else who signs in is a buyer and has no `users` document.

## Deployment

### GitHub Pages

The frontend is published through:

```text
.github/workflows/deploy.yml
```

The workflow installs dependencies, builds the Quasar application, and publishes the generated files from:

```text
dist/spa
```

### Firebase

The frontend is hosted on GitHub Pages; deploy only the rules and functions:

```bash
firebase deploy -P cksc-ticket --only firestore:rules,functions
```

## Main Routes

| Route | Description |
|---|---|
| `/` | Storefront home |
| `/product/:id` | Ticket type detail and order form |
| `/order-success` | Order confirmation |
| `/login` | Google sign-in for buyers and staff |
| `/orders` | The signed-in buyer's orders |
| `/orders/:id` | Order detail (the buyer's own, or any for staff) |
| `/intro`, `/performer`, `/about` | Party introduction, lineup, about |
| `/survey` | User survey |
| `/admin` | Admin dashboard / notifications |
| `/admin/orders/:id` | Staff order view (ticket QR codes link here) |
| `/admin/management` | Ticket type settings |
| `/admin/account` | Staff accounts |
| `/comingsoon` | Pre-launch landing page |

## Application Notes

### Launch Gate

Super admins set the opening time on `/admin/management` (stored in `settings/shop`; 立即開賣 uses the server's clock). Until a time is saved, `SHOP_OPEN_AT` in `src/config/app.js` (and its copy in `functions/lib/constants.js`) is the default.

Before the opening time:

- visitors are sent to `/comingsoon` (`src/router/index.js`, routes with `meta.shop`), which takes them back to the page they asked for once the shop opens;
- visitors already in the shop are sent back if the opening time turns out to be later (`src/layouts/MainLayout.vue`);
- `createOrder` refuses orders.

Staff accounts bypass all three.

## Maintainers

This project is maintained by the **Taipei Municipal Chien Kuo High School Student Council**.

## Developers

### Chris Sun

- 79-2 Student Council Student Assembly Deputy Speaker
- 80-1 Student Council Chairman (President)
- 80-2 Student Council Speaker

### Jim Tang

- 80-1 Student Council Executive Department CIO
- 80-2 Student Council Executive Department IT Associate


### Dong Chen
- 80-2 Student Council Executive Department IT Associate
- 81-1 Student Council Executive Department CIO
---

**CK Party Night Tickets**  
Taipei Municipal Chien Kuo High School Student Council
