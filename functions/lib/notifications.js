import * as functions from 'firebase-functions/v1'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import { db, HttpsError, assertRole } from './common.js'
import { REGION, SCHOOL_CODES } from './constants.js'
import { SENDER_EMAIL } from './mailer.js'
import { enqueueNotificationBatch, MAX_BCC_PER_BATCH } from './mailQueue.js'
import { notificationProgress } from './mailQueueCore.js'
import { TICKET_TYPE_ID_PATTERN } from './orderValidation.js'
import { GUEST_SCHOOL } from './guests.js'

export { batchDelayMs } from './mailQueueCore.js'

// survey invites every buyer to this year's 舞會滿意度調查 (partySurvey.js)
const NOTIFY_TYPES = ['payment', 'pickup', 'both', 'custom', 'survey']
const NOTIFY_SUBJECTS = {
  payment: '【建中舞會購票系統】繳費通知', pickup: '【建中舞會購票系統】取票通知',
  both: '【建中舞會購票系統】繳費暨取票通知', custom: '【建中舞會購票系統】通知',
  survey: '【建中舞會購票系統】舞會滿意度調查'
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
  if (type === 'survey') return
  if (type === 'custom') {
    if (!message) throw new HttpsError('invalid-argument', '請提供訊息內容')
    return
  }
  if (!location) throw new HttpsError('invalid-argument', '請提供地點')
  if ((type === 'payment' || type === 'both') && !paymentTime) throw new HttpsError('invalid-argument', '請提供繳費時間')
  if ((type === 'pickup' || type === 'both') && !pickupTime) throw new HttpsError('invalid-argument', '請提供取票時間')
}

// The invitation links to /party-survey, which only takes answers while
// partySurveys/{year} is open
async function assertPartySurveyOpen(year) {
  if (!Number.isInteger(year) || year < 2000 || year > 2999) throw new HttpsError('invalid-argument', '問卷年度不正確')
  const survey = await db.doc(`partySurveys/${year}`).get()
  if (survey.get('open') !== true) {
    throw new HttpsError('failed-precondition', `${year} 年舞會滿意度調查尚未開放填寫，請先開放再寄送`)
  }
}

// 公關票 guests (guests.js) have nothing to pay; they still get pickup,
// custom and survey notices
export const includesGuests = (type) => type !== 'payment' && type !== 'both'

// Payment notices skip paid orders and pickup notices skip delivered ones, so
// nobody is asked to pay twice or to collect tickets they already have.
export function needsNotice(order, type) {
  if (order.complimentary === true && !includesGuests(type)) return false
  const unpaid = order.paid !== true && order.complimentary !== true
  const undelivered = order.delivered !== true
  if (type === 'payment') return unpaid
  if (type === 'pickup') return undelivered
  if (type === 'both') return unpaid || undelivered
  return true
}

const PAID_FILTERS = ['any', 'unpaid', 'paid']
const DELIVERED_FILTERS = ['any', 'undelivered', 'delivered']
const COMPLIMENTARY_FILTERS = ['include', 'exclude', 'only']
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_TICKET_TYPE_FILTERS = 50

function readChoice(value, choices) {
  if (value === undefined || value === null || value === '') return choices[0]
  if (!choices.includes(value)) throw new HttpsError('invalid-argument', '篩選條件不正確')
  return value
}

function readDate(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (!DATE_PATTERN.test(text) || Number.isNaN(new Date(`${text}T00:00:00+08:00`).getTime())) {
    throw new HttpsError('invalid-argument', '訂購日期格式不正確')
  }
  return text
}

function readList(value, valid, limit, label) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > limit) throw new HttpsError('invalid-argument', `${label}篩選不正確`)
  const list = [...new Set(value.map((item) => String(item || '').trim()))]
  if (list.some((item) => !valid(item))) throw new HttpsError('invalid-argument', `${label}篩選不正確`)
  return list.sort()
}

// Who a notice goes to, on top of what needsNotice requires for its type.
// Empty lists mean every school / ticket type. Dates are inclusive Taiwan
// calendar days. The older `school` field ('all' or one school) still works.
export function readRecipientFilters(data, type) {
  const input = data?.filters && typeof data.filters === 'object' ? data.filters : {}
  const legacySchool = String(data?.school || '').trim()
  const filters = {
    schools: readList(input.schools ?? (legacySchool && legacySchool !== 'all' ? [legacySchool] : []),
      (school) => Object.hasOwn(SCHOOL_CODES, school) || school === GUEST_SCHOOL, Object.keys(SCHOOL_CODES).length + 1, '學校'),
    ticketTypeIds: readList(input.ticketTypeIds, (id) => TICKET_TYPE_ID_PATTERN.test(id), MAX_TICKET_TYPE_FILTERS, '票種'),
    paid: readChoice(input.paid, PAID_FILTERS),
    delivered: readChoice(input.delivered, DELIVERED_FILTERS),
    complimentary: readChoice(input.complimentary, COMPLIMENTARY_FILTERS),
    createdFrom: readDate(input.createdFrom),
    createdTo: readDate(input.createdTo)
  }
  if (filters.createdFrom && filters.createdTo && filters.createdFrom > filters.createdTo) {
    throw new HttpsError('invalid-argument', '訂購日期的開始日不能晚於結束日')
  }
  // Payment and pickup notices already pick unpaid / undelivered orders
  // (needsNotice); a contrary status filter could only empty the list.
  if (type !== 'custom') {
    filters.paid = 'any'
    filters.delivered = 'any'
  }
  // 公關票 guests all sit under GUEST_SCHOOL, so the school list does not
  // apply to them
  if (filters.complimentary === 'only') filters.schools = []
  return filters
}

const orderTicketTypeIds = (order) => (Array.isArray(order.items) ? order.items : [])
  .filter((item) => Number(item?.quantity) > 0)
  .map((item) => String(item?.ticketTypeId || item?.id || ''))

function createdAtMillis(order) {
  const value = order.createdAt
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  return null
}

export function matchesRecipientFilters(order, filters) {
  const complimentary = order.complimentary === true
  if (filters.complimentary === 'exclude' && complimentary) return false
  if (filters.complimentary === 'only' && !complimentary) return false
  if (filters.schools.length && !filters.schools.includes(order.school)) return false
  if (filters.ticketTypeIds.length && !orderTicketTypeIds(order).some((id) => filters.ticketTypeIds.includes(id))) return false
  // 公關票 orders are saved as paid; they have nothing to pay either way
  const paid = order.paid === true || complimentary
  if (filters.paid === 'unpaid' && paid) return false
  if (filters.paid === 'paid' && !paid) return false
  const delivered = order.delivered === true
  if (filters.delivered === 'undelivered' && delivered) return false
  if (filters.delivered === 'delivered' && !delivered) return false
  if (filters.createdFrom || filters.createdTo) {
    const created = createdAtMillis(order)
    if (created === null) return false
    if (filters.createdFrom && created < new Date(`${filters.createdFrom}T00:00:00+08:00`).getTime()) return false
    if (filters.createdTo && created >= new Date(`${filters.createdTo}T00:00:00+08:00`).getTime() + 86_400_000) return false
  }
  return true
}

async function collectRecipients(filters, type) {
  let query = db.collection('orders')
  // one school narrows the scan; several are checked per order below
  if (filters.complimentary === 'only') query = query.where('school', '==', GUEST_SCHOOL)
  else if (filters.schools.length === 1) query = query.where('school', '==', filters.schools[0])
  query = query.orderBy(FieldPath.documentId()).limit(250)
  const emails = new Set()
  let cursor
  while (true) {
    const snapshot = await (cursor ? query.startAfter(cursor) : query).get()
    if (snapshot.empty) break
    snapshot.forEach((doc) => {
      if (!needsNotice(doc.data(), type) || !matchesRecipientFilters(doc.data(), filters)) return
      const email = String(doc.data().customerEmail || '').trim().toLowerCase()
      if (email && email.length <= 320 && email !== SENDER_EMAIL && !email.startsWith('no-reply@') && !email.startsWith('noreply@')) emails.add(email)
    })
    if (emails.size > MAX_RECIPIENTS) throw new HttpsError('resource-exhausted', '收件人過多，請縮小篩選條件後分批建立通知')
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
  const filters = readRecipientFilters(data, type)
  const fields = { paymentTime: readField(data, 'paymentTime'), pickupTime: readField(data, 'pickupTime'),
    location: readField(data, 'location'), message: readField(data, 'message', 8000) }
  validateNotification(type, fields)
  if (type === 'survey') await assertPartySurveyOpen(Number(data?.year))
  const recipients = await collectRecipients(filters, type)
  if (!recipients.length) return { status: 'empty', jobId: null, sentCount: 0, total: 0 }
  const ref = db.collection('notificationJobs').doc()
  const batch = db.batch()
  // `school` stays for older readers of notificationJobs
  const school = filters.schools.length === 1 ? filters.schools[0] : filters.schools.length ? 'multiple' : 'all'
  batch.create(ref, { type, school, filters, subject: resolveSubject(type, readField(data, 'subject', 200)),
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
