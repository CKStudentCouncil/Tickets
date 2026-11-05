import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'

import { db, HttpsError } from './common.js'
import { MAX_SELLER_TICKETS, REGION, ROLE_RANK } from './constants.js'
import { TICKET_TYPE_ID_PATTERN, isValidRequestId } from './orderValidation.js'
import { STOCK_GATE_SECRETS, resetStockGate } from './stockGate.js'
import {
  clearSoldOut,
  getBuyerAccount,
  isContention,
  legacyRef,
  reserveStock,
  settingsRef,
  shardRef,
  ticketTypeOf,
  ticketTypesOf
} from './orders.js'

// 學弟登記賣票: students on the seller list (sellers/{email}, kept by super
// admins) take tickets of the ticket type chosen in settings/sellerProgram
// (the 二售 type) to sell to their friends themselves. A registration takes
// the tickets from that type's stock at once, so the public sees fewer left,
// and cannot be undone by the seller: tickets taken must be sold. Admins may
// delete a mistaken registration, which gives the tickets back.
//
// Documents written only by these functions (denied to clients by the rules):
//   sellerRegistrations/{requestId}  the registration; admins may only flip
//                                    delivered / paid and delete it, and
//                                    change its quantity through
//                                    updateSellerRegistrationQuantity
//   sellerStats/summary              { total } tickets registered by everyone
//   sellerReleases/{registrationId}  marks a deleted registration as released

const programRef = db.doc('settings/sellerProgram')
const summaryRef = db.doc('sellerStats/summary')
const sellerRef = (email) => db.doc(`sellers/${email}`)
const registrationRef = (id) => db.doc(`sellerRegistrations/${id}`)
const releaseRef = (id) => db.doc(`sellerReleases/${id}`)

export function sanitizeSellerInput(data) {
  const quantity = Number(data?.quantity)
  const sellerName = String(data?.sellerName ?? '').trim().slice(0, 50)

  if (!isValidRequestId(data?.requestId)) {
    throw new HttpsError('invalid-argument', '登記請求無效，請重新整理後再試')
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new HttpsError('invalid-argument', '張數必須為正整數')
  }
  if (quantity > MAX_SELLER_TICKETS) {
    throw new HttpsError('invalid-argument', `一次最多登記 ${MAX_SELLER_TICKETS} 張`)
  }
  if (!sellerName) {
    throw new HttpsError('invalid-argument', '請填寫姓名')
  }

  return { requestId: data.requestId, quantity, sellerName }
}

// The registration as the seller sees it
const resultOf = (id, registration) => ({
  id,
  quantity: registration.quantity,
  ticketTypeName: registration.ticketTypeName
})

export const registerSellerTickets = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    const account = getBuyerAccount(context)
    const { requestId, quantity, sellerName } = sanitizeSellerInput(data)
    const ref = registrationRef(requestId)

    try {
      return await db.runTransaction(async (tx) => {
        const [requestSnap, releasedSnap, sellerSnap, programSnap, settingsSnap] = await tx.getAll(
          ref,
          releaseRef(requestId),
          sellerRef(account.email),
          programRef,
          settingsRef
        )

        // the same registration was already saved (e.g. the response was lost)
        if (requestSnap.exists) {
          if (requestSnap.data().sellerUid !== account.uid) {
            throw new HttpsError('invalid-argument', '登記請求無效，請重新整理後再試')
          }
          return resultOf(requestSnap.id, requestSnap.data())
        }
        // an admin deleted it: a late retry must not register it again
        if (releasedSnap.exists) {
          throw new HttpsError('failed-precondition', '這筆登記已被刪除，請重新整理後再登記')
        }

        if (!sellerSnap.exists) {
          throw new HttpsError('permission-denied', '你不在賣票名單中，請聯絡總副召')
        }

        const program = programSnap.data() || {}
        const ticketTypeId = String(program.ticketTypeId || '')
        if (program.enabled !== true || !TICKET_TYPE_ID_PATTERN.test(ticketTypeId)) {
          throw new HttpsError('failed-precondition', '目前尚未開放登記賣票')
        }

        const ticketTypes = ticketTypesOf(settingsSnap)
        const ticketType = ticketTypeOf(ticketTypes, ticketTypeId)
        const legacySnap = await tx.get(legacyRef(ticketTypeId))

        // Every shard is locked: registrations are rare, and this makes
        // "not enough left" final. No sale window or per-person limit: the
        // seller is not the buyer, and sells before or during the sale.
        const stockShards = await reserveStock(
          tx,
          [{ id: ticketTypeId, quantity }],
          ticketTypes,
          [legacySnap],
          {}
        )

        Object.entries(stockShards[ticketTypeId]).forEach(([k, n]) => {
          tx.set(shardRef(ticketTypeId, k), { sold: FieldValue.increment(n) }, { merge: true })
        })

        const registration = {
          sellerUid: account.uid,
          sellerEmail: account.email,
          sellerName,
          ticketTypeId,
          ticketTypeName: String(ticketType.name || ''),
          price: Number(ticketType.price) || 0,
          quantity,
          stockShards, // { [ticketTypeId]: { [shard]: n } }, refunded by releaseSellerStock
          delivered: false,
          paid: false,
          createdAt: FieldValue.serverTimestamp()
        }
        tx.create(ref, registration)
        tx.set(
          summaryRef,
          { total: FieldValue.increment(quantity), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )

        return resultOf(ref.id, registration)
      }, { maxAttempts: 10 })
    } catch (error) {
      // reserveStock reports a sold-out type as resource-exhausted
      if (error instanceof HttpsError) throw error
      if (isContention(error)) {
        throw new HttpsError('aborted', '目前購票人數眾多，請稍後再試一次')
      }
      console.error('[registerSellerTickets] unexpected error:', error)
      throw new HttpsError('internal', '登記失敗，請稍後再試')
    }
  })

// When an admin deletes a registration, give its tickets back to the stock
// and take them off the shared total. The marker document makes this safe if
// the trigger is delivered more than once. The stock gate then counts those
// types again from the shards.
export const releaseSellerStock = functions
  .region(REGION)
  .runWith({ failurePolicy: true, secrets: STOCK_GATE_SECRETS })
  .firestore.document('sellerRegistrations/{registrationId}')
  .onDelete(async (snap, context) => {
    const registration = snap.data() || {}
    const quantity = Number(registration.quantity)
    if (!Number.isInteger(quantity) || quantity <= 0) return

    const markerRef = releaseRef(context.params.registrationId)

    await db.runTransaction(async (tx) => {
      if ((await tx.get(markerRef)).exists) return

      Object.entries(registration.stockShards || {}).forEach(([id, allocation]) => {
        Object.entries(allocation || {}).forEach(([k, n]) => {
          if (Number.isInteger(n) && n > 0) {
            tx.set(shardRef(id, k), { sold: FieldValue.increment(-n) }, { merge: true })
          }
        })
        // as in releaseOrderStock: plan the caps again from the remaining sales
        tx.set(legacyRef(id), { shardCaps: FieldValue.delete() }, { merge: true })
      })
      clearSoldOut(tx, Object.keys(registration.stockShards || {}))

      tx.set(
        summaryRef,
        { total: FieldValue.increment(-quantity), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      )
      tx.create(markerRef, { releasedAt: FieldValue.serverTimestamp() })
    })
    // thrown when Redis cannot be reached, so the trigger is retried (the
    // marker skips the release itself)
    await resetStockGate(Object.keys(registration.stockShards || {}), { throwOnError: true })
  })

export function sanitizeQuantityChange(data) {
  const quantity = Number(data?.quantity)
  const expectedQuantity = Number(data?.expectedQuantity)

  // a registration's id is its requestId
  if (!isValidRequestId(data?.registrationId)) {
    throw new HttpsError('invalid-argument', '登記編號無效')
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new HttpsError('invalid-argument', '張數必須為正整數；要取消整筆登記請用刪除')
  }
  if (quantity > MAX_SELLER_TICKETS) {
    throw new HttpsError('invalid-argument', `一筆登記最多 ${MAX_SELLER_TICKETS} 張`)
  }
  if (!Number.isInteger(expectedQuantity) || expectedQuantity <= 0) {
    throw new HttpsError('invalid-argument', '請提供目前的登記張數')
  }

  return { registrationId: data.registrationId, quantity, expectedQuantity }
}

// Takes `count` tickets off a registration's shard allocation
// ({ [shard]: n }), from the shards holding the most first. Returns the new
// allocation and what each shard gives back, or null when it holds fewer.
export function takeFromAllocation(allocation, count) {
  const next = {}
  const taken = {}
  let left = count

  Object.entries(allocation || {})
    .filter(([, n]) => Number.isInteger(n) && n > 0)
    .sort(([, a], [, b]) => b - a)
    .forEach(([k, n]) => {
      const take = Math.min(n, left)
      left -= take
      if (take > 0) taken[k] = take
      if (n - take > 0) next[k] = n - take
    })

  return left > 0 ? null : { next, taken }
}

// Admins change how many tickets a registration took, straight away: more
// are taken from the same ticket type's stock (never beyond it), fewer go
// back to it, and the shared total follows. expectedQuantity is what the
// admin saw, so two admins editing at once cannot undo each other.
export const updateSellerRegistrationQuantity = functions
  .region(REGION)
  .runWith({ secrets: STOCK_GATE_SECRETS })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) throw new HttpsError('unauthenticated', '請先登入')
    const { registrationId, quantity, expectedQuantity } = sanitizeQuantityChange(data)
    const ref = registrationRef(registrationId)
    const actorRef = db.doc(`users/${context.auth.uid}`)

    let result
    try {
      result = await db.runTransaction(async (tx) => {
        // the role is read in the same transaction, so a revoked admin cannot slip through
        const [actorSnap, registrationSnap] = await tx.getAll(actorRef, ref)
        const role = actorSnap.data()?.role
        if ((Object.hasOwn(ROLE_RANK, role) ? ROLE_RANK[role] : 0) < ROLE_RANK.admin) {
          throw new HttpsError('permission-denied', '權限不足')
        }
        if (!registrationSnap.exists) {
          throw new HttpsError('not-found', '找不到這筆登記，可能已被刪除')
        }

        const registration = registrationSnap.data()
        const current = Number(registration.quantity)
        if (current !== expectedQuantity) {
          throw new HttpsError('failed-precondition', '這筆登記的張數已被更改，請重新整理後再試', { quantity: current })
        }

        const delta = quantity - current
        if (delta === 0) return { quantity, delta: 0, released: false }

        const ticketTypeId = String(registration.ticketTypeId || '')
        const allocation = { ...(registration.stockShards?.[ticketTypeId] || {}) }
        let next

        if (delta > 0) {
          const [settingsSnap, legacySnap] = await tx.getAll(settingsRef, legacyRef(ticketTypeId))
          const ticketTypes = ticketTypesOf(settingsSnap)
          if (!ticketTypes.has(ticketTypeId)) {
            throw new HttpsError('failed-precondition', '這筆登記的票種已不存在，無法加票')
          }
          // every shard is locked, as in registerSellerTickets
          const added = (await reserveStock(tx, [{ id: ticketTypeId, quantity: delta }], ticketTypes, [legacySnap], {}))[ticketTypeId]
          Object.entries(added).forEach(([k, n]) => {
            tx.set(shardRef(ticketTypeId, k), { sold: FieldValue.increment(n) }, { merge: true })
            allocation[k] = (allocation[k] || 0) + n
          })
          next = allocation
        } else {
          const plan = takeFromAllocation(allocation, -delta)
          if (!plan) {
            throw new HttpsError('failed-precondition', '這筆登記的庫存紀錄不完整，無法減少張數')
          }
          Object.entries(plan.taken).forEach(([k, n]) => {
            tx.set(shardRef(ticketTypeId, k), { sold: FieldValue.increment(-n) }, { merge: true })
          })
          // as in releaseSellerStock: plan the caps again from the remaining sales
          tx.set(legacyRef(ticketTypeId), { shardCaps: FieldValue.delete() }, { merge: true })
          clearSoldOut(tx, [ticketTypeId])
          next = plan.next
        }

        tx.update(ref, {
          quantity,
          stockShards: { ...(registration.stockShards || {}), [ticketTypeId]: next },
          // what the seller registered, kept through every edit
          registeredQuantity: Number.isInteger(registration.registeredQuantity) ? registration.registeredQuantity : current,
          quantityUpdatedAt: FieldValue.serverTimestamp(),
          quantityUpdatedByUid: context.auth.uid
        })
        tx.set(
          summaryRef,
          { total: FieldValue.increment(delta), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        )

        return { quantity, delta, released: delta < 0, ticketTypeId }
      }, { maxAttempts: 10 })
    } catch (error) {
      // reserveStock reports a sold-out type as resource-exhausted
      if (error instanceof HttpsError) throw error
      if (isContention(error)) {
        throw new HttpsError('aborted', '目前購票人數眾多，請稍後再試一次')
      }
      console.error('[updateSellerRegistrationQuantity] unexpected error:', error)
      throw new HttpsError('internal', '修改失敗，請稍後再試')
    }

    // tickets came back: the stock gate counts the type again from the shards
    if (result.released) await resetStockGate([result.ticketTypeId])
    return { quantity: result.quantity, delta: result.delta }
  })
