// Checkout (replaces the createOrder callable, functions/lib/orders.js).
//
// Prices, names, sale windows, stock and per-person limits all come from the
// ticket_types table; nothing price-related is trusted from the client. The
// order, its stock and the buyer's allowance are written in one D1 batch,
// which is a single transaction: the CHECK constraints on ticket_types.sold
// and buyer_purchases.quantity make the whole batch fail rather than oversell
// or exceed a limit, however many checkouts run at once.
import { ApiError, type ErrorCode } from './errors'
import { flag, type Env } from './env'
import { rankOf } from './auth'
import type { SessionUser } from './context'
import { SCHOOL_CODES, SHOP_OPEN_AT } from './domain/constants.js'
import { getTaiwanDateKey, parseTaipeiDateTime } from './domain/time.js'
import {
  checkTicketType,
  generateOrderId,
  generateTicketCode,
  getBuyerKey,
  getPurchaseLimit,
  getStockLimit,
  isValidRequestId,
  sanitizeOrderInput
} from './domain/orderValidation.js'
import { CHECKOUT_ACTION, parseHostnames, verifyTurnstile } from './domain/turnstile.js'
import { listTicketTypeRows } from './data/settings'
import { ticketTypeFromRow, type TicketTypeConfig, type TicketTypeRow } from './data/rows'
import { confirmationJobId, mailJobInsert } from './mail/jobs'

const ORDER_ID_ATTEMPTS = 3
// How long a passed Turnstile check covers retries of the same checkout
const TURNSTILE_PASS_MS = 10 * 60 * 1000
const DEFINITE_ORDER_ERRORS = new Set<ErrorCode>(['invalid-argument', 'failed-precondition', 'permission-denied', 'resource-exhausted'])

export interface CheckoutInput {
  orderPayload?: unknown
  requestId?: string
  turnstileToken?: string
}

export interface CheckoutResult {
  status: 200 | 201
  id: string
  emailJobId?: string
}

interface RequestRow {
  user_id: string
  order_id: string | null
  status: string
  error_code: string | null
  error_message: string | null
}

const invalidRequest = () => new ApiError('invalid-argument', '訂單請求無效，請重新送出')

function rejectedRequestError(request: RequestRow, uid: string) {
  if (request.user_id !== uid) return invalidRequest()
  const code = DEFINITE_ORDER_ERRORS.has(request.error_code as ErrorCode) ? (request.error_code as ErrorCode) : 'failed-precondition'
  return new ApiError(code, request.error_message || '這次訂單未成立，請重新送出', { checkoutRejected: true })
}

const missingRequestOrderError = () =>
  new ApiError('not-found', '原訂單已取消，請重新建立訂單', { checkoutRejected: true })

type RequestLookup = RequestRow & { order_user_id: string | null; deleted_at: number | null }

const requestLookup = (db: D1Database, requestId: string) => db.prepare(
  `SELECT r.user_id, r.order_id, r.status, r.error_code, r.error_message,
          o.user_id AS order_user_id, o.deleted_at
   FROM order_requests r LEFT JOIN orders o ON o.id = r.order_id
   WHERE r.request_id = ?`
).bind(requestId)

// What an earlier checkout with this request id came to: its order, or its
// definite rejection (thrown). Null when the request id is new.
function resolveRequestRow(request: RequestLookup | undefined, uid: string): CheckoutResult | null {
  if (!request) return null
  if (request.status === 'rejected') throw rejectedRequestError(request, uid)
  if (request.user_id !== uid) throw invalidRequest()
  // A deleted order resolves this checkout as cancelled; an old retry cannot
  // resurrect it, even after stock is available again.
  if (!request.order_user_id || request.deleted_at != null) throw missingRequestOrderError()
  if (request.order_user_id !== uid) throw invalidRequest()
  return { status: 200, id: request.order_id! }
}

async function resolveRequest(db: D1Database, requestId: string, uid: string) {
  return resolveRequestRow((await requestLookup(db, requestId).first<RequestLookup>()) ?? undefined, uid)
}

// Turnstile tokens are single-use, but the client retries a checkout with the
// same token and request id when the server was busy or the response was
// lost. The first pass is remembered per request id, so such a retry gets
// through while a token replayed on another checkout does not.
async function assertTurnstile(env: Env, input: CheckoutInput, uid: string, requestId: string | null, remoteip: string | null) {
  if (!flag(env.ENFORCE_TURNSTILE)) return

  const passed = await verifyTurnstile({
    token: input.turnstileToken,
    action: CHECKOUT_ACTION,
    hostnames: parseHostnames(env.TURNSTILE_HOSTNAMES),
    secret: env.TURNSTILE_SECRET?.trim(),
    remoteip
  })

  if (passed) {
    if (requestId) {
      await env.DB.prepare(
        `INSERT INTO turnstile_passes (request_id, user_id, expires_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (request_id) DO UPDATE SET expires_at = excluded.expires_at WHERE user_id = excluded.user_id`
      ).bind(requestId, uid, Date.now() + TURNSTILE_PASS_MS).run()
    }
    return
  }

  const pass = requestId
    ? await env.DB.prepare('SELECT user_id, expires_at FROM turnstile_passes WHERE request_id = ?').bind(requestId).first<{ user_id: string; expires_at: number }>()
    : null
  if (pass?.user_id !== uid || pass.expires_at < Date.now()) {
    throw new ApiError('permission-denied', '人機驗證已過期，請重新驗證後再送出')
  }
}

// The /comingsoon page only hides the shop in the browser, so the same gate
// is enforced here; staff may order before it, as they may browse the shop.
function assertShopOpen(shop: { value: string } | undefined, role: string | null | undefined) {
  const openAt = parseTaipeiDateTime(shop ? JSON.parse(shop.value).openAt : null) || SHOP_OPEN_AT
  if (new Date() < openAt && rankOf(role) === 0) throw new ApiError('failed-precondition', '尚未開賣')
}

// Orders per account per minute (the ORDER_LIMITER binding), counted only
// for checkouts that passed Turnstile
async function enforceAccountLimit(env: Env, uid: string) {
  if (!env.ORDER_LIMITER) return
  const { success } = await env.ORDER_LIMITER.limit({ key: uid })
  if (!success) throw new ApiError('resource-exhausted', '下單次數過多，請稍後再試')
}

const soldOutError = (ticketType: TicketTypeConfig) => new ApiError('resource-exhausted', `${ticketType.name}剩餘票量不足`)

// A constraint that failed the batch, read from D1's error message
function constraintOf(error: unknown) {
  const message = String((error as Error)?.message || '')
  if (/CHECK constraint failed: stock_available/.test(message)) return 'stock'
  if (/CHECK constraint failed: per_person_limit/.test(message)) return 'limit'
  if (/UNIQUE constraint failed: orders\.id/.test(message)) return 'order-id'
  if (/UNIQUE constraint failed: order_requests\.request_id/.test(message)) return 'request-id'
  return null
}

export async function checkout(
  env: Env,
  user: SessionUser,
  input: CheckoutInput,
  { remoteip = null as string | null } = {}
): Promise<CheckoutResult> {
  if (!user.email || !user.emailVerified) {
    throw new ApiError('failed-precondition', '此帳號的 Email 尚未驗證，請改用 Google 帳號登入')
  }
  const db = env.DB
  const uid = user.id
  const requestId = isValidRequestId(input?.requestId) ? input.requestId! : null

  // Everything the checkout reads, in one round trip to D1
  const buyerKey = await getBuyerKey(user.email)
  const [requests, shops, roles, typeRows, bought] = await db.batch([
    requestId ? requestLookup(db, requestId) : db.prepare('SELECT NULL WHERE 0'),
    db.prepare(`SELECT value FROM settings WHERE key = 'shop'`),
    db.prepare('SELECT role FROM user WHERE id = ?').bind(uid),
    db.prepare('SELECT id, sort, active, config, stock, sold FROM ticket_types WHERE active = 1'),
    db.prepare('SELECT ticket_type_id, quantity FROM buyer_purchases WHERE email_hash = ?').bind(buyerKey)
  ])

  // A committed checkout remains recoverable even if the shop is later closed
  // or throttling starts. The batch below also inserts this request id, so
  // two simultaneous calls cannot both create an order.
  if (requestId) {
    const previous = resolveRequestRow(requests.results[0] as RequestLookup | undefined, uid)
    if (previous) return previous
  }

  try {
    const { order, quantities } = sanitizeOrderInput(input?.orderPayload, user.email)

    await assertTurnstile(env, input, uid, requestId, remoteip)
    assertShopOpen(shops.results[0] as { value: string } | undefined, (roles.results[0] as { role: string | null } | undefined)?.role)
    await enforceAccountLimit(env, uid)

    const rows = typeRows.results as TicketTypeRow[]
    const types = new Map(rows.map((row) => [row.id, { row, type: ticketTypeFromRow(row) }]))
    const alreadyBought = new Map((bought.results as { ticket_type_id: string; quantity: number }[]).map((r) => [r.ticket_type_id, r.quantity]))

    const now = new Date()
    const items = [...quantities].map(([id, quantity]) => {
      const entry = types.get(id)
      if (!entry) throw new ApiError('invalid-argument', `無效的票種：${id}`)
      const { row, type } = entry
      checkTicketType(type, quantity, { now, school: order.school, email: user.email, alreadyBought: alreadyBought.get(id) || 0 })
      // An unlocked look so a sold-out type is reported as such; the CHECK in
      // the batch is what actually prevents overselling.
      const stock = getStockLimit(type)
      if (stock !== null && row.sold + quantity > stock) throw soldOutError(type)
      return {
        item: { id, ticketTypeId: id, name: String(type.name || ''), price: Number(type.price) || 0, quantity },
        type,
        stock,
        limit: getPurchaseLimit(type)
      }
    })
    const finalTotal = items.reduce((sum, { item }) => sum + item.price * item.quantity, 0)
    const schoolCode = (SCHOOL_CODES as Record<string, string>)[order.school]
    const dateKey = getTaiwanDateKey()

    for (let attempt = 1; ; attempt++) {
      const orderId = generateOrderId(schoolCode, dateKey)
      const createdAt = Date.now()
      const jobId = confirmationJobId(orderId)
      const statements = [
        ...items.flatMap(({ item, limit }) => [
          // ticket types without a stock limit count their sales too
          db.prepare('UPDATE ticket_types SET sold = sold + ?1 WHERE id = ?2').bind(item.quantity, item.id),
          db.prepare(
            `INSERT INTO buyer_purchases (email_hash, ticket_type_id, quantity, max_quantity, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT DO UPDATE SET quantity = quantity + excluded.quantity,
               max_quantity = excluded.max_quantity, updated_at = excluded.updated_at`
          ).bind(buyerKey, item.id, item.quantity, limit, createdAt),
          db.prepare('INSERT INTO order_items (order_id, ticket_type_id, quantity) VALUES (?, ?, ?)')
            .bind(orderId, item.id, item.quantity)
        ]),
        db.prepare(
          `INSERT INTO orders (id, user_id, customer_name, customer_email, customer_phone, school, class, number, office,
             items, original_total, final_total, ticket_code, email_status, email_job_id, email_updated_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12, 'queued', ?13, ?14, ?14)`
        ).bind(orderId, uid, order.customerName, order.customerEmail, order.customerPhone, order.school,
          order.class, order.number, order.office, JSON.stringify(items.map(({ item }) => item)), finalTotal,
          generateTicketCode(), jobId, createdAt),
        mailJobInsert(db, {
          id: jobId, kind: 'confirmation', purpose: 'confirmation', orderId, recipientCount: 1, buyerCount: 1, now: createdAt
        }),
        ...(requestId
          ? [db.prepare(`INSERT INTO order_requests (request_id, user_id, order_id, status, created_at) VALUES (?, ?, ?, 'created', ?)`)
              .bind(requestId, uid, orderId, createdAt)]
          : [])
      ]

      try {
        await db.batch(statements)
        await env.MAIL_QUEUE.send({ jobId }).catch((error) => {
          // the cron sweep picks up queued jobs that never reached the queue
          console.error('[checkout] could not enqueue confirmation', orderId, error)
        })
        return { status: 201, id: orderId, emailJobId: jobId }
      } catch (error) {
        const constraint = constraintOf(error)
        if (constraint === 'order-id' && attempt < ORDER_ID_ATTEMPTS) continue
        if (constraint === 'request-id' && requestId) {
          // a simultaneous call with the same request id committed first
          const previous = await resolveRequest(db, requestId, uid)
          if (previous) return previous
        }
        if (constraint === 'stock') {
          const fresh = new Map((await listTicketTypeRows(db)).map((row) => [row.id, row]))
          const gone = items.find(({ item, stock }) => stock !== null && (fresh.get(item.id)?.sold ?? 0) + item.quantity > stock)
          throw soldOutError((gone || items[0]).type)
        }
        if (constraint === 'limit') {
          const { type, limit } = items.find(({ limit }) => limit !== null) || items[0]
          throw new ApiError('failed-precondition', `${type.name}超過每人限購 ${limit} 張`)
        }
        throw error
      }
    }
  } catch (error) {
    if (requestId && error instanceof ApiError && DEFINITE_ORDER_ERRORS.has(error.code)) {
      // A final rejection also fences any in-flight checkout with this
      // request id: whichever writes order_requests first wins.
      try {
        const { meta } = await db.prepare(
          `INSERT INTO order_requests (request_id, user_id, status, error_code, error_message, created_at)
           VALUES (?, ?, 'rejected', ?, ?, ?) ON CONFLICT DO NOTHING`
        ).bind(requestId, uid, error.code, error.message, Date.now()).run()
        if (meta.changes === 0) {
          const previous = await resolveRequest(db, requestId, uid)
          if (previous) return previous
        }
      } catch (markerError) {
        if (markerError instanceof ApiError) throw markerError
        console.error('[checkout] could not resolve rejected checkout:', markerError)
      }
      throw new ApiError(error.code, error.message, { checkoutRejected: true })
    }
    if (error instanceof ApiError) throw error
    console.error('[checkout] unexpected error:', error)
    throw new ApiError('internal', '訂單送出失敗，請稍後再試')
  }
}
