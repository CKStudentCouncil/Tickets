// Checkout (replaces the createOrder callable, functions/lib/orders.js).
//
// Prices, names, sale windows, stock and per-person limits all come from the
// ticket_types table; nothing price-related is trusted from the client. Once
// a checkout is valid it goes through the checkout gate (checkoutGate.ts),
// which turns it away when its tickets are gone and otherwise writes it in a
// D1 batch with the other orders of that moment. Each order's stock, the
// buyer's allowance and the order itself are in one transaction, and the
// CHECK constraints on ticket_types.sold and buyer_purchases.quantity make it
// fail rather than oversell or exceed a limit, however many checkouts run at
// once.
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
  isValidRequestId,
  sanitizeOrderInput
} from './domain/orderValidation.js'
import { CHECKOUT_ACTION, parseHostnames, verifyTurnstile } from './domain/turnstile.js'
import { listTicketTypeRows } from './data/settings'
import { ticketTypeFromRow, type TicketTypeConfig, type TicketTypeRow } from './data/rows'
import { confirmationJobId } from './mail/jobs'
import { checkoutGate, type GateOrder, type GateResult } from './checkoutGate'

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
// lost. A retry of a checkout that reached a verdict is answered from
// order_requests before Turnstile is checked, and one still in the gate joins
// it; a checkout that failed without a verdict remembers its pass (see
// rememberTurnstilePass), so its retry gets through while a token replayed on
// another checkout does not. Returns whether a token was verified.
async function assertTurnstile(env: Env, input: CheckoutInput, uid: string, requestId: string | null, remoteip: string | null) {
  if (!flag(env.ENFORCE_TURNSTILE)) return false

  const passed = await verifyTurnstile({
    token: input.turnstileToken,
    action: CHECKOUT_ACTION,
    hostnames: parseHostnames(env.TURNSTILE_HOSTNAMES),
    secret: env.TURNSTILE_SECRET?.trim(),
    remoteip
  })
  if (passed) return true

  const pass = requestId
    ? await env.DB.prepare('SELECT user_id, expires_at FROM turnstile_passes WHERE request_id = ?').bind(requestId).first<{ user_id: string; expires_at: number }>()
    : null
  if (pass?.user_id !== uid || pass.expires_at < Date.now()) {
    throw new ApiError('permission-denied', '人機驗證已過期，請重新驗證後再送出')
  }
  return false
}

// Written only when a verified checkout ends without a verdict, so a rush of
// checkouts does not cost D1 a write each
async function rememberTurnstilePass(env: Env, uid: string, requestId: string) {
  await env.DB.prepare(
    `INSERT INTO turnstile_passes (request_id, user_id, expires_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (request_id) DO UPDATE SET expires_at = excluded.expires_at WHERE user_id = excluded.user_id`
  ).bind(requestId, uid, Date.now() + TURNSTILE_PASS_MS).run().catch((error) => {
    console.error('[checkout] could not remember the Turnstile pass', error)
  })
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

  let verified = false
  try {
    const { order, quantities } = sanitizeOrderInput(input?.orderPayload, user.email)

    verified = await assertTurnstile(env, input, uid, requestId, remoteip)
    assertShopOpen(shops.results[0] as { value: string } | undefined, (roles.results[0] as { role: string | null } | undefined)?.role)
    await enforceAccountLimit(env, uid)

    const rows = typeRows.results as TicketTypeRow[]
    const types = new Map(rows.map((row) => [row.id, ticketTypeFromRow(row)]))
    const alreadyBought = new Map((bought.results as { ticket_type_id: string; quantity: number }[]).map((r) => [r.ticket_type_id, r.quantity]))

    // Whether the tickets are still there is the gate's call: its counts are
    // fresher than this read, and its sold-out verdicts are recorded together.
    const now = new Date()
    const items = [...quantities].map(([id, quantity]) => {
      const type = types.get(id)
      if (!type) throw new ApiError('invalid-argument', `無效的票種：${id}`)
      checkTicketType(type, quantity, { now, school: order.school, email: user.email, alreadyBought: alreadyBought.get(id) || 0 })
      return { id, name: String(type.name || ''), price: Number(type.price) || 0, quantity, limit: getPurchaseLimit(type) as number | null }
    })
    const typeOf = (id: string) => types.get(id)!
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const schoolCode = (SCHOOL_CODES as Record<string, string>)[order.school]
    const dateKey = getTaiwanDateKey()
    const gate = checkoutGate(env)

    for (let attempt = 1; ; attempt++) {
      const orderId = generateOrderId(schoolCode, dateKey)
      const jobId = confirmationJobId(orderId)
      const gateOrder: GateOrder = {
        id: orderId, requestId, uid, buyerKey, items, total, ticketCode: generateTicketCode(), jobId,
        customer: {
          name: order.customerName, email: order.customerEmail, phone: order.customerPhone, school: order.school,
          class: order.class, number: order.number, office: order.office
        }
      }
      const result: GateResult = await gate.admit(gateOrder)

      switch (result.kind) {
        case 'created':
          if (result.joined) return { status: 200, id: result.orderId }
          await env.MAIL_QUEUE.send({ jobId }).catch((error) => {
            // the cron sweep picks up queued jobs that never reached the queue
            console.error('[checkout] could not enqueue confirmation', orderId, error)
          })
          return { status: 201, id: orderId, emailJobId: jobId }
        case 'sold-out': {
          const error = soldOutError(typeOf(result.typeId))
          // the gate already recorded this rejection for the request id
          if (result.fenced) throw new ApiError(error.code, error.message, { checkoutRejected: true })
          throw error
        }
        case 'order-id':
          if (attempt < ORDER_ID_ATTEMPTS) continue
          throw new Error('Could not generate a unique order id')
        case 'request-id': {
          // a call with the same request id reached a verdict first
          const previous = requestId ? await resolveRequest(db, requestId, uid) : null
          if (previous) return previous
          throw invalidRequest()
        }
        case 'stock': {
          const fresh = new Map((await listTicketTypeRows(db)).map((row) => [row.id, row]))
          const gone = items.find((item) => {
            const row = fresh.get(item.id)
            return row?.stock != null && row.sold + item.quantity > row.stock
          })
          throw soldOutError(typeOf((gone || items[0]).id))
        }
        case 'limit': {
          const { id, limit } = items.find(({ limit }) => limit !== null) || items[0]
          throw new ApiError('failed-precondition', `${typeOf(id).name}超過每人限購 ${limit} 張`)
        }
        case 'unknown':
          throw new Error('The checkout gate could not tell whether the order was written')
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
    // without a verdict, the client retries with the same token and request id
    if (verified && requestId) await rememberTurnstilePass(env, uid, requestId)
    throw new ApiError('internal', '訂單送出失敗，請稍後再試')
  }
}
