import * as functions from 'firebase-functions'
import { FieldValue } from 'firebase-admin/firestore'

import { db, HttpsError, assertRole } from './common.js'
import { REGION } from './constants.js'
import { createTransporter, MAIL_SECRETS, SENDER, SENDER_EMAIL } from './mailer.js'
import { SES_RECIPIENTS_PER_SECOND } from './params.js'
import { generateOrderNotificationHTML } from '../templates/notification.js'

const NOTIFY_TYPES = ['payment', 'pickup', 'both', 'custom']

const NOTIFY_SUBJECTS = {
  payment: '【建中舞會購票系統】繳費通知',
  pickup: '【建中舞會購票系統】取票通知',
  both: '【建中舞會購票系統】繳費暨取票通知',
  custom: '【建中舞會購票系統】通知'
}

// Always addressed to the council mailbox; buyers are BCC'd in batches.
const NOTIFY_TO = 'ckhssc@gl.ck.tp.edu.tw'
const MAX_BCC_PER_BATCH = 49
const TIMEOUT_SECONDS = 540
// Stop starting new batches after this, save progress and let the client continue
const TIME_BUDGET_MS = 480 * 1000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// SES quotas count recipients, not messages: a batch of 49 BCC + 1 To uses
// 50 of the per-second allowance.
export function batchDelayMs(recipientCount, recipientsPerSecond) {
  return Math.ceil((recipientCount / Math.max(1, recipientsPerSecond)) * 1000)
}

// A custom subject only applies to custom notices; the input is hidden for
// the other types, so a leftover value must never replace their subject.
export function resolveSubject(type, subject) {
  return type === 'custom' && subject ? subject : NOTIFY_SUBJECTS[type]
}

function readField(data, key) {
  return String(data?.[key] || '').trim()
}

function validateNotification(type, { paymentTime, pickupTime, location, message }) {
  if (type === 'custom') {
    if (!message) throw new HttpsError('invalid-argument', '請提供訊息內容')
    return
  }

  if (!location) {
    throw new HttpsError('invalid-argument', '請提供地點')
  }

  if ((type === 'payment' || type === 'both') && !paymentTime) {
    throw new HttpsError('invalid-argument', '請提供繳費時間')
  }

  if ((type === 'pickup' || type === 'both') && !pickupTime) {
    throw new HttpsError('invalid-argument', '請提供取票時間')
  }
}

async function collectRecipients(school) {
  const snapshot = await db.collection('orders').get()
  const sender = SENDER_EMAIL.toLowerCase()
  const emails = new Set()

  snapshot.forEach((doc) => {
    const order = doc.data()
    if (school !== 'all' && order.school !== school) return

    const email = String(order.customerEmail || '').trim().toLowerCase()
    if (
      email &&
      email !== sender &&
      !email.startsWith('no-reply@') &&
      !email.startsWith('noreply@')
    ) {
      emails.add(email)
    }
  })

  return [...emails]
}

async function createJob(data, context) {
  const type = NOTIFY_TYPES.includes(data?.type) ? data.type : 'payment'
  const school = readField(data, 'school') || 'all'
  const fields = {
    paymentTime: readField(data, 'paymentTime'),
    pickupTime: readField(data, 'pickupTime'),
    location: readField(data, 'location'),
    message: readField(data, 'message')
  }

  validateNotification(type, fields)

  const job = {
    type,
    school,
    subject: resolveSubject(type, readField(data, 'subject')),
    fields,
    recipients: await collectRecipients(school),
    nextIndex: 0,
    status: 'sending',
    createdBy: context.auth.uid,
    createdAt: FieldValue.serverTimestamp()
  }

  const ref = db.collection('notificationJobs').doc()
  await ref.set(job)
  return { ref, job }
}

async function loadJob(jobId) {
  const ref = db.doc(`notificationJobs/${jobId}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '找不到這次寄送紀錄')
  return { ref, job: snap.data() }
}

// Managers get the notification screen in the admin UI, so they may send too.
// Progress is saved in notificationJobs/{jobId} after every batch. When the
// time budget runs out the call returns status 'partial' and the client calls
// again with the jobId; after an SES error staff can resume the same job, so
// nobody receives the notice twice.
export const sendOrderNotification = functions
  .region(REGION)
  .runWith({ secrets: MAIL_SECRETS, timeoutSeconds: TIMEOUT_SECONDS })
  .https.onCall(async (data, context) => {
    await assertRole(context, 'manager')

    const startedAt = Date.now()
    const { ref, job } = data?.jobId
      ? await loadJob(String(data.jobId))
      : await createJob(data, context)

    const total = job.recipients.length
    const progress = (status) => ({ status, jobId: ref.id, sentCount: job.nextIndex, total })

    if (job.status === 'done' || job.nextIndex >= total) {
      await ref.update({ status: 'done' })
      return progress('done')
    }

    const transporter = createTransporter()
    const html = generateOrderNotificationHTML({ type: job.type, ...job.fields })
    const rate = SES_RECIPIENTS_PER_SECOND.value()

    await ref.update({ status: 'sending' })

    while (job.nextIndex < total) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        return progress('partial')
      }

      const batch = job.recipients.slice(job.nextIndex, job.nextIndex + MAX_BCC_PER_BATCH)
      const batchStartedAt = Date.now()

      try {
        await transporter.sendMail({
          from: SENDER,
          to: NOTIFY_TO,
          bcc: batch,
          subject: job.subject,
          html
        })
      } catch (error) {
        console.error(`[sendOrderNotification] job ${ref.id} stopped at ${job.nextIndex}/${total}:`, error)
        await ref.update({ status: 'failed', error: String(error.message || error).slice(0, 500) })
        throw new HttpsError(
          'unavailable',
          `寄送中斷：已寄出 ${job.nextIndex} / ${total} 位，可稍後按「繼續寄送」`,
          progress('failed')
        )
      }

      job.nextIndex += batch.length
      await ref.update({ nextIndex: job.nextIndex, updatedAt: FieldValue.serverTimestamp() })

      const waitMs = batchDelayMs(batch.length + 1, rate) - (Date.now() - batchStartedAt)
      if (job.nextIndex < total && waitMs > 0) await sleep(waitMs)
    }

    await ref.update({ status: 'done' })
    console.log(`Sent ${job.type} notification to ${total} recipients (job ${ref.id})`)

    return progress('done')
  })
