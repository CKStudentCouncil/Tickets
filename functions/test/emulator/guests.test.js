// Runs sendGuestInvitation (公關票) against the Firestore emulator:
// `yarn test:emulator` (needs Java).
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { HOUR, PROJECT_ID, db, fft, functions, isEmulator } from './setup.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')

const callSend = fft.wrap(functions.sendGuestInvitation)
const callPrepare = fft.wrap(functions.prepareOrderNotification)

const SUPER = { uid: 'super-uid', email: 'super@example.com' }
const ADMIN = { uid: 'admin-uid', email: 'admin@example.com' }
const GUEST_UID = 'guestUid1'
const as = ({ uid, email }) => ({ auth: { uid, token: { email, email_verified: true } } })

let requestCount = 0
const send = (extra = {}) => ({
  requestId: `guest-request-${String(++requestCount).padStart(8, '0')}`,
  name: '王大明',
  email: 'Alumni@Example.com',
  relation: 'alumni',
  relationDetail: '78 屆',
  quantity: 1,
  ...extra
})
const sendTo = (registrationId, quantity = 1) => ({
  requestId: `guest-request-${String(++requestCount).padStart(8, '0')}`,
  registrationId,
  quantity
})

const orderOf = async (id) => (await db.doc(`orders/${id}`).get()).data()

after(() => fft.cleanup())

beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  assert.ok(response.ok)
  const batch = db.batch()
  batch.set(db.doc(`users/${SUPER.uid}`), { email: SUPER.email, role: 'super_admin' })
  batch.set(db.doc(`users/${ADMIN.uid}`), { email: ADMIN.email, role: 'admin' })
  batch.set(db.doc('settings/shop'), { openAt: new Date(Date.now() - HOUR) })
  batch.set(db.doc(`guestRegistrations/${GUEST_UID}`), {
    name: '陳小華',
    email: 'friend@example.com',
    relation: 'friend',
    relationDetail: '班聯會 王小明',
    createdAt: new Date(),
    updatedAt: new Date()
  })
  await batch.commit()
})

describe('sendGuestInvitation', () => {
  test('creates an NT$0 公關票 order for the guest, touching no stock', async () => {
    const { id } = await callSend(send({ quantity: 2 }), as(SUPER))

    assert.match(id, /^PR\d{8}/)
    const order = await orderOf(id)
    assert.equal(order.complimentary, true)
    assert.equal(order.customerName, '王大明')
    assert.equal(order.customerEmail, 'alumni@example.com')
    assert.deepEqual(order.guest, { relation: 'alumni', relationDetail: '78 屆' })
    assert.equal(order.items[0].quantity, 2)
    assert.equal(order.finalTotal, 0)
    assert.equal(order.paid, true)
    assert.equal(order.delivered, false)
    assert.equal(order.emailStatus, 'pending')
    assert.equal(order.userId, null)
    assert.equal(order.invitedByUid, SUPER.uid)
    assert.ok(order.ticketCode)
    assert.equal(order.stockCounted, undefined)
    assert.equal((await db.collection('ticketSales').get()).size, 0)
    assert.equal((await db.collection('buyerPurchases').get()).size, 0)
  })

  test('a retried request returns the same ticket instead of a second one', async () => {
    const request = send()
    const first = await callSend(request, as(SUPER))
    const again = await callSend(request, as(SUPER))

    assert.equal(again.id, first.id)
    assert.equal((await db.collection('orders').get()).size, 1)
  })

  test('a registration is sent with its own details, once, and its guest owns the order', async () => {
    // what the client sends besides the id is ignored
    const { id } = await callSend({ ...sendTo(GUEST_UID, 2), name: '冒名', email: 'other@example.com' }, as(SUPER))

    const order = await orderOf(id)
    assert.equal(order.customerName, '陳小華')
    assert.equal(order.customerEmail, 'friend@example.com')
    assert.deepEqual(order.guest, { relation: 'friend', relationDetail: '班聯會 王小明' })
    assert.equal(order.userId, GUEST_UID)
    assert.equal(order.items[0].quantity, 2)

    const registration = (await db.doc(`guestRegistrations/${GUEST_UID}`).get()).data()
    assert.equal(registration.orderId, id)
    assert.equal(registration.invitedByUid, SUPER.uid)
    assert.ok(registration.invitedAt)

    await assert.rejects(callSend(sendTo(GUEST_UID), as(SUPER)), { code: 'already-exists' })
    assert.equal((await db.collection('orders').get()).size, 1)
  })

  test('a registration whose ticket was deleted can be sent another', async () => {
    const first = await callSend(sendTo(GUEST_UID), as(SUPER))
    await db.doc(`orders/${first.id}`).delete()

    const second = await callSend(sendTo(GUEST_UID), as(SUPER))
    assert.notEqual(second.id, first.id)
    assert.equal((await db.doc(`guestRegistrations/${GUEST_UID}`).get()).data().orderId, second.id)
  })

  test('simultaneous sends to one registration create one ticket', async () => {
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => callSend(sendTo(GUEST_UID), as(SUPER))))
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal((await db.collection('orders').get()).size, 1)
  })

  test('a missing registration is reported', async () => {
    await assert.rejects(callSend(sendTo('nobody'), as(SUPER)), { code: 'not-found' })
  })

  test('only super admins may send', async () => {
    await assert.rejects(callSend(send(), {}), { code: 'unauthenticated' })
    await assert.rejects(callSend(send(), as(ADMIN)), { code: 'permission-denied' })
    await assert.rejects(callSend(send(), as({ uid: 'buyer', email: 'buyer@example.com' })), { code: 'permission-denied' })
    assert.equal((await db.collection('orders').get()).size, 0)
  })
})

describe('notifications and 公關票', () => {
  const recipientsOf = async (jobId) => {
    const batches = await db.collection(`notificationJobs/${jobId}/batches`).get()
    return batches.docs.flatMap((d) => d.data().recipients).sort()
  }

  test('guests get pickup notices but not payment notices', async () => {
    await callSend(send(), as(SUPER))
    await db.doc('orders/O20261026AAAAAA').set({ customerEmail: 'buyer@example.com', school: '其他學校或社會人士' })

    const payment = await callPrepare({ type: 'payment', paymentTime: '11/20', location: '穿堂' }, as(ADMIN))
    assert.deepEqual(await recipientsOf(payment.jobId), ['buyer@example.com'])

    const both = await callPrepare({ type: 'both', paymentTime: '11/20', pickupTime: '11/21', location: '穿堂' }, as(ADMIN))
    assert.deepEqual(await recipientsOf(both.jobId), ['buyer@example.com'])

    const pickup = await callPrepare({ type: 'pickup', pickupTime: '11/21', location: '穿堂' }, as(ADMIN))
    assert.deepEqual(await recipientsOf(pickup.jobId), ['alumni@example.com', 'buyer@example.com'])
  })
})
