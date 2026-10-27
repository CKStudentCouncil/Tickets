import * as functions from 'firebase-functions/v1'
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'

import { db, HttpsError, assertRole } from './common.js'
import { REGION, SHOP_OPEN_AT } from './constants.js'
import { getTaiwanYear, parseTaipeiDateTime } from './time.js'
import { isValidRequestId } from './orderValidation.js'
import { applyStockReleases, stockReleaseOf, stockReleaseRef } from './orders.js'
import { staffName } from './orderActions.js'
import { saleDatesOf, saleRowOf, ticketTypeNamesOf, writeYearArchive } from './salesArchive.js'

// 清除所有訂單: once a super admin's browser on /admin has downloaded an Excel
// backup of every order, it calls purgeOrders with exactly those order ids.
// Every one of them is archived to salesArchives (with the yearly summaries)
// before any is deleted; then each order is archived again as it is at that
// moment and deleted in the same transaction as its stock release, so an
// order is never gone without its archived copy. Orders placed after the
// backup are not on the list and stay. An interrupted purge keeps its
// progress and resumes with the same purgeId.
//
// Documents written only by this function (super admins may read them):
//   orderPurges/{purgeId}                          the run: stage, progress, lease; small, as the
//                                                  admin page follows it live
//   orderPurges/{purgeId}/orderIds/{n}             its order ids, ID_CHUNK per document (functions only)
//   salesArchives/{year}/archivedOrders/{orderId}  the order as it was when deleted ("orders"
//                                                  would put it under every orders index)
//   salesArchives/{year}, .../rows/{n}             the year's summary and sale rows of the
//                                                  orders placed in it (salesArchive.js)
//   systemLogs/purge_{purgeId}                     who purged how many orders, and when

export const PURGE_CONFIRM_PHRASE = 'DELETE ALL ORDERS'
// what one call can archive and delete well within its 540 s
export const MAX_PURGE_ORDERS = 20_000
// writes per delete transaction, below Firestore's 500
export const MAX_PURGE_WRITES = 450
const MAX_ORDERS_PER_COMMIT = 100
const PAGE_SIZE = 200
const ID_CHUNK = 2000
// held for longer than one call may run (540 s)
const LEASE_MS = 10 * 60 * 1000
const UNFINISHED_STAGES = ['archive', 'delete']

const purgeRef = (purgeId) => db.doc(`orderPurges/${purgeId}`)
const orderIdsRef = (purgeId) => db.collection(`orderPurges/${purgeId}/orderIds`)
const orderRef = (orderId) => db.doc(`orders/${orderId}`)
const archivedOrderRef = (year, orderId) => db.doc(`salesArchives/${year}/archivedOrders/${orderId}`)
const archivedCopy = (order, archive) => ({ ...order, archive })
const millis = (value) => value?.toMillis?.() ?? 0

// Any order document id: orders made by hand or before ORDER_ID_PATTERN may
// not follow it
function isDocumentId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 200 &&
    !id.includes('/') && id !== '.' && id !== '..' && !/^__.*__$/.test(id)
}

export function sanitizePurgeInput(data) {
  if (data?.confirm !== PURGE_CONFIRM_PHRASE) {
    throw new HttpsError('invalid-argument', `請輸入「${PURGE_CONFIRM_PHRASE}」確認清除`)
  }
  if (!isValidRequestId(data.purgeId)) {
    throw new HttpsError('invalid-argument', '清除作業編號無效，請重新整理頁面後再試')
  }
  // resuming: the run already holds its order ids
  if (data.orderIds == null) return { purgeId: data.purgeId, orderIds: null }

  if (!Array.isArray(data.orderIds) || data.orderIds.length === 0 || !data.orderIds.every(isDocumentId)) {
    throw new HttpsError('invalid-argument', '訂單清單無效，請重新下載備份後再試')
  }
  const orderIds = [...new Set(data.orderIds)]
  if (orderIds.length > MAX_PURGE_ORDERS) {
    throw new HttpsError('invalid-argument', `一次最多清除 ${MAX_PURGE_ORDERS} 筆訂單`)
  }
  return { purgeId: data.purgeId, orderIds }
}

// Archived under the year the order was placed, in Taiwan time
export function archiveYearOf(order, fallbackYear) {
  const at = parseTaipeiDateTime(order?.createdAt)
  return at ? getTaiwanYear(at) : fallbackYear
}

// The documents deleting one order writes: its archived copy, the order, its
// release marker and the counters its release changes (written once per
// transaction however many orders share them, see applyStockReleases).
export function purgeWriteKeys(orderId, order) {
  // a missing order at most removes a stale archived copy
  if (!order) return [`copy/${orderId}`]

  const keys = [`copy/${orderId}`, `order/${orderId}`]
  const release = stockReleaseOf(order)
  if (!release) return keys

  keys.push(`marker/${orderId}`)
  if (release.buyerKey) keys.push(`buyer/${release.buyerKey}`)
  if (release.stockShards) {
    Object.entries(release.stockShards).forEach(([id, allocation]) => {
      keys.push(`legacy/${id}`)
      Object.keys(allocation || {}).forEach((k) => keys.push(`shard/${id}/${k}`))
    })
  } else {
    release.quantities.forEach((_, id) => keys.push(`legacy/${id}`))
  }
  return keys
}

// Splits [{ id, order }] into the order ids of each delete transaction
export function planPurgeCommits(entries, maxWrites = MAX_PURGE_WRITES, maxOrders = MAX_ORDERS_PER_COMMIT) {
  const commits = []
  let ids = []
  let keys = new Set()

  entries.forEach(({ id, order }) => {
    const orderKeys = purgeWriteKeys(id, order)
    const added = orderKeys.filter((key) => !keys.has(key)).length
    if (ids.length && (ids.length >= maxOrders || keys.size + added > maxWrites)) {
      commits.push(ids)
      ids = []
      keys = new Set()
    }
    ids.push(id)
    orderKeys.forEach((key) => keys.add(key))
  })

  if (ids.length) commits.push(ids)
  return commits
}

function progressOf(purgeId, job) {
  return {
    purgeId,
    stage: job.stage,
    total: job.total,
    archivedCount: job.archivedCount || 0,
    deletedCount: job.deletedCount || 0,
    missingCount: job.missingCount || 0,
    years: job.years || [],
    error: job.error ? { stage: job.error.stage, message: job.error.message } : null
  }
}

// Starts the run, or takes it over to resume it. Another call still working
// on it keeps it; this one then only reports the progress.
function claimPurge(input, actor, owner) {
  const ref = purgeRef(input.purgeId)

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const leaseUntil = Timestamp.fromMillis(Date.now() + LEASE_MS)

    if (!snap.exists) {
      if (!input.orderIds) throw new HttpsError('not-found', '找不到這次清除作業，請重新開始')
      const unfinished = await tx.get(db.collection('orderPurges').where('stage', 'in', UNFINISHED_STAGES).limit(1))
      if (!unfinished.empty) {
        throw new HttpsError('failed-precondition', '另一個清除作業尚未完成，請先在後台繼續完成它')
      }

      const job = {
        total: input.orderIds.length,
        stage: 'archive',
        archiveCursor: 0,
        archivedCount: 0,
        deleteCursor: 0,
        deletedCount: 0,
        missingCount: 0,
        years: [],
        // for orders without createdAt, fixed so a resumed run files them alike
        fallbackYear: getTaiwanYear(),
        error: null,
        requestedByUid: actor.uid,
        requestedByName: actor.name,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        leaseOwner: owner,
        leaseUntil
      }
      tx.create(ref, job)
      for (let start = 0; start < input.orderIds.length; start += ID_CHUNK) {
        tx.create(orderIdsRef(input.purgeId).doc(String(start / ID_CHUNK).padStart(3, '0')), {
          ids: input.orderIds.slice(start, start + ID_CHUNK)
        })
      }
      return { job, run: true }
    }

    const job = snap.data()
    if (job.stage === 'done') return { job, run: false }
    if (job.leaseOwner && job.leaseOwner !== owner && millis(job.leaseUntil) > Date.now()) {
      return { job, run: false }
    }

    tx.update(ref, { leaseOwner: owner, leaseUntil, error: null, updatedAt: FieldValue.serverTimestamp() })
    return { job: { ...job, error: null }, run: true }
  })
}

// Recomputed from every archived order of the year, so a rerun, or a second
// purge in the same year, never counts an order twice
async function writeSummaries(years) {
  const shop = await db.doc('settings/shop').get()
  const shopOpenAt = parseTaipeiDateTime(shop.data()?.openAt) || SHOP_OPEN_AT

  for (const year of years) {
    // A year imported from its Excel export (importSalesArchive) already
    // holds that whole sale; the few orders left of it stay in
    // archivedOrders but must not replace it.
    const current = await db.doc(`salesArchives/${year}`).get()
    if (current.exists && current.data().source === 'import') continue

    const snap = await db.collection(`salesArchives/${year}/archivedOrders`)
      .select('createdAt', 'finalTotal', 'paid', 'delivered', 'school', 'class', 'items', 'archive.purgeId')
      .get()
    const orders = snap.docs.map((doc) => doc.data())
    const rows = orders.map(saleRowOf)
    await writeYearArchive(year, {
      rows,
      names: ticketTypeNamesOf(orders),
      ...saleDatesOf(rows, year, shopOpenAt),
      source: 'purge',
      fields: { purgeIds: [...new Set(orders.map((order) => order.archive?.purgeId).filter(Boolean))].sort() }
    })
  }
}

// Copies every order of the run before any is deleted. A failure here
// leaves every order in place.
async function archiveOrders(ref, state, purgeId) {
  const archivedAt = Timestamp.now()
  const years = new Set(state.years)

  while (state.archiveCursor < state.total) {
    const ids = state.orderIds.slice(state.archiveCursor, state.archiveCursor + PAGE_SIZE)
    const snaps = await db.getAll(...ids.map(orderRef))
    const batch = db.batch()
    let archived = 0

    snaps.forEach((snap) => {
      // already deleted by someone else: nothing to archive or purge
      if (!snap.exists) return
      const year = archiveYearOf(snap.data(), state.fallbackYear)
      years.add(year)
      batch.set(archivedOrderRef(year, snap.id), archivedCopy(snap.data(), { purgeId, archivedAt }))
      archived += 1
    })
    await batch.commit()

    state.archiveCursor += ids.length
    state.archivedCount += archived
    state.years = [...years].sort()
    await ref.update({
      archiveCursor: state.archiveCursor,
      archivedCount: state.archivedCount,
      years: state.years,
      updatedAt: FieldValue.serverTimestamp()
    })
  }

  await writeSummaries(state.years)
  state.stage = 'delete'
  await ref.update({ stage: 'delete', updatedAt: FieldValue.serverTimestamp() })
}

// One transaction: each order is archived again as it is now (payment or
// pickup may have changed since), its stock and allowance are given back
// and it is deleted. Its release marker keeps releaseOrderStock, which the
// deletion triggers, from giving them back a second time.
function deleteCommit(ids, state, purgeId, purgedAt) {
  const span = 2 + state.years.length

  return db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...ids.flatMap((id) => [
      orderRef(id),
      stockReleaseRef(id),
      ...state.years.map((year) => archivedOrderRef(year, id))
    ]))
    const releases = []
    const years = new Set(state.years)
    let deleted = 0
    let missing = 0

    ids.forEach((id, i) => {
      const [orderSnap, markerSnap, ...copies] = snaps.slice(i * span, (i + 1) * span)
      const copy = copies.find((snap) => snap.exists)

      if (orderSnap.exists) {
        const order = orderSnap.data()
        const year = archiveYearOf(order, state.fallbackYear)
        years.add(year)
        tx.set(archivedOrderRef(year, id), archivedCopy(order, {
          purgeId,
          archivedAt: copy?.data().archive?.archivedAt || purgedAt,
          purgedAt
        }))

        const release = stockReleaseOf(order)
        if (release && !markerSnap.exists) {
          releases.push(release)
          tx.create(markerSnap.ref, { releasedAt: FieldValue.serverTimestamp() })
        }
        tx.delete(orderSnap.ref)
        deleted += 1
        return
      }

      const archive = copy?.data().archive
      if (archive?.purgedAt) {
        // deleted by an earlier, interrupted call of this purge (or by another)
        if (archive.purgeId === purgeId) deleted += 1
        else missing += 1
      } else {
        // deleted by someone else after it was archived: it was not purged
        if (copy) tx.delete(copy.ref)
        missing += 1
      }
    })

    applyStockReleases(tx, releases)
    return { deleted, missing, years: [...years].sort() }
  })
}

async function deleteOrders(ref, state, purgeId) {
  const purgedAt = Timestamp.now()

  while (state.deleteCursor < state.total) {
    const ids = state.orderIds.slice(state.deleteCursor, state.deleteCursor + PAGE_SIZE)
    // read once to size the transactions; items, stock shards and the email
    // of an order never change
    const snaps = await db.getAll(...ids.map(orderRef))
    const commits = planPurgeCommits(snaps.map((snap) => ({ id: snap.id, order: snap.exists ? snap.data() : null })))

    for (const commitIds of commits) {
      const { deleted, missing, years } = await deleteCommit(commitIds, state, purgeId, purgedAt)
      state.deleteCursor += commitIds.length
      state.deletedCount += deleted
      state.missingCount += missing
      state.years = years
      await ref.update({
        deleteCursor: state.deleteCursor,
        deletedCount: state.deletedCount,
        missingCount: state.missingCount,
        years: state.years,
        updatedAt: FieldValue.serverTimestamp()
      })
    }
  }
}

async function finishPurge(ref, state, purgeId, actor) {
  await writeSummaries(state.years)

  // the log and the finished run commit together
  const batch = db.batch()
  batch.set(db.doc(`systemLogs/purge_${purgeId}`), {
    type: 'orders.purge',
    purgeId,
    actorUid: actor.uid,
    actorName: actor.name,
    requestedByUid: state.requestedByUid,
    requestedByName: state.requestedByName,
    total: state.total,
    purgedCount: state.deletedCount,
    missingCount: state.missingCount,
    years: state.years,
    occurredAt: FieldValue.serverTimestamp()
  })
  batch.update(ref, {
    stage: 'done',
    leaseOwner: FieldValue.delete(),
    leaseUntil: FieldValue.delete(),
    finishedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  })
  await batch.commit()
  state.stage = 'done'
}

function failureMessage(state) {
  if (state.stage === 'archive') return '封存訂單失敗，沒有刪除任何訂單；請稍後重試'
  if (state.deleteCursor >= state.total) return '訂單已全部刪除，但封存摘要或系統紀錄尚未寫入；請重試以完成'
  return `刪除中斷，已刪除 ${state.deletedCount} / ${state.total} 筆；請重試以繼續清除其餘訂單`
}

// Retry with the same purgeId (without orderIds) to resume an interrupted
// run. Returns its progress; `running` when another call is still on it.
export const purgeOrders = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    await assertRole(context, 'super_admin')
    const profile = (await db.doc(`users/${context.auth.uid}`).get()).data() || {}
    const actor = { uid: context.auth.uid, name: staffName(profile, context) }
    const input = sanitizePurgeInput(data)
    const ref = purgeRef(input.purgeId)

    const { job, run } = await claimPurge(input, actor, randomUUID())
    if (!run) return { ...progressOf(input.purgeId, job), running: job.stage !== 'done' }

    const state = { ...job }
    try {
      const chunks = await orderIdsRef(input.purgeId).orderBy(FieldPath.documentId()).get()
      state.orderIds = chunks.docs.flatMap((doc) => doc.data().ids)

      if (state.stage === 'archive') await archiveOrders(ref, state, input.purgeId)
      if (state.stage === 'delete') {
        await deleteOrders(ref, state, input.purgeId)
        await finishPurge(ref, state, input.purgeId, actor)
      }
      return progressOf(input.purgeId, state)
    } catch (error) {
      console.error(`[purgeOrders] ${input.purgeId} stopped at ${state.stage}:`, error)
      state.error = { stage: state.stage, message: failureMessage(state) }
      await ref.update({
        error: { ...state.error, at: FieldValue.serverTimestamp() },
        leaseOwner: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      }).catch((updateError) => console.error('[purgeOrders] could not record the failure:', updateError))
      throw new HttpsError('aborted', state.error.message, progressOf(input.purgeId, state))
    }
  })
