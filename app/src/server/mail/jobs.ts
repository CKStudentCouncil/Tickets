// Mail jobs: every email is first written to mail_jobs (in the same batch as
// what caused it), then a queue message asks the consumer to send it.
export const confirmationJobId = (orderId: string) => `confirmation_${orderId}`

export interface NewMailJob {
  id: string
  kind: 'confirmation' | 'notification'
  purpose?: string
  orderId?: string
  notificationJobId?: string
  type?: string
  subject?: string
  fields?: Record<string, string>
  recipients?: string[]
  recipientCount: number
  buyerCount: number
  createdBy?: string
  now: number
}

// Insert a pending job; a job with this id already existing is left as is,
// so the deterministic ids make enqueueing idempotent.
export function mailJobInsert(db: D1Database, job: NewMailJob) {
  return db.prepare(
    `INSERT INTO mail_jobs (id, kind, purpose, order_id, notification_job_id, type, subject, fields, recipients,
       recipient_count, buyer_count, status, attempts, available_at, created_by, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending', 0, ?12, ?13, ?12, ?12)
     ON CONFLICT (id) DO NOTHING`
  ).bind(
    job.id, job.kind, job.purpose ?? null, job.orderId ?? null, job.notificationJobId ?? null, job.type ?? null,
    job.subject ?? null, job.fields ? JSON.stringify(job.fields) : null, job.recipients ? JSON.stringify(job.recipients) : null,
    job.recipientCount, job.buyerCount, job.now, job.createdBy ?? null
  )
}
