// What anyone may read: ticket types, the shop's opening time and published
// content. Unpublished content (and disabled stories) never leaves the server.
import { Hono } from 'hono'
import type { AppEnv } from '../context'
import { getSetting, listTicketTypes } from '../data/settings'
import { iso } from '../data/rows'
import { storyFromRow, lineupFromRow, type StoryRow, type LineupRow } from '../data/content'

// Clients whose clock runs slightly ahead may still see items about to publish
const PUBLISH_SLACK_MS = 5 * 60 * 1000

export const publicRoutes = new Hono<AppEnv>()
  .get('/ticket-types', async (c) => {
    return c.json({ types: await listTicketTypes(c.env.DB) })
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
