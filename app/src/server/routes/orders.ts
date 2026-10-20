// The signed-in buyer's checkout and orders
import { Hono } from 'hono'
import { valid } from '../validate'
import { z } from 'zod'
import { currentUser, staffRole, type AppEnv } from '../context'
import { checkout } from '../checkout'
import { ApiError } from '../errors'
import { orderFromRow, type OrderRow } from '../data/rows'
import { ORDER_ID_PATTERN } from '../domain/orderValidation.js'

const checkoutBody = z.object({
  orderPayload: z.unknown().optional(),
  requestId: z.string().max(100).optional(),
  turnstileToken: z.string().max(4096).optional()
})

export const orderRoutes = new Hono<AppEnv>()
  .post('/', valid('json', checkoutBody), async (c) => {
    const user = currentUser(c)
    const result = await checkout(c.env, user, c.req.valid('json'), { remoteip: c.req.header('cf-connecting-ip') ?? null, timing: c.get('timing') })
    return c.json({ status: result.status, id: result.id }, result.status)
  })
  .get('/', async (c) => {
    const user = currentUser(c)
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM orders WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC'
    ).bind(user.id).all<OrderRow>()
    return c.json({ orders: results.map(orderFromRow) })
  })
  // One order: buyers get only their own, staff (managers, at the door) any.
  // A missing order and someone else's both come back as not found.
  .get('/:id', async (c) => {
    const user = currentUser(c)
    const id = c.req.param('id')
    if (!ORDER_ID_PATTERN.test(id)) throw new ApiError('not-found', '找不到訂單')
    const row = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL').bind(id).first<OrderRow>()
    if (!row || (row.user_id !== user.id && (await staffRole(c.env.DB, user.id)).rank < 1)) {
      throw new ApiError('not-found', '找不到訂單')
    }
    return c.json({ order: orderFromRow(row) })
  })
