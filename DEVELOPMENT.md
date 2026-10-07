# Development Guide

This guide covers development of CK Party Night Tickets, the Quasar/Vue ticketing application in this repository. See [README.md](README.md) for the product overview and [functions/README.md](functions/README.md) for backend details.

## Prerequisites

- **Node.js 22** to match the Cloud Functions runtime, Docker image, and CI. The frontend also accepts Node.js 24, but the functions package declares Node.js 22.
- **Yarn Classic 1.x**. Both the repository root and `functions/` have their own `package.json` and `yarn.lock`.
- **Firebase CLI** for emulator tests and backend deployment.
- **Java 21** for the Firestore emulator, matching CI.
- **Docker and Docker Compose** if using the container-based frontend workflow.
- Access to a suitable Firebase project for browser testing and staff administration.

Check the tools needed for your workflow:

```bash
node --version
yarn --version
firebase --version
java -version
```

## Local setup

Run commands from the repository root unless a section states otherwise.

### Native frontend development

Install both dependency sets using the committed lockfiles:

```bash
yarn install --frozen-lockfile
yarn --cwd functions install --frozen-lockfile
```

Start the Quasar development server:

```bash
yarn dev
```

Open the URL printed by Quasar, normally `http://localhost:9000`. Source changes hot-reload. Stop the server with `Ctrl+C`.

### Docker frontend development

```bash
docker compose up --build
```

Open `http://localhost:9000`. Compose mounts the repository at `/app` and keeps the container's Linux frontend dependencies in a separate volume. After changing frontend dependencies, recreate that volume:

```bash
docker compose up --build -V
```

The image installs the root dependencies and runs the frontend dev server. Backend tests still need the `functions/` dependencies; emulator tests also need Firebase CLI and Java in the environment running them.

### Firebase connection and App Check

The frontend initializes Firebase in [src/boot/firebase.js](src/boot/firebase.js) and calls functions in `asia-east1`. It currently points to `cksc-ticket`. **Running the frontend locally still uses that project's live Firebase services.** There are no frontend emulator connection calls in the current boot file.

For isolated browser testing, configure a development Firebase project in `src/boot/firebase.js`, set the CLI project in `.firebaserc`, and configure its Google sign-in, App Check, rules, functions, and test data. Changing `.firebaserc` alone does not change the browser's Firebase project. Keep App Check's site key in [src/config/app.js](src/config/app.js) aligned with the selected web app.

Email and QR destinations use the hardcoded `SITE_URL`, independently of the Firebase project. To test those links against a development frontend, update it in both `src/config/app.js` and `functions/lib/constants.js`.

With the configured App Check key, `quasar dev` uses the debug provider. Register the token printed in the browser console under Firebase console → App Check → Apps → Manage debug tokens, then reload the page. Alternatively, register a fixed token and supply it when starting the server:

```bash
APP_CHECK_DEBUG_TOKEN=<registered-token> yarn dev
```

For Docker:

```bash
APP_CHECK_DEBUG_TOKEN=<registered-token> docker compose up --build
```

Treat debug tokens as credentials and keep them out of Git. [quasar.config.js](quasar.config.js) only exposes this variable in development builds. An unregistered token can cause `appCheck/fetch-status-error` with HTTP 403.

## Finding the right code

| Area | Location and responsibility |
| --- | --- |
| Screens and navigation | `src/pages/`, `src/layouts/MainLayout.vue`, `src/router/routes.js`, `src/router/index.js` |
| Reusable UI | `src/components/` |
| Shared frontend state | `src/stores/auth.js`, `src/stores/shop.js`, `src/stores/toast.js` |
| Firebase access helpers | `src/services/`: orders, ticket types, shop settings, and published content |
| Shared screen behavior | `src/composables/`, including admin order handling and reactive time |
| Styling | `src/css/app.scss` for global styles; page styles in `src/css/` imported by the corresponding Vue files |
| Site values and form options | `src/config/app.js`, `src/data/` |
| Frontend utilities | `src/utils/`: Taiwan dates, QR codes, PDFs, analytics, redirects, text, and debounce |
| Static frontend assets | `public/`, including the GitHub Pages fallback `404.html` |
| Backend entry point | `functions/index.js`, which re-exports functions implemented in `functions/lib/` |
| Backend emails and images | `functions/templates/` and `functions/templates/assets/` |
| Database access and indexes | `firestore.rules`, `firestore.indexes.json` |
| Build and deployment configuration | `quasar.config.js`, `firebase.json`, `.github/workflows/deploy.yml` |

The frontend uses Vue single-file components with the Composition API and `<script setup>`, Pinia stores, and JavaScript ES modules. Follow neighboring files' conventions. Keep reusable Firebase operations in services and reusable logic in composables or utilities. Backend modules use explicit `.js` import extensions.

The root `format` script invokes Prettier across the repository. Prettier is not declared in the current package manifests, so that command requires it to be available separately. If formatting, scope changes to the files you intend to edit.

## Application and data flow

### Sign-in and roles

Buyers and staff sign in with Google on `/login`. [src/stores/auth.js](src/stores/auth.js) loads the Firebase account and its optional `users/{uid}` staff profile. Ordinary buyers do not need a `users` document.

| Role | Main capabilities |
| --- | --- |
| Signed-in buyer | Purchase with a verified account email and read their own orders |
| `manager` | Open individual orders, mark delivery/check-in, access staff survey views, and prepare/send notifications |
| `admin` | Manager capabilities plus list all orders, change payment status, delete orders, and resend confirmation emails |
| `super_admin` | Admin capabilities plus manage ticket types, shop opening, staff accounts, stories, and lineup |

Route guards control navigation. Firestore rules and backend role checks enforce data access. When changing permissions, keep [src/router/index.js](src/router/index.js), `src/stores/auth.js`, [firestore.rules](firestore.rules), and [functions/lib/common.js](functions/lib/common.js) aligned.

For a new development project, bootstrap the first super admin by adding `users/{uid}` with `role: "super_admin"` in the Firebase console, using the account's Authentication UID. That account can invite staff on `/admin/account`. Invitations live at `pendingUsers/{lowercase-email}`; the invitee's first sign-in creates their staff document and consumes the invitation in one batch.

### Checkout

1. `ProductPage.vue` loads ticket settings and collects buyer details and consent.
2. `src/services/orderService.js` calls `createOrder` with the payload and a generated `requestId`. Its retry loop reuses that ID.
3. `functions/lib/orders.js` takes the UID and verified email from authentication, validates the shop opening and ticket configuration, and reserves stock and buyer allowance in a Firestore transaction.
4. The function saves the order and returns `{ id }`. A repeated request with the same ID returns the already-created order.
5. The order-created trigger sends the confirmation email and records its delivery status. The email's QR code opens `/admin/orders/{id}?c={ticketCode}`.

Keep price, eligibility, sale windows, stock limits, and purchase limits authoritative on the server. Changes to validation belong in [functions/lib/orderValidation.js](functions/lib/orderValidation.js) and its tests, with matching frontend feedback where needed. Preserve the same request ID when retrying an uncertain checkout result.

Campus-only tickets require both the school `建國中學` and an account at `@gl.ck.tp.edu.tw`. Per-person ticket allowance is counted by account email. Buyer order-list queries must filter on `userId`; Firestore rejects queries that could return another buyer's orders.

### Key Firestore records

| Record | Purpose |
| --- | --- |
| `settings/ticketTypes` | Ticket prices, stock, sale windows, eligibility, and purchase limits; shared by frontend and backend |
| `settings/shop` | Public `openAt` timestamp, written by super admins |
| `orders/{id}` | Buyer ownership, purchased items, payment/delivery state, ticket code, and email status |
| `users/{uid}`, `pendingUsers/{email}` | Active staff profiles and invitations |
| `partyStories`, `partyLineup` | Scheduled public content |
| `surveyResponses` | Public survey submissions, subject to rules validation |
| `ticketSales/{typeId}/shards/{shardId}` | Backend stock counters, with caps on the parent ticket-sales document |
| `buyerPurchases`, `orderRequests`, `rateLimits`, `stockReleases`, `notificationJobs` | Backend-only allowance, retry, rate-limit, stock-release, and email-job bookkeeping |

Create orders through `createOrder`; clients cannot create them directly. Order deletion triggers stock and allowance release. Client writes to backend bookkeeping collections are denied.

In ticket configuration, `unlimitedStock` controls total stock, while `unlimited` controls the per-person allowance. Keep those flags distinct when changing the management form or validation. A type with missing or zero stock sells nothing unless `unlimitedStock` is true.

Published stories require `enabled == true` and a `publishAt` timestamp at or before the query time. Published lineup queries also filter on `publishAt`. Use [src/services/contentService.js](src/services/contentService.js) so public queries match the rules. Legacy string publication dates need migration through the content administration flow.

Settings and published content are public data. Follow the existing use of `updatedByUid` rather than placing staff names or email addresses in those documents.

### Dates, shop opening, and shared values

Admin date inputs mean Taiwan time (`Asia/Taipei`, UTC+08:00), regardless of the developer's or user's device timezone. Use [src/utils/datetime.js](src/utils/datetime.js) and [functions/lib/time.js](functions/lib/time.js) for parsing and formatting. Shop opening and publication dates use Firestore timestamps; ticket sale datetime strings include the Taiwan offset.

Before shop opening, routes marked `meta.shop` redirect buyers to `/comingsoon`, the layout reacts to opening-time changes, and `createOrder` rejects checkout. Staff bypass the shop-opening gate. `settings/shop.openAt` overrides the built-in default.

Update both sides of these shared values together:

| Value | Files to keep aligned |
| --- | --- |
| Site URL and default shop opening | `src/config/app.js`, `functions/lib/constants.js` |
| School codes, school lists, home school, and school account domain | `src/data/schools.js`, `functions/lib/constants.js` |
| Ticket eligibility identifiers | `src/data/ticketTypes.js`, `functions/lib/constants.js` |
| Event date and venue | `src/config/app.js`, `EVENT_META` in `functions/templates/shared.js` |
| Taiwan datetime parsing | `src/utils/datetime.js`, `functions/lib/time.js` |
| Survey options and accepted values | `src/data/surveyQuestions.js`, `firestore.rules` |

[functions/test/unit/consistency.test.js](functions/test/unit/consistency.test.js) checks the frontend/backend constants and date parsing. Rules tests check survey options against the rules.

## Backend settings and email

The backend uses the Firebase Functions v1 API, Node.js 22, and region `asia-east1`.

`functions/.env` is intentionally tracked for non-secret deploy-time settings. Definitions and defaults are in [functions/lib/params.js](functions/lib/params.js):

| Setting | Default | Purpose |
| --- | --- | --- |
| `ENFORCE_APP_CHECK` | `false` | Require App Check for `createOrder` |
| `CREATE_ORDER_MIN_INSTANCES` | `0` | Keep checkout instances warm |
| `ORDER_LIMIT_PER_ACCOUNT` | `0` | Limit orders per account per ten minutes; zero disables the limit |
| `SES_RECIPIENTS_PER_SECOND` | `14` | Pace bulk notification recipients |

These are code defaults; the project's deployed values may differ. Changes require redeploying functions.

AWS SES email credentials use Secret Manager secrets named `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION`. Keep credentials out of `functions/.env`. The sender is configured in [functions/lib/mailer.js](functions/lib/mailer.js). See [functions/README.md](functions/README.md) for secret setup and function-specific details.

Bulk notifications have a prepare step that records recipients, followed by a send step with leasing and progress tracking. Use unit tests to verify mail changes without sending live email. For manual sends, use a development project and intended test recipients.

## Validation

Run the checks relevant to your change from the repository root:

| Command | Checks | Requirements |
| --- | --- | --- |
| `yarn test` | Backend unit tests, including validation, mailer behavior, notifications, and shared-value consistency | Root and functions dependencies; no emulator |
| `yarn test:rules` | Firestore permissions, ownership, role boundaries, and survey validation | Root dependencies, Firebase CLI, Java |
| `yarn --cwd functions test:emulator` | Checkout transactions, retries, stock release, and concurrent stock limits | Functions dependencies, Firebase CLI, Java |
| `yarn --cwd functions test:load` | Concurrent checkout load scenarios; each gets a fresh emulator | Functions dependencies, Firebase CLI, Java; run when changing stock/concurrency behavior |
| `yarn build` | Production frontend compilation into `dist/spa` | Root dependencies |

Rules, checkout emulator tests, and load scenarios use the `demo-cksc-ticket` project. The checkout tests wrap the backend functions and connect them to the Firestore emulator; they do not run the frontend or exercise real Google sign-in and SES. Run them through their scripts so the emulator environment is set correctly.

The GitHub Pages workflow runs unit, rules, and checkout emulator tests before building and publishing. Load tests are available locally and are not part of that workflow.

For frontend changes, also check the affected screens in the browser: mobile layout, keyboard navigation, loading/error states, sign-in redirects, and the appropriate buyer/staff role. For checkout UI changes, verify the opening gate, ticket eligibility, order confirmation, and buyer order detail using development data. For QR/PDF changes, inspect the generated output as well as the screen.

Stock changes need particular care: the backend currently uses 20 shards per ticket type. Do not lower `SHARD_COUNT` after sales exist. Every checkout transaction reads `settings/ticketTypes`, so saving that document during a sale opening adds contention. Read the stock migration and deployment notes in `functions/README.md` before changing that design or rolling back a sharded implementation.

## Build and deployment

Build the frontend natively:

```bash
yarn build
```

Or through the frontend container:

```bash
docker compose run --rm app yarn build
```

Both produce `dist/spa`. The Docker service is a development server; the production frontend is the static build.

The checked-in workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml) publishes that build to **GitHub Pages** when changes reach `main`, after tests pass. Vue Router uses history mode, and `public/404.html` provides the Pages fallback. If changing routing or hosting paths, verify direct navigation to nested routes.

**Firebase backend changes deploy separately.** Confirm the intended project and complete relevant tests before running deployment commands. The configured project is `cksc-ticket`; for a development project, substitute its ID explicitly:

```bash
firebase login
firebase deploy --project <project-id> --only firestore:rules,functions
```

`firebase.json` runs the functions unit tests as a predeploy check. If changing `firestore.indexes.json`, deploy indexes explicitly too:

```bash
firebase deploy --project <project-id> --only firestore:indexes
```

`firebase.json` also contains Firebase Hosting configuration for `dist/spa`, but the checked-in frontend publishing workflow uses GitHub Pages. Choose explicit deployment targets for the change being released.

## Troubleshooting

| Symptom | Checks |
| --- | --- |
| App Check HTTP 403 during local development | Register the browser's debug token in the selected Firebase project's App Check settings; reload or restart with a registered fixed token |
| Google sign-in fails | Check the selected web app, Google provider, authorized domain, popup handling, and App Check; embedded app browsers may need Safari or Chrome |
| Redirect to `/comingsoon` | Check `settings/shop.openAt` and the fallback `SHOP_OPEN_AT`; ordinary buyers are gated before opening |
| Empty ticket list | Check that `settings/ticketTypes` exists, contains valid types, and their sale windows have not ended |
| Checkout fails | Confirm verified sign-in, deployed `createOrder` in `asia-east1`, shop/ticket sale windows, eligibility, allowance, stock, and App Check; inspect the returned callable error |
| Firestore `permission-denied` | Check the current staff role, buyer `userId` filter, permitted update fields, and public-content query filters against `firestore.rules` |
| Missing-index error | Check `firestore.indexes.json` and deploy the required indexes to the selected project |
| Missing confirmation email | Check the order's `emailStatus`, function logs, and SES/Secret Manager setup; an admin can resend the confirmation |
| Emulator tests fail to start | Check Firebase CLI and Java, install both dependency sets, and run through the documented scripts |
| Container dependencies appear stale | Rebuild with `docker compose up --build -V` after updating the root manifest and lockfile |

For backend logs:

```bash
firebase functions:log --project <project-id>
```
