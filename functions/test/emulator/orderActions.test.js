import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { PROJECT_ID, db, fft, isEmulator } from './setup.js'
import { updateOrderDelivery, updateOrderPayment } from '../../lib/orderActions.js'
import { findStudentOrders } from '../../lib/studentCards.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')

const deliver = fft.wrap(updateOrderDelivery)
const pay = fft.wrap(updateOrderPayment)
const findByCard = fft.wrap(findStudentOrders)
const ORDER_ID = 'CKS20261105ABC234'
const TICKET_CODE = 'valid-code-12'
const ref = () => db.doc(`orders/${ORDER_ID}`)
const as = (uid) => ({ auth: { uid, token: { name: 'Token Name', email: `${uid}@example.com`, email_verified: true } } })
const collect = (extra = {}) => ({ orderId: ORDER_ID, delivered: true, expectedDelivered: false, ticketCode: TICKET_CODE, ...extra })

after(() => fft.cleanup())
beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  assert.ok(response.ok)
  const batch = db.batch()
  batch.set(db.doc('users/manager1'), { role: 'manager', name: 'Door One' })
  batch.set(db.doc('users/manager2'), { role: 'manager', name: 'Door Two' })
  batch.set(db.doc('users/admin'), { role: 'admin', name: 'Administrator' })
  batch.set(ref(), {
    userId: 'buyer', delivered: false, paid: true, ticketCode: TICKET_CODE, finalTotal: 700,
    customerEmail: 'ck1130524@gl.ck.tp.edu.tw', customerName: '王小明', items: [{ name: '一階票', quantity: 1 }]
  })
  await batch.commit()
})

describe('atomic delivery', () => {
  test('concurrent scans collect once and preserve the first actor and one audit record', async () => {
    const results = await Promise.allSettled([deliver(collect(), as('manager1')), deliver(collect(), as('manager2'))])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const conflict = results.find((result) => result.status === 'rejected').reason
    assert.equal(conflict.code, 'already-exists')

    const saved = (await ref().get()).data()
    const history = await ref().collection('history').get()
    assert.equal(saved.delivered, true)
    assert.equal(history.size, 1)
    assert.equal(history.docs[0].data().actorUid, saved.deliveryUpdatedByUid)
    assert.equal(conflict.details.deliveryUpdatedByUid, saved.deliveryUpdatedByUid)
    assert.equal(conflict.details.deliveryUpdatedAt, saved.deliveryUpdatedAt.toDate().toISOString())
    assert.equal(history.docs[0].data().codeVerification, 'verified')

    await assert.rejects(deliver(collect(), as('admin')), { code: 'already-exists' })
    assert.deepEqual((await ref().get()).data(), saved)
    assert.equal((await ref().collection('history').get()).size, 1)
  })

  test('manager needs a valid scanned code and cannot reset or override identity', async () => {
    for (const ticketCode of ['', 'wrong-code']) {
      await assert.rejects(deliver(collect({ ticketCode, overrideReason: 'Claimed manual check' }), as('manager1')), { code: 'permission-denied' })
    }
    assert.equal((await ref().collection('history').get()).size, 0)
    await deliver(collect(), as('manager1'))
    await assert.rejects(deliver({ orderId: ORDER_ID, delivered: false, expectedDelivered: true, overrideReason: 'Reset' }, as('manager1')), { code: 'permission-denied' })
    assert.equal((await ref().get()).data().delivered, true)
  })

  test('admin override and reset require recorded reasons; forged staff metadata is ignored', async () => {
    await assert.rejects(deliver(collect({ ticketCode: '' }), as('admin')), { code: 'failed-precondition' })
    await assert.rejects(deliver(collect({ ticketCode: '', overrideReason: 'x'.repeat(501) }), as('admin')), { code: 'failed-precondition' })
    const result = await deliver(collect({
      ticketCode: 'wrong-code', overrideReason: '  Checked original ID  ',
      deliveryUpdatedByUid: 'forged', deliveryUpdatedByName: 'Forged Name', deliveryUpdatedAt: '2000-01-01'
    }), as('admin'))
    assert.equal(result.deliveryUpdatedByUid, 'admin')
    assert.equal(result.deliveryUpdatedByName, 'Administrator')
    assert.match(result.deliveryUpdatedAt, /^\d{4}-\d{2}-\d{2}T/)
    const event = (await ref().collection('history').get()).docs[0].data()
    assert.equal(event.codeVerification, 'admin_override')
    assert.equal(event.overrideReason, 'Checked original ID')
    assert.equal(event.ticketCode, undefined)

    await assert.rejects(deliver({ orderId: ORDER_ID, delivered: false, expectedDelivered: true }, as('admin')), { code: 'failed-precondition' })
    await deliver({ orderId: ORDER_ID, delivered: false, expectedDelivered: true, overrideReason: 'Accidental collection corrected' }, as('admin'))
    assert.equal((await ref().get()).data().delivered, false)
    assert.equal((await ref().collection('history').get()).size, 2)
  })
})

describe('掃描學生證', () => {
  test('managers find the orders of ck{學號}@gl.ck.tp.edu.tw, nothing more', async () => {
    await db.doc('orders/CKS20261105ABC235').set({ customerEmail: 'ck1130525@gl.ck.tp.edu.tw', delivered: false })
    const found = await findByCard({ studentId: '1130524' }, as('manager1'))
    assert.equal(found.email, 'ck1130524@gl.ck.tp.edu.tw')
    assert.deepEqual(found.orders.map((order) => order.id), [ORDER_ID])
    assert.equal(found.orders[0].customerName, '王小明')
    assert.equal(found.orders[0].ticketCode, undefined)
    assert.deepEqual((await findByCard({ studentId: '7654321' }, as('manager1'))).orders, [])
    await assert.rejects(findByCard({ studentId: '1130524' }, as('buyer')), { code: 'permission-denied' })
    await assert.rejects(findByCard({ studentId: '1130524' }, {}), { code: 'unauthenticated' })
    await assert.rejects(findByCard({ studentId: 'ck1130524' }, as('manager1')), { code: 'invalid-argument' })
  })

  test('a ticket type for 建中 students needs the student card as well as the QR code', async () => {
    await db.doc('settings/ticketTypes').set({ types: [{ id: 'early', name: '早鳥票', eligibleBuyerIdentity: 'campus_students' }] })
    await ref().update({ items: [{ id: 'early', ticketTypeId: 'early', name: '早鳥票', quantity: 1 }] })
    const card = { studentId: '1130524', studentCardChecked: true }
    // the QR code alone, or with a card that is not this buyer's or not checked
    for (const extra of [{}, { ...card, studentCardChecked: false }, { ...card, studentId: '1130525' }, { overrideReason: 'manager cannot' }]) {
      await assert.rejects(deliver(collect(extra), as('manager1')), { code: 'failed-precondition' }, JSON.stringify(extra))
    }
    // the card alone: a manager still needs the QR code
    await assert.rejects(deliver(collect({ ticketCode: '', ...card }), as('manager1')), { code: 'permission-denied' })
    await assert.rejects(deliver(collect({ ticketCode: '', ...card, skipQr: true }), as('manager1')), { code: 'permission-denied' })
    // other checks: a known method, and a note for 其他
    for (const idCheck of [{ method: 'passport' }, 'kuclass', { method: 'other' }, { method: 'other', note: '   ' }, { method: 'kuclass', note: 'x'.repeat(201) }]) {
      await assert.rejects(deliver(collect({ idCheck }), as('manager1')), (error) => ['invalid-argument', 'failed-precondition'].includes(error.code), JSON.stringify(idCheck))
    }
    assert.equal((await ref().collection('history').get()).size, 0)

    await deliver(collect(card), as('manager1'))
    const event = (await ref().collection('history').get()).docs[0].data()
    assert.equal(event.codeVerification, 'verified')
    assert.equal(event.idVerification, 'student_card')
    assert.equal(event.studentId, '1130524')
  })

  test('staff record another check when the card cannot be scanned', async () => {
    await db.doc('settings/ticketTypes').set({ types: [{ id: 'early', name: '早鳥票', eligibleBuyerIdentity: 'campus_students' }] })
    await ref().update({ items: [{ id: 'early', ticketTypeId: 'early', name: '早鳥票', quantity: 1 }] })
    await deliver(collect({ idCheck: { method: 'other', note: '  學生證補辦中，核對身分證  ' } }), as('manager1'))
    const event = (await ref().collection('history').get()).docs[0].data()
    assert.equal(event.codeVerification, 'verified')
    assert.equal(event.idVerification, 'other')
    assert.equal(event.idNote, '學生證補辦中，核對身分證')
  })

  test('admins: the student card stands in for a forgotten QR code; an override covers both', async () => {
    await db.doc('settings/ticketTypes').set({ types: [{ id: 'early', name: '早鳥票', eligibleBuyerIdentity: 'campus_students' }] })
    await ref().update({ items: [{ id: 'early', ticketTypeId: 'early', name: '早鳥票', quantity: 1 }] })
    const card = { ticketCode: '', studentId: '1130524', studentCardChecked: true }
    // without saying the card stands in, an admin is asked for a reason
    await assert.rejects(deliver(collect(card), as('admin')), { code: 'failed-precondition' })
    await assert.rejects(deliver(collect({ ...card, studentId: '1130525', skipQr: true }), as('admin')), { code: 'failed-precondition' })
    await deliver(collect({ ...card, skipQr: true }), as('admin'))
    let event = (await ref().collection('history').get()).docs[0].data()
    assert.equal(event.codeVerification, 'student_card')
    assert.equal(event.idVerification, 'student_card')

    await deliver({ orderId: ORDER_ID, delivered: false, expectedDelivered: true, overrideReason: 'Reset' }, as('admin'))
    await deliver(collect({ ticketCode: '', overrideReason: '核對身分證' }), as('admin'))
    const history = await ref().collection('history').orderBy('occurredAt', 'desc').limit(1).get()
    event = history.docs[0].data()
    assert.equal(event.codeVerification, 'admin_override')
    assert.equal(event.idVerification, 'admin_override')
  })

  test('other orders: the QR code is enough; a manager\'s student card no longer replaces it', async () => {
    await db.doc('settings/ticketTypes').set({ types: [{ id: 'open', name: '一階票', eligibleBuyerIdentity: 'all' }] })
    await ref().update({ items: [{ id: 'open', ticketTypeId: 'open', name: '一階票', quantity: 1 }] })
    await assert.rejects(deliver(collect({ ticketCode: '', studentId: '1130524', studentCardChecked: true }), as('manager1')), { code: 'permission-denied' })
    await deliver(collect(), as('manager1'))
    const event = (await ref().collection('history').get()).docs[0].data()
    assert.equal(event.codeVerification, 'verified')
    assert.equal(event.idVerification, undefined)
  })
})

describe('atomic payment and input authority', () => {
  test('an unpaid order is not collected until it is marked paid, whoever asks', async () => {
    await ref().update({ paid: false })
    await assert.rejects(deliver(collect(), as('manager1')), { code: 'failed-precondition', message: /尚未付款/ })
    await assert.rejects(deliver(collect({ overrideReason: '現場收款' }), as('admin')), { code: 'failed-precondition', message: /尚未付款/ })
    assert.equal((await ref().collection('history').get()).size, 0)
    await pay({ orderId: ORDER_ID, paid: true, expectedPaid: false }, as('admin'))
    assert.equal((await deliver(collect(), as('manager1'))).delivered, true)
  })

  test('a complimentary order needs no payment', async () => {
    await ref().update({ paid: false, complimentary: true })
    assert.equal((await deliver(collect(), as('manager1'))).delivered, true)
  })

  test('only admins can change payment, with canonical metadata and immutable audit per transition', async () => {
    await ref().update({ paid: false })
    const input = { orderId: ORDER_ID, paid: true, expectedPaid: false, paymentUpdatedByName: 'Forged' }
    await assert.rejects(pay(input, as('manager1')), { code: 'permission-denied' })
    const result = await pay(input, as('admin'))
    assert.equal(result.paid, true)
    assert.equal(result.paymentUpdatedByName, 'Administrator')
    assert.equal(result.paymentUpdatedByUid, 'admin')
    assert.equal(result.paymentUpdatedAt, (await ref().get()).data().paymentUpdatedAt.toDate().toISOString())
    await assert.rejects(pay(input, as('admin')), { code: 'failed-precondition' })
    assert.equal((await ref().collection('history').get()).size, 1)
    await pay({ orderId: ORDER_ID, paid: false, expectedPaid: true }, as('admin'))
    assert.equal((await ref().collection('history').get()).size, 2)
  })

  test('rejects anonymous, nonstaff, missing orders and invalid states before any audit writes', async () => {
    await assert.rejects(deliver(collect(), {}), { code: 'unauthenticated' })
    await assert.rejects(deliver(collect(), as('buyer')), { code: 'permission-denied' })
    await assert.rejects(deliver(collect({ delivered: 'yes' }), as('manager1')), { code: 'invalid-argument' })
    await assert.rejects(deliver(collect({ expectedDelivered: undefined }), as('manager1')), { code: 'invalid-argument' })
    await assert.rejects(deliver(collect({ orderId: '../users/admin' }), as('manager1')), { code: 'invalid-argument' })
    await assert.rejects(deliver(collect({ orderId: 'CKS20261105XYZ234' }), as('manager1')), { code: 'not-found' })
    assert.equal((await ref().collection('history').get()).size, 0)
  })
})
