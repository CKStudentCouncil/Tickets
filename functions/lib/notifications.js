import * as functions from 'firebase-functions'

import { db, HttpsError, assertRole } from './common.js'
import { REGION } from './constants.js'
import { createTransporter, MAIL_SECRETS, SENDER, SENDER_EMAIL } from './mailer.js'
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
const MAX_SENDS_PER_SECOND = 14
const MIN_MS_BETWEEN_SENDS = Math.ceil(1000 / MAX_SENDS_PER_SECOND)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function chunk(array, size) {
  const result = []
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size))
  }
  return result
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

// Managers get the notification screen in the admin UI, so they may send too.
export const sendOrderNotification = functions
  .region(REGION)
  .runWith({ secrets: MAIL_SECRETS, timeoutSeconds: 300 })
  .https.onCall(async (data, context) => {
    await assertRole(context, 'manager')

    const type = NOTIFY_TYPES.includes(data?.type) ? data.type : 'payment'
    const school = readField(data, 'school') || 'all'
    const subject = readField(data, 'subject')
    const fields = {
      paymentTime: readField(data, 'paymentTime'),
      pickupTime: readField(data, 'pickupTime'),
      location: readField(data, 'location'),
      message: readField(data, 'message')
    }

    validateNotification(type, fields)

    const recipients = await collectRecipients(school)

    if (recipients.length === 0) {
      return { sentCount: 0 }
    }

    const transporter = createTransporter()
    const html = generateOrderNotificationHTML({ type, ...fields })
    let lastSendAt = 0

    for (const batch of chunk(recipients, MAX_BCC_PER_BATCH)) {
      const waitMs = MIN_MS_BETWEEN_SENDS - (Date.now() - lastSendAt)
      if (lastSendAt !== 0 && waitMs > 0) await sleep(waitMs)
      lastSendAt = Date.now()

      await transporter.sendMail({
        from: SENDER,
        to: NOTIFY_TO,
        bcc: batch,
        subject: subject || NOTIFY_SUBJECTS[type],
        html
      })
    }

    console.log(`Sent ${type} notification to ${recipients.length} recipients`)

    return { sentCount: recipients.length }
  })
