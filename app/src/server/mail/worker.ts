// Sending one mail job (the queue consumer) and the cron sweep. Ported from
// functions/lib/mailQueueCore.js with the same outcome rules:
//   pending/retry -> sending -> accepted | failed | uncertain | skipped
// Only an explicit SES rejection is retried. A timeout, a 5xx or a crash
// after the send began may follow acceptance, so the job becomes uncertain
// and is never sent again automatically (staff resend deliberately).
// The queue consumer runs one batch at a time (max_concurrency 1) and paces
// every mail source together through mail_control.next_send_at.
import type { Env } from '../env'
import {
  MAIL_LEASE_MS,
  MAIL_MAX_ATTEMPTS,
  MAIL_SEND_TIMEOUT_MS,
  NOTIFY_TO,
  batchDelayMs,
  isExplicitMailRejection,
  retryDelayMs
} from '../domain/mailRules.js'
import { getBuyerOrderUrl } from '../domain/constants.js'
import { generateEmailHTML } from '../templates/orderConfirmation.js'
import { generateOrderNotificationHTML } from '../templates/notification.js'
import { heroAttachment } from '../templates/shared.js'
import { orderFromRow, type OrderRow } from '../data/rows'
import { sesSender, toBase64, type MailMessage, type Send } from './ses'
import { ticketQrPng } from './qr'

export interface MailJobRow {
  id: string
  kind: string
  purpose: string | null
  order_id: string | null
  notification_job_id: string | null
  type: string | null
  subject: string | null
  fields: string | null
  recipients: string | null
  recipient_count: number
  buyer_count: number
  status: string
  attempts: number
  available_at: number | null
}

interface Outcome {
  status: 'retry' | 'accepted' | 'failed' | 'uncertain' | 'skipped'
  error?: string
  providerMessageId?: string
  availableAt?: number
}

export interface WorkerDeps {
  send?: Send
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  sendTimeoutMs?: number
}

// Slack for a queue redelivery arriving a moment before the job's retry time
const EARLY_SLACK_MS = 2000

// The order's email status follows its current job only: an old
// confirmation must not overwrite a newer deliberate resend.
function orderEmailUpdate(db: D1Database, job: Pick<MailJobRow, 'id' | 'order_id'>, outcome: Outcome | { status: 'sending' }, now: number) {
  const o = outcome as Outcome
  return db.prepare(
    `UPDATE orders SET email_status = ?1, email_error = ?2, email_updated_at = ?3,
       email_provider_message_id = coalesce(?4, email_provider_message_id)
     WHERE id = ?5 AND email_job_id = ?6`
  ).bind(o.status, o.error ?? null, now, o.providerMessageId ?? null, job.order_id, job.id)
}

async function buildMessage(env: Env, job: MailJobRow): Promise<MailMessage | null> {
  const hero = heroAttachment()
  if (job.kind === 'notification') {
    return {
      to: NOTIFY_TO,
      bcc: JSON.parse(job.recipients || '[]'),
      subject: job.subject || '',
      html: generateOrderNotificationHTML({ type: job.type, ...JSON.parse(job.fields || '{}') }),
      attachments: [hero]
    }
  }
  if (job.kind !== 'confirmation') throw new Error('Unsupported mail job kind')
  const row = await env.DB.prepare('SELECT * FROM orders WHERE id = ? AND deleted_at IS NULL').bind(job.order_id).first<OrderRow>()
  if (!row || !row.customer_email) return null
  const order = orderFromRow(row)
  const qr = await ticketQrPng(order.id, order.ticketCode)
  return {
    to: order.customerEmail,
    subject: `建中舞會購票系統購票成功 - 票券編號：${order.id}`,
    html: generateEmailHTML(order.id, order, getBuyerOrderUrl(order.id)),
    attachments: [{ filename: 'ticket-qrcode.png', contentType: 'image/png', base64: toBase64(qr), cid: 'qrcode' }, hero]
  }
}

async function checkpoint(db: D1Database, job: MailJobRow, outcome: Outcome, now: number) {
  await db.batch([
    db.prepare(
      `UPDATE mail_jobs SET status = ?1, error = ?2, provider_message_id = coalesce(?3, provider_message_id),
         accepted_at = CASE WHEN ?1 = 'accepted' THEN ?4 ELSE accepted_at END,
         available_at = ?5, lease_until = NULL, updated_at = ?4
       WHERE id = ?6 AND status = 'sending'`
    ).bind(outcome.status, outcome.error ?? null, outcome.providerMessageId ?? null, now, outcome.availableAt ?? null, job.id),
    ...(job.order_id ? [orderEmailUpdate(db, job, outcome, now)] : [])
  ])
}

/**
 * Sends the job if it is due. Returns how long to wait before the queue
 * should deliver it again (an explicit rejection being retried, or a
 * redelivery that came early), or null when the queue is done with it.
 */
export async function processMailJob(env: Env, jobId: string, deps: WorkerDeps = {}): Promise<number | null> {
  const db = env.DB
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const send = deps.send ?? sesSender(env)
  const sendTimeoutMs = deps.sendTimeoutMs ?? MAIL_SEND_TIMEOUT_MS
  const recipientsPerSecond = Number(env.SES_RECIPIENTS_PER_SECOND) || 14

  const claimedAt = now()
  const [claimed] = await db.batch<MailJobRow>([
    db.prepare(
      `UPDATE mail_jobs SET status = 'sending', attempts = attempts + 1, lease_until = ?2, send_started_at = ?1,
         available_at = NULL, updated_at = ?1
       WHERE id = ?3 AND status IN ('pending', 'retry') AND coalesce(available_at, 0) <= ?1 + ${EARLY_SLACK_MS}
       RETURNING *`
    ).bind(claimedAt, claimedAt + MAIL_LEASE_MS, jobId),
    db.prepare(
      `UPDATE orders SET email_status = 'sending', email_updated_at = ?1
       WHERE email_job_id = ?2 AND EXISTS (SELECT 1 FROM mail_jobs WHERE id = ?2 AND status = 'sending' AND send_started_at = ?1)`
    ).bind(claimedAt, jobId)
  ])
  const job = claimed.results[0]
  if (!job) {
    // Already handled (a duplicate delivery), or a retry that is not due yet
    const waiting = await db.prepare(`SELECT available_at FROM mail_jobs WHERE id = ? AND status IN ('pending', 'retry')`)
      .bind(jobId).first<{ available_at: number | null }>()
    return waiting?.available_at ? Math.max(1000, waiting.available_at - now()) : null
  }

  let message: MailMessage | null
  try {
    message = await buildMessage(env, job)
  } catch (error) {
    // No provider call has begun, so rendering/read failures can be retried
    // safely within the same bounded attempt policy.
    const retry = job.attempts < MAIL_MAX_ATTEMPTS
    const availableAt = retry ? now() + retryDelayMs(job.attempts) : undefined
    await checkpoint(db, job, { status: retry ? 'retry' : 'failed', error: String((error as Error).message).slice(0, 500), availableAt }, now())
    return availableAt ? availableAt - now() : null
  }
  if (!message) {
    await checkpoint(db, job, { status: 'skipped', error: 'Order no longer exists or has no recipient.' }, now())
    return null
  }

  // Reserve this send's share of the SES rate before the external side
  // effect, so every mail source is paced together.
  const delay = batchDelayMs(job.recipient_count, recipientsPerSecond)
  const slot = await db.prepare(
    `UPDATE mail_control SET next_send_at = max(next_send_at, ?1) + ?2 WHERE id = 'global' RETURNING next_send_at - ?2 AS start_at`
  ).bind(now(), delay).first<{ start_at: number }>()
  const startAt = slot?.start_at ?? now()
  if (startAt > now()) await sleep(startAt - now())

  let outcome: Outcome
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const info = await Promise.race([
      send(message),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('SES response timeout; acceptance is unknown.')), sendTimeoutMs)
      })
    ])
    // Only SES's message id is evidence that it accepted the message
    outcome = info.providerMessageId
      ? { status: 'accepted', providerMessageId: info.providerMessageId }
      : { status: 'uncertain', error: 'Provider response omitted a message ID; review SES before resending.' }
  } catch (error) {
    const explicit = isExplicitMailRejection(error)
    const retry = explicit && job.attempts < MAIL_MAX_ATTEMPTS
    outcome = {
      status: retry ? 'retry' : explicit ? 'failed' : 'uncertain',
      error: String((error as Error)?.message || error).slice(0, 500),
      ...(retry ? { availableAt: now() + retryDelayMs(job.attempts) } : {})
    }
  } finally {
    clearTimeout(timeout)
  }

  try {
    await checkpoint(db, job, outcome, now())
  } catch (error) {
    // Never send again because a successful send was not checkpointed: the
    // expired lease turns the job uncertain in the cron sweep.
    console.error('[mail] checkpoint failed', job.id, outcome.providerMessageId || '', (error as Error).message)
    return null
  }
  return outcome.availableAt ? outcome.availableAt - now() : null
}

// Queue consumer: one message per mail job
export async function consumeMailBatch(batch: MessageBatch<{ jobId: string }>, env: Env, deps: WorkerDeps = {}) {
  for (const message of batch.messages) {
    try {
      const waitMs = await processMailJob(env, message.body.jobId, deps)
      if (waitMs == null) message.ack()
      else message.retry({ delaySeconds: Math.min(43_200, Math.ceil(waitMs / 1000)) })
    } catch (error) {
      // The job was not claimed (or its claim is recoverable): try again later
      console.error('[mail] job failed before sending', message.body.jobId, error)
      message.retry({ delaySeconds: 30 })
    }
  }
}

// How long a due job may wait before the sweep puts it on the queue again
// (its message was lost, or enqueueing failed after the order was saved)
const REQUEUE_AFTER_MS = 10 * 60 * 1000

// Cron: recover interrupted sends, re-enqueue stranded jobs, expire old rows
export async function sweepMail(env: Env, now = Date.now()) {
  const db = env.DB
  const { results: stale } = await db.prepare(
    `SELECT id, order_id FROM mail_jobs WHERE status = 'sending' AND lease_until <= ? LIMIT 100`
  ).bind(now).all<Pick<MailJobRow, 'id' | 'order_id'>>()
  for (const job of stale) {
    const outcome: Outcome = { status: 'uncertain', error: 'Worker interrupted after send was reserved; review SES before any deliberate resend.' }
    await db.batch([
      db.prepare(`UPDATE mail_jobs SET status = 'uncertain', error = ?1, lease_until = NULL, updated_at = ?2 WHERE id = ?3 AND status = 'sending'`)
        .bind(outcome.error, now, job.id),
      ...(job.order_id ? [orderEmailUpdate(db, job, outcome, now)] : [])
    ])
  }

  const { results: stranded } = await db.prepare(
    `UPDATE mail_jobs SET updated_at = ?1
     WHERE id IN (SELECT id FROM mail_jobs WHERE status IN ('pending', 'retry') AND coalesce(available_at, 0) <= ?1
                  AND updated_at <= ?2 ORDER BY available_at LIMIT 100)
     RETURNING id`
  ).bind(now, now - REQUEUE_AFTER_MS).all<{ id: string }>()
  if (stranded.length) await env.MAIL_QUEUE.sendBatch(stranded.map(({ id }) => ({ body: { jobId: id } })))

  await db.prepare('DELETE FROM turnstile_passes WHERE expires_at < ?').bind(now).run()
  return { recovered: stale.length, requeued: stranded.length }
}
