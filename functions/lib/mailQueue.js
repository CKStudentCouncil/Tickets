import * as functions from 'firebase-functions/v1'
import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import { db } from './common.js'
import { REGION, getAdminOrderUrl, getBuyerOrderUrl } from './constants.js'
import { createTransporter, MAIL_SECRETS, SENDER } from './mailer.js'
import { SES_RECIPIENTS_PER_SECOND } from './params.js'
import { createMailQueue } from './mailQueueCore.js'
import { generateEmailHTML } from '../templates/orderConfirmation.js'
import { generateOrderNotificationHTML } from '../templates/notification.js'
import { heroAttachment } from '../templates/shared.js'

export const NOTIFY_TO = 'ckhssc@gl.ck.tp.edu.tw'
export const MAX_BCC_PER_BATCH = 49

async function buildMessage(job) {
  if (job.kind === 'notification') return {
    from: SENDER, to: NOTIFY_TO, bcc: job.recipients,
    subject: job.subject,
    html: generateOrderNotificationHTML({ type: job.type, ...job.fields }),
    attachments: [heroAttachment()]
  }
  if (job.kind !== 'confirmation') throw new Error('Unsupported queue message kind')
  const snap = await db.doc(`orders/${job.orderId}`).get()
  if (!snap.exists || !snap.data().customerEmail) return null
  const order = snap.data()
  const qr = await QRCode.toBuffer(getAdminOrderUrl(job.orderId, order.ticketCode), {
    width: 300, margin: 2, color: { dark: '#1d1d1f', light: '#ffffff' },
    errorCorrectionLevel: 'H', type: 'png'
  })
  return {
    from: SENDER, to: order.customerEmail,
    subject: `建中舞會購票系統購票成功 - 票券編號：${job.orderId}`,
    html: generateEmailHTML(job.orderId, order, getBuyerOrderUrl(job.orderId)),
    attachments: [{ filename: 'ticket-qrcode.png', content: qr, contentType: 'image/png',
      cid: 'qrcode', contentDisposition: 'inline' }, heroAttachment()]
  }
}

const queue = createMailQueue({ db, buildMessage,
  // Created only while the scheduled worker sends, never during enqueue.
  send: (message) => createTransporter().sendMail(message),
  recipientsPerSecond: () => SES_RECIPIENTS_PER_SECOND.value() })

export function enqueueOrderConfirmation(orderId, order) {
  // Trigger retries use the same ID. Preserve legacy sent confirmations.
  if (order.emailStatus === 'sent' || order.emailStatus === 'accepted' || !order.customerEmail) {
    return Promise.resolve({ jobId: null, status: order.emailStatus || 'skipped', emailStatus: order.emailStatus || 'skipped' })
  }
  return queue.enqueue(`confirmation_${orderId}`, {
    kind: 'confirmation', orderId, recipientCount: 1, buyerCount: 1,
    purpose: 'confirmation'
  }, { orderRef: db.doc(`orders/${orderId}`) })
}

export function enqueueManualOrderResend(orderId, order, actorUid, { requestId } = {}) {
  if (requestId != null && !/^[A-Za-z0-9_-]{8,80}$/.test(String(requestId))) {
    throw new functions.https.HttpsError('invalid-argument', '重寄請求編號無效')
  }
  // Each deliberate resend is a new job; retries of that action can reuse its
  // requestId. Uncertain original sends never automatically become retries.
  return queue.enqueue(`resend_${orderId}_${requestId || randomUUID()}`, {
    kind: 'confirmation', orderId, recipientCount: 1, buyerCount: 1,
    purpose: 'manual-resend', createdBy: actorUid
  }, { orderRef: db.doc(`orders/${orderId}`) })
}

export const enqueueNotificationBatch = (id, payload) => queue.enqueue(id, payload)

export const processMailQueue = functions.region(REGION)
  .runWith({ secrets: MAIL_SECRETS, timeoutSeconds: 120, maxInstances: 1 })
  .pubsub.schedule('every 1 minutes').timeZone('Asia/Taipei')
  .onRun(() => queue.runWorker())
