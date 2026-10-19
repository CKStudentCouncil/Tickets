// Staff order tools: the dashboard (admins), check-in (managers at the door),
// payments, deletion and email resends. Permissions follow firestore.rules
// and the callables they replace (functions/lib/orderActions.js, orders.js).
import { Hono } from 'hono'
import { valid } from '../validate'
import { z } from 'zod'
import { ROLE_RANK } from '../auth'
import { actorName, requireRole, type AppEnv, type SessionUser } from '../context'
import { ApiError } from '../errors'
import { iso, orderFromRow, type OrderRow } from '../data/rows'
import { ORDER_ID_PATTERN, getBuyerKey } from '../domain/orderValidation.js'
import { mailJobInsert } from '../mail/jobs'
import { invalidateCheckoutGate } from '../checkoutGate'

export const ORDER_PAGE_MAX = 251

const filtersSchema = z.object({
  school: z.string().max(30).optional(),
  emailStatus: z.string().max(20).optional(),
  delivered: z.enum(['true', 'false']).optional(),
  paid: z.enum(['true', 'false']).optional()
})

const pageSchema = filtersSchema.extend({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(ORDER_PAGE_MAX).default(51)
})

// SQL conditions for the dashboard filters (same groups as before:
// "pending" covers every not-yet-sent state, "accepted" includes legacy "sent")
function filterSql(filters: z.infer<typeof filtersSchema>) {
  const where = ['deleted_at IS NULL']
  const params: unknown[] = []
  if (filters.school && filters.school !== 'all') {
    where.push('school = ?')
    params.push(filters.school)
  }
  if (filters.emailStatus === 'pending') where.push(`email_status IN ('pending', 'queued', 'sending', 'retry')`)
  else if (filters.emailStatus === 'accepted') where.push(`email_status IN ('accepted', 'sent')`)
  else if (filters.emailStatus && filters.emailStatus !== 'all') {
    where.push('email_status = ?')
    params.push(filters.emailStatus)
  }
  if (filters.delivered) where.push(`delivered = ${filters.delivered === 'true' ? 1 : 0}`)
  if (filters.paid) where.push(`paid = ${filters.paid === 'true' ? 1 : 0}`)
  return { where, params }
}

// Pages run newest first; the cursor is the last order's "createdAt_id"
function parseCursor(cursor: string | undefined) {
  const match = /^(\d+)_([A-Z0-9]+)$/.exec(cursor || '')
  return match ? { createdAt: Number(match[1]), id: match[2] } : null
}

const orderInput = (field: 'delivered' | 'paid', expectedField: 'expectedDelivered' | 'expectedPaid') =>
  z.object({
    [field]: z.boolean({ error: '請提供目前與新的訂單狀態' }),
    [expectedField]: z.boolean({ error: '請提供目前與新的訂單狀態' }),
    ticketCode: z.string().max(200).optional(),
    overrideReason: z.string().optional()
  })

function requireOverrideReason(reason: unknown) {
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500) {
    throw new ApiError('failed-precondition', '請填寫管理員核對身分及略過 QR 驗證的原因（最多 500 字）')
  }
  return reason.trim()
}

function metadata(order: ReturnType<typeof orderFromRow>, field: 'delivered' | 'paid', prefix: 'delivery' | 'payment') {
  return {
    [field]: order[field],
    [`${prefix}UpdatedAt`]: order[`${prefix}UpdatedAt`],
    [`${prefix}UpdatedByName`]: order[`${prefix}UpdatedByName`],
    [`${prefix}UpdatedByUid`]: order[`${prefix}UpdatedByUid`]
  }
}

function orderIdOf(id: string) {
  if (!ORDER_ID_PATTERN.test(id)) throw new ApiError('invalid-argument', '訂單編號無效')
  return id
}

// Check-in and payment: the client sends the new value and the value it
// expects now, so two staff scanning the same ticket cannot both succeed.
// The status change and its audit record commit together.
async function changeStatus(
  db: D1Database,
  user: SessionUser,
  orderId: string,
  { field, prefix, value, expected, verification = {} }: {
    field: 'delivered' | 'paid'
    prefix: 'delivery' | 'payment'
    value: boolean
    expected: boolean
    verification?: { codeVerification?: string; overrideReason?: string }
  }
) {
  const now = Date.now()
  const name = actorName(user)
  const column = field
  const [updated] = await db.batch([
    db.prepare(
      `UPDATE orders SET ${column} = ?1, ${prefix}_updated_at = ?2, ${prefix}_updated_by_uid = ?3, ${prefix}_updated_by_name = ?4
       WHERE id = ?5 AND deleted_at IS NULL AND ${column} = ?6 RETURNING *`
    ).bind(value ? 1 : 0, now, user.id, name, orderId, expected ? 1 : 0),
    db.prepare(
      `INSERT INTO order_history (order_id, action, previous_value, value, actor_uid, actor_name, occurred_at, code_verification, override_reason)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
       WHERE EXISTS (SELECT 1 FROM orders WHERE id = ?1 AND ${prefix}_updated_at = ?7 AND ${prefix}_updated_by_uid = ?5)`
    ).bind(orderId, prefix, expected ? 1 : 0, value ? 1 : 0, user.id, name, now,
      verification.codeVerification ?? null, verification.overrideReason ?? null)
  ])
  const row = (updated.results as OrderRow[])[0]
  if (row) return metadata(orderFromRow(row), field, prefix)
  return null
}

async function currentOrder(db: D1Database, orderId: string) {
  const row = await db.prepare('SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL').bind(orderId).first<OrderRow>()
  if (!row) throw new ApiError('not-found', '找不到訂單')
  return orderFromRow(row)
}

function staleStateError(order: ReturnType<typeof orderFromRow>, field: 'delivered' | 'paid', prefix: 'delivery' | 'payment', value: boolean) {
  const current = order[field]
  const code = field === 'delivered' && value && current ? 'already-exists' : 'failed-precondition'
  return new ApiError(code, current && field === 'delivered' ? '此訂單已領票' : '訂單狀態已變更，請重新確認', metadata(order, field, prefix))
}

const rankOfUser = (user: SessionUser) => (user.role ? ROLE_RANK[user.role] : 0)

export const adminOrderRoutes = new Hono<AppEnv>()
  // One bounded page of orders, newest first. The dashboard searches by
  // scanning these pages with src/client/utils/orderSearch.js.
  .get('/', requireRole('admin'), valid('query', pageSchema), async (c) => {
    const query = c.req.valid('query')
    const { where, params } = filterSql(query)
    const cursor = parseCursor(query.cursor)
    if (cursor) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))')
      params.push(cursor.createdAt, cursor.createdAt, cursor.id)
    }
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`
    ).bind(...params, query.limit + 1).all<OrderRow>()
    const page = results.slice(0, query.limit)
    const last = page.at(-1)
    return c.json({
      orders: page.map(orderFromRow),
      cursor: last ? `${last.created_at}_${last.id}` : null,
      hasNext: results.length > query.limit
    })
  })
  .get('/summary', requireRole('admin'), valid('query', filtersSchema), async (c) => {
    const { where, params } = filterSql(c.req.valid('query'))
    const row = await c.env.DB.prepare(
      `SELECT count(*) AS orderCount, coalesce(sum(final_total), 0) AS bookedAmount,
              coalesce(sum(CASE WHEN paid = 1 THEN final_total END), 0) AS paidAmount,
              coalesce(sum(delivered), 0) AS deliveredOrderCount
       FROM orders WHERE ${where.join(' AND ')}`
    ).bind(...params).first<{ orderCount: number; bookedAmount: number; paidAmount: number; deliveredOrderCount: number }>()
    return c.json(row!)
  })
  .get('/:id/history', requireRole('manager'), async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM order_history WHERE order_id = ? ORDER BY occurred_at'
    ).bind(orderIdOf(c.req.param('id'))).all<Record<string, unknown>>()
    return c.json({
      history: results.map((h) => ({
        action: h.action, previousValue: h.previous_value === 1, value: h.value === 1,
        actorUid: h.actor_uid, actorName: h.actor_name, occurredAt: iso(h.occurred_at as number),
        codeVerification: h.code_verification, overrideReason: h.override_reason
      }))
    })
  })
  // Check-in: a manager needs the ticket's QR code; an admin may override it
  // with a reason, and only an admin may undo a check-in.
  .post('/:id/delivery', requireRole('manager'), valid('json', orderInput('delivered', 'expectedDelivered')), async (c) => {
    const user = c.get('user')!
    const orderId = orderIdOf(c.req.param('id'))
    const body = c.req.valid('json') as { delivered: boolean; expectedDelivered: boolean; ticketCode?: string; overrideReason?: string }
    const order = await currentOrder(c.env.DB, orderId)
    const value = body.delivered
    if (order.delivered !== body.expectedDelivered || order.delivered === value) throw staleStateError(order, 'delivered', 'delivery', value)

    let verification: { codeVerification: string; overrideReason?: string }
    if (!value) {
      if (rankOfUser(user) < ROLE_RANK.admin) throw new ApiError('permission-denied', '只有管理員可以重設領票狀態')
      verification = { codeVerification: 'not_required', overrideReason: requireOverrideReason(body.overrideReason) }
    } else if (body.ticketCode && order.ticketCode && body.ticketCode === order.ticketCode) {
      verification = { codeVerification: 'verified' }
    } else if (rankOfUser(user) < ROLE_RANK.admin) {
      throw new ApiError('permission-denied', '請掃描有效的票券 QR Code；驗證不符需由管理員核對身分')
    } else {
      verification = { codeVerification: 'admin_override', overrideReason: requireOverrideReason(body.overrideReason) }
    }

    const result = await changeStatus(c.env.DB, user, orderId, { field: 'delivered', prefix: 'delivery', value, expected: body.expectedDelivered, verification })
    if (!result) throw staleStateError(await currentOrder(c.env.DB, orderId), 'delivered', 'delivery', value)
    return c.json(result)
  })
  .post('/:id/payment', requireRole('admin'), valid('json', orderInput('paid', 'expectedPaid')), async (c) => {
    const orderId = orderIdOf(c.req.param('id'))
    const body = c.req.valid('json') as { paid: boolean; expectedPaid: boolean }
    const order = await currentOrder(c.env.DB, orderId)
    if (order.paid !== body.expectedPaid || order.paid === body.paid) throw staleStateError(order, 'paid', 'payment', body.paid)
    const result = await changeStatus(c.env.DB, c.get('user')!, orderId, { field: 'paid', prefix: 'payment', value: body.paid, expected: body.expectedPaid })
    if (!result) throw staleStateError(await currentOrder(c.env.DB, orderId), 'paid', 'payment', body.paid)
    return c.json(result)
  })
  // Deleting an order gives its tickets back to the stock and to the buyer's
  // allowance, exactly once: every release statement only matches the token
  // of the delete that succeeded.
  .delete('/:id', requireRole('admin'), async (c) => {
    const db = c.env.DB
    const orderId = orderIdOf(c.req.param('id'))
    const order = await currentOrder(db, orderId)
    const token = crypto.randomUUID()
    const buyerKey = await getBuyerKey(order.customerEmail)
    const deleted = `EXISTS (SELECT 1 FROM orders WHERE id = ?1 AND delete_token = ?2)`
    await db.batch([
      db.prepare('UPDATE orders SET deleted_at = ?3, delete_token = ?2 WHERE id = ?1 AND deleted_at IS NULL').bind(orderId, token, Date.now()),
      db.prepare(
        `UPDATE ticket_types SET sold = max(0, sold - (SELECT quantity FROM order_items WHERE order_id = ?1 AND ticket_type_id = ticket_types.id))
         WHERE id IN (SELECT ticket_type_id FROM order_items WHERE order_id = ?1) AND ${deleted}`
      ).bind(orderId, token),
      db.prepare(
        `UPDATE buyer_purchases SET quantity = max(0, quantity - (SELECT quantity FROM order_items WHERE order_id = ?1 AND ticket_type_id = buyer_purchases.ticket_type_id)), updated_at = ?4
         WHERE email_hash = ?3 AND ticket_type_id IN (SELECT ticket_type_id FROM order_items WHERE order_id = ?1) AND ${deleted}`
      ).bind(orderId, token, buyerKey, Date.now()),
      // mail not yet sent for a deleted order is skipped
      db.prepare(
        `UPDATE mail_jobs SET status = 'skipped', error = 'Order deleted before sending.', available_at = NULL, updated_at = ?3
         WHERE order_id = ?1 AND status IN ('pending', 'retry') AND ${deleted}`
      ).bind(orderId, token, Date.now())
    ])
    // the tickets given back are for sale again
    await invalidateCheckoutGate(c.env)
    return c.json({ ok: true })
  })
  // Each deliberate resend is a new job; a retry of the same action reuses
  // its request id. An uncertain original send never becomes a retry by itself.
  .post('/:id/resend', requireRole('admin'), valid('json', z.object({ requestId: z.string().optional() })), async (c) => {
    const db = c.env.DB
    const orderId = orderIdOf(c.req.param('id'))
    const { requestId } = c.req.valid('json')
    if (requestId != null && !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw new ApiError('invalid-argument', '重寄請求編號無效')
    const order = await currentOrder(db, orderId)
    if (!order.customerEmail) throw new ApiError('failed-precondition', '訂單沒有 Email')
    const jobId = `resend_${orderId}_${requestId || crypto.randomUUID()}`
    const now = Date.now()
    const [inserted] = await db.batch([
      mailJobInsert(db, { id: jobId, kind: 'confirmation', purpose: 'manual-resend', orderId, recipientCount: 1, buyerCount: 1, createdBy: c.get('user')!.id, now }),
      db.prepare(
        `UPDATE orders SET email_status = 'queued', email_job_id = ?2, email_error = NULL, email_updated_at = ?3
         WHERE id = ?1 AND EXISTS (SELECT 1 FROM mail_jobs WHERE id = ?2 AND created_at = ?3)`
      ).bind(orderId, jobId, now)
    ])
    if (inserted.meta.changes) await c.env.MAIL_QUEUE.send({ jobId })
    const job = await db.prepare('SELECT status FROM mail_jobs WHERE id = ?').bind(jobId).first<{ status: string }>()
    const status = ['pending', 'retry'].includes(job?.status || '') ? 'queued' : job?.status || 'queued'
    return c.json({ jobId, status, emailStatus: status, created: inserted.meta.changes > 0 })
  })
