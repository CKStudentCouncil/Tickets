import * as functions from 'firebase-functions/v1'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import { db, HttpsError, assertRole } from './common.js'
import { REGION } from './constants.js'
import { SENDER_EMAIL } from './mailer.js'
import { enqueueNotificationBatch, MAX_BCC_PER_BATCH } from './mailQueue.js'
import { notificationProgress } from './mailQueueCore.js'

export { batchDelayMs } from './mailQueueCore.js'

const NOTIFY_TYPES = ['payment', 'pickup', 'both', 'custom']
const NOTIFY_SUBJECTS = {
  payment: '【建中舞會購票系統】繳費通知', pickup: '【建中舞會購票系統】取票通知',
  both: '【建中舞會購票系統】繳費暨取票通知', custom: '【建中舞會購票系統】通知'
}
const JOB_ID_PATTERN = /^[A-Za-z0-9]{1,40}$/
const MAX_RECIPIENTS = 10_000

export function resolveSubject(type, subject) {
  return type === 'custom' && subject ? subject : NOTIFY_SUBJECTS[type]
}

function readField(data, key, limit = 500) {
  const value = String(data?.[key] || '').trim()
  if (value.length > limit) throw new HttpsError('invalid-argument', `${key} 內容過長`)
  return value
}

function validateNotification(type, { paymentTime, pickupTime, location, message }) {
  if (type === 'custom') {
    if (!message) throw new HttpsError('invalid-argument', '請提供訊息內容')
    return
  }
  if (!location) throw new HttpsError('invalid-argument', '請提供地點')
  if ((type === 'payment' || type === 'both') && !paymentTime) throw new HttpsError('invalid-argument', '請提供繳費時間')
  if ((type === 'pickup' || type === 'both') && !pickupTime) throw new HttpsError('invalid-argument', '請提供取票時間')
}

async function collectRecipients(school) {
  let query = db.collection('orders')
  if (school !== 'all') query = query.where('school', '==', school)
  query = query.orderBy(FieldPath.documentId()).limit(250)
  const emails = new Set()
  let cursor
  while (true) {
    const snapshot = await (cursor ? query.startAfter(cursor) : query).get()
    if (snapshot.empty) break
    snapshot.forEach((doc) => {
      const email = String(doc.data().customerEmail || '').trim().toLowerCase()
      if (email && email.length <= 320 && email !== SENDER_EMAIL && !email.startsWith('no-reply@') && !email.startsWith('noreply@')) emails.add(email)
    })
    if (emails.size > MAX_RECIPIENTS) throw new HttpsError('resource-exhausted', '收件人過多，請依學校分批建立通知')
    cursor = snapshot.docs.at(-1)
    if (snapshot.size < 250) break
  }
  return [...emails]
}

function notificationRef(data) {
  const id = String(data?.jobId || '')
  if (!JOB_ID_PATTERN.test(id)) throw new HttpsError('invalid-argument', '寄送紀錄無效，請重新整理頁面後再試')
  return db.doc(`notificationJobs/${id}`)
}

async function progressOf(ref) {
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', '找不到這次寄送紀錄')
  const job = snap.data()
  const total = job.total ?? job.recipients.length
  if (!job.queueVersion) return {
    jobId: ref.id, status: job.status, sentCount: job.nextIndex || 0,
    acceptedCount: job.nextIndex || 0, total,
    failedCount: 0, uncertainCount: 0, pendingCount: total - (job.nextIndex || 0),
    pendingEnqueueCount: total - (job.nextIndex || 0)
  }
  const batches = await db.collection('mailQueue').where('notificationJobId', '==', ref.id).get()
  const values = batches.docs.map((batch) => batch.data())
  if (job.queueStartIndex) values.push({ status: 'accepted', buyerCount: job.queueStartIndex })
  const progress = notificationProgress(ref.id, total, values)
  // These are informational counters, not a sending checkpoint. Durable
  // per-batch documents are always the source of truth for status polling.
  await ref.update({ status: progress.status, acceptedCount: progress.acceptedCount,
    failedCount: progress.failedCount, uncertainCount: progress.uncertainCount,
    updatedAt: FieldValue.serverTimestamp() })
  return progress
}

// Preparation freezes recipients and message; the caller confirms this count
// before sendOrderNotification puts its deterministic batches in the queue.
export const prepareOrderNotification = functions.region(REGION).https.onCall(async (data, context) => {
  await assertRole(context, 'manager')
  const type = NOTIFY_TYPES.includes(data?.type) ? data.type : 'payment'
  const school = readField(data, 'school') || 'all'
  const fields = { paymentTime: readField(data, 'paymentTime'), pickupTime: readField(data, 'pickupTime'),
    location: readField(data, 'location'), message: readField(data, 'message', 8000) }
  validateNotification(type, fields)
  const recipients = await collectRecipients(school)
  if (!recipients.length) return { status: 'empty', jobId: null, sentCount: 0, total: 0 }
  const ref = db.collection('notificationJobs').doc()
  const batch = db.batch()
  batch.create(ref, { type, school, subject: resolveSubject(type, readField(data, 'subject', 200)),
    fields, total: recipients.length, batchCount: Math.ceil(recipients.length / MAX_BCC_PER_BATCH),
    schemaVersion: 2, nextIndex: 0, status: 'ready',
    createdBy: context.auth.uid, createdAt: FieldValue.serverTimestamp() })
  // Bounded immutable subdocuments keep the campaign itself small. 10,000
  // recipients need at most 205 batch documents, within one atomic write.
  for (let start = 0; start < recipients.length; start += MAX_BCC_PER_BATCH) {
    batch.create(ref.collection('batches').doc(String(start).padStart(6, '0')), {
      start, recipients: recipients.slice(start, start + MAX_BCC_PER_BATCH)
    })
  }
  await batch.commit()
  return { status: 'ready', jobId: ref.id, sentCount: 0, total: recipients.length, pendingEnqueueCount: recipients.length }
})

// Retry this callable with the same jobId after an enqueue interruption.
// Existing accepted, failed, or uncertain batches are never reset or resent.
// No SES call occurs here; all mail shares one leased and paced worker.
export const sendOrderNotification = functions.region(REGION).runWith({ timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
    await assertRole(context, 'manager')
    const ref = notificationRef(data)
    const job = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) throw new HttpsError('not-found', '找不到這次寄送紀錄')
      const current = snap.data()
      if (!current.queueVersion) {
        if (current.leaseUntil?.toMillis() > Date.now()) throw new HttpsError('failed-precondition', '先前的寄送仍在執行，請稍候重試')
        // A legacy interrupted sender may have an unknown next batch. Inspect
        // SES before upgrading that job into an automatic queue retry.
        if (['sending', 'failed'].includes(current.status)) throw new HttpsError('failed-precondition', '先前寄送結果需要人工核對 SES，請勿盲目續寄')
        current.queueStartIndex = current.nextIndex || 0
        current.queueVersion = 1
        tx.update(ref, { queueStartIndex: current.queueStartIndex, queueVersion: 1,
          status: 'queued', queuedAt: FieldValue.serverTimestamp(), queuedBy: context.auth.uid })
      }
      return current
    })
    const enqueue = async (start, recipients) => {
      await enqueueNotificationBatch(`notification_${ref.id}_${start}`, {
        kind: 'notification', notificationJobId: ref.id, type: job.type,
        subject: job.subject, fields: job.fields, recipients,
        buyerCount: recipients.length, recipientCount: recipients.length + 1,
        createdBy: context.auth.uid
      })
    }
    if (job.schemaVersion === 2) {
      const query = ref.collection('batches').orderBy(FieldPath.documentId()).limit(100)
      let cursor
      while (true) {
        const page = await (cursor ? query.startAfter(cursor) : query).get()
        if (page.empty) break
        for (const snap of page.docs) await enqueue(snap.data().start, snap.data().recipients)
        cursor = page.docs.at(-1)
        if (page.size < 100) break
      }
    } else {
      // Legacy prepared/partially accepted campaigns retain their frozen list.
      for (let start = job.queueStartIndex; start < job.recipients.length; start += MAX_BCC_PER_BATCH) {
        await enqueue(start, job.recipients.slice(start, start + MAX_BCC_PER_BATCH))
      }
    }
    return progressOf(ref)
  })

export const getOrderNotificationStatus = functions.region(REGION).https.onCall(async (data, context) => {
  await assertRole(context, 'manager')
  return progressOf(notificationRef(data))
})
