// Super admin tools: ticket types, the shop's opening time, staff accounts,
// the intro stories and lineup (with images in R2). Plus the survey results
// managers may read.
import { Hono } from 'hono'
import { valid } from '../validate'
import { z } from 'zod'
import { isRole } from '../auth'
import { requireRole, type AppEnv } from '../context'
import { ApiError } from '../errors'
import { iso, ticketTypeFromRow, type TicketTypeRow } from '../data/rows'
import { lineupFromRow, mediaUrl, storyFromRow, type LineupRow, type StoryRow } from '../data/content'
import { parseTaipeiDateTime } from '../domain/time.js'
import { invalidateCheckoutGate } from '../checkoutGate'
import { getStockLimit, TICKET_TYPE_ID_PATTERN } from '../domain/orderValidation.js'

const MAX_IMAGE_BYTES = 7 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png'])
const CONTENT_ID = /^[\w-]{1,100}$/

const ticketTypesBody = z.object({ types: z.array(z.record(z.string(), z.unknown())).max(100) })

function publishAtMs(value: unknown) {
  const date = parseTaipeiDateTime(value)
  if (!date) throw new ApiError('invalid-argument', '請設定公開時間')
  return date.getTime()
}

const storyBody = z.object({
  title: z.string().max(200),
  subtitle: z.string().max(500).default(''),
  content: z.string().max(20000),
  publishAt: z.string().max(40),
  order: z.coerce.number().int().default(0),
  enabled: z.boolean().default(true)
})

const lineupBody = z.object({
  type: z.string().max(50).default(''),
  name: z.string().max(200).default(''),
  title: z.string().max(200).default(''),
  content: z.string().max(20000).default(''),
  publishAt: z.string().max(40),
  imageStoragePath: z.string().max(300).default('')
})

const imageBody = z.object({
  filename: z.string().max(300).optional(),
  contentType: z.string().max(50),
  // base64; the browser resizes and converts to WebP before uploading
  fileData: z.string().max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8)
})

const isLineupKey = (key: string) => /^lineup\/[\w-]+\/[\w.-]+$/.test(key) && !key.includes('..')

export const adminSiteRoutes = new Hono<AppEnv>()
  /* ---------- ticket types and opening time ---------- */
  // The whole list is saved at once, as the management page edits it. A type
  // dropped from the list keeps its row (inactive) when it has sales, so its
  // stock can be given back if an order is deleted.
  // Every ticket type, on sale or not, for the management page
  .get('/ticket-types', requireRole('super_admin'), async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM ticket_types WHERE active = 1 ORDER BY sort').all<TicketTypeRow>()
    return c.json({ types: results.map(ticketTypeFromRow) })
  })
  .put('/ticket-types', requireRole('super_admin'), valid('json', ticketTypesBody), async (c) => {
    const db = c.env.DB
    const { types } = c.req.valid('json')
    const now = Date.now()
    const uid = c.get('user')!.id
    const ids = new Set<string>()
    for (const type of types) {
      const id = String(type.id || '')
      if (!TICKET_TYPE_ID_PATTERN.test(id) || ids.has(id)) throw new ApiError('invalid-argument', `票種代碼無效或重複：${id}`)
      if (!String(type.name || '').trim()) throw new ApiError('invalid-argument', '請填寫票種名稱')
      ids.add(id)
    }
    const { results: existing } = await db.prepare('SELECT id, sold FROM ticket_types').all<{ id: string; sold: number }>()
    for (const type of types) {
      const stock = getStockLimit(type)
      const sold = existing.find((row) => row.id === type.id)?.sold ?? 0
      if (stock !== null && stock < sold) {
        throw new ApiError('failed-precondition', `${type.name}的總票數不可少於已售出的 ${sold} 張`)
      }
    }
    await db.batch([
      ...types.map((type, index) =>
        db.prepare(
          `INSERT INTO ticket_types (id, sort, active, config, stock, sold, updated_at, updated_by_uid)
           VALUES (?1, ?2, 1, ?3, ?4, 0, ?5, ?6)
           ON CONFLICT (id) DO UPDATE SET sort = excluded.sort, active = 1, config = excluded.config,
             stock = excluded.stock, updated_at = excluded.updated_at, updated_by_uid = excluded.updated_by_uid`
        ).bind(type.id, index, JSON.stringify(type), getStockLimit(type), now, uid)
      ),
      db.prepare(
        `DELETE FROM ticket_types WHERE sold = 0 AND id NOT IN (SELECT value FROM json_each(?1))`
      ).bind(JSON.stringify([...ids])),
      db.prepare(
        `UPDATE ticket_types SET active = 0, updated_at = ?2 WHERE id NOT IN (SELECT value FROM json_each(?1))`
      ).bind(JSON.stringify([...ids]), now)
    ])
    await invalidateCheckoutGate(c.env)
    const { results } = await db.prepare('SELECT * FROM ticket_types WHERE active = 1 ORDER BY sort').all<TicketTypeRow>()
    return c.json({ types: results.map(ticketTypeFromRow) })
  })
  // Ticket sales so far, per type (for the management page)
  .get('/ticket-sales', requireRole('admin'), async (c) => {
    const { results } = await c.env.DB.prepare('SELECT id, sold, stock, active FROM ticket_types ORDER BY sort').all()
    return c.json({ sales: results })
  })
  // openAt null means "open now", by the server's clock
  .put('/shop', requireRole('super_admin'), valid('json', z.object({ openAt: z.string().max(40).nullable() })), async (c) => {
    const { openAt } = c.req.valid('json')
    const date = openAt === null ? new Date() : parseTaipeiDateTime(openAt)
    if (!date) throw new ApiError('invalid-argument', '開賣時間格式錯誤')
    await c.env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by_uid) VALUES ('shop', ?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by_uid = excluded.updated_by_uid`
    ).bind(JSON.stringify({ openAt: date.toISOString() }), Date.now(), c.get('user')!.id).run()
    return c.json({ openAt: date.toISOString() })
  })
  .delete('/shop', requireRole('super_admin'), async (c) => {
    await c.env.DB.prepare(`DELETE FROM settings WHERE key = 'shop'`).run()
    return c.json({ openAt: null })
  })

  /* ---------- staff accounts and invites ---------- */
  .get('/staff', requireRole('super_admin'), async (c) => {
    const db = c.env.DB
    const [users, invites] = await db.batch([
      db.prepare('SELECT id, email, name, image, role, staffName, createdAt FROM user WHERE role IS NOT NULL ORDER BY email'),
      db.prepare('SELECT email, role, name, created_at FROM staff_invites ORDER BY email')
    ])
    return c.json({
      users: [
        ...(users.results as Record<string, string>[]).map((u) => ({
          id: u.id, email: u.email, name: u.staffName || '', displayName: u.name, photoURL: u.image || '',
          role: u.role, pending: false
        })),
        ...(invites.results as Record<string, string | number>[]).map((i) => ({
          id: i.email as string, email: i.email as string, name: i.name as string, role: i.role as string, pending: true,
          createdAt: iso(i.created_at as number)
        }))
      ]
    })
  })
  .post('/staff/invites', requireRole('super_admin'), valid('json', z.object({
    email: z.string().max(254), name: z.string().max(100).default(''), role: z.string()
  })), async (c) => {
    const { email: raw, name, role } = c.req.valid('json')
    const email = raw.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('invalid-argument', 'Email 格式不正確')
    if (!isRole(role)) throw new ApiError('invalid-argument', '角色無效')
    const db = c.env.DB
    const existing = await db.prepare('SELECT id FROM user WHERE lower(email) = ? AND role IS NOT NULL').bind(email).first()
    if (existing) throw new ApiError('already-exists', '此 Email 已建立過帳號')
    await db.prepare(
      `INSERT INTO staff_invites (email, role, name, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET role = excluded.role, name = excluded.name`
    ).bind(email, role, name.trim(), Date.now()).run()
    // An account that already exists (a buyer) becomes staff on its next sign-in
    return c.json({ id: email, email, name: name.trim(), role, pending: true })
  })
  .patch('/staff/:id', requireRole('super_admin'), valid('json', z.object({ role: z.string(), pending: z.boolean() })), async (c) => {
    const { role, pending } = c.req.valid('json')
    if (!isRole(role)) throw new ApiError('invalid-argument', '角色無效')
    const id = c.req.param('id')
    const db = c.env.DB
    const stmt = pending
      ? db.prepare('UPDATE staff_invites SET role = ? WHERE email = ?').bind(role, id)
      : db.prepare(`UPDATE user SET role = ? WHERE id = ? AND role IS NOT NULL`).bind(role, id)
    if ((await stmt.run()).meta.changes === 0) throw new ApiError('not-found', '找不到使用者')
    return c.json({ ok: true })
  })
  // Removing a staff account takes its role away (the Google account stays,
  // as a buyer) and signs it out everywhere.
  .delete('/staff/:id', requireRole('super_admin'), valid('query', z.object({ pending: z.enum(['true', 'false']).default('false') })), async (c) => {
    const id = c.req.param('id')
    const db = c.env.DB
    if (c.req.valid('query').pending === 'true') {
      await db.prepare('DELETE FROM staff_invites WHERE email = ?').bind(id).run()
    } else {
      if (id === c.get('user')!.id) throw new ApiError('failed-precondition', '不能刪除自己的帳號')
      await db.batch([
        db.prepare('UPDATE user SET role = NULL, staffName = NULL WHERE id = ?').bind(id),
        db.prepare('DELETE FROM session WHERE userId = ?').bind(id)
      ])
    }
    return c.json({ ok: true })
  })
  // Removes every manager / admin account and invite. Super admins (including
  // yourself) are kept so the system can never be left without one.
  .post('/staff/delete-all', requireRole('super_admin'), async (c) => {
    const db = c.env.DB
    const self = c.get('user')!.id
    const [, users, invites] = await db.batch([
      db.prepare(`DELETE FROM session WHERE userId IN (SELECT id FROM user WHERE role IN ('manager', 'admin') AND id != ?)`).bind(self),
      db.prepare(`UPDATE user SET role = NULL, staffName = NULL WHERE role IN ('manager', 'admin') AND id != ?`).bind(self),
      db.prepare(`DELETE FROM staff_invites WHERE role != 'super_admin'`)
    ])
    return c.json({ deleted: users.meta.changes + invites.meta.changes })
  })

  /* ---------- intro stories ---------- */
  .get('/content/stories', requireRole('super_admin'), async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM party_stories ORDER BY sort, publish_at').all<StoryRow>()
    return c.json({ items: results.map(storyFromRow) })
  })
  .put('/content/stories/:id', requireRole('super_admin'), valid('json', storyBody), async (c) => {
    const id = c.req.param('id')
    if (!CONTENT_ID.test(id)) throw new ApiError('invalid-argument', '內容編號無效')
    const s = c.req.valid('json')
    await c.env.DB.prepare(
      `INSERT INTO party_stories (id, title, subtitle, content, publish_at, sort, enabled, updated_at, updated_by_uid)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT (id) DO UPDATE SET title = excluded.title, subtitle = excluded.subtitle, content = excluded.content,
         publish_at = excluded.publish_at, sort = excluded.sort, enabled = excluded.enabled,
         updated_at = excluded.updated_at, updated_by_uid = excluded.updated_by_uid`
    ).bind(id, s.title.trim(), s.subtitle.trim(), s.content.trim(), publishAtMs(s.publishAt), s.order, s.enabled ? 1 : 0, Date.now(), c.get('user')!.id).run()
    return c.json({ ok: true })
  })
  .delete('/content/stories/:id', requireRole('super_admin'), async (c) => {
    await c.env.DB.prepare('DELETE FROM party_stories WHERE id = ?').bind(c.req.param('id')).run()
    return c.json({ ok: true })
  })

  /* ---------- lineup ---------- */
  .get('/content/lineup', requireRole('super_admin'), async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM party_lineup ORDER BY publish_at').all<LineupRow>()
    return c.json({ items: results.map(lineupFromRow) })
  })
  // The image is uploaded first; the item is written only after the upload
  // succeeded, so a failed upload leaves nothing behind (PARTY-21).
  .put('/content/lineup/:id', requireRole('super_admin'), valid('json', lineupBody), async (c) => {
    const id = c.req.param('id')
    if (!CONTENT_ID.test(id)) throw new ApiError('invalid-argument', '內容編號無效')
    const item = c.req.valid('json')
    const imageKey = item.imageStoragePath || null
    if (imageKey && !isLineupKey(imageKey)) throw new ApiError('invalid-argument', '圖片路徑無效')
    const now = Date.now()
    const uid = c.get('user')!.id
    await c.env.DB.prepare(
      `INSERT INTO party_lineup (id, type, name, title, content, publish_at, image_key, created_at, created_by_uid, updated_at, updated_by_uid)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?8, ?9)
       ON CONFLICT (id) DO UPDATE SET type = excluded.type, name = excluded.name, title = excluded.title, content = excluded.content,
         publish_at = excluded.publish_at, image_key = excluded.image_key, updated_at = excluded.updated_at, updated_by_uid = excluded.updated_by_uid`
    ).bind(id, item.type, item.name.trim(), item.title.trim(), item.content.trim(), publishAtMs(item.publishAt), imageKey, now, uid).run()
    return c.json({ ok: true })
  })
  .delete('/content/lineup/:id', requireRole('super_admin'), async (c) => {
    await c.env.DB.prepare('DELETE FROM party_lineup WHERE id = ?').bind(c.req.param('id')).run()
    return c.json({ ok: true })
  })
  .post('/media/lineup/:itemId', requireRole('super_admin'), valid('json', imageBody), async (c) => {
    const itemId = c.req.param('itemId')
    if (!CONTENT_ID.test(itemId)) throw new ApiError('invalid-argument', '內容編號無效')
    const { contentType, fileData } = c.req.valid('json')
    if (!IMAGE_TYPES.has(contentType)) throw new ApiError('invalid-argument', '只接受 JPG、PNG 或 WebP 圖片')
    let bytes: Uint8Array
    try {
      bytes = Uint8Array.from(atob(fileData), (ch) => ch.charCodeAt(0))
    } catch {
      throw new ApiError('invalid-argument', '圖片資料格式錯誤')
    }
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new ApiError('invalid-argument', '圖片需小於 7MB')
    const ext = contentType === 'image/webp' ? 'webp' : contentType === 'image/png' ? 'png' : 'jpg'
    const key = `lineup/${itemId}/${Date.now()}.${ext}`
    await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } })
    return c.json({ url: mediaUrl(key), storagePath: key })
  })
  .delete('/media', requireRole('super_admin'), valid('json', z.object({ storagePath: z.string().max(300) })), async (c) => {
    const { storagePath } = c.req.valid('json')
    if (!isLineupKey(storagePath)) throw new ApiError('invalid-argument', '圖片路徑無效')
    await c.env.MEDIA.delete(storagePath)
    return c.json({ ok: true })
  })

  /* ---------- survey results ---------- */
  .get('/survey', requireRole('manager'), async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM survey_responses ORDER BY id').all<Record<string, string | number>>()
    return c.json({
      responses: results.map((r) => ({
        id: String(r.id), identity: r.identity, channels: JSON.parse(r.channels as string), device: r.device,
        scores: JSON.parse(r.scores as string), issueCount: r.issue_count, issueTypes: JSON.parse(r.issue_types as string),
        improvement: r.improvement, suggestion: r.suggestion, createdAt: iso(r.created_at as number)
      }))
    })
  })
  .delete('/survey/:id', requireRole('super_admin'), async (c) => {
    await c.env.DB.prepare('DELETE FROM survey_responses WHERE id = ?').bind(Number(c.req.param('id'))).run()
    return c.json({ ok: true })
  })
