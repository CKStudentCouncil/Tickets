// Runs createOrder / getOrders / releaseOrderStock against the Firestore
// emulator: `npm run test:emulator` (needs Java). The emulator project is a
// demo- project, so nothing ever reaches production.
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import functionsTest from 'firebase-functions-test'

const PROJECT_ID = 'demo-cksc-ticket'
process.env.GCLOUD_PROJECT = PROJECT_ID
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.appspot.com`
})

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run through `npm run test:emulator`')

const fft = functionsTest({ projectId: PROJECT_ID })
const { createOrder, getOrders, releaseOrderStock } = await import('../../index.js')
const { db } = await import('../../lib/common.js')

const callCreate = fft.wrap(createOrder)
const callGetOrders = fft.wrap(getOrders)
const callRelease = fft.wrap(releaseOrderStock)

const HOUR = 60 * 60 * 1000
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString()

const TICKET_TYPES = [
  { id: 'open', name: '一階票', price: 900, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 100, purchaseLimitPerPerson: 4 },
  { id: 'small', name: '限量票', price: 500, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 5, unlimited: true, purchaseLimitPerPerson: null },
  { id: 'campus', name: '校內票', price: 700, eligibleBuyerIdentity: 'campus_students', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), unlimitedStock: true, purchaseLimitPerPerson: 2 },
  { id: 'future', name: '二階票', price: 1200, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(HOUR), salesEndTime: iso(2 * HOUR), totalTicketQuantity: 0, purchaseLimitPerPerson: null }
]

const buyer = (email, extra = {}) => ({
  customerName: '測試',
  customerEmail: email,
  customerPhone: '0900000000',
  school: '北一女中',
  class: '101',
  number: '1',
  ...extra
})

const order = (email, items, extra) => ({ orderPayload: { ...buyer(email, extra), items } })

async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  const res = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  )
  assert.ok(res.ok)
}

async function countOrdersOf(ticketTypeId) {
  const snap = await db.collection('orders').get()
  return snap.docs
    .flatMap((d) => d.data().items)
    .filter((item) => item.id === ticketTypeId)
    .reduce((sum, item) => sum + item.quantity, 0)
}

after(() => fft.cleanup())

beforeEach(async () => {
  await clearFirestore()
  await db.doc('settings/ticketTypes').set({ types: TICKET_TYPES })
})

describe('createOrder', () => {
  test('ignores tampered prices, totals, flags and userId (PARTY-3)', async () => {
    const result = await callCreate({
      orderPayload: {
        ...buyer('a@example.com'),
        items: [{ id: 'open', quantity: 2, price: 0 }],
        finalTotal: 0,
        paid: true,
        delivered: true,
        userId: 'victim',
        isAdminOrder: true
      }
    }, {})

    assert.equal(result.status, 201)
    assert.match(result.id, /^TFG\d{8}[A-HJ-NP-Z2-9]{6}$/)
    assert.match(result.token, /^[0-9a-f]{48}$/)

    const saved = (await db.doc(`orders/${result.id}`).get()).data()
    assert.equal(saved.finalTotal, 1800)
    assert.equal(saved.items[0].price, 900)
    assert.equal(saved.paid, false)
    assert.equal(saved.delivered, false)
    assert.equal(saved.userId, null)
    assert.equal(saved.isAdminOrder, undefined)
  })

  test('userId comes from the signed-in caller, never the payload', async () => {
    const { id } = await callCreate(
      order('a@example.com', [{ id: 'open', quantity: 1 }], { userId: 'victim' }),
      { auth: { uid: 'real-uid', token: {} } }
    )
    assert.equal((await db.doc(`orders/${id}`).get()).data().userId, 'real-uid')
  })

  test('order ids carry the school code and Taiwan date', async () => {
    const { id } = await callCreate(order('b@example.com', [{ id: 'open', quantity: 1 }], { school: '建國中學' }), {})
    assert.match(id, /^CKS\d{8}[A-HJ-NP-Z2-9]{6}$/)
  })

  test('retrying with the same requestId returns the same order, once (PARTY-20)', async () => {
    const payload = { ...order('retry@example.com', [{ id: 'open', quantity: 2 }]), requestId: 'req-0123456789abcdef' }
    const first = await callCreate(payload, {})
    const second = await callCreate(payload, {})

    assert.equal(first.status, 201)
    assert.equal(second.status, 200)
    assert.equal(second.id, first.id)
    assert.equal(second.token, first.token)
    assert.equal((await db.doc('ticketSales/open').get()).data().sold, 2)
  })

  test('every order gets a secret ticket code for its QR (PARTY-19)', async () => {
    const { id, token } = await callCreate(order('code@example.com', [{ id: 'open', quantity: 1 }]), {})
    const saved = (await db.doc(`orders/${id}`).get()).data()
    assert.match(saved.ticketCode, /^[\w-]{12}$/)
    assert.equal(saved.emailStatus, 'pending')

    const { orders } = await callGetOrders({ orders: [{ id, token }] }, {})
    assert.equal(orders[0].ticketCode, saved.ticketCode)
  })

  test('a ticket type without stock or the unlimited switch sells nothing (PARTY-18)', async () => {
    await db.doc('settings/ticketTypes').set({
      types: [{ ...TICKET_TYPES[0], id: 'nostock', totalTicketQuantity: 0 }]
    })
    await assert.rejects(
      callCreate(order('a@example.com', [{ id: 'nostock', quantity: 1 }]), {}),
      { code: 'resource-exhausted' }
    )
  })

  test('rejects unknown, not-yet-on-sale and campus-only tickets for outsiders', async () => {
    await assert.rejects(callCreate(order('a@example.com', [{ id: 'nope', quantity: 1 }]), {}), { code: 'invalid-argument' })
    await assert.rejects(callCreate(order('a@example.com', [{ id: 'future', quantity: 1 }]), {}), { code: 'failed-precondition' })
    await assert.rejects(
      callCreate(order('a@example.com', [{ id: 'campus', quantity: 1 }], { school: '其他學校或社會人士' }), {}),
      { code: 'permission-denied' }
    )
    await assert.doesNotReject(callCreate(order('a@example.com', [{ id: 'campus', quantity: 1 }]), {}))
  })

  test('concurrent checkouts never oversell (PARTY-5)', async (t) => {
    const attempts = 25
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, i) =>
        callCreate(order(`buyer${i}@example.com`, [{ id: 'small', quantity: 1 }]), {})
      )
    )
    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    const sold = (await db.doc('ticketSales/small').get()).data()?.sold || 0
    t.diagnostic(`${succeeded} of ${attempts} concurrent orders succeeded for 5 tickets`)

    const rejectionCodes = new Set(results.filter((r) => r.status === 'rejected').map((r) => r.reason?.code))

    assert.equal(succeeded, 5, 'exactly the 5 available tickets should sell')
    assert.deepEqual([...rejectionCodes], ['resource-exhausted'])
    assert.equal(sold, succeeded)
    assert.equal(await countOrdersOf('small'), succeeded)
  })

  test('concurrent checkouts by one buyer respect the per-person limit (PARTY-5)', async (t) => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        callCreate(order('same@example.com', [{ id: 'open', quantity: 1 }]), {})
      )
    )
    const succeeded = results.filter((r) => r.status === 'fulfilled').length

    t.diagnostic(`${succeeded} of 10 concurrent orders succeeded with a limit of 4`)
    assert.ok(succeeded >= 1 && succeeded <= 4, `bought ${succeeded} with a limit of 4`)
    assert.equal(await countOrdersOf('open'), succeeded)
  })

  test('the per-person limit ignores email case', async () => {
    await callCreate(order('Case@Example.com', [{ id: 'open', quantity: 4 }]), {})
    await assert.rejects(
      callCreate(order('case@example.com', [{ id: 'open', quantity: 1 }]), {}),
      { code: 'failed-precondition' }
    )
  })
})

describe('getOrders', () => {
  test('returns an order only with its token, without the token (PARTY-2)', async () => {
    const { id, token } = await callCreate(order('a@example.com', [{ id: 'open', quantity: 1 }]), {})

    const good = await callGetOrders({ orders: [{ id, token }] }, {})
    assert.equal(good.orders.length, 1)
    assert.equal(good.orders[0].id, id)
    assert.equal(good.orders[0].accessToken, undefined)
    assert.equal(good.orders[0].userId, undefined)
    assert.equal(good.orders[0].stockCounted, undefined)
    assert.equal(typeof good.orders[0].createdAt, 'string')

    const bad = await callGetOrders({ orders: [{ id, token: 'wrong' }, { id }] }, {})
    assert.equal(bad.orders.length, 0)
  })
})

describe('releaseOrderStock', () => {
  test('deleting an order returns stock and the buyer allowance exactly once (PARTY-5)', async () => {
    const { id } = await callCreate(order('a@example.com', [{ id: 'open', quantity: 3 }]), {})
    const snap = await db.doc(`orders/${id}`).get()
    await db.doc(`orders/${id}`).delete()

    await callRelease(snap, { params: { orderId: id }, eventId: 'e1' })
    await callRelease(snap, { params: { orderId: id }, eventId: 'e2' }) // duplicate delivery

    assert.equal((await db.doc('ticketSales/open').get()).data().sold, 0)

    // the buyer can buy the full allowance again
    await assert.doesNotReject(callCreate(order('a@example.com', [{ id: 'open', quantity: 4 }]), {}))
  })

  test('orders created before the counters existed are not refunded', async () => {
    await db.doc('ticketSales/open').set({ sold: 2 })
    const legacy = { items: [{ id: 'open', quantity: 2 }], customerEmail: 'old@example.com' }
    await db.doc('orders/CKS202601010001').set(legacy)
    const snap = await db.doc('orders/CKS202601010001').get()
    await callRelease(snap, { params: { orderId: 'CKS202601010001' }, eventId: 'e3' })
    assert.equal((await db.doc('ticketSales/open').get()).data().sold, 2)
  })
})
