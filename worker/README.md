# Stock gate Worker (experimental)

A Cloudflare Worker that stands in front of `createOrder` during a sale opening. The browser asks it first; it checks the buyer's Firebase login, takes the tickets from the counts in Redis (Upstash) in one Lua call, and either answers 售完 itself or signs a short-lived pass (HS256 JWT) that `createOrder` checks before it creates the order. Buyers turned away never reach Cloud Functions, so a sale opening with far more buyers than tickets costs Cloud Functions about as many calls as there are tickets.

```text
browser ──POST /pass (ID token, requestId, quantities)──▶ Worker ──EVAL──▶ Upstash Redis
   │                         ◀── 409 售完 ──────────────────┤
   │                         ◀── 200 { pass } ──────────────┘
   └──createOrder({ orderPayload, requestId, gatePass })──▶ Cloud Functions ──▶ Firestore shards
```

It is the same gate `createOrder` already runs with `STOCK_GATE=true` ([functions/lib/stockGate.js](../functions/lib/stockGate.js)), moved to the edge: the Worker loads the same Redis keys and admit script ([functions/lib/gateScripts.js](../functions/lib/gateScripts.js)) and the same pass code ([functions/lib/gatePass.js](../functions/lib/gatePass.js)) as the functions, so both always agree. The Firestore shards still decide every sale; see "Worker pass" in [functions/README.md](../functions/README.md) for how the function side works.

## What it does per request

1. **Login**: verifies the Firebase ID token (RS256) against Google's public keys, which each isolate fetches once and keeps for as long as Google allows. The email must be verified, as `createOrder` requires.
2. **Sold-out memory**: if this isolate saw Redis turn the same ticket type away in the last `SOLD_OUT_CACHE_MS` (1 s) for as many tickets or fewer, it answers 售完 without calling Redis. Once a type is sold out, Redis sees about one call per isolate per second, however many buyers keep pressing the button.
3. **Redis**: one `EVAL` of `ADMIT_ONE_PER_ACCOUNT`. A retry with the same `requestId` is let through without taking more; a new checkout of the same account first gives back the account's last hold, so a script cannot drain the counts with checkouts it never finishes.
4. **Pass**: signs `{ sub: uid, rid: requestId, q: quantities, held, miss }` with `GATE_PASS_SECRET`, valid 120 s. If Redis gives no answer within 800 ms the pass is still signed with `held: false`, and `createOrder` reads the shards as it would without the gate.

## Measured on this branch

`yarn bench` runs the handler in Node (the same code and WebCrypto calls) against a real `redis-server`, 20,000 buyers, 500 at a time, 2,800 tickets, on a 4-core container:

| | |
|---|---|
| 售完 from the isolate memory (all CPU) | 0.38 ms per request |
| Pass without Redis (ID token check + signing, all CPU) | 0.42 ms per request |
| Whole sale on **one thread** | about 4,000 checkouts/s; all 2,800 passes handed out in 1.7 s |
| Redis calls | about 4,000 for 20,000 buyers (the rest answered from memory) |

Cloudflare runs as many isolates as the traffic needs, so the Worker itself scales past this; the limit before sell-out is Upstash (about 10,000 commands/s on the pay-as-you-go plan), and after sell-out the isolates answer from memory. `wrangler dev` is no good for throughput numbers: its local proxy alone tops out around 1,000 requests a second on a small machine, even for `/health`.

## Setting it up

Needs a Workers Paid plan for a real sale (Free allows 100,000 requests a day).

```bash
cd worker
yarn install
npx wrangler login
npx wrangler secret put UPSTASH_REDIS_REST_URL     # the same database as the functions
npx wrangler secret put UPSTASH_REDIS_REST_TOKEN
npx wrangler secret put GATE_PASS_SECRET           # the same value as the functions' secret, 32+ characters
yarn deploy
```

Then in this order:

1. `firebase functions:secrets:set GATE_PASS_SECRET` with the same value, `GATE_PASS=true` in `functions/.env`, and deploy the functions. From now on `createOrder` refuses checkouts without a pass.
2. Put the Worker's URL in `GATE_WORKER_URL` in `src/config/app.js` and deploy the site.

Turn it off in the reverse order. Between the two steps checkouts fail, so do it when no sale is open.

`wrangler.toml` holds the non-secret settings: `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGINS` (the site's origin for CORS; add `http://localhost:9000` for a local frontend) and `SOLD_OUT_CACHE_MS`. `FIREBASE_JWKS_URL` may point the key fetch elsewhere; the tests and the benchmark use it.

## Commands

| Command | |
|---|---|
| `yarn test` | Handler tests against a local `redis-server` (needs `redis-server`; no install needed) |
| `yarn bench` | Cost per request and a local sale; `BUYERS`, `CONCURRENCY`, `STOCK` set its size |
| `yarn dev` | `wrangler dev` with the settings in `.dev.vars` |
| `yarn deploy` | `wrangler deploy` |

The end-to-end test, Worker and `createOrder` together against the Firestore emulator, is `functions/test/emulator/gatePass.test.js` (`yarn --cwd functions test:emulator`).
