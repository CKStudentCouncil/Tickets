import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { PROJECT_ID, db, fft } from './setup.js'
import { updateOrderDelivery, updateOrderPayment } from '../../lib/orderActions.js'

const deliver = fft.wrap(updateOrderDelivery)
const pay = fft.wrap(updateOrderPayment)
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
  batch.set(ref(), { userId: 'buyer', delivered: false, paid: false, ticketCode: TICKET_CODE, finalTotal: 700 })
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

describe('atomic payment and input authority', () => {
  test('only admins can change payment, with canonical metadata and immutable audit per transition', async () => {
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
