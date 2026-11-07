import * as functions from 'firebase-functions/v1'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'

import { db, HttpsError, assertRole } from './common.js'
import { REGION } from './constants.js'
import { isAdminOnlyType } from './orderValidation.js'
import { applyStockReleases, stockReleaseOf, stockReleaseRef } from './orders.js'
import { staffName } from './orderActions.js'
import { planPurgeCommits } from './orderPurge.js'

// 刪除所有測試票訂單: a super admin on /admin first calls deleteTestOrders
// with { dryRun: true } to see how many there are, then with
// { confirm: true } to delete them. A test order is one whose every ticket
// is of a type that is a 測試票 now (settings/ticketTypes); an order that
// also holds other tickets is only counted (mixedCount), never deleted.
//
// Unlike the per-order delete in firestore.rules, paid and collected test
// orders go too, and so do test orders that were cancelled
// (cancelledOrders). Each order's stock and per-person allowance are given
// back in the transaction that deletes it, as purgeOrders does; its release
// marker keeps releaseOrderStock from giving them back twice. Its history
// goes with it, and systemLogs records who deleted how many.

const PAGE_SIZE = 500
// the fields a test order is told by, plus what stockReleaseOf and the
// preview need
const ORDER_FIELDS = ['items', 'stockCounted', 'stockShards', 'customerEmail', 'paid', 'delivered']

const orderRef = (orderId) => db.doc(`orders/${orderId}`)
const historyOf = (orderId) => db.collection(`orders/${orderId}/history`)

function ticketTypeIdsOf(order) {
  return (Array.isArray(order?.items) ? order.items : [])
    .filter((item) => Number(item?.quantity) > 0)
    .map((item) => String(item?.ticketTypeId || item?.id || ''))
}

function ticketCountOf(order) {
  return (Array.isArray(order?.items) ? order.items : [])
    .reduce((total, item) => total + (Number(item?.quantity) > 0 ? Number(item.quantity) : 0), 0)
}

// 'test' when every ticket on the order is a 測試票, 'mixed' when only some
// are, otherwise null
export function testOrderKind(order, testTypeIds) {
  const ids = ticketTypeIdsOf(order)
  const tests = ids.filter((id) => testTypeIds.has(id)).length
  if (tests === 0) return null
  return tests === ids.length ? 'test' : 'mixed'
}

export function sanitizeTestOrdersInput(data) {
  if (data?.dryRun === true) return { dryRun: true }
  if (data?.confirm !== true) throw new HttpsError('invalid-argument', '請先確認要刪除的測試票訂單')
  return { dryRun: false }
}

async function testTicketTypes() {
  const snap = await db.doc('settings/ticketTypes').get()
  const types = Array.isArray(snap.data()?.types) ? snap.data().types : []
  return types
    .filter((type) => type?.id && isAdminOnlyType(type))
    .map((type) => ({ id: String(type.id), name: String(type.name || type.id) }))
}

// Every document of the collection with `fields`, a page at a time
async function scan(collectionPath, fields, visit) {
  let last = null
  for (;;) {
    let page = db.collection(collectionPath).select(...fields).orderBy(FieldPath.documentId()).limit(PAGE_SIZE)
    if (last) page = page.startAfter(last)
    const snap = await page.get()
    snap.docs.forEach((doc) => visit(doc.id, doc.data()))
    if (snap.size < PAGE_SIZE) return
    last = snap.docs[snap.docs.length - 1]
  }
}

async function findTestOrders(testTypeIds) {
  const orders = []
  const cancelledIds = []
  let mixedCount = 0

  await scan('orders', ORDER_FIELDS, (id, order) => {
    const kind = testOrderKind(order, testTypeIds)
    if (kind === 'test') orders.push({ id, order })
    else if (kind === 'mixed') mixedCount += 1
  })
  // their stock went back when they were cancelled
  await scan('cancelledOrders', ['items'], (id, order) => {
    if (testOrderKind(order, testTypeIds) === 'test') cancelledIds.push(id)
  })

  return { orders, cancelledIds, mixedCount }
}

// One transaction: each order, read again, is deleted if it is still a test
// order, with its stock and allowance given back. Returns the ids deleted.
function deleteCommit(ids, testTypeIds) {
  return db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...ids.flatMap((id) => [orderRef(id), stockReleaseRef(id)]))
    const releases = []
    const deleted = []

    ids.forEach((id, i) => {
      const [orderSnap, markerSnap] = snaps.slice(i * 2, i * 2 + 2)
      if (!orderSnap.exists || testOrderKind(orderSnap.data(), testTypeIds) !== 'test') return

      const release = stockReleaseOf(orderSnap.data())
      if (release && !markerSnap.exists) {
        releases.push(release)
        tx.create(markerSnap.ref, { releasedAt: FieldValue.serverTimestamp() })
      }
      tx.delete(orderSnap.ref)
      deleted.push(id)
    })

    applyStockReleases(tx, releases)
    return deleted
  })
}

async function deleteCancelled(ids, testTypeIds) {
  const deleted = []
  for (let start = 0; start < ids.length; start += PAGE_SIZE) {
    const refs = ids.slice(start, start + PAGE_SIZE).map((id) => db.doc(`cancelledOrders/${id}`))
    const snaps = await db.getAll(...refs)
    const batch = db.batch()
    snaps.forEach((snap) => {
      if (!snap.exists || testOrderKind(snap.data(), testTypeIds) !== 'test') return
      batch.delete(snap.ref)
      deleted.push(snap.id)
    })
    await batch.commit()
  }
  return deleted
}

export const deleteTestOrders = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onCall(async (data, context) => {
    await assertRole(context, 'super_admin')
    const input = sanitizeTestOrdersInput(data)

    const ticketTypes = await testTicketTypes()
    const testTypeIds = new Set(ticketTypes.map((type) => type.id))
    const found = testTypeIds.size
      ? await findTestOrders(testTypeIds)
      : { orders: [], cancelledIds: [], mixedCount: 0 }

    const preview = {
      ticketTypes,
      orderCount: found.orders.length,
      ticketCount: found.orders.reduce((total, { order }) => total + ticketCountOf(order), 0),
      paidCount: found.orders.filter(({ order }) => order.paid === true).length,
      deliveredCount: found.orders.filter(({ order }) => order.delivered === true).length,
      cancelledCount: found.cancelledIds.length,
      mixedCount: found.mixedCount
    }
    if (input.dryRun) return { dryRun: true, ...preview }

    const deletedOrderIds = []
    for (const ids of planPurgeCommits(found.orders)) {
      deletedOrderIds.push(...await deleteCommit(ids, testTypeIds))
    }
    const deletedCancelledIds = await deleteCancelled(found.cancelledIds, testTypeIds)

    // payment and pickup records of the orders, cancelled ones included;
    // left behind they are unreachable, so a failure only logs
    try {
      const writer = db.bulkWriter()
      for (const id of [...deletedOrderIds, ...deletedCancelledIds]) {
        await db.recursiveDelete(historyOf(id), writer)
      }
      await writer.close()
    } catch (error) {
      console.error('[deleteTestOrders] could not delete order history:', error)
    }

    const profile = (await db.doc(`users/${context.auth.uid}`).get()).data() || {}
    await db.collection('systemLogs').add({
      type: 'orders.deleteTest',
      actorUid: context.auth.uid,
      actorName: staffName(profile, context),
      ticketTypeIds: [...testTypeIds],
      deletedCount: deletedOrderIds.length,
      cancelledDeletedCount: deletedCancelledIds.length,
      mixedCount: found.mixedCount,
      occurredAt: FieldValue.serverTimestamp()
    })

    return {
      dryRun: false,
      ...preview,
      deletedCount: deletedOrderIds.length,
      cancelledDeletedCount: deletedCancelledIds.length,
      deletedOrderIds
    }
  })
