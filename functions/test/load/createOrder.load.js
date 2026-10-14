// Load test for createOrder (PARTY-28). Many buyers check out at the same
// moment; prints successes, latency, error codes, Firestore reads and writes
// and a timeline for one scenario:
//   node test/load/createOrder.load.js <index> [--out result.json]
// Against the emulator: `yarn test:load` (needs Java; run.js gives every
// scenario its own emulator, which locks more conservatively than
// production, so compare emulator runs with each other only).
// Against a real test project's Firestore: LOADTEST_PROJECT=<project id>
// (see ../emulator/setup.js). Every run uses its own ticket type and buyers.
// --out saves each buyer's reads, writes, transaction attempts and timings.
import { AsyncLocalStorage } from 'node:async_hooks'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import { DocumentReference, Firestore, Query, Transaction } from 'firebase-admin/firestore'

import { HOUR, PROJECT_ID, fft, functions, db, iso, isEmulator } from '../emulator/setup.js'
import { SHARD_COUNT } from '../../lib/orderValidation.js'
import { SCENARIOS } from './scenarios.js'

const callCreate = fft.wrap(functions.createOrder)
const callPlan = fft.wrap(functions.planStockShards)

/* ---------- counting Firestore operations ---------- */

// Every read, write and transaction attempt is recorded against the buyer
// whose checkout made it (or the harness, outside a checkout). Reads count
// requested documents; a query counts the documents it returned (at least 1).
const buyerContext = new AsyncLocalStorage()
const harness = { events: [], txSeq: 0 }
let origin = performance.now()
const now = () => Math.round((performance.now() - origin) * 10) / 10
const record = (event) => (buyerContext.getStore() || harness).events.push(event)
const codeOf = (error) => error?.code ?? error?.constructor?.name ?? 'error'

if (!(db instanceof Firestore)) throw new Error('db is not the Firestore class this script instruments')

function countRead(proto, name, kind, docsOf) {
  const original = proto[name]
  proto[name] = function (...args) {
    const t0 = now()
    return original.apply(this, args).then(
      (result) => {
        record({ kind, docs: docsOf(args, result), t0, t1: now() })
        return result
      },
      (error) => {
        record({ kind, docs: docsOf(args, null), t0, t1: now(), error: codeOf(error) })
        throw error
      }
    )
  }
}

const refCount = (args) => args.filter((arg) => arg instanceof DocumentReference).length
countRead(Firestore.prototype, 'getAll', 'read', refCount) // DocumentReference.get goes through here
countRead(Transaction.prototype, 'getAll', 'tx.read', refCount)
countRead(Transaction.prototype, 'get', 'tx.read', ([ref], result) =>
  ref instanceof DocumentReference ? 1 : Math.max(1, result?.size ?? 1))
countRead(Query.prototype, 'get', 'query', (args, result) => Math.max(1, result?.size ?? 1))

// Transaction writes are billed only for the attempt that commits
for (const name of ['set', 'create', 'update', 'delete']) {
  const original = Transaction.prototype[name]
  Transaction.prototype[name] = function (ref, data, ...rest) {
    const ctx = buyerContext.getStore() || harness
    const event = { kind: 'tx.write', op: name, path: ref.path, tx: ctx.tx, attempt: ctx.attempt, t0: now() }
    if (name === 'create' && ref.path.startsWith('orders/')) event.stockShards = data.stockShards
    record(event)
    return original.call(this, ref, data, ...rest)
  }
}
for (const name of ['set', 'create', 'update', 'delete']) {
  const original = DocumentReference.prototype[name]
  DocumentReference.prototype[name] = function (...args) {
    const t0 = now()
    return original.apply(this, args).then(
      (result) => {
        record({ kind: 'write', op: name, path: this.path, t0, t1: now() })
        return result
      },
      (error) => {
        record({ kind: 'write', op: name, path: this.path, t0, t1: now(), error: codeOf(error) })
        throw error
      }
    )
  }
}

const originalRun = Firestore.prototype.runTransaction
Firestore.prototype.runTransaction = function (updateFunction, options) {
  const ctx = buyerContext.getStore() || harness
  const tx = ++ctx.txSeq
  const t0 = now()
  let attempt = 0
  return originalRun.call(this, (transaction) => {
    attempt++
    ctx.tx = tx
    ctx.attempt = attempt
    record({ kind: 'tx.attempt', tx, attempt, t0: now() })
    return updateFunction(transaction)
  }, options).then(
    (result) => {
      record({ kind: 'tx.commit', tx, attempts: attempt, t0, t1: now() })
      return result
    },
    (error) => {
      record({ kind: 'tx.fail', tx, attempts: attempt, t0, t1: now(), error: codeOf(error) })
      throw error
    }
  )
}

// Reads, billed writes and transaction figures of one list of events
function tally(events) {
  const committed = new Set(events.filter((e) => e.kind === 'tx.commit').map((e) => `${e.tx}:${e.attempts}`))
  const reads = events.filter((e) => ['read', 'tx.read', 'query'].includes(e.kind))
  return {
    reads: reads.reduce((sum, e) => sum + e.docs, 0),
    readsOutsideTx: reads.filter((e) => e.kind !== 'tx.read').reduce((sum, e) => sum + e.docs, 0),
    readsInTx: reads.filter((e) => e.kind === 'tx.read').reduce((sum, e) => sum + e.docs, 0),
    writes: events.filter((e) => e.kind === 'write' && !e.error).length +
      events.filter((e) => e.kind === 'tx.write' && committed.has(`${e.tx}:${e.attempt}`)).length,
    transactions: events.filter((e) => e.kind === 'tx.commit' || e.kind === 'tx.fail').length,
    txAttempts: events.filter((e) => e.kind === 'tx.attempt').length,
    // chooseShards reads every shard of the type at once
    stockLooks: events.filter((e) => e.kind === 'read' && e.docs === SHARD_COUNT).length,
    shardsTaken: events.filter((e) => e.kind === 'tx.fail' && e.error === 'ShardsTaken').length,
    contentionAborts: events.filter((e) => e.kind === 'tx.fail' && (e.error === 10 || e.error === 'aborted')).length
  }
}

/* ---------- the run ---------- */

const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
// cumulative results at these seconds after the start
const MARKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 30, 60, 90, 120, 180, 240, 300]

async function run({ label, buyers, stock }) {
  const runId = Date.now().toString(36)
  const typeId = `load-${runId}`

  // round trips from this machine before the run: one document read each
  const roundTrips = []
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now()
    await db.doc('settings/shop').get()
    roundTrips.push(Math.round(performance.now() - t0))
  }

  await db.doc('settings/shop').set({ openAt: new Date(Date.now() - HOUR) })
  await db.doc('settings/ticketTypes').set({
    types: [{
      id: typeId, name: '壓測票', price: 900, eligibleBuyerIdentity: 'all_users',
      salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: stock, purchaseLimitPerPerson: 4
    }]
  })
  // as the trigger does in production when the ticket types are saved
  await callPlan(fft.makeChange(null, await db.doc('settings/ticketTypes').get()), {})
  const setupTally = tally(harness.events)
  harness.events = []

  origin = performance.now()
  const startedAt = new Date()
  const results = await Promise.all(
    Array.from({ length: buyers }, (_, i) => {
      const ctx = { i, events: [], txSeq: 0 }
      return buyerContext.run(ctx, async () => {
        const t0 = now()
        try {
          const result = await callCreate(
            {
              orderPayload: {
                customerName: '壓測', customerPhone: '0900000000', school: '北一女中', class: '101', number: '1',
                items: [{ id: typeId, quantity: 1 }]
              },
              requestId: `load-${runId}-${i}-0123456789`
            },
            { auth: { uid: `load-${runId}-${i}`, token: { email: `load-${runId}-${i}@example.com`, email_verified: true } } }
          )
          return { i, t0, t1: now(), outcome: 'ok', orderId: result.id, events: ctx.events }
        } catch (error) {
          return { i, t0, t1: now(), outcome: codeOf(error), message: error.message, events: ctx.events }
        }
      })
    })
  )
  const totalMs = now()

  // final shard state, read once after the run
  const [legacy, shardDocs] = await Promise.all([
    db.doc(`ticketSales/${typeId}`).get(),
    db.collection(`ticketSales/${typeId}/shards`).get()
  ])
  const caps = legacy.data()?.shardCaps?.caps || []
  const shardSold = Object.fromEntries(shardDocs.docs.map((d) => [d.id, d.data().sold || 0]))
  const shards = Array.from({ length: SHARD_COUNT }, (_, k) => ({ k, sold: shardSold[k] || 0, cap: caps[k] ?? null }))
  const sold = shards.reduce((sum, s) => sum + s.sold, 0) + (legacy.data()?.sold || 0)

  const perBuyer = results.map((r) => {
    const t = tally(r.events)
    const order = r.events.find((e) => e.kind === 'tx.write' && e.stockShards)
    return {
      i: r.i, t0: r.t0, t1: r.t1, ms: Math.round(r.t1 - r.t0), outcome: r.outcome, message: r.message,
      orderId: r.orderId, shards: r.outcome === 'ok' && order ? Object.keys(order.stockShards[typeId]).map(Number) : undefined,
      ...t
    }
  })
  // transaction numbers are per buyer, so tally each buyer and add them up
  const runTally = {}
  perBuyer.forEach((b) => Object.keys(tally([])).forEach((key) => { runTally[key] = (runTally[key] || 0) + b[key] }))

  const outcomes = {}
  perBuyer.forEach((b) => { outcomes[b.outcome] = (outcomes[b.outcome] || 0) + 1 })
  const latencies = perBuyer.map((b) => b.ms).sort((a, b) => a - b)
  const okEnds = perBuyer.filter((b) => b.outcome === 'ok').map((b) => b.t1).sort((a, b) => a - b)

  // cumulative outcomes every 100 ms
  const timeline = []
  for (let t = 0; t <= Math.ceil(totalMs / 100) * 100; t += 100) {
    const done = perBuyer.filter((b) => b.t1 <= t)
    const row = { ms: t }
    Object.keys(outcomes).forEach((code) => { row[code] = done.filter((b) => b.outcome === code).length })
    timeline.push(row)
  }

  const summary = {
    scenario: label,
    project: PROJECT_ID,
    emulator: isEmulator,
    succeeded: outcomes.ok || 0,
    sold,
    oversold: Math.max(0, sold - stock),
    shardsOverCap: shards.filter((s) => s.cap !== null && s.sold > s.cap).length,
    outcomes,
    totalMs: Math.round(totalMs),
    lastSaleMs: Math.round(okEnds.at(-1) ?? 0),
    p50Ms: percentile(latencies, 0.5),
    p90Ms: percentile(latencies, 0.9),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    maxMs: latencies.at(-1),
    roundTripMs: roundTrips,
    firestore: { run: runTally, setup: setupTally }
  }

  console.log(summary)
  const codes = Object.keys(outcomes)
  console.log(['cumulative results:', ...MARKS.filter((sec) => sec * 1000 < totalMs + 1000).map((sec) => {
    const done = perBuyer.filter((b) => b.t1 <= sec * 1000)
    return `${String(sec).padStart(4)}s  ` + codes.map((code) => `${code} ${done.filter((b) => b.outcome === code).length}`).join('  ')
  })].join('\n'))

  const out = process.argv.indexOf('--out')
  if (out > 0) {
    let commit = null
    try { commit = execSync('git rev-parse --short HEAD').toString().trim() } catch {}
    writeFileSync(process.argv[out + 1], JSON.stringify({
      meta: {
        runId, typeId, stock, buyers, startedAt: startedAt.toISOString(), commit,
        node: process.version, platform: `${os.type()} ${os.release()} ${os.arch()}`, cpus: os.cpus().length
      },
      summary, shards, timeline, buyers: perBuyer, events: results.map((r) => ({ i: r.i, events: r.events }))
    }))
    console.log(`saved ${process.argv[out + 1]}`)
  }
}

const scenario = SCENARIOS[Number(process.argv[2])]
if (!scenario) {
  console.error(`usage: node createOrder.load.js <0-${SCENARIOS.length - 1}> [--out result.json]`)
  process.exit(1)
}
await run(scenario)

fft.cleanup()
process.exit(0)
