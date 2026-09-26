import * as functions from 'firebase-functions'
import { FieldValue } from 'firebase-admin/firestore'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import QRCode from 'qrcode'

import { db, HttpsError } from './common.js'
import { REGION, SCHOOL_CODES, getAdminOrderUrl } from './constants.js'
import { getTaiwanDateKey, toIsoString } from './time.js'
import { checkTicketType, getBuyerKey, sanitizeOrderInput } from './orderValidation.js'
import { createTransporter, MAIL_SECRETS, SENDER } from './mailer.js'
import { generateEmailHTML } from '../templates/orderConfirmation.js'

const MAX_ORDERS_PER_LOOKUP = 50
const ORDER_ID_PATTERN = /^[A-Z]+\d{12}$/

// Counter documents, written only by these functions:
//   ticketSales/{ticketTypeId}      { sold }
//   buyerPurchases/{sha256(email)}  { quantities: { [ticketTypeId]: n } }
//   orderCounters/{YYYYMMDD}        { serialNumber }
//   stockReleases/{orderId}         marks a deleted order as already released

// Prices, names, sale windows, stock and per-person limits all come from
// settings/ticketTypes; nothing price-related is trusted from the client.
// Everything runs in one transaction so simultaneous checkouts cannot
// oversell or exceed the per-person limit.
export const createOrder = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const { order, quantities } = sanitizeOrderInput(data?.orderPayload)

    const dateKey = getTaiwanDateKey()
    const accessToken = randomBytes(24).toString('hex')
    const ticketTypeIds = [...quantities.keys()]

    const settingsRef = db.doc('settings/ticketTypes')
    const counterRef = db.doc(`orderCounters/${dateKey}`)
    const buyerRef = db.doc(`buyerPurchases/${getBuyerKey(order.customerEmail)}`)
    const salesRefs = ticketTypeIds.map((id) => db.doc(`ticketSales/${id}`))

    const orderId = await db.runTransaction(async (tx) => {
      const [settingsSnap, counterSnap, buyerSnap, ...salesSnaps] =
        await tx.getAll(settingsRef, counterRef, buyerRef, ...salesRefs)

      const ticketTypes = new Map(
        (settingsSnap.data()?.types || [])
          .filter((type) => type?.id)
          .map((type) => [String(type.id), type])
      )

      const now = new Date()
      const bought = buyerSnap.data()?.quantities || {}
      const items = []

      ticketTypeIds.forEach((id, index) => {
        const ticketType = ticketTypes.get(id)

        if (!ticketType) {
          throw new HttpsError('invalid-argument', `無效的票種：${id}`)
        }

        const quantity = quantities.get(id)

        checkTicketType(ticketType, quantity, {
          now,
          school: order.school,
          sold: Number(salesSnaps[index].data()?.sold || 0),
          alreadyBought: Number(bought[id] || 0)
        })

        items.push({
          id,
          ticketTypeId: id,
          name: String(ticketType.name || ''),
          price: Number(ticketType.price) || 0,
          quantity
        })
      })

      const serial = Number(counterSnap.data()?.serialNumber || 0) + 1
      const id = `${SCHOOL_CODES[order.school]}${dateKey}${String(serial).padStart(4, '0')}`

      tx.set(counterRef, {
        date: dateKey,
        serialNumber: serial,
        updatedAt: FieldValue.serverTimestamp()
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

      tx.create(db.doc(`orders/${id}`), {
        ...order,
        items,
        originalTotal: finalTotal,
        finalTotal,
        userId: context.auth?.uid || null,
        accessToken,
        delivered: false,
        paid: false,
        createdAt: FieldValue.serverTimestamp()
      })

      return id
    })

    return { status: 201, id: orderId, token: accessToken }
  })

function tokensMatch(expected, actual) {
  const a = Buffer.from(String(expected || ''))
  const b = Buffer.from(String(actual || ''))
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

export function serializeOrder(id, data) {
  const order = { ...data }
  delete order.accessToken

  return {
    ...order,
    id,
    createdAt: toIsoString(data.createdAt),
    deliveryUpdatedAt: toIsoString(data.deliveryUpdatedAt),
    paymentUpdatedAt: toIsoString(data.paymentUpdatedAt)
  }
}

// Buyers are not signed in, so they prove ownership of an order with the
// access token returned by createOrder (kept in their browser).
export const getOrders = functions
  .region(REGION)
  .https.onCall(async (data) => {
    const refs = (Array.isArray(data?.orders) ? data.orders : [])
      .slice(0, MAX_ORDERS_PER_LOOKUP)
      .filter((ref) => typeof ref?.id === 'string' && ORDER_ID_PATTERN.test(ref.id))

    if (refs.length === 0) {
      return { orders: [] }
    }

    const snaps = await db.getAll(...refs.map((ref) => db.doc(`orders/${ref.id}`)))

    return {
      orders: snaps
        .map((snap, index) =>
          snap.exists && tokensMatch(snap.data().accessToken, refs[index].token)
            ? serializeOrder(snap.id, snap.data())
            : null
        )
        .filter(Boolean)
    }
  })

// When an admin deletes an order, give its tickets back to the stock and to
// the buyer's per-person allowance. The marker document makes this safe if
// the trigger is delivered more than once.
export const releaseOrderStock = functions
  .region(REGION)
  .firestore.document('orders/{orderId}')
  .onDelete(async (snap, context) => {
    const order = snap.data() || {}
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

export const sendOrderQRCode = functions
  .region(REGION)
  .runWith({ secrets: MAIL_SECRETS })
  .firestore.document('orders/{orderId}')
  .onCreate(async (snap, context) => {
    const order = snap.data()
    const orderId = context.params.orderId

    if (!order.customerEmail) {
      console.log(`Order ${orderId} has no customer email, skipping`)
      return
    }

    try {
      const qrPngBuffer = await QRCode.toBuffer(getAdminOrderUrl(orderId), {
        width: 300,
        margin: 2,
        color: { dark: '#1d1d1f', light: '#ffffff' },
        errorCorrectionLevel: 'H',
        type: 'png'
      })

      await createTransporter().sendMail({
        from: SENDER,
        to: order.customerEmail,
        subject: `建中舞會購票系統購票成功 - 票券編號：${orderId}`,
        html: generateEmailHTML(orderId, order),
        attachments: [
          {
            filename: 'ticket-qrcode.png',
            content: qrPngBuffer,
            contentType: 'image/png',
            cid: 'qrcode',
            contentDisposition: 'inline'
          }
        ]
      })

      console.log(`Sent ticket confirmation email to ${order.customerEmail}`)
    } catch (error) {
      // Logged with a searchable prefix; the order itself is already saved.
      console.error(`[sendOrderQRCode] failed for order ${orderId}:`, error)
    }
  })
