# Deploying the Cloudflare version

This is the checklist for putting `app/` on Cloudflare: first staging, then production on `tickets.cksc.tw`. The Firebase site (`src/`, `functions/`, GitHub Pages) keeps running untouched until the DNS switch in step 8, and stays ready as the fallback.

Run every command from `app/` with `npx wrangler login` done (or `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set). Commands without `--env production` act on staging; add `--env production` for production.

## Staging before Google sign-in and SES are ready

Staging can go up before the Google OAuth client and the SES keys exist. Sign-in and email then fail, which is expected; everything else, including the load test, works. Follow steps 1–3, 5 and 8 below with these changes:

1. **Check the token first.** `curl -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify` must answer `"status":"active"`, and `npx wrangler whoami` must succeed. Before creating anything, list the account's Workers, D1 databases and R2 buckets to make sure no `cksc-tickets-staging*` names exist yet.
2. **Turnstile off on staging.** The `workers.dev` host is not on the Turnstile widget's hostname list, so set the top-level `ENFORCE_TURNSTILE` to `"false"` in `wrangler.jsonc` and build with Cloudflare's always-passing test key: `PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA yarn build`.
3. **Secrets.**
   - Generate `BETTER_AUTH_SECRET` into a shell variable and set it with `printf %s "$SECRET" | npx wrangler secret put BETTER_AUTH_SECRET`. Never write it to a file or print it. The load test signs its cookies with it.
   - Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `not-configured` until the real client exists.
   - Leave the AWS keys unset.
4. **Deploy twice.** After the first `npx wrangler deploy`, put the `https://cksc-tickets-staging.<subdomain>.workers.dev` address into the top-level `SITE_URL` and its host into `TURNSTILE_HOSTNAMES`, build again and deploy again.
5. **Smoke check.**
   - `/api/public/shop` and `/api/me` answer 200.
   - `/`, `/product/x` and `/admin` answer HTML (in a browser, `/admin` goes on to `/login`).
   - `npx wrangler tail` shows no errors.
6. **Load test** (step 8.4): 300 buyers / 100 tickets, then 1000 / 800, then `--cleanup`.
   - Record the outcome counts, p50/p95/p99, and the CPU time per request (`npx wrangler tail --format json`, or Metrics in the dashboard).
   - On the free plan, 1102 errors (CPU time exceeded) may appear. Report them as they are; they decide whether Workers Paid is needed.
7. **Commit** the staging `database_id`, address and `ENFORCE_TURNSTILE: "false"` to `main-xn72jn`. Record the staging address here.

Staging is up at https://cksc-tickets-staging.ckscitdivision.workers.dev (D1 `cksc-tickets-staging`, R2 `cksc-tickets-staging-media`, queue `cksc-tickets-staging-mail`).

Never touch production (`--env production`), DNS or the `main` branch while doing this.

## 1. Account

- Use one Cloudflare account for the site, the account that holds the `cksc.tw` zone, so the Worker can take `tickets.cksc.tw` as a custom domain.
- Subscribe to **Workers Paid** ($5/month). The free plan's 10 ms CPU per request is too tight for sign-in and rendering the QR code, and its daily request cap could be hit on the opening day.

## 2. Create the resources

```bash
# staging
npx wrangler d1 create cksc-tickets-staging --location apac
npx wrangler r2 bucket create cksc-tickets-staging-media
npx wrangler queues create cksc-tickets-staging-mail

# production
npx wrangler d1 create cksc-tickets --location apac
npx wrangler r2 bucket create cksc-tickets-media
npx wrangler queues create cksc-tickets-mail
```

Put each D1 `database_id` that `d1 create` prints into `wrangler.jsonc`, replacing the placeholder ids `00000000-…-000000000000` (staging) and `00000000-…-000000000001` (production). Commit that change.

The first `wrangler deploy` prints the staging address (`https://cksc-tickets-staging.<subdomain>.workers.dev`). Put that host into the staging `SITE_URL` and `TURNSTILE_HOSTNAMES` in `wrangler.jsonc`.

## 3. Database tables

```bash
npx wrangler d1 migrations apply DB --remote
npx wrangler d1 migrations apply DB --remote --env production
```

The deploy workflow runs this before every deploy, so later migrations apply themselves.

## 4. Google sign-in

In Google Cloud Console → APIs & Services → Credentials, create an **OAuth client ID** (Web application), or reuse the Firebase project's client, and add these redirect URIs:

- `https://<staging host>/api/auth/callback/google`
- `https://tickets.cksc.tw/api/auth/callback/google`
- `http://localhost:8787/api/auth/callback/google` (local `wrangler dev`, optional)

## 5. Secrets

Set the secrets for each environment (add `--env production` for production). Wrangler asks for the value, so it never appears in the shell history.

| Secret | Value |
|---|---|
| `BETTER_AUTH_SECRET` | a new random string, e.g. `openssl rand -base64 32`; a different one per environment |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from step 4 |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | the SES sending user (the same IAM user as the Firebase functions; its policy allows `ses:SendEmail` / `ses:SendRawEmail` from `*@tickets.cksc.tw`) |
| `TURNSTILE_SECRET` | the Turnstile widget's secret key |

```bash
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
# …and the rest
```

`AWS_REGION` is a variable in `wrangler.jsonc` (default `us-east-1`); change it there if SES runs in another region.

## 6. Turnstile, PostHog and the deploy workflow

- **Turnstile:** in the Cloudflare dashboard → Turnstile, add the staging host to the existing widget's hostnames (sitekey `0x4AAAAAAFWXF__M6iNt9Yf9`, set in `src/client/config/app.js`), or create a new widget and set its sitekey as the `PUBLIC_TURNSTILE_SITE_KEY` repository variable.
- **PostHog:** set the project API key as the `PUBLIC_POSTHOG_KEY` repository variable (GitHub → Settings → Secrets and variables → Actions → Variables). Without it, analytics stay off.
- **GitHub:** add the `CLOUDFLARE_API_TOKEN` (permission template "Edit Cloudflare Workers", plus D1 Edit) and `CLOUDFLARE_ACCOUNT_ID` repository secrets, and create the `staging` and `production` environments. Then Actions → **Cloudflare app** → Run workflow deploys the chosen environment after the tests pass.

Deploying by hand works too:

```bash
yarn deploy:staging        # astro build && wrangler deploy
yarn deploy:production
```

## 7. Data and the first super admin

Staff sign in with Google; a role comes only from an invite. To bring over the current ticket types, opening time, staff (as invites), intro stories and lineup images from Firebase, use a service account key of the `cksc-ticket` project (Firebase console → Project settings → Service accounts → Generate new private key) and run on your own machine:

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=~/cksc-ticket-sa.json node scripts/export-to-d1.mjs --out ../app/import
cd ../app
npx wrangler d1 execute DB --remote --env production --file import/import.sql
# then the `wrangler r2 object put` lines it printed, with <bucket> = cksc-tickets-media
```

Orders are not exported. Delete the key file afterwards.

Without the import (e.g. on staging), invite the first super admin directly:

```bash
npx wrangler d1 execute DB --remote --command \
  "INSERT INTO staff_invites (email, role, name, created_at) VALUES ('you@gl.ck.tp.edu.tw', 'super_admin', '你的名字', unixepoch() * 1000)"
```

They sign in once at `/login`; after that, invite everyone else from 帳號管理.

## 8. Checks on staging

1. **Sign-in:** sign in with a school account and another Google account; staff invites turn into roles.
2. **Checkout and mail:** buy a ticket. The confirmation email arrives with the QR code (SES sandbox: only to verified addresses).
3. **Door:** scan the QR on `/admin/scan`, then check the ticket in and mark it paid.
4. **Load:** set `ENFORCE_TURNSTILE` to `"false"` for staging in `wrangler.jsonc`, deploy, then run:
   ```bash
   BETTER_AUTH_SECRET=<staging secret> node scripts/load-test.mjs --target staging --base https://<staging host> --buyers 300 --stock 100
   BETTER_AUTH_SECRET=<staging secret> node scripts/load-test.mjs --target staging --base https://<staging host> --buyers 1000 --stock 800
   node scripts/load-test.mjs --cleanup --target staging
   ```
   Pass means no overselling, no 5xx and p95 under 1.5 s. Set `ENFORCE_TURNSTILE` back to `"true"` and deploy again.
5. **PostHog:** the `purchase` event shows up with the buyer's id, and no recordings exist for `/admin` pages.

## 9. Switching `tickets.cksc.tw`

1. Deploy production (step 6) and load the data (step 7).
2. In the Cloudflare dashboard → `cksc.tw` → DNS, delete the `tickets` record that points to GitHub Pages.
3. Deploy production again (`yarn deploy:production`). The `routes` entry with `custom_domain: true` makes Cloudflare create the `tickets` DNS record and its certificate.
4. Smoke test on `https://tickets.cksc.tw` with a staff account: buy, delete that order, check in, receive the email.
5. Turn off the Firebase site's ordering: in the old management page, set the opening time far in the future. Anyone still on a cached old page then cannot place orders in Firestore.

**Rolling back before sales open:** delete the Worker's custom domain (Workers → cksc-tickets → Settings → Domains & Routes), recreate the `tickets` CNAME to `ckstudentcouncil.github.io`, and reset the old opening time. Once sales have opened on Cloudflare, the two systems hold different orders, so fix forward instead.

## Operating

- Live logs: `npx wrangler tail --env production`.
- Mail that ended `uncertain` (SES may or may not have sent it) is never resent automatically. Check SES, then use 補寄確認信 on the order if needed.
- Database backups: D1 Time Travel restores any point in the last 30 days (`npx wrangler d1 time-travel restore DB --env production --timestamp …`).
