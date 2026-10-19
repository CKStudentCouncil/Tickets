# CK Tickets on Cloudflare

The Cloudflare version of the ticket site: the same Vue pages, now served by one Cloudflare Worker with the data in D1. It replaces the Quasar build, Firebase Auth, Firestore, Cloud Functions and Firebase Storage in the repository root. See [DEPLOY.md](DEPLOY.md) to deploy it.

| Part | Where |
|---|---|
| Worker entry: API, R2 images, mail queue consumer, cron | `src/worker/index.ts` |
| API (Hono, typed for the RPC client) | `src/server/app.ts`, `src/server/routes/` |
| Checkout (one D1 batch, CHECK constraints against overselling) | `src/server/checkout.ts` |
| Sign-in (Better Auth, Google) and staff roles | `src/server/auth.ts`, `src/server/context.ts` |
| Mail (SES through `aws4fetch`, queue consumer, cron sweep) | `src/server/mail/`, email templates in `src/server/templates/` |
| Pure rules shared with the tests | `src/server/domain/` |
| Database tables | `migrations/` |
| The site (Astro page mounting the Vue app) | `src/pages/index.astro`, `src/client/` |
| RPC client and the services the pages call | `src/client/api.ts`, `src/client/services/` |

## Develop

Node 22 and Yarn 1, as in the rest of the repository.

```bash
cd app
yarn install
cp .dev.vars.example .dev.vars       # local secrets for wrangler dev
npx wrangler d1 migrations apply DB --local
node scripts/dev-seed.mjs            # ticket types, an open shop, a buyer and a super admin
yarn dev                             # astro build && wrangler dev → http://localhost:8787
```

Google sign-in needs a real OAuth client in `.dev.vars` (redirect URI `http://localhost:8787/api/auth/callback/google`). Without one, use the seeded accounts: `test/e2e/.cookies.json` holds their session cookies (`better-auth.session_token`).

`yarn dev` serves the last `astro build`; after changing pages run `yarn build` again (the Worker code reloads by itself). For the Turnstile widget on localhost, build with Cloudflare's always-passing test key: `PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA yarn build`.

## Test

```bash
yarn typecheck
yarn test            # unit tests (Node) and API tests in workerd with local D1, R2 and Queues
```

With `yarn dev` running and the seed loaded, two more checks:

```bash
node test/e2e/smoke.mjs                                       # browser run: browse, buy, list, check in (Playwright)
node scripts/load-test.mjs --target local --buyers 300 --stock 100   # concurrent checkouts; must never oversell
node scripts/load-test.mjs --cleanup --target local
```

Local latency numbers mean little (`wrangler dev` handles one request at a time); measure on staging (DEPLOY.md step 8).

## Notes

- The API keeps the Firestore field names (camelCase, ISO dates) and the callables' error codes (`functions/<code>` on the client), so the pages and `src/client/utils/checkoutRecovery.js` work as before.
- Values shared by the client and the server (site URL, schools, opening time, ticket identities) are checked against each other by `test/unit/consistency.test.js`.
- The pages in `src/client/pages/` were copied from `src/pages/` at commit `8ccb050` on `main`. Port later UI changes from `main` with `git diff 8ccb050 origin/main -- src/` and update that commit here.
