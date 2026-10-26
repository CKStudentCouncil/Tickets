// Runs purgeOrders (清除所有訂單) against the Firestore emulator:
// `yarn test:emulator` (needs Java).
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { Timestamp } from 'firebase-admin/firestore'

import { HOUR, PROJECT_ID, db, fft, functions, iso, soldOf, isEmulator } from './setup.js'
import { getBuyerKey } from '../../lib/orderValidation.js'
import { getTaiwanYear } from '../../lib/time.js'
import { PURGE_CONFIRM_PHRASE } from '../../lib/orderPurge.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')

const callPurge = fft.wrap(functions.purgeOrders)
const callCreate = fft.wrap(functions.createOrder)
const callRelease = fft.wrap(functions.releaseOrderStock)

const TICKET_TYPES = [
  { id: 'open', name: '一階票', price: 900, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 300, purchaseLimitPerPerson: 4 },
  { id: 'free', name: '自由票', price: 500, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), unlimitedStock: true, unlimited: true }
]

const SUPER = { uid: 'super-uid', email: 'super@example.com' }
const ADMIN = { uid: 'admin-uid', email: 'admin@example.com' }
const as = ({ uid, email }) => ({ auth: { uid, token: { email, email_verified: true } } })
const buyerOf = (email) => as({ uid: `uid-${email}`, email })
const THIS_YEAR = getTaiwanYear()

let requestCount = 0
const nextPurgeId = () => `purge-request-${String(++requestCount).padStart(8, '0')}`
const purge = (extra = {}) => ({ purgeId: nextPurgeId(), confirm: PURGE_CONFIRM_PHRASE, ...extra })
const resume = (purgeId) => ({ purgeId, confirm: PURGE_CONFIRM_PHRASE })

const buy = (email, items, school = '北一女中') => callCreate({
  orderPayload: { customerName: '測試', customerPhone: '0900000000', school, class: '101', number: '1', items }
}, buyerOf(email))

const exists = async (path) => (await db.doc(path).get()).exists
const summaryOf = async (year) => (await db.doc(`salesArchives/${year}`).get()).data()
const archivedOf = async (year, id) => (await db.doc(`salesArchives/${year}/archivedOrders/${id}`).get()).data()

// a run stored the way purgeOrders stores it, for tests that pick one up halfway
async function saveRun(purgeId, orderIds, run) {
  const batch = db.batch()
  batch.set(db.doc(`orderPurges/${purgeId}`), {
    total: orderIds.length, archiveCursor: 0, archivedCount: 0, deleteCursor: 0, deletedCount: 0,
    missingCount: 0, years: [], fallbackYear: THIS_YEAR, error: null, ...run
  })
  batch.set(db.doc(`orderPurges/${purgeId}/orderIds/000`), { ids: orderIds })
  await batch.commit()
}

after(() => fft.cleanup())

beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  assert.ok(response.ok)
  const batch = db.batch()
  batch.set(db.doc('settings/ticketTypes'), { types: TICKET_TYPES })
  batch.set(db.doc('settings/shop'), { openAt: new Date(Date.now() - HOUR) })
  batch.set(db.doc(`users/${SUPER.uid}`), { email: SUPER.email, role: 'super_admin', name: '總召' })
  batch.set(db.doc(`users/${ADMIN.uid}`), { email: ADMIN.email, role: 'admin' })
  await batch.commit()
})

describe('purgeOrders', () => {
  test('archives the listed orders, then deletes them and gives back their stock and allowance', async () => {
    const a = await buy('a@example.com', [{ id: 'open', quantity: 3 }])
    const b = await buy('b@example.com', [{ id: 'open', quantity: 1 }, { id: 'free', quantity: 2 }], '建中老師')
    await db.doc(`orders/${a.id}`).update({ paid: true })
    // placed after the backup was downloaded: not on the list, so it stays
    const later = await buy('c@example.com', [{ id: 'open', quantity: 2 }])
    const deletedA = await db.doc(`orders/${a.id}`).get()

    const result = await callPurge(purge({ orderIds: [a.id, b.id] }), as(SUPER))

    assert.equal(result.stage, 'done')
    assert.equal(result.deletedCount, 2)
    assert.equal(result.missingCount, 0)
    assert.deepEqual(result.years, [THIS_YEAR])
    assert.equal(await exists(`orders/${a.id}`), false)
    assert.equal(await exists(`orders/${b.id}`), false)
    assert.equal(await exists(`orders/${later.id}`), true)

    assert.equal(await soldOf('open'), 2)
    assert.equal(await soldOf('free'), 0)
    // the buyer can buy the full allowance again
    await assert.doesNotReject(buy('a@example.com', [{ id: 'open', quantity: 4 }]))
    // the deletion trigger finds the release marker and gives nothing back twice
    await callRelease(deletedA, { params: { orderId: a.id }, eventId: 'purged-a' })
    assert.equal(await soldOf('open'), 6)

    const archived = await archivedOf(THIS_YEAR, a.id)
    assert.equal(archived.customerEmail, 'a@example.com')
    assert.equal(archived.paid, true)
    assert.equal(archived.archive.purgeId, result.purgeId)
    assert.ok(archived.archive.purgedAt)

    const summary = await summaryOf(THIS_YEAR)
    assert.equal(summary.year, THIS_YEAR)
    assert.equal(summary.orderCount, 2)
    assert.equal(summary.ticketCount, 6)
    assert.equal(summary.revenue, 2700 + 1900)
    assert.equal(summary.paidRevenue, 2700)
    assert.equal(summary.paidOrderCount, 1)
    assert.deepEqual(summary.bySchool['北一女中'], { orderCount: 1, ticketCount: 3, revenue: 2700 })
    assert.deepEqual(summary.bySchool['建中老師'], { orderCount: 1, ticketCount: 3, revenue: 1900 })
    assert.deepEqual(summary.byTicketType.open, { name: '一階票', ticketCount: 4, revenue: 3600 })
    assert.deepEqual(summary.purgeIds, [result.purgeId])
    assert.equal(Object.values(summary.byDay).reduce((sum, day) => sum + day.orderCount, 0), 2)
    assert.equal(summary.source, 'purge')
    assert.match(summary.openDate, /^\d{4}-\d{2}-\d{2}$/)
    // the analytics page reads sale rows, without the buyers' details
    const rows = (await db.doc(`salesArchives/${THIS_YEAR}/rows/000`).get()).data().rows
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map((row) => row.s).sort(), ['北一女中', '建中老師'])
    assert.doesNotMatch(JSON.stringify(rows), /測試|0900000000|@example\.com/)

    const log = (await db.doc(`systemLogs/purge_${result.purgeId}`).get()).data()
    assert.equal(log.type, 'orders.purge')
    assert.equal(log.actorUid, SUPER.uid)
    assert.equal(log.actorName, '總召')
    assert.equal(log.purgedCount, 2)
    assert.ok(log.occurredAt)

    // the admin page follows the run live, so its order ids are kept apart
    const run = (await db.doc(`orderPurges/${result.purgeId}`).get()).data()
    assert.equal(run.stage, 'done')
    assert.equal(run.orderIds, undefined)
    assert.equal(run.leaseOwner, undefined)
    const ids = await db.collection(`orderPurges/${result.purgeId}/orderIds`).get()
    assert.deepEqual(ids.docs.flatMap((doc) => doc.data().ids), [a.id, b.id])
  })

  test('only super admins can purge, and only with the confirmation phrase', async () => {
    const a = await buy('a@example.com', [{ id: 'open', quantity: 1 }])
    const orderIds = [a.id]

    await assert.rejects(callPurge(purge({ orderIds }), {}), { code: 'unauthenticated' })
    await assert.rejects(callPurge(purge({ orderIds }), as(ADMIN)), { code: 'permission-denied' })
    for (const bad of [
      purge({ orderIds, confirm: 'delete all orders' }),
      purge({ orderIds, purgeId: 'short' }),
      purge({ orderIds: [] }),
      purge({ orderIds: ['orders/other'] }),
      purge({ orderIds: 'everything' })
    ]) {
      await assert.rejects(callPurge(bad, as(SUPER)), { code: 'invalid-argument' })
    }
    // resuming a run that never started
    await assert.rejects(callPurge(resume(nextPurgeId()), as(SUPER)), { code: 'not-found' })

    assert.equal(await exists(`orders/${a.id}`), true)
    assert.equal(await soldOf('open'), 1)
  })

  test('calling a finished purge again returns its result and releases nothing twice', async () => {
    const a = await buy('a@example.com', [{ id: 'open', quantity: 2 }])
    await buy('b@example.com', [{ id: 'open', quantity: 1 }])
    const input = purge({ orderIds: [a.id] })

    const first = await callPurge(input, as(SUPER))
    const again = await callPurge(input, as(SUPER))

    assert.deepEqual(again, { ...first, running: false })
    assert.equal(await soldOf('open'), 1)
  })

  test('an archive failure deletes nothing, and the purge resumes once it is fixed', async () => {
    const a = await buy('a@example.com', [{ id: 'open', quantity: 2 }])
    // fits under Firestore's 1 MiB document limit, but its archived copy
    // (a longer path and the archive field) does not
    const big = 'CKS20261105BIGBIG'
    await db.doc(`orders/${big}`).set({ notes: 'x'.repeat(1_048_400), finalTotal: 0, createdAt: Timestamp.now() })
    const input = purge({ orderIds: [a.id, big] })

    await assert.rejects(callPurge(input, as(SUPER)), (error) => {
      assert.equal(error.code, 'aborted')
      assert.equal(error.details.stage, 'archive')
      assert.equal(error.details.deletedCount, 0)
      return true
    })
    assert.equal(await exists(`orders/${a.id}`), true)
    assert.equal(await exists(`orders/${big}`), true)
    assert.equal(await soldOf('open'), 2)
    assert.equal(await exists(`systemLogs/purge_${input.purgeId}`), false)
    const failed = (await db.doc(`orderPurges/${input.purgeId}`).get()).data()
    assert.equal(failed.stage, 'archive')
    assert.equal(failed.error.stage, 'archive')

    await db.doc(`orders/${big}`).update({ notes: 'small' })
    const resumed = await callPurge(resume(input.purgeId), as(SUPER))

    assert.equal(resumed.stage, 'done')
    assert.equal(resumed.deletedCount, 2)
    assert.equal(resumed.error, null)
    assert.equal(await exists(`orders/${a.id}`), false)
    assert.equal(await exists(`orders/${big}`), false)
    assert.equal(await soldOf('open'), 0)
    assert.equal((await summaryOf(THIS_YEAR)).orderCount, 2)
  })

  test('an order deleted by someone else after it was archived is not counted as purged', async () => {
    const a = await buy('a@example.com', [{ id: 'open', quantity: 1 }])
    const b = await buy('b@example.com', [{ id: 'open', quantity: 1 }])
    const purgeId = nextPurgeId()
    const archivedAt = Timestamp.now()
    // the run as archiveOrders leaves it, just before deleting
    for (const id of [a.id, b.id]) {
      const order = (await db.doc(`orders/${id}`).get()).data()
      await db.doc(`salesArchives/${THIS_YEAR}/archivedOrders/${id}`).set({ ...order, archive: { purgeId, archivedAt } })
    }
    await saveRun(purgeId, [a.id, b.id], {
      stage: 'delete', archiveCursor: 2, archivedCount: 2, years: [THIS_YEAR],
      requestedByUid: SUPER.uid, requestedByName: '總召', createdAt: archivedAt
    })
    // an admin deletes b on its own meanwhile
    const deletedB = await db.doc(`orders/${b.id}`).get()
    await db.doc(`orders/${b.id}`).delete()
    await callRelease(deletedB, { params: { orderId: b.id }, eventId: 'admin-deleted-b' })

    const result = await callPurge(resume(purgeId), as(SUPER))

    assert.equal(result.deletedCount, 1)
    assert.equal(result.missingCount, 1)
    assert.equal(await archivedOf(THIS_YEAR, b.id), undefined)
    assert.equal((await archivedOf(THIS_YEAR, a.id)).archive.archivedAt.toMillis(), archivedAt.toMillis())
    assert.equal((await summaryOf(THIS_YEAR)).orderCount, 1)
    assert.equal(await soldOf('open'), 0)
  })

  test('while another call holds the run, a call only reports its progress', async () => {
    const a = await buy('a@example.com', [{ id: 'open', quantity: 1 }])
    const purgeId = nextPurgeId()
    await saveRun(purgeId, [a.id], {
      stage: 'archive', leaseOwner: 'another-call', leaseUntil: Timestamp.fromMillis(Date.now() + 60_000)
    })

    const result = await callPurge(resume(purgeId), as(SUPER))

    assert.equal(result.running, true)
    assert.equal(result.stage, 'archive')
    assert.equal(await exists(`orders/${a.id}`), true)
  })

  test('a new purge is refused while an earlier one is unfinished', async () => {
    const a = await buy('a@example.com', [{ id: 'open', quantity: 1 }])
    await saveRun(nextPurgeId(), [a.id], { stage: 'delete' })

    await assert.rejects(callPurge(purge({ orderIds: [a.id] }), as(SUPER)), { code: 'failed-precondition' })
    assert.equal(await exists(`orders/${a.id}`), true)
  })

  test('a second purge in the same year adds to its summary', async () => {
    const a = await buy('a@example.com', [{ id: 'open', quantity: 1 }])
    await callPurge(purge({ orderIds: [a.id] }), as(SUPER))
    const b = await buy('b@example.com', [{ id: 'open', quantity: 2 }])
    const second = await callPurge(purge({ orderIds: [b.id] }), as(SUPER))

    const summary = await summaryOf(THIS_YEAR)
    assert.equal(summary.orderCount, 2)
    assert.equal(summary.ticketCount, 3)
    assert.equal(summary.purgeIds.length, 2)
    assert.ok(summary.purgeIds.includes(second.purgeId))
  })

  test('orders are archived under the Taiwan year they were placed in', async () => {
    const batch = db.batch()
    // 2026-01-01 00:30 and 2025-12-31 23:30 in Taiwan
    batch.set(db.doc('orders/CKS20260101AAAAAA'), { school: '建國中學', finalTotal: 700, items: [{ id: 'open', name: '一階票', price: 700, quantity: 1 }], createdAt: Timestamp.fromDate(new Date('2025-12-31T16:30:00Z')) })
    batch.set(db.doc('orders/CKS20251231BBBBBB'), { school: '建國中學', finalTotal: 700, items: [{ id: 'open', name: '一階票', price: 700, quantity: 1 }], createdAt: Timestamp.fromDate(new Date('2025-12-31T15:30:00Z')) })
    await batch.commit()

    const result = await callPurge(purge({ orderIds: ['CKS20260101AAAAAA', 'CKS20251231BBBBBB'] }), as(SUPER))

    assert.deepEqual(result.years, [2025, 2026])
    assert.ok(await archivedOf(2026, 'CKS20260101AAAAAA'))
    assert.ok(await archivedOf(2025, 'CKS20251231BBBBBB'))
    assert.deepEqual(Object.keys((await summaryOf(2026)).byDay), ['2026-01-01'])
    assert.deepEqual(Object.keys((await summaryOf(2025)).byDay), ['2025-12-31'])
  })

  test('hundreds of orders are purged over several transactions', async () => {
    const count = 230
    const ids = []
    let batch = db.batch()
    for (let i = 0; i < count; i++) {
      const id = `CKS20261105${String(i).padStart(4, '0')}`
      ids.push(id)
      batch.set(db.doc(`orders/${id}`), {
        customerEmail: `bulk${i}@example.com`, school: '建國中學', finalTotal: 900, createdAt: Timestamp.now(),
        items: [{ id: 'open', name: '一階票', price: 900, quantity: 1 }],
        stockCounted: true, stockShards: { open: { [i % 20]: 1 } }
      })
      batch.set(db.doc(`buyerPurchases/${getBuyerKey(`bulk${i}@example.com`)}`), { quantities: { open: 1 } })
      if (i % 200 === 199) {
        await batch.commit()
        batch = db.batch()
      }
    }
    for (let k = 0; k < 20; k++) {
      batch.set(db.doc(`ticketSales/open/shards/${k}`), { sold: ids.filter((_, i) => i % 20 === k).length })
    }
    await batch.commit()
    assert.equal(await soldOf('open'), count)

    const result = await callPurge(purge({ orderIds: ids }), as(SUPER))

    assert.equal(result.deletedCount, count)
    assert.equal((await db.collection('orders').count().get()).data().count, 0)
    assert.equal(await soldOf('open'), 0)
    assert.equal((await db.doc(`buyerPurchases/${getBuyerKey('bulk7@example.com')}`).get()).data().quantities.open, 0)
    assert.equal((await summaryOf(THIS_YEAR)).revenue, count * 900)
  })
})
