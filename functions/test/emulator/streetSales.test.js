// Runs registerStreetSale against the Firestore emulator: `yarn test:emulator`
// (needs Java).
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { HOUR, PROJECT_ID, db, fft, functions, iso, soldOf, isEmulator, wrapCallable, wrapTrigger } from './setup.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')

const callRegister = wrapCallable(functions.registerStreetSale)
const callRelease = wrapTrigger(functions.releaseOrderStock)
const callConfirm = wrapTrigger(functions.sendOrderQRCode)

const TICKET_TYPES = [
  // on sale later: 路宣 may sell before the online sale opens
  { id: 'open', name: '一般票', price: 900, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(HOUR), salesEndTime: iso(2 * HOUR), totalTicketQuantity: 10, purchaseLimitPerPerson: 4 },
  { id: 'campus', name: '校內票', price: 700, eligibleBuyerIdentity: 'campus_students', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 10, unlimited: true }
]

const STAFF = {
  admin: { uid: 'admin-uid', email: 'admin@example.com', role: 'admin', name: '林管理' },
  superAdmin: { uid: 'super-uid', email: 'super@example.com', role: 'super_admin', name: '王總召' },
  manager: { uid: 'manager-uid', email: 'manager@example.com', role: 'manager', name: '門口' }
}
const as = ({ uid, email }) => ({ auth: { uid, token: { email, email_verified: true } } })

let requestCount = 0
const sale = (quantity, extra = {}) => ({
  requestId: `street-request-${String(++requestCount).padStart(8, '0')}`,
  quantity,
  ...extra
})

after(() => fft.cleanup())

beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  assert.ok(response.ok)
  const batch = db.batch()
  batch.set(db.doc('settings/ticketTypes'), { types: TICKET_TYPES })
  batch.set(db.doc('settings/streetSale'), { enabled: true, ticketTypeId: 'open' })
  Object.values(STAFF).forEach(({ uid, email, role, name }) => batch.set(db.doc(`users/${uid}`), { uid, email, role, name }))
  await batch.commit()
})

describe('registerStreetSale', () => {
  test('makes a paid, collected 路宣 order from the chosen type, sold by the admin', async () => {
    const { id } = await callRegister(sale(2, { name: '陳小華', phone: '0912345678' }), as(STAFF.admin))

    assert.match(id, /^ST\d{8}[A-HJ-NP-Z2-9]{6}$/)
    assert.equal(await soldOf('open'), 2)
    const order = (await db.doc(`orders/${id}`).get()).data()
    assert.equal(order.school, '路宣')
    assert.equal(order.streetSale, true)
    // nothing about the buyer, even when sent
    assert.equal(order.customerName, '')
    assert.equal(order.customerEmail, '')
    assert.equal(order.userId, null)
    assert.equal(order.finalTotal, 1800)
    assert.equal(order.paid, true)
    assert.equal(order.delivered, true)
    assert.equal(order.promoterEmail, 'admin@example.com')
    // the name staff accounts carry, as staff actions record it
    assert.equal(order.promoterName, '林管理')
    assert.equal(order.paymentUpdatedByUid, 'admin-uid')
    assert.equal(order.deliveryUpdatedByName, '林管理')

    const history = (await db.collection(`orders/${id}/history`).get()).docs.map((d) => d.data())
    assert.deepEqual(history.map((entry) => [entry.action, entry.value, entry.actorUid]).sort(), [
      ['delivery', true, 'admin-uid'],
      ['payment', true, 'admin-uid']
    ])
    // no buyer email, so no per-person allowance is counted
    assert.equal((await db.collection('buyerPurchases').get()).size, 0)
  })

  test('admins and super admins may register; nobody else', async () => {
    await callRegister(sale(1), as(STAFF.superAdmin))
    await assert.rejects(callRegister(sale(1), as(STAFF.manager)), { code: 'permission-denied' })
    await assert.rejects(callRegister(sale(1), as({ uid: 'buyer-uid', email: 'buyer@example.com' })), { code: 'permission-denied' })
    await assert.rejects(callRegister(sale(1), {}), { code: 'unauthenticated' })
    // a demoted admin's retry is refused too
    const request = sale(1)
    await db.doc(`users/${STAFF.admin.uid}`).update({ role: 'manager' })
    await assert.rejects(callRegister(request, as(STAFF.admin)), { code: 'permission-denied' })
    assert.equal(await soldOf('open'), 1)
  })

  test('a retried request returns the same order without selling more', async () => {
    const request = sale(3)
    const first = await callRegister(request, as(STAFF.admin))
    const again = await callRegister(request, as(STAFF.admin))

    assert.equal(again.id, first.id)
    assert.equal(await soldOf('open'), 3)
    // another admin replaying it gets nothing
    await assert.rejects(callRegister(request, as(STAFF.superAdmin)), { code: 'invalid-argument' })
  })

  test('ignores the per-person limit, and sales of as many tickets each count', async () => {
    await callRegister(sale(6), as(STAFF.admin))
    await callRegister(sale(2), as(STAFF.admin))
    await callRegister(sale(2), as(STAFF.admin))
    assert.equal(await soldOf('open'), 10)
  })

  test('never sells past the stock, even all at once', async () => {
    await callRegister(sale(8), as(STAFF.admin))
    await assert.rejects(callRegister(sale(3), as(STAFF.admin)), { code: 'resource-exhausted' })

    const results = await Promise.allSettled(Array.from({ length: 4 }, () => callRegister(sale(1), as(STAFF.admin))))
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2)
    assert.equal(await soldOf('open'), 10)
  })

  test('is refused while closed, without a ticket type, or for 本校學生 tickets', async () => {
    for (const program of [{ enabled: false, ticketTypeId: 'open' }, { enabled: true, ticketTypeId: '' }, { enabled: true, ticketTypeId: 'campus' }, null]) {
      if (program) await db.doc('settings/streetSale').set(program)
      else await db.doc('settings/streetSale').delete()
      await assert.rejects(callRegister(sale(1), as(STAFF.admin)), { code: 'failed-precondition' }, JSON.stringify(program))
    }
    assert.equal(await soldOf('open'), 0)
    assert.equal(await soldOf('campus'), 0)
  })

  test('rejects bad quantities and request ids', async () => {
    for (const bad of [sale(0), sale(21), sale(1.5), sale('2x'), sale(1, { requestId: 'short' })]) {
      await assert.rejects(callRegister(bad, as(STAFF.admin)), { code: 'invalid-argument' })
    }
    assert.equal(await soldOf('open'), 0)
  })

  test('queues no email for it', async () => {
    const { id } = await callRegister(sale(1), as(STAFF.admin))
    await callConfirm(await db.doc(`orders/${id}`).get(), { params: { orderId: id } })
    assert.equal((await db.collection('mailQueue').get()).size, 0)
    assert.equal((await db.doc(`orders/${id}`).get()).data().emailStatus, 'skipped')
  })

  test('a deleted sale gives its tickets back, and a late retry does not sell it again', async () => {
    const request = sale(4)
    const { id } = await callRegister(request, as(STAFF.admin))
    const snap = await db.doc(`orders/${id}`).get()
    await snap.ref.delete()
    await callRelease(snap, { params: { orderId: id } })
    await callRelease(snap, { params: { orderId: id } })

    assert.equal(await soldOf('open'), 0)
    await assert.rejects(callRegister(request, as(STAFF.admin)), { code: 'failed-precondition' })
    assert.equal(await soldOf('open'), 0)
  })
})
