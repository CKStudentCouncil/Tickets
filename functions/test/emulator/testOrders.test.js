// Runs deleteTestOrders (刪除所有測試票訂單) against the Firestore emulator:
// `yarn test:emulator` (needs Java).
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { HOUR, PROJECT_ID, db, fft, functions, iso, soldOf, isEmulator } from './setup.js'
import { getBuyerKey } from '../../lib/orderValidation.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')

const callDelete = fft.wrap(functions.deleteTestOrders)
// createOrder is a 2nd gen callable: one request carries the data and the auth
const wrappedCreate = fft.wrap(functions.createOrder)
const callCreate = (data, context = {}) => wrappedCreate({ data, ...context })
const callRelease = fft.wrap(functions.releaseOrderStock)

const TICKET_TYPES = [
  { id: 'open', name: '一階票', price: 900, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 300, purchaseLimitPerPerson: 4 },
  { id: 'trial', name: '測試票', price: 1, eligibleBuyerIdentity: 'admins_only', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 50, purchaseLimitPerPerson: 4 }
]

const SUPER = { uid: 'super-uid', email: 'super@example.com' }
const ADMIN = { uid: 'admin-uid', email: 'admin@example.com' }
const STAFF = 'staff@example.com'
const as = ({ uid, email }) => ({ auth: { uid, token: { email, email_verified: true } } })
const buyerOf = (email) => as({ uid: `uid-${email}`, email })

const buy = (email, items) => callCreate({
  orderPayload: { customerName: '測試', customerPhone: '0900000000', school: '北一女中', class: '101', number: '1', items }
}, buyerOf(email))

const exists = async (path) => (await db.doc(path).get()).exists
const allowanceOf = async (email, id) => (await db.doc(`buyerPurchases/${getBuyerKey(email)}`).get()).data()?.quantities?.[id] || 0

after(() => fft.cleanup())

beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  assert.ok(response.ok)
  const batch = db.batch()
  batch.set(db.doc('settings/ticketTypes'), { types: TICKET_TYPES })
  batch.set(db.doc('settings/shop'), { openAt: new Date(Date.now() - HOUR) })
  batch.set(db.doc(`users/${SUPER.uid}`), { email: SUPER.email, role: 'super_admin', name: '總召' })
  batch.set(db.doc(`users/${ADMIN.uid}`), { email: ADMIN.email, role: 'admin' })
  // only staff may buy a 測試票
  batch.set(db.doc(`users/uid-${STAFF}`), { email: STAFF, role: 'manager' })
  await batch.commit()
})

describe('deleteTestOrders', () => {
  test('deletes every order made only of 測試票, paid, collected and cancelled ones included', async () => {
    const collected = await buy(STAFF, [{ id: 'trial', quantity: 2 }])
    const unpaid = await buy(STAFF, [{ id: 'trial', quantity: 1 }])
    const mixed = await buy(STAFF, [{ id: 'trial', quantity: 1 }, { id: 'open', quantity: 1 }])
    const normal = await buy('a@example.com', [{ id: 'open', quantity: 3 }])
    await db.doc(`orders/${collected.id}`).update({ paid: true, delivered: true })
    await db.doc(`orders/${collected.id}/history/payment`).set({ action: 'payment' })
    await db.doc('cancelledOrders/CKSCANCELLED01').set({ items: [{ id: 'trial', ticketTypeId: 'trial', quantity: 1 }], refundAmount: 1 })
    await db.doc('cancelledOrders/CKSCANCELLED02').set({ items: [{ id: 'open', ticketTypeId: 'open', quantity: 1 }], refundAmount: 900 })
    assert.equal(await soldOf('trial'), 4)
    const deletedCollected = await db.doc(`orders/${collected.id}`).get()

    const preview = await callDelete({ dryRun: true }, as(SUPER))
    assert.deepEqual(preview.ticketTypes, [{ id: 'trial', name: '測試票' }])
    assert.equal(preview.orderCount, 2)
    assert.equal(preview.ticketCount, 3)
    assert.equal(preview.paidCount, 1)
    assert.equal(preview.deliveredCount, 1)
    assert.equal(preview.cancelledCount, 1)
    assert.equal(preview.mixedCount, 1)
    // a preview deletes nothing
    assert.equal(await exists(`orders/${collected.id}`), true)
    assert.equal(await exists('cancelledOrders/CKSCANCELLED01'), true)

    const result = await callDelete({ confirm: true }, as(SUPER))
    assert.equal(result.deletedCount, 2)
    assert.equal(result.cancelledDeletedCount, 1)
    assert.deepEqual(result.deletedOrderIds.sort(), [collected.id, unpaid.id].sort())

    assert.equal(await exists(`orders/${collected.id}`), false)
    assert.equal(await exists(`orders/${unpaid.id}`), false)
    assert.equal(await exists(`orders/${collected.id}/history/payment`), false)
    assert.equal(await exists('cancelledOrders/CKSCANCELLED01'), false)
    // orders that also hold other tickets, and every other order, stay
    assert.equal(await exists(`orders/${mixed.id}`), true)
    assert.equal(await exists(`orders/${normal.id}`), true)
    assert.equal(await exists('cancelledOrders/CKSCANCELLED02'), true)

    // their stock and allowance are back
    assert.equal(await soldOf('trial'), 1)
    assert.equal(await soldOf('open'), 4)
    assert.equal(await allowanceOf(STAFF, 'trial'), 1)
    // the deletion trigger finds the release marker and gives nothing back twice
    await callRelease(deletedCollected, { params: { orderId: collected.id }, eventId: 'test-collected' })
    assert.equal(await soldOf('trial'), 1)

    const logs = await db.collection('systemLogs').where('type', '==', 'orders.deleteTest').get()
    assert.equal(logs.size, 1)
    const log = logs.docs[0].data()
    assert.equal(log.actorUid, SUPER.uid)
    assert.equal(log.actorName, '總召')
    assert.equal(log.deletedCount, 2)
    assert.equal(log.cancelledDeletedCount, 1)
    assert.deepEqual(log.ticketTypeIds, ['trial'])

    // nothing is left to delete
    const again = await callDelete({ confirm: true }, as(SUPER))
    assert.equal(again.deletedCount, 0)
    assert.equal(again.mixedCount, 1)
  })

  test('only super admins can delete them, and only once confirmed', async () => {
    const order = await buy(STAFF, [{ id: 'trial', quantity: 1 }])
    await assert.rejects(callDelete({ confirm: true }, as(ADMIN)), { code: 'permission-denied' })
    await assert.rejects(callDelete({ confirm: true }, buyerOf(STAFF)), { code: 'permission-denied' })
    await assert.rejects(callDelete({ confirm: true }, {}), { code: 'unauthenticated' })
    await assert.rejects(callDelete({}, as(SUPER)), { code: 'invalid-argument' })
    await assert.rejects(callDelete({ confirm: 'yes' }, as(SUPER)), { code: 'invalid-argument' })
    assert.equal(await exists(`orders/${order.id}`), true)
  })

  test('with no 測試票 type, nothing counts as a test order', async () => {
    const order = await buy(STAFF, [{ id: 'trial', quantity: 1 }])
    // the type was made an ordinary ticket afterwards
    await db.doc('settings/ticketTypes').set({ types: TICKET_TYPES.map((type) => ({ ...type, eligibleBuyerIdentity: 'all_users' })) })

    const result = await callDelete({ confirm: true }, as(SUPER))
    assert.deepEqual(result.ticketTypes, [])
    assert.equal(result.deletedCount, 0)
    assert.equal(await exists(`orders/${order.id}`), true)
  })
})
