// Payment / pickup notifications to buyers (replaces prepareOrderNotification,
// sendOrderNotification and getOrderNotificationStatus).
// Preparing freezes the recipients and the message; the caller confirms the
// count before sending puts one deterministic mail job per batch on the queue.
import { Hono } from 'hono'
import { valid } from '../validate'
import { z } from 'zod'
import { requireRole, type AppEnv } from '../context'
import { ApiError } from '../errors'
import { MAX_BCC_PER_BATCH, NOTIFY_TYPES, notificationProgress, resolveSubject } from '../domain/mailRules.js'
import { mailJobInsert } from '../mail/jobs'
import { SENDER_EMAIL } from '../mail/ses'

const MAX_RECIPIENTS = 10_000
const JOB_ID_PATTERN = /^[A-Za-z0-9]{1,40}$/

const field = (limit: number) => z.string().max(limit, '內容過長').default('').transform((value) => value.trim())

const prepareBody = z.object({
  type: z.string().default('payment'),
  school: field(500),
  paymentTime: field(500),
  pickupTime: field(500),
  location: field(500),
  message: field(8000),
  subject: field(200)
})

function validateNotification(type: string, { paymentTime, pickupTime, location, message }: Record<string, string>) {
  if (type === 'custom') {
    if (!message) throw new ApiError('invalid-argument', '請提供訊息內容')
    return
  }
  if (!location) throw new ApiError('invalid-argument', '請提供地點')
  if ((type === 'payment' || type === 'both') && !paymentTime) throw new ApiError('invalid-argument', '請提供繳費時間')
  if ((type === 'pickup' || type === 'both') && !pickupTime) throw new ApiError('invalid-argument', '請提供取票時間')
}

const isSendable = (email: string) =>
  email && email.length <= 320 && email !== SENDER_EMAIL && !email.startsWith('no-reply@') && !email.startsWith('noreply@')

async function progressOf(db: D1Database, jobId: string) {
  if (!JOB_ID_PATTERN.test(jobId)) throw new ApiError('invalid-argument', '寄送紀錄無效，請重新整理頁面後再試')
  const job = await db.prepare('SELECT total FROM notification_jobs WHERE id = ?').bind(jobId).first<{ total: number }>()
  if (!job) throw new ApiError('not-found', '找不到這次寄送紀錄')
  const { results } = await db.prepare('SELECT status, buyer_count AS buyerCount FROM mail_jobs WHERE notification_job_id = ?')
    .bind(jobId).all<{ status: string; buyerCount: number }>()
  const progress = notificationProgress(jobId, job.total, results)
  await db.prepare('UPDATE notification_jobs SET status = ?, updated_at = ? WHERE id = ?').bind(progress.status, Date.now(), jobId).run()
  return progress
}

export const notificationRoutes = new Hono<AppEnv>()
  .post('/', requireRole('manager'), valid('json', prepareBody), async (c) => {
    const db = c.env.DB
    const body = c.req.valid('json')
    const type = NOTIFY_TYPES.includes(body.type) ? body.type : 'payment'
    const school = body.school || 'all'
    const fields = { paymentTime: body.paymentTime, pickupTime: body.pickupTime, location: body.location, message: body.message }
    validateNotification(type, fields)

    const { results } = await db.prepare(
      `SELECT DISTINCT lower(trim(customer_email)) AS email FROM orders
       WHERE deleted_at IS NULL ${school === 'all' ? '' : 'AND school = ?'} ORDER BY email`
    ).bind(...(school === 'all' ? [] : [school])).all<{ email: string }>()
    const recipients = results.map((r) => r.email).filter(isSendable)
    if (recipients.length > MAX_RECIPIENTS) throw new ApiError('resource-exhausted', '收件人過多，請依學校分批建立通知')
    if (!recipients.length) return c.json({ status: 'empty' as const, jobId: null, sentCount: 0, total: 0, pendingEnqueueCount: 0 })

    const jobId = crypto.randomUUID().replace(/-/g, '').slice(0, 20)
    const now = Date.now()
    const batches = []
    for (let start = 0; start < recipients.length; start += MAX_BCC_PER_BATCH) {
      batches.push(db.prepare('INSERT INTO notification_batches (job_id, start, recipients) VALUES (?, ?, ?)')
        .bind(jobId, start, JSON.stringify(recipients.slice(start, start + MAX_BCC_PER_BATCH))))
    }
    await db.batch([
      db.prepare(
        `INSERT INTO notification_jobs (id, type, school, subject, fields, total, batch_count, status, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'ready', ?8, ?9, ?9)`
      ).bind(jobId, type, school, resolveSubject(type, body.subject), JSON.stringify(fields), recipients.length, batches.length,
        c.get('user')!.id, now),
      ...batches
    ])
    return c.json({ status: 'ready' as const, jobId, sentCount: 0, total: recipients.length, pendingEnqueueCount: recipients.length })
  })
  // Safe to call again with the same job after an interruption: existing
  // batches (accepted, failed or uncertain) are never reset or resent.
  .post('/:jobId/send', requireRole('manager'), async (c) => {
    const db = c.env.DB
    const jobId = c.req.param('jobId')
    if (!JOB_ID_PATTERN.test(jobId)) throw new ApiError('invalid-argument', '寄送紀錄無效，請重新整理頁面後再試')
    const job = await db.prepare('SELECT * FROM notification_jobs WHERE id = ?').bind(jobId).first<Record<string, string>>()
    if (!job) throw new ApiError('not-found', '找不到這次寄送紀錄')
    const { results: batches } = await db.prepare('SELECT start, recipients FROM notification_batches WHERE job_id = ? ORDER BY start')
      .bind(jobId).all<{ start: number; recipients: string }>()
    const now = Date.now()
    const fields = JSON.parse(job.fields)
    const createdBy = c.get('user')!.id
    const jobs = batches.map(({ start, recipients }) => {
      const list = JSON.parse(recipients) as string[]
      return {
        id: `notification_${jobId}_${start}`, kind: 'notification' as const, notificationJobId: jobId, type: job.type,
        subject: job.subject, fields, recipients: list, buyerCount: list.length, recipientCount: list.length + 1, createdBy, now
      }
    })
    const inserted = await db.batch([
      ...jobs.map((j) => mailJobInsert(db, j)),
      db.prepare(`UPDATE notification_jobs SET status = 'queued', queued_at = coalesce(queued_at, ?2) WHERE id = ?1`).bind(jobId, now)
    ])
    const fresh = jobs.filter((_, i) => inserted[i].meta.changes > 0)
    for (let i = 0; i < fresh.length; i += 100) {
      await c.env.MAIL_QUEUE.sendBatch(fresh.slice(i, i + 100).map((j) => ({ body: { jobId: j.id } })))
    }
    return c.json(await progressOf(db, jobId))
  })
  .get('/:jobId', requireRole('manager'), async (c) => c.json(await progressOf(c.env.DB, c.req.param('jobId'))))
