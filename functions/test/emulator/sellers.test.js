// Runs registerSellerTickets / releaseSellerStock against the Firestore
// emulator: `yarn test:emulator` (needs Java).
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { HOUR, PROJECT_ID, db, fft, functions, iso, soldOf, isEmulator } from './setup.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')

const callRegister = fft.wrap(functions.registerSellerTickets)
const callRelease = fft.wrap(functions.releaseSellerStock)
const callCreate = fft.wrap(functions.createOrder)

const TICKET_TYPES = [
  // 二售 sells later; sellers take from it before the public sale opens
  { id: 'second', name: '二售票', price: 800, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 10, unlimited: true },
  { id: 'later', name: '晚鳥票', price: 900, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(HOUR), salesEndTime: iso(2 * HOUR), totalTicketQuantity: 5, unlimited: true }
]

const SELLER = 's1001@gl.ck.tp.edu.tw'
const as = (email, { uid = `uid-${email}`, verified = true } = {}) => ({
  auth: { uid, token: { email, email_verified: verified } }
})

let requestCount = 0
const register = (quantity, extra = {}) => ({
  requestId: `seller-request-${String(++requestCount).padStart(8, '0')}`,
  quantity,
  sellerName: '王小明',
  ...extra
})

const total = async () => (await db.doc('sellerStats/summary').get()).data()?.total || 0

after(() => fft.cleanup())

beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  assert.ok(response.ok)
  const batch = db.batch()
  batch.set(db.doc('settings/ticketTypes'), { types: TICKET_TYPES })
  batch.set(db.doc('settings/shop'), { openAt: new Date(Date.now() - HOUR) })
  batch.set(db.doc('settings/sellerProgram'), { enabled: true, ticketTypeId: 'second', goal: 750 })
  batch.set(db.doc(`sellers/${SELLER}`), { email: SELLER, name: '王小明' })
  await batch.commit()
})

describe('registerSellerTickets', () => {
  test('takes the tickets from the chosen type and adds them to the shared total', async () => {
    const result = await callRegister(register(4), as(SELLER))

    assert.equal(result.quantity, 4)
    assert.equal(result.ticketTypeName, '二售票')
    assert.equal(await soldOf('second'), 4)
    assert.equal(await total(), 4)

    const saved = (await db.doc(`sellerRegistrations/${result.id}`).get()).data()
    assert.equal(saved.sellerUid, `uid-${SELLER}`)
    assert.equal(saved.sellerEmail, SELLER)
    assert.equal(saved.price, 800)
    assert.equal(saved.delivered, false)
    assert.equal(saved.paid, false)
  })

  test('the tickets left for buyers go down by what sellers took', async () => {
    await callRegister(register(8), as(SELLER))

    const buy = (quantity, email) => callCreate({
      orderPayload: { customerName: '買家', customerPhone: '0900000000', school: '北一女中', items: [{ id: 'second', quantity }] }
    }, as(email))
    await assert.rejects(buy(3, 'a@example.com'), { code: 'resource-exhausted' })
    await buy(2, 'b@example.com')
    await assert.rejects(callRegister(register(1), as(SELLER)), { code: 'resource-exhausted' })
    assert.equal(await soldOf('second'), 10)
  })

  test('ignores the sale window: sellers may take tickets before it opens', async () => {
    await db.doc('settings/sellerProgram').set({ enabled: true, ticketTypeId: 'later', goal: 750 })
    await callRegister(register(5), as(SELLER))
    assert.equal(await soldOf('later'), 5)
    await assert.rejects(callRegister(register(1), as(SELLER)), { code: 'resource-exhausted' })
  })

  test('a retried request returns the same registration without taking more', async () => {
    const request = register(3)
    const first = await callRegister(request, as(SELLER))
    const again = await callRegister(request, as(SELLER))

    assert.equal(again.id, first.id)
    assert.equal(await soldOf('second'), 3)
    assert.equal(await total(), 3)
    // someone else replaying it gets nothing
    await db.doc('sellers/other@example.com').set({ email: 'other@example.com' })
    await assert.rejects(callRegister(request, as('other@example.com')), { code: 'invalid-argument' })
  })

  test('only sellers on the list, with a verified email, may register', async () => {
    await assert.rejects(callRegister(register(1), {}), { code: 'unauthenticated' })
    await assert.rejects(callRegister(register(1), as(SELLER, { verified: false })), { code: 'failed-precondition' })
    await assert.rejects(callRegister(register(1), as('stranger@gl.ck.tp.edu.tw')), { code: 'permission-denied' })
    // the list is keyed by lower-case email
    await callRegister(register(1), as(SELLER.toUpperCase()))
    assert.equal(await soldOf('second'), 1)
  })

  test('is refused while the program is off or has no ticket type', async () => {
    for (const program of [{ enabled: false, ticketTypeId: 'second' }, { enabled: true, ticketTypeId: '' }, null]) {
      if (program) await db.doc('settings/sellerProgram').set(program)
      else await db.doc('settings/sellerProgram').delete()
      await assert.rejects(callRegister(register(1), as(SELLER)), { code: 'failed-precondition' })
    }
    assert.equal(await soldOf('second'), 0)
  })

  test('rejects bad quantities, names and request ids', async () => {
    for (const bad of [register(0), register(-1), register(1.5), register(201), register(1, { sellerName: '  ' }), register(1, { requestId: 'short' })]) {
      await assert.rejects(callRegister(bad, as(SELLER)), { code: 'invalid-argument' })
    }
    assert.equal(await soldOf('second'), 0)
  })

  test('simultaneous registrations never take more than the stock', async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => callRegister(register(3), as(SELLER))))
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3)
    assert.equal(await soldOf('second'), 9)
    assert.equal(await total(), 9)
  })
})

describe('releaseSellerStock', () => {
  test('a deleted registration gives its tickets back, once', async () => {
    const { id } = await callRegister(register(6), as(SELLER))
    const snap = await db.doc(`sellerRegistrations/${id}`).get()
    await snap.ref.delete()

    await callRelease(snap, { params: { registrationId: id } })
    await callRelease(snap, { params: { registrationId: id } })

    assert.equal(await soldOf('second'), 0)
    assert.equal(await total(), 0)
    await callRegister(register(10), as(SELLER))
  })

  test('a late retry of a deleted registration does not register it again', async () => {
    const request = register(4)
    const { id } = await callRegister(request, as(SELLER))
    const snap = await db.doc(`sellerRegistrations/${id}`).get()
    await snap.ref.delete()
    await callRelease(snap, { params: { registrationId: id } })

    await assert.rejects(callRegister(request, as(SELLER)), { code: 'failed-precondition' })
    assert.equal(await soldOf('second'), 0)
    assert.equal(await total(), 0)
  })
})
