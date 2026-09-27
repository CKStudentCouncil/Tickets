import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'
import { randomBytes } from 'node:crypto'
import QRCode from 'qrcode'

import { db, HttpsError, assertRole, getRoleRank } from './common.js'
import { REGION, SCHOOL_CODES, SHOP_OPEN_AT, getAdminOrderUrl, getBuyerOrderUrl } from './constants.js'
import { getTaiwanDateKey, parseTaipeiDateTime } from './time.js'
import {
  ORDER_ID_PATTERN,
  checkTicketType,
  generateOrderId,
  getBuyerKey,
  isValidRequestId,
  sanitizeOrderInput
} from './orderValidation.js'
import { createTransporter, MAIL_SECRETS, SENDER } from './mailer.js'
import { CREATE_ORDER_MIN_INSTANCES, ENFORCE_APP_CHECK, ORDER_LIMIT_PER_ACCOUNT } from './params.js'
import { generateEmailHTML } from '../templates/orderConfirmation.js'
import { heroAttachment } from '../templates/shared.js'

const ORDER_ID_ATTEMPTS = 3
const RATE_WINDOW_MS = 10 * 60 * 1000
// Stop retrying a failed confirmation email after this long; staff can resend
const EMAIL_RETRY_WINDOW_MS = 60 * 60 * 1000

// Documents written only by these functions (denied to clients by the rules):
//   ticketSales/{ticketTypeId}      { sold }
//   buyerPurchases/{sha256(email)}  { quantities: { [ticketTypeId]: n } }, per account email
//   orderRequests/{requestId}       { orderId } — makes retried checkouts idempotent
//   rateLimits/{uid}_{slot}         { count }  — only when ORDER_LIMIT_PER_ACCOUNT > 0
//   stockReleases/{orderId}         marks a deleted order as already released

class OrderIdTaken extends Error {}

function assertAppCheck(context) {
  if (ENFORCE_APP_CHECK.value() && !context.app) {
    throw new HttpsError('failed-precondition', '請使用正式網站購票')
  }
}

// Buyers must be signed in; the order email is the account's verified email
function getBuyerAccount(context) {
  const token = context.auth?.token

  if (!context.auth?.uid) {
    throw new HttpsError('unauthenticated', '請先登入再購票')
  }
  if (!token?.email || token.email_verified !== true) {
    throw new HttpsError('failed-precondition', '此帳號的 Email 尚未驗證，請改用 Google 帳號登入')
  }

  return { uid: context.auth.uid, email: String(token.email).toLowerCase() }
}

// The site's opening time (settings/shop, set on the management page). The
// /comingsoon page only hides the shop in the browser, so the same gate is
// enforced here; staff may order before it, as they may browse the shop.
async function assertShopOpen(account) {
  const snap = await db.doc('settings/shop').get()
  const openAt = parseTaipeiDateTime(snap.data()?.openAt) || SHOP_OPEN_AT

  if (new Date() < openAt && (await getRoleRank(account.uid)) === 0) {
    throw new HttpsError('failed-precondition', '尚未開賣')
  }
}

async function enforceAccountLimit(account) {
  const limit = ORDER_LIMIT_PER_ACCOUNT.value()
  if (!limit) return

  const slot = Math.floor(Date.now() / RATE_WINDOW_MS)
  const ref = db.doc(`rateLimits/${account.uid}_${slot}`)

  await db.runTransaction(async (tx) => {
    const count = Number((await tx.get(ref)).data()?.count || 0)
    if (count >= limit) {
      throw new HttpsError('resource-exhausted', '下單次數過多，請稍後再試')
    }
    tx.set(ref, { count: count + 1, expiresAt: new Date((slot + 2) * RATE_WINDOW_MS) })
  })
}

// Firestore gives up on a transaction after repeated contention; say so
// clearly instead of the generic "internal" error.
function toHttpsError(error) {
  if (error instanceof HttpsError) return error
  if (error?.code === 10 || error?.code === 'aborted') {
    return new HttpsError('aborted', '目前購票人數眾多，請稍後再試一次')
  }
  console.error('[createOrder] unexpected error:', error)
  return new HttpsError('internal', '訂單送出失敗，請稍後再試')
}

// Prices, names, sale windows, stock and per-person limits all come from
// settings/ticketTypes; nothing price-related is trusted from the client.
// Everything runs in one transaction so simultaneous checkouts cannot
// oversell or exceed the per-person limit. Buyers read their orders back
// straight from Firestore (the rules allow the account in `userId`).
export const createOrder = functions
  .region(REGION)
  .runWith({ minInstances: CREATE_ORDER_MIN_INSTANCES })
  .https.onCall(async (data, context) => {
    assertAppCheck(context)
    const account = getBuyerAccount(context)

    const { order, quantities } = sanitizeOrderInput(data?.orderPayload, account.email)
    const requestId = isValidRequestId(data?.requestId) ? data.requestId : null

    await assertShopOpen(account)
    await enforceAccountLimit(account)

    const dateKey = getTaiwanDateKey()
    const schoolCode = SCHOOL_CODES[order.school]
    const ticketTypeIds = [...quantities.keys()]

    const settingsRef = db.doc('settings/ticketTypes')
    const buyerRef = db.doc(`buyerPurchases/${getBuyerKey(order.customerEmail)}`)
    const salesRefs = ticketTypeIds.map((id) => db.doc(`ticketSales/${id}`))
    const requestRef = requestId ? db.doc(`orderRequests/${requestId}`) : null

    for (let attempt = 1; ; attempt++) {
      const orderRef = db.doc(`orders/${generateOrderId(schoolCode, dateKey)}`)

      try {
        return await db.runTransaction(async (tx) => {
          const refs = [settingsRef, buyerRef, orderRef, ...(requestRef ? [requestRef] : []), ...salesRefs]
          const snaps = await tx.getAll(...refs)
          const [settingsSnap, buyerSnap, orderSnap] = snaps
          const requestSnap = requestRef ? snaps[3] : null
          const salesSnaps = snaps.slice(requestRef ? 4 : 3)

          // the same checkout was already committed (e.g. the response was lost)
          if (requestSnap?.exists) {
            const previous = await tx.get(db.doc(`orders/${requestSnap.data().orderId}`))
            if (previous.exists && previous.data().userId === account.uid) {
              return { status: 200, id: previous.id }
            }
            if (previous.exists) {
              throw new HttpsError('invalid-argument', '訂單請求無效，請重新送出')
            }
          }

          if (orderSnap.exists) throw new OrderIdTaken()

          const ticketTypes = new Map(
            (settingsSnap.data()?.types || [])
              .filter((type) => type?.id)
              .map((type) => [String(type.id), type])
          )

          const now = new Date()
          const bought = buyerSnap.data()?.quantities || {}
          const items = ticketTypeIds.map((id, index) => {
            const ticketType = ticketTypes.get(id)

            if (!ticketType) {
              throw new HttpsError('invalid-argument', `無效的票種：${id}`)
            }

            const quantity = quantities.get(id)

            checkTicketType(ticketType, quantity, {
              now,
              school: order.school,
              email: account.email,
              sold: Number(salesSnaps[index].data()?.sold || 0),
              alreadyBought: Number(bought[id] || 0)
            })

            return {
              id,
              ticketTypeId: id,
              name: String(ticketType.name || ''),
              price: Number(ticketType.price) || 0,
              quantity
            }
          })

          items.forEach((item, index) => {
            tx.set(salesRefs[index], { sold: FieldValue.increment(item.quantity) }, { merge: true })
          })

          tx.set(
            buyerRef,
            {
              quantities: Object.fromEntries(
                items.map((item) => [item.id, Number(bought[item.id] || 0) + item.quantity])
              ),
              updatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          )

          const finalTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0)

          tx.create(orderRef, {
            ...order,
            items,
            originalTotal: finalTotal,
            finalTotal,
            userId: account.uid, // the buyer's key to read the order (firestore.rules)
            ticketCode: randomBytes(9).toString('base64url'),
            stockCounted: true, // releaseOrderStock only refunds orders that were counted
            delivered: false,
            paid: false,
            emailStatus: 'pending',
            createdAt: FieldValue.serverTimestamp()
          })

          if (requestRef) {
            tx.set(requestRef, { orderId: orderRef.id, createdAt: FieldValue.serverTimestamp() })
          }

          return { status: 201, id: orderRef.id }
        }, { maxAttempts: 10 })
      } catch (error) {
        if (error instanceof OrderIdTaken && attempt < ORDER_ID_ATTEMPTS) continue
        throw toHttpsError(error)
      }
    }
  })

// When an admin deletes an order, give its tickets back to the stock and to
// the buyer's per-person allowance. The marker document makes this safe if
// the trigger is delivered more than once.
export const releaseOrderStock = functions
  .region(REGION)
  .runWith({ failurePolicy: true }) // retried on failure; the marker keeps it idempotent
  .firestore.document('orders/{orderId}')
  .onDelete(async (snap, context) => {
    const order = snap.data() || {}
    // orders created before the counters existed were never counted
    if (order.stockCounted !== true) return

    const quantities = new Map()

    ;(Array.isArray(order.items) ? order.items : []).forEach((item) => {
      const id = String(item?.ticketTypeId || item?.id || '')
      const quantity = Number(item?.quantity)
      if (id && Number.isInteger(quantity) && quantity > 0) {
        quantities.set(id, (quantities.get(id) || 0) + quantity)
      }
    })

    if (quantities.size === 0) return

    const markerRef = db.doc(`stockReleases/${context.params.orderId}`)

    await db.runTransaction(async (tx) => {
      if ((await tx.get(markerRef)).exists) return

      quantities.forEach((quantity, id) => {
        tx.set(db.doc(`ticketSales/${id}`), { sold: FieldValue.increment(-quantity) }, { merge: true })
      })

      if (order.customerEmail) {
        tx.set(
          db.doc(`buyerPurchases/${getBuyerKey(order.customerEmail)}`),
          {
            quantities: Object.fromEntries(
              [...quantities].map(([id, quantity]) => [id, FieldValue.increment(-quantity)])
            ),
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        )
      }

      tx.create(markerRef, { releasedAt: FieldValue.serverTimestamp() })
    })
  })

/* ---------- confirmation email ---------- */

export async function sendConfirmationEmail(orderId, order, transporter = createTransporter()) {
  const qrPngBuffer = await QRCode.toBuffer(getAdminOrderUrl(orderId, order.ticketCode), {
    width: 300,
    margin: 2,
    color: { dark: '#1d1d1f', light: '#ffffff' },
    errorCorrectionLevel: 'H',
    type: 'png'
  })

  await transporter.sendMail({
    from: SENDER,
    to: order.customerEmail,
    subject: `建中舞會購票系統購票成功 - 票券編號：${orderId}`,
    html: generateEmailHTML(orderId, order, getBuyerOrderUrl(orderId)),
    attachments: [
      {
        filename: 'ticket-qrcode.png',
        content: qrPngBuffer,
        contentType: 'image/png',
        cid: 'qrcode',
        contentDisposition: 'inline'
      },
      heroAttachment()
    ]
  })
}

function markEmail(ref, status, error) {
  return ref.update({
    emailStatus: status,
    emailError: error ? String(error.message || error).slice(0, 500) : FieldValue.delete(),
    emailUpdatedAt: FieldValue.serverTimestamp()
  })
}

// Records the result on the order (emailStatus: pending / sent / failed /
// skipped). Failures are retried for an hour (e.g. when SES throttles at
// the sale opening); after that staff can resend from the admin page.
export const sendOrderQRCode = functions
  .region(REGION)
  .runWith({ secrets: MAIL_SECRETS, failurePolicy: true })
  .firestore.document('orders/{orderId}')
  .onCreate(async (snap, context) => {
    const orderId = context.params.orderId
    const current = await snap.ref.get()

    if (!current.exists || current.data().emailStatus === 'sent') return

    const order = current.data()

    if (!order.customerEmail) {
      await markEmail(snap.ref, 'skipped')
      return
    }

    try {
      await sendConfirmationEmail(orderId, order)
      await markEmail(snap.ref, 'sent')
    } catch (error) {
      console.error(`[sendOrderQRCode] failed for order ${orderId}:`, error)
      await markEmail(snap.ref, 'failed', error)

      const age = Date.now() - new Date(context.timestamp).getTime()
      if (age < EMAIL_RETRY_WINDOW_MS) throw error // let Cloud Functions retry
    }
  })

// Staff can resend the confirmation from the admin order list
export const resendOrderEmail = functions
  .region(REGION)
  .runWith({ secrets: MAIL_SECRETS })
  .https.onCall(async (data, context) => {
    await assertRole(context, 'admin')

    const orderId = String(data?.orderId || '')
    if (!ORDER_ID_PATTERN.test(orderId)) {
      throw new HttpsError('invalid-argument', '訂單編號無效')
    }

    const ref = db.doc(`orders/${orderId}`)
    const snap = await ref.get()

    if (!snap.exists) throw new HttpsError('not-found', '找不到訂單')
    if (!snap.data().customerEmail) throw new HttpsError('failed-precondition', '訂單沒有 Email')

    try {
      await sendConfirmationEmail(orderId, snap.data())
      await markEmail(ref, 'sent')
      return { emailStatus: 'sent' }
    } catch (error) {
      console.error(`[resendOrderEmail] failed for order ${orderId}:`, error)
      await markEmail(ref, 'failed', error)
      throw new HttpsError('unavailable', `寄送失敗：${error.message || error}`)
    }
  })
