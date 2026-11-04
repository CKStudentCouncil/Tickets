// Deploy-time settings, read from functions/.env (change them there, no code
// edit needed). See functions/README.md.
import { defineBoolean, defineInt, defineString } from 'firebase-functions/params'

// Warm createOrder instances kept running, each serving up to 250 checkouts
// at once; raise to 5-10 around the sale opening to avoid cold starts, set
// back to 0 afterwards (it costs money).
export const CREATE_ORDER_MIN_INSTANCES = defineInt('CREATE_ORDER_MIN_INSTANCES', { default: 0 })

// Max orders per signed-in account per 10 minutes, 0 = off. Counted per
// account rather than per IP: the client IP header can be forged by the
// caller, and schools and mobile carriers put many buyers behind one IP.
export const ORDER_LIMIT_PER_ACCOUNT = defineInt('ORDER_LIMIT_PER_ACCOUNT', { default: 0 })

// SES sending rate of the AWS account, in recipients per second.
export const SES_RECIPIENTS_PER_SECOND = defineInt('SES_RECIPIENTS_PER_SECOND', { default: 14 })

// Require a Cloudflare Turnstile token on createOrder, submitSurvey and
// submitPartySurvey. Turn on only after TURNSTILE_SITE_KEY is filled in
// src/config/app.js, the site is deployed and the TURNSTILE_SECRET secret is
// set, otherwise every order and survey answer is rejected.
export const ENFORCE_TURNSTILE = defineBoolean('ENFORCE_TURNSTILE', { default: false })

// Let createOrder turn buyers away by a count of tickets left kept in Redis
// (Upstash) before it reads the stock in Firestore (see lib/stockGate.js).
// Needs the UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN secrets; off,
// or when Redis cannot be reached, checkouts work as without it.
export const STOCK_GATE = defineBoolean('STOCK_GATE', { default: false })

// Comma-separated hostnames of the site whose Turnstile tokens createOrder
// accepts. Never add localhost here: the production functions would then take
// tokens solved on any developer's machine.
export const TURNSTILE_HOSTNAMES = defineString('TURNSTILE_HOSTNAMES', { default: 'tickets.cksc.tw' })

// Require a pass from the stock gate Worker (/worker) on createOrder: the
// Worker takes the tickets from the counts in Redis and signs a short-lived
// pass (HS256 JWT, lib/gatePass.js); createOrder checks the pass instead of
// calling Redis itself. Needs the Worker deployed, GATE_WORKER_URL filled in
// src/config/app.js, and the same GATE_PASS_SECRET secret in the Worker and
// here; otherwise every order is rejected. Off, createOrder works as before.
export const GATE_PASS = defineBoolean('GATE_PASS', { default: false })
