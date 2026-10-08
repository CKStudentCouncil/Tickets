import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'
import { randomBytes, randomInt } from 'node:crypto'

import { db, HttpsError, assertRole, getRoleRank } from './common.js'
import { REGION, SCHOOL_CODES, SHOP_OPEN_AT } from './constants.js'
import { getTaiwanDateKey, parseTaipeiDateTime } from './time.js'
import {
  ORDER_ID_PATTERN,
  SHARD_COUNT,
  TICKET_TYPE_ID_PATTERN,
  allocateStock,
  checkSaleOpen,
  checkTicketType,
  generateOrderId,
  getAvailable,
  getBuyerKey,
  getCurrentCaps,
  getStockLimit,
  isValidRequestId,
  planShardCaps,
  planShards,
  sanitizeOrderInput
} from './orderValidation.js'
import { CREATE_ORDER_MIN_INSTANCES, ENFORCE_APP_CHECK, ORDER_LIMIT_PER_ACCOUNT } from './params.js'
import { enqueueOrderConfirmation, enqueueManualOrderResend } from './mailQueue.js'

const ORDER_ID_ATTEMPTS = 3
// Fresh looks at the shards before giving up when the locked ones were full
const STOCK_ATTEMPTS = 6
// After this many, lock every shard with room rather than one random shard
const SPREAD_AFTER = 2
const RATE_WINDOW_MS = 10 * 60 * 1000
const DEFINITE_ORDER_ERRORS = new Set(['invalid-argument', 'failed-precondition', 'permission-denied', 'resource-exhausted'])

// Documents written only by these functions (denied to clients by the rules):
//   ticketSales/{ticketTypeId}/shards/{k}  { sold } — stock counters, see SHARD_COUNT
//   ticketSales/{ticketTypeId}      { sold, shardCaps } — legacy counter of orders
//                                   placed before the shards (still counts against
//                                   stock) and how many each shard may sell
//   buyerPurchases/{sha256(email)}  { quantities: { [ticketTypeId]: n } }, per account email
//   orderRequests/{requestId}       { userId, orderId } or owned rejection — checkout recovery
//   rateLimits/{uid}_{slot}         { count }  — only when ORDER_LIMIT_PER_ACCOUNT > 0
//   stockReleases/{orderId}         marks a deleted order as already released

class OrderIdTaken extends Error {}
// The shards chosen from the unlocked look filled up before they were locked
class ShardsTaken extends Error {}

function rejectedRequestError(request, account) {
  if (request.userId !== account.uid) {
    return new HttpsError('invalid-argument', '訂單請求無效，請重新送出')
  }
  const code = DEFINITE_ORDER_ERRORS.has(request.errorCode) ? request.errorCode : 'failed-precondition'
  return new HttpsError(code, request.errorMessage || '這次訂單未成立，請重新送出', { checkoutRejected: true })
}

function missingRequestOrderError(request, account) {
  return request.userId === account.uid
    ? new HttpsError('not-found', '原訂單已取消，請重新建立訂單', { checkoutRejected: true })
    : new HttpsError('invalid-argument', '訂單請求無效，請重新送出')
}

// A final logical rejection must also fence any in-flight checkout with this
// request ID. Resolve a committed order first; otherwise the tombstone and the
// checkout compete on the same transaction read, so only one can commit.
async function finishRejectedRequest(requestRef, account, error) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(requestRef)
    const request = snap.data() || {}
    if (request.status === 'rejected') return { error: rejectedRequestError(request, account) }
    if (request.userId && request.userId !== account.uid) {
      return { error: new HttpsError('invalid-argument', '訂單請求無效，請重新送出') }
    }
    if (request.orderId) {
      const previous = await tx.get(db.doc(`orders/${request.orderId}`))
      if (previous.exists) {
        return previous.data().userId === account.uid
          ? { result: { status: 200, id: previous.id } }
          : { error: new HttpsError('invalid-argument', '訂單請求無效，請重新送出') }
      }
      // A deleted order resolves this checkout as cancelled. Keep its marker
      // so an old retry cannot resurrect it, even after stock is available.
      return { error: missingRequestOrderError(request, account) }
    }
    const rejected = {
      userId: account.uid,
      status: 'rejected',
      errorCode: error.code,
      errorMessage: error.message,
      createdAt: FieldValue.serverTimestamp()
    }
    tx.set(requestRef, rejected)
    return { error: rejectedRequestError(rejected, account) }
  })
}
// Firestore gave up on a transaction after repeated lock contention
const isContention = (error) => error?.code === 10 || error?.code === 'aborted'

const ALL_SHARDS = Array.from({ length: SHARD_COUNT }, (_, k) => k)
const settingsRef = db.doc('settings/ticketTypes')
const legacyRef = (ticketTypeId) => db.doc(`ticketSales/${ticketTypeId}`)
const shardRef = (ticketTypeId, k) => db.doc(`ticketSales/${ticketTypeId}/shards/${k}`)
const soldOf = (snap) => Number(snap.data()?.sold || 0)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function ticketTypesOf(settingsSnap) {
  return new Map(
    (settingsSnap.data()?.types || [])
      .filter((type) => type?.id)
      .map((type) => [String(type.id), type])
  )
}

function ticketTypeOf(ticketTypes, id) {
  const ticketType = ticketTypes.get(id)
  if (!ticketType) throw new HttpsError('invalid-argument', `無效的票種：${id}`)
  return ticketType
}

const soldOutError = (ticketType) => new HttpsError('resource-exhausted', `${ticketType.name}剩餘票量不足`)

// The stored shard caps of a limited type, or null when they must be planned again
function currentCapsOf(legacySnap, stock) {
  return getCurrentCaps(legacySnap.data()?.shardCaps, getAvailable(stock, soldOf(legacySnap)))
}

// Unlocked look before the transaction, so a sold-out type turns buyers away
// without opening one and the transaction locks only shards with room.
// Returns null when this requestId was already resolved (the transaction
// returns the order or rejection), otherwise { [ticketTypeId]: shards to lock } for the
// limited types. Throws the errors the transaction would for unknown types,
// types not on sale or not for this buyer, and sold-out types.
async function chooseShards({ ticketTypeIds, quantities, requestRef, order, account, spread }) {
  const refs = [settingsRef, ...ticketTypeIds.map(legacyRef), ...(requestRef ? [requestRef] : [])]
  const [settingsSnap, ...snaps] = await db.getAll(...refs)
  const legacySnaps = snaps.slice(0, ticketTypeIds.length)
  if (requestRef && snaps.at(-1).exists) return null

  const ticketTypes = ticketTypesOf(settingsSnap)
  const now = new Date()
  const limited = []

  ticketTypeIds.forEach((id, i) => {
    const ticketType = ticketTypeOf(ticketTypes, id)
    checkSaleOpen(ticketType, { now, school: order.school, email: account.email })
    const stock = getStockLimit(ticketType)
    if (stock !== null) limited.push({ id, ticketType, stock, legacySnap: legacySnaps[i] })
  })
  if (limited.length === 0) return {}

  const shardSnaps = await db.getAll(...limited.flatMap(({ id }) => ALL_SHARDS.map((k) => shardRef(id, k))))

  return Object.fromEntries(
    limited.map(({ id, ticketType, stock, legacySnap }, i) => {
      const sold = shardSnaps.slice(i * SHARD_COUNT, (i + 1) * SHARD_COUNT).map(soldOf)
      const caps = currentCapsOf(legacySnap, stock) || planShardCaps(getAvailable(stock, soldOf(legacySnap)), sold)
      const shards = planShards({ caps, sold, quantity: quantities.get(id), random: randomInt, spread })
      if (!shards) throw soldOutError(ticketType)
      return [id, shards]
    })
  )
}

// Counts each item's tickets in its shards; returns { [ticketTypeId]: { [k]: n } }.
// A limited type locks only the shards chooseShards picked and sells each up
// to its cap in ticketSales/{id}.shardCaps, throwing ShardsTaken when they
// filled up meanwhile. When the caps are missing or were planned for another
// stock, every shard is locked and the caps planned again from what each has
// sold; so is a type chooseShards did not plan. Locking every shard makes
// "sold out" final. Unlimited types read nothing: they add to a random shard,
// which makes stored caps out of date, so those are dropped.
async function reserveStock(tx, items, ticketTypes, legacySnaps, chosen) {
  const plans = items.map((item, index) => {
    const legacySnap = legacySnaps[index]
    const ticketType = ticketTypes.get(item.id)
    const stock = getStockLimit(ticketType)
    if (stock === null) return { item, legacySnap, allocation: { [randomInt(SHARD_COUNT)]: item.quantity } }

    const caps = currentCapsOf(legacySnap, stock)
    const shards = caps && chosen[item.id] ? chosen[item.id] : ALL_SHARDS
    return { item, legacySnap, ticketType, available: getAvailable(stock, soldOf(legacySnap)), caps, shards }
  })
  const limited = plans.filter((plan) => !plan.allocation)
  const refs = limited.flatMap((plan) => plan.shards.map((k) => shardRef(plan.item.id, k)))
  const snaps = refs.length > 0 ? await tx.getAll(...refs) : []

  let next = 0
  for (const plan of limited) {
    const sold = plan.shards.map(() => soldOf(snaps[next++]))
    if (!plan.caps) {
      plan.caps = planShardCaps(plan.available, sold)
      tx.set(plan.legacySnap.ref, { shardCaps: { available: plan.available, caps: plan.caps } }, { merge: true })
    }

    plan.allocation = allocateStock({ caps: plan.caps, shards: plan.shards, sold, quantity: plan.item.quantity })
    if (!plan.allocation) {
      throw plan.shards.length === SHARD_COUNT ? soldOutError(plan.ticketType) : new ShardsTaken()
    }
  }

  plans
    .filter((plan) => !plan.ticketType && plan.legacySnap.data()?.shardCaps)
    .forEach((plan) => tx.set(plan.legacySnap.ref, { shardCaps: FieldValue.delete() }, { merge: true }))

  return Object.fromEntries(plans.map((plan) => [plan.item.id, plan.allocation]))
}

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
  if (error instanceof ShardsTaken || isContention(error)) {
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

    const requestId = isValidRequestId(data?.requestId) ? data.requestId : null
    const requestRef = requestId ? db.doc(`orderRequests/${requestId}`) : null

    // A committed checkout remains recoverable even if the shop is later
    // closed or throttling starts. The transaction below also checks this
    // marker, protecting simultaneous calls before either has committed.
    if (requestId) {
      const request = await requestRef.get()
      if (request.exists) {
        if (request.data().status === 'rejected') throw rejectedRequestError(request.data(), account)
        if (request.data().userId && request.data().userId !== account.uid) {
          throw new HttpsError('invalid-argument', '訂單請求無效，請重新送出')
        }
        const previous = await db.doc(`orders/${request.data().orderId}`).get()
        if (previous.exists) {
          if (previous.data().userId !== account.uid) {
            throw new HttpsError('invalid-argument', '訂單請求無效，請重新送出')
          }
          return { status: 200, id: previous.id }
        }
        throw missingRequestOrderError(request.data(), account)
      }
    }

    const { order, quantities } = sanitizeOrderInput(data?.orderPayload, account.email)

    const dateKey = getTaiwanDateKey()
    const schoolCode = SCHOOL_CODES[order.school]
    const ticketTypeIds = [...quantities.keys()]

    const buyerRef = db.doc(`buyerPurchases/${getBuyerKey(order.customerEmail)}`)
    const legacyRefs = ticketTypeIds.map(legacyRef)
    const choose = (spread) => chooseShards({ ticketTypeIds, quantities, requestRef, order, account, spread })
    let idAttempt = 1
    let stockAttempt = 1

    try {
      // the stock look runs alongside the checks before it; their errors come first
      const [checks, look] = await Promise.allSettled([
        assertShopOpen(account).then(() => enforceAccountLimit(account)),
        choose(false)
      ])
      if (checks.status === 'rejected') throw checks.reason
      if (look.status === 'rejected') throw look.reason
      let chosen = look.value

      for (;;) {
        const orderRef = db.doc(`orders/${generateOrderId(schoolCode, dateKey)}`)

        try {
          return await db.runTransaction(async (tx) => {
            const refs = [settingsRef, buyerRef, orderRef, ...(requestRef ? [requestRef] : []), ...legacyRefs]
            const snaps = await tx.getAll(...refs)
            const [settingsSnap, buyerSnap, orderSnap] = snaps
            const requestSnap = requestRef ? snaps[3] : null
            const legacySnaps = snaps.slice(requestRef ? 4 : 3)

            // the same checkout was already committed (e.g. the response was lost)
            if (requestSnap?.exists) {
              const request = requestSnap.data()
              if (request.status === 'rejected') throw rejectedRequestError(request, account)
              if (request.userId && request.userId !== account.uid) {
                throw new HttpsError('invalid-argument', '訂單請求無效，請重新送出')
              }
              const previous = await tx.get(db.doc(`orders/${requestSnap.data().orderId}`))
              if (previous.exists && previous.data().userId === account.uid) {
                return { status: 200, id: previous.id }
              }
              if (previous.exists) {
                throw new HttpsError('invalid-argument', '訂單請求無效，請重新送出')
              }
              throw missingRequestOrderError(request, account)
            }

            if (orderSnap.exists) throw new OrderIdTaken()

            const ticketTypes = ticketTypesOf(settingsSnap)

            const now = new Date()
            const bought = buyerSnap.data()?.quantities || {}
            const items = ticketTypeIds.map((id) => {
              const ticketType = ticketTypeOf(ticketTypes, id)
              const quantity = quantities.get(id)

              checkTicketType(ticketType, quantity, {
                now,
                school: order.school,
                email: account.email,
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

            // Stock and buyer allowance commit together with the new order.
            const stockShards = await reserveStock(tx, items, ticketTypes, legacySnaps, chosen || {})

            Object.entries(stockShards).forEach(([id, allocation]) => {
              Object.entries(allocation).forEach(([k, n]) => {
                tx.set(shardRef(id, k), { sold: FieldValue.increment(n) }, { merge: true })
              })
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
              stockShards, // { [ticketTypeId]: { [shard]: n } }, refunded by releaseOrderStock
              delivered: false,
              paid: false,
              emailStatus: 'pending',
              createdAt: FieldValue.serverTimestamp()
            })

            if (requestRef) {
              tx.set(requestRef, { userId: account.uid, orderId: orderRef.id, createdAt: FieldValue.serverTimestamp() })
            }

            return { status: 201, id: orderRef.id }
          }, { maxAttempts: 10 })
        } catch (error) {
          if (error instanceof OrderIdTaken && idAttempt++ < ORDER_ID_ATTEMPTS) continue
          // the last tickets are fought over until Firestore gives up; if they
          // are gone by then, say sold out rather than "try again"
          if (isContention(error)) await choose(false)
          if (!(error instanceof ShardsTaken) || stockAttempt++ >= STOCK_ATTEMPTS) throw error
          // others took those shards: back off a little, then look again
          await sleep(randomInt(20, 100) * stockAttempt)
          chosen = await choose(stockAttempt > SPREAD_AFTER)
        }
      }
    } catch (error) {
      if (requestRef && error instanceof HttpsError && DEFINITE_ORDER_ERRORS.has(error.code)) {
        let outcome
        try {
          outcome = await finishRejectedRequest(requestRef, account, error)
        } catch (markerError) {
          console.error('[createOrder] could not resolve rejected checkout:', markerError)
        }
        if (outcome?.result) return outcome.result
        if (outcome?.error) throw outcome.error
      }
      throw toHttpsError(error)
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

      // orders placed before the shards were counted in the legacy counter
      if (order.stockShards && typeof order.stockShards === 'object') {
        Object.entries(order.stockShards).forEach(([id, allocation]) => {
          Object.entries(allocation || {}).forEach(([k, n]) => {
            if (Number.isInteger(n) && n > 0) {
              tx.set(shardRef(id, k), { sold: FieldValue.increment(-n) }, { merge: true })
            }
          })
          // Caps can exceed the configured stock when it was lowered below
          // existing sales. Reusing a refunded cap would then sell tickets
          // above that limit; recalculate against the remaining sales first.
          tx.set(legacyRef(id), { shardCaps: FieldValue.delete() }, { merge: true })
        })
      } else {
        // this changes the stock left for the shards, so their caps are planned again
        quantities.forEach((quantity, id) => {
          tx.set(legacyRef(id), { sold: FieldValue.increment(-quantity) }, { merge: true })
        })
      }

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

// Plans the shard caps of every limited type as soon as the ticket types are
// saved, so the first checkouts after a stock change need not each lock all
// shards to do it (createOrder still does, if this has not run yet).
export const planStockShards = functions
  .region(REGION)
  .firestore.document('settings/ticketTypes')
  .onWrite(async () => {
    await db.runTransaction(async (tx) => {
      const limited = [...ticketTypesOf(await tx.get(settingsRef))]
        .filter(([id, ticketType]) => TICKET_TYPE_ID_PATTERN.test(id) && getStockLimit(ticketType) !== null)
      if (limited.length === 0) return

      const legacySnaps = await tx.getAll(...limited.map(([id]) => legacyRef(id)))
      const stale = limited
        .map(([id, ticketType], i) => ({ id, stock: getStockLimit(ticketType), legacySnap: legacySnaps[i] }))
        .filter(({ stock, legacySnap }) => !currentCapsOf(legacySnap, stock))
      if (stale.length === 0) return

      const shardSnaps = await tx.getAll(...stale.flatMap(({ id }) => ALL_SHARDS.map((k) => shardRef(id, k))))
      stale.forEach(({ stock, legacySnap }, i) => {
        const available = getAvailable(stock, soldOf(legacySnap))
        const sold = shardSnaps.slice(i * SHARD_COUNT, (i + 1) * SHARD_COUNT).map(soldOf)
        tx.set(legacySnap.ref, { shardCaps: { available, caps: planShardCaps(available, sold) } }, { merge: true })
      })
    })
  })

/* ---------- confirmation email queue ---------- */

// The deterministic queue ID makes duplicate trigger deliveries harmless.
// Provider sends and retry / uncertain outcomes are handled by the mail worker.
export const sendOrderQRCode = functions
  .region(REGION)
  .runWith({ failurePolicy: true })
  .firestore.document('orders/{orderId}')
  .onCreate(async (snap, context) => {
    const orderId = context.params.orderId
    const current = await snap.ref.get()

    if (!current.exists || current.data().emailStatus === 'sent') return

    await enqueueOrderConfirmation(orderId, current.data())
  })

// Staff can resend the confirmation from the admin order list
export const resendOrderEmail = functions
  .region(REGION)
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

    return enqueueManualOrderResend(orderId, snap.data(), context.auth.uid, { requestId: data?.requestId })
  })
