// What anyone may read: ticket types, the shop's opening time and published
// content. Ticket types outside their sale window, unpublished content and
// disabled stories never leave the server (staff see every ticket type).
import { Hono } from 'hono'
import { staffRole, type AppEnv } from '../context'
import { isOnSale } from '../domain/orderValidation.js'
import { getSetting, listTicketTypes } from '../data/settings'
import { iso } from '../data/rows'
import { storyFromRow, lineupFromRow, type StoryRow, type LineupRow } from '../data/content'

// Clients whose clock runs slightly ahead may still see items about to publish
const PUBLISH_SLACK_MS = 5 * 60 * 1000

export const publicRoutes = new Hono<AppEnv>()
  // Staff see every type, to preview them and to order before the sale
  // opens (the checkout lets them); everyone else only the ones on sale now.
  .get('/ticket-types', async (c) => {
    const user = c.get('user')
    const [types, isStaff] = await Promise.all([
      listTicketTypes(c.env.DB),
      user ? staffRole(c.env.DB, user.id).then(({ rank }) => rank > 0) : false
    ])
    const now = new Date()
    // the answer depends on who asks
    c.header('Cache-Control', 'private, no-store')
    return c.json({ types: isStaff ? types : types.filter((type) => isOnSale(type, now)) })
  })
  .get('/shop', async (c) => {
    const shop = await getSetting<{ openAt?: string | null }>(c.env.DB, 'shop')
    return c.json({ openAt: shop?.openAt ?? null, serverTime: iso(Date.now())! })
  })
  .get('/stories', async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM party_stories WHERE enabled = 1 AND publish_at <= ? ORDER BY sort, publish_at'
    ).bind(Date.now() + PUBLISH_SLACK_MS).all<StoryRow>()
    return c.json({ items: results.map(storyFromRow) })
  })
  .get('/lineup', async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM party_lineup WHERE publish_at <= ? ORDER BY publish_at'
    ).bind(Date.now() + PUBLISH_SLACK_MS).all<LineupRow>()
    return c.json({ items: results.map(lineupFromRow) })
  })
