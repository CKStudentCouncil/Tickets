// The checkout gate: one Durable Object that every checkout passes through
// once its input has been checked. D1 commits writes one transaction at a
// time, so a rush of checkouts writing one by one queues up behind each
// other; the gate turns that rush into a few batches.
//
// - It knows how many tickets of each type are left (read from D1), and
//   turns away a checkout that no longer fits without writing its order.
// - The checkouts that fit are written together: whatever arrived while the
//   previous batch was being committed goes into the next one (group commit).
//   Each D1 batch is one transaction, so a batch of orders lands entirely or
//   not at all.
// - Nobody is answered before D1 has committed what the answer says: an
//   order id only after its order is written, a sold-out rejection only
//   after its request id is fenced in order_requests.
//
// D1 stays the source of truth. The counts here are only a cache: the CHECK
// constraints on ticket_types and buyer_purchases still decide every write,
// and a batch they reject is split until each order gets its own verdict.
// Losing this object (a restart, a deploy) loses only queued checkouts, whose
// callers see an error and retry with the same request id.
import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env'
import { mailJobInsert } from './mail/jobs'

// Keeps a batch well under D1's limit of 1000 statements per invocation
const MAX_ORDERS_PER_BATCH = 25
// A sold-out verdict must rest on counts read at most this long ago, so stock
// given back (a deleted order, a raised total) is seen within this time
const REJECT_FRESH_MS = 1000
// D1 for staging and production runs in APAC: the gate sits next to it
const GATE_LOCATION: DurableObjectLocationHint = 'apac'

export const checkoutGate = (env: Env) => env.CHECKOUT_GATE.get(env.CHECKOUT_GATE.idFromName('checkout'), { locationHint: GATE_LOCATION })

// After a write to stock or sales that bypasses the gate, so its next
// verdict reads them again
export async function invalidateCheckoutGate(env: Env) {
  await checkoutGate(env).invalidate().catch((error) => console.error('[gate] could not invalidate', error))
}

export interface GateItem {
  id: string
  name: string
  price: number
  quantity: number
  limit: number | null
}

export interface GateOrder {
  id: string
  requestId: string | null
  uid: string
  buyerKey: string
  items: GateItem[]
  customer: {
    name: string
    email: string
    phone: string
    school: string
    class: string
    number: string
    office: string
  }
  total: number
  ticketCode: string
  jobId: string
}

export type GateResult =
  | { kind: 'created'; orderId: string; joined?: boolean }
  // turned away by the gate; fenced: the rejection is recorded for the request id
  | { kind: 'sold-out'; typeId: string; fenced: boolean }
  // turned away by D1's constraints when the batch was split
  | { kind: 'stock' }
  | { kind: 'limit' }
  | { kind: 'order-id' }
  // the request id was already used, by this or another account
  | { kind: 'request-id' }
  // D1 failed without saying whether the order was written
  | { kind: 'unknown' }

interface Pending {
  order: GateOrder
  resolve: (result: GateResult) => void
}

interface Counts {
  types: Map<string, { stock: number | null; sold: number }>
  readAt: number
}

// A constraint that failed a batch, read from D1's error message
export function constraintOf(error: unknown) {
  const message = String((error as Error)?.message || '')
  if (/CHECK constraint failed: stock_available/.test(message)) return 'stock'
  if (/CHECK constraint failed: per_person_limit/.test(message)) return 'limit'
  if (/UNIQUE constraint failed: orders\.id/.test(message)) return 'order-id'
  if (/UNIQUE constraint failed: order_requests\.request_id/.test(message)) return 'request-id'
  return null
}

const COUNTS_SQL = 'SELECT id, stock, sold FROM ticket_types'

function countsOf(rows: { id: string; stock: number | null; sold: number }[]): Counts {
  return { types: new Map(rows.map((row) => [row.id, { stock: row.stock, sold: row.sold }])), readAt: Date.now() }
}

// The statements that write one order, apart from ticket_types.sold
function orderStatements(db: D1Database, order: GateOrder, now: number) {
  const { customer: c } = order
  return [
    ...order.items.flatMap((item) => [
      db.prepare(
        `INSERT INTO buyer_purchases (email_hash, ticket_type_id, quantity, max_quantity, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT DO UPDATE SET quantity = quantity + excluded.quantity,
           max_quantity = excluded.max_quantity, updated_at = excluded.updated_at`
      ).bind(order.buyerKey, item.id, item.quantity, item.limit, now),
      db.prepare('INSERT INTO order_items (order_id, ticket_type_id, quantity) VALUES (?, ?, ?)')
        .bind(order.id, item.id, item.quantity)
    ]),
    db.prepare(
      `INSERT INTO orders (id, user_id, customer_name, customer_email, customer_phone, school, class, number, office,
         items, original_total, final_total, ticket_code, email_status, email_job_id, email_updated_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12, 'queued', ?13, ?14, ?14)`
    ).bind(order.id, order.uid, c.name, c.email, c.phone, c.school, c.class, c.number, c.office,
      JSON.stringify(order.items.map(({ id, name, price, quantity }) => ({ id, ticketTypeId: id, name, price, quantity }))),
      order.total, order.ticketCode, order.jobId, now),
    mailJobInsert(db, {
      id: order.jobId, kind: 'confirmation', purpose: 'confirmation', orderId: order.id, recipientCount: 1, buyerCount: 1, now
    }),
    ...(order.requestId
      ? [db.prepare(`INSERT INTO order_requests (request_id, user_id, order_id, status, created_at) VALUES (?, ?, ?, 'created', ?)`)
          .bind(order.requestId, order.uid, order.id, now)]
      : [])
  ]
}

// Every type's sales go up by one statement per batch; ticket types without
// a stock limit count their sales too
function soldStatements(db: D1Database, orders: GateOrder[]) {
  const sold = new Map<string, number>()
  for (const order of orders) for (const item of order.items) sold.set(item.id, (sold.get(item.id) ?? 0) + item.quantity)
  return [...sold].map(([id, quantity]) => db.prepare('UPDATE ticket_types SET sold = sold + ?1 WHERE id = ?2').bind(quantity, id))
}

const ordersStatements = (db: D1Database, orders: GateOrder[], now: number) =>
  [...soldStatements(db, orders), ...orders.flatMap((order) => orderStatements(db, order, now))]

// One statement fences all of a batch's sold-out request ids; RETURNING says
// which were new (the others were already used)
function fenceStatement(db: D1Database, rejected: { order: GateOrder; typeId: string }[], names: Map<string, string>, now: number) {
  const rows = rejected.map(({ order, typeId }) => [order.requestId, order.uid, `${names.get(typeId) ?? ''}剩餘票量不足`])
  return db.prepare(
    `INSERT INTO order_requests (request_id, user_id, status, error_code, error_message, created_at)
     SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), 'rejected', 'resource-exhausted', json_extract(value, '$[2]'), ?2
     FROM json_each(?1) WHERE true
     ON CONFLICT DO NOTHING RETURNING request_id`
  ).bind(JSON.stringify(rows), now)
}

export class CheckoutGate extends DurableObject<Env> {
  private queue: Pending[] = []
  private running = false
  private counts: Counts | null = null
  private inFlight = new Map<string, { uid: string; result: Promise<GateResult> }>()

  // Queue one checkout; resolves once D1 has committed its outcome
  admit(order: GateOrder): Promise<GateResult> {
    if (order.requestId) {
      // a retry of a checkout still in the gate gets that checkout's outcome
      const earlier = this.inFlight.get(order.requestId)
      if (earlier) {
        return earlier.uid === order.uid
          ? earlier.result.then((result) => (result.kind === 'created' ? { ...result, joined: true } : result))
          : Promise.resolve({ kind: 'request-id' })
      }
    }
    const result = new Promise<GateResult>((resolve) => this.queue.push({ order, resolve }))
    if (order.requestId) {
      const requestId = order.requestId
      this.inFlight.set(requestId, { uid: order.uid, result })
      result.finally(() => this.inFlight.delete(requestId))
    }
    if (!this.running) void this.run()
    return result
  }

  // Forget the counts, after a write that did not go through the gate
  // (a deleted order, edited ticket types)
  invalidate() {
    this.counts = null
  }

  private async readCounts() {
    const { results } = await this.env.DB.prepare(COUNTS_SQL).all<{ id: string; stock: number | null; sold: number }>()
    this.counts = countsOf(results)
    return this.counts
  }

  private async run() {
    this.running = true
    try {
      while (this.queue.length) {
        let counts: Counts
        try {
          counts = this.counts ?? (await this.readCounts())
        } catch (error) {
          console.error('[gate] could not read stock', error)
          // nothing was written for these checkouts; they may simply retry
          for (const { resolve } of this.queue.splice(0)) resolve({ kind: 'unknown' })
          return
        }

        const admitted: Pending[] = []
        const rejected: (Pending & { typeId: string })[] = []
        const later: Pending[] = []
        const buyers = new Set<string>()
        const planned = new Map<string, number>()
        for (const pending of this.queue.splice(0)) {
          const { order } = pending
          // one order per buyer per batch, so a buyer's own orders cannot fail
          // each other's batch on the per-person limit
          if (admitted.length >= MAX_ORDERS_PER_BATCH || buyers.has(order.buyerKey)) {
            later.push(pending)
            continue
          }
          const short = order.items.find(({ id, quantity }) => {
            const type = counts.types.get(id)
            // a type the counts do not know yet is left to D1's CHECK
            return type && type.stock !== null && type.sold + (planned.get(id) ?? 0) + quantity > type.stock
          })
          if (short) {
            rejected.push({ ...pending, typeId: short.id })
          } else {
            admitted.push(pending)
            buyers.add(order.buyerKey)
            for (const { id, quantity } of order.items) planned.set(id, (planned.get(id) ?? 0) + quantity)
          }
        }

        if (rejected.length && Date.now() - counts.readAt > REJECT_FRESH_MS) {
          // read the counts again before turning anyone away
          this.queue.unshift(...admitted, ...rejected, ...later)
          this.counts = null
          continue
        }
        this.queue.unshift(...later)
        await this.commit(admitted, rejected)
      }
    } finally {
      this.running = false
    }
  }

  private async commit(admitted: Pending[], rejected: (Pending & { typeId: string })[]) {
    const db = this.env.DB
    const now = Date.now()
    // without a request id there is nothing to fence
    for (const { typeId, resolve } of rejected.filter(({ order }) => !order.requestId)) resolve({ kind: 'sold-out', typeId, fenced: false })
    const fenced = rejected.filter(({ order }) => order.requestId)
    if (!admitted.length && !fenced.length) return

    const names = new Map(
      [...admitted, ...fenced].flatMap(({ order }) => order.items.map((item) => [item.id, item.name] as [string, string]))
    )
    const statements = [
      ...ordersStatements(db, admitted.map(({ order }) => order), now),
      ...(fenced.length ? [fenceStatement(db, fenced, names, now)] : []),
      db.prepare(COUNTS_SQL)
    ]
    try {
      const results = await db.batch(statements)
      this.counts = countsOf(results.at(-1)!.results as { id: string; stock: number | null; sold: number }[])
      for (const { order, resolve } of admitted) resolve({ kind: 'created', orderId: order.id })
      if (fenced.length) this.resolveFenced(fenced, results.at(-2)!.results as { request_id: string }[])
    } catch (error) {
      this.counts = null
      const constraint = constraintOf(error)
      if (!constraint) {
        // D1 may or may not have committed the batch; the callers find out
        // by retrying with their request ids
        console.error('[gate] batch failed', error)
        for (const { resolve } of admitted) resolve({ kind: 'unknown' })
        for (const { typeId, resolve } of fenced) resolve({ kind: 'sold-out', typeId, fenced: false })
        return
      }
      // a constraint rolled the whole batch back: give each order its own verdict
      await Promise.all([this.split(admitted, now), this.fence(fenced, names, now)])
    }
  }

  private async fence(fenced: (Pending & { typeId: string })[], names: Map<string, string>, now: number) {
    if (!fenced.length) return
    try {
      const [inserted] = await this.env.DB.batch([fenceStatement(this.env.DB, fenced, names, now)])
      this.resolveFenced(fenced, inserted.results as { request_id: string }[])
    } catch (error) {
      console.error('[gate] could not fence rejected checkouts', error)
      for (const { typeId, resolve } of fenced) resolve({ kind: 'sold-out', typeId, fenced: false })
    }
  }

  private resolveFenced(fenced: (Pending & { typeId: string })[], inserted: { request_id: string }[]) {
    const ids = new Set(inserted.map((row) => row.request_id))
    for (const { order, typeId, resolve } of fenced) {
      resolve(ids.has(order.requestId!) ? { kind: 'sold-out', typeId, fenced: true } : { kind: 'request-id' })
    }
  }

  // Halves a batch D1's constraints rejected until each order stands alone
  private async split(orders: Pending[], now: number): Promise<void> {
    if (!orders.length) return
    try {
      await this.env.DB.batch(ordersStatements(this.env.DB, orders.map(({ order }) => order), now))
      for (const { order, resolve } of orders) resolve({ kind: 'created', orderId: order.id })
    } catch (error) {
      const constraint = constraintOf(error)
      if (!constraint) {
        console.error('[gate] batch failed', error)
        for (const { resolve } of orders) resolve({ kind: 'unknown' })
      } else if (orders.length === 1) {
        orders[0].resolve({ kind: constraint })
      } else {
        const half = Math.ceil(orders.length / 2)
        await this.split(orders.slice(0, half), now)
        await this.split(orders.slice(half), now)
      }
    }
  }
}
