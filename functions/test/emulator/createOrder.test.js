// Runs createOrder / releaseOrderStock against the Firestore emulator:
// `yarn test:emulator` (needs Java). The emulator project is a demo-
// project, so nothing ever reaches production.
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import functionsTest from 'firebase-functions-test'

const PROJECT_ID = 'demo-cksc-ticket'
process.env.GCLOUD_PROJECT = PROJECT_ID
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.appspot.com`
})

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run through `yarn test:emulator`')

const fft = functionsTest({ projectId: PROJECT_ID })
const { createOrder, releaseOrderStock } = await import('../../index.js')
const { db } = await import('../../lib/common.js')

const callCreate = fft.wrap(createOrder)
const callRelease = fft.wrap(releaseOrderStock)

const HOUR = 60 * 60 * 1000
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString()

const TICKET_TYPES = [
  { id: 'open', name: '一階票', price: 900, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 100, purchaseLimitPerPerson: 4 },
  { id: 'small', name: '限量票', price: 500, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 5, unlimited: true, purchaseLimitPerPerson: null },
  { id: 'campus', name: '校內票', price: 700, eligibleBuyerIdentity: 'campus_students', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), unlimitedStock: true, purchaseLimitPerPerson: 2 },
  { id: 'future', name: '二階票', price: 1200, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(HOUR), salesEndTime: iso(2 * HOUR), totalTicketQuantity: 0, purchaseLimitPerPerson: null }
]

// callable context of a buyer signed in with Google
const as = (email, { uid = `uid-${email}`, verified = true } = {}) => ({
  auth: { uid, token: { email, email_verified: verified } }
})

const buyer = (extra = {}) => ({
  customerName: '測試',
  customerPhone: '0900000000',
  school: '北一女中',
  class: '101',
  number: '1',
  ...extra
})

const order = (items, extra) => ({ orderPayload: { ...buyer(extra), items } })

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

// tickets counted against a type's stock: the shards plus the legacy counter
async function soldOf(ticketTypeId) {
  const [legacy, shards] = await Promise.all([
    db.doc(`ticketSales/${ticketTypeId}`).get(),
    db.collection(`ticketSales/${ticketTypeId}/shards`).get()
  ])
  return shards.docs.reduce((sum, d) => sum + (d.data().sold || 0), legacy.data()?.sold || 0)
}

after(() => fft.cleanup())

beforeEach(async () => {
  await clearFirestore()
  await db.doc('settings/ticketTypes').set({ types: TICKET_TYPES })
  // the shop is open unless a test says otherwise
  await db.doc('settings/shop').set({ openAt: new Date(Date.now() - HOUR) })
})

describe('createOrder', () => {
  test('requires a signed-in account with a verified email', async () => {
    await assert.rejects(callCreate(order([{ id: 'open', quantity: 1 }]), {}), { code: 'unauthenticated' })
    await assert.rejects(
      callCreate(order([{ id: 'open', quantity: 1 }]), as('a@example.com', { verified: false })),
      { code: 'failed-precondition' }
    )
  })

  test('ignores tampered prices, totals, flags, userId and email (PARTY-3)', async () => {
    const result = await callCreate({
      orderPayload: {
        ...buyer(),
        customerEmail: 'victim@example.com',
        items: [{ id: 'open', quantity: 2, price: 0 }],
        finalTotal: 0,
        paid: true,
        delivered: true,
        userId: 'victim',
        isAdminOrder: true
      }
    }, as('A@Example.com', { uid: 'real-uid' }))

    assert.equal(result.status, 201)
    assert.match(result.id, /^TFG\d{8}[A-HJ-NP-Z2-9]{6}$/)
    assert.equal(result.token, undefined)

    const saved = (await db.doc(`orders/${result.id}`).get()).data()
    assert.equal(saved.finalTotal, 1800)
    assert.equal(saved.items[0].price, 900)
    assert.equal(saved.paid, false)
    assert.equal(saved.delivered, false)
    assert.equal(saved.userId, 'real-uid')
    assert.equal(saved.customerEmail, 'a@example.com')
    assert.equal(saved.accessToken, undefined)
    assert.equal(saved.isAdminOrder, undefined)
  })

  test('order ids carry the school code and Taiwan date', async () => {
    const { id } = await callCreate(order([{ id: 'open', quantity: 1 }], { school: '建國中學' }), as('b@example.com'))
    assert.match(id, /^CKS\d{8}[A-HJ-NP-Z2-9]{6}$/)
  })

  test('retrying with the same requestId returns the same order, once (PARTY-20)', async () => {
    const payload = { ...order([{ id: 'open', quantity: 2 }]), requestId: 'req-0123456789abcdef' }
    const first = await callCreate(payload, as('retry@example.com'))
    const second = await callCreate(payload, as('retry@example.com'))

    assert.equal(first.status, 201)
    assert.equal(second.status, 200)
    assert.equal(second.id, first.id)
    assert.equal(await soldOf('open'), 2)

    // another account cannot claim that order with the same requestId
    await assert.rejects(callCreate(payload, as('other@example.com')), { code: 'invalid-argument' })
  })

  test('every order gets a secret ticket code for its QR (PARTY-19)', async () => {
    const { id } = await callCreate(order([{ id: 'open', quantity: 1 }]), as('code@example.com'))
    const saved = (await db.doc(`orders/${id}`).get()).data()
    assert.match(saved.ticketCode, /^[\w-]{12}$/)
    assert.equal(saved.emailStatus, 'pending')
  })

  test('a ticket type without stock or the unlimited switch sells nothing (PARTY-18)', async () => {
    await db.doc('settings/ticketTypes').set({
      types: [{ ...TICKET_TYPES[0], id: 'nostock', totalTicketQuantity: 0 }]
    })
    await assert.rejects(
      callCreate(order([{ id: 'nostock', quantity: 1 }]), as('a@example.com')),
      { code: 'resource-exhausted' }
    )
  })

  test('before the site opens only staff can order, whatever the sale window', async () => {
    const payload = order([{ id: 'open', quantity: 1 }])

    await db.doc('settings/shop').set({ openAt: new Date(Date.now() + HOUR) })
    await assert.rejects(callCreate(payload, as('early@example.com')), { code: 'failed-precondition' })

    await db.doc('users/staff-uid').set({ role: 'manager' })
    await assert.doesNotReject(callCreate(payload, as('staff@example.com', { uid: 'staff-uid' })))

    // a legacy Taiwan-time string is read the same way
    await db.doc('settings/shop').set({ openAt: '2999-01-01T12:00:00+08:00' })
    await assert.rejects(callCreate(payload, as('early@example.com')), { code: 'failed-precondition' })

    await db.doc('settings/shop').set({ openAt: new Date(Date.now() - HOUR) })
    await assert.doesNotReject(callCreate(payload, as('early@example.com')))
  })

  test('rejects unknown and not-yet-on-sale tickets', async () => {
    await assert.rejects(callCreate(order([{ id: 'nope', quantity: 1 }]), as('a@example.com')), { code: 'invalid-argument' })
    await assert.rejects(callCreate(order([{ id: 'future', quantity: 1 }]), as('a@example.com')), { code: 'failed-precondition' })
  })

  test('本校學生 tickets need a @gl.ck.tp.edu.tw account and 建國中學', async () => {
    const campus = [{ id: 'campus', quantity: 1 }]
    const student = as('s1234@gl.ck.tp.edu.tw')

    await assert.rejects(callCreate(order(campus, { school: '建國中學' }), as('s1234@gmail.com')), { code: 'permission-denied' })
    for (const school of ['其他學校或社會人士', '北一女中']) {
      await assert.rejects(callCreate(order(campus, { school }), student), { code: 'permission-denied' })
    }
    await assert.doesNotReject(callCreate(order(campus, { school: '建國中學' }), student))
  })

  test('concurrent checkouts never oversell (PARTY-5)', async (t) => {
    const attempts = 25
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, i) =>
        callCreate(order([{ id: 'small', quantity: 1 }]), as(`buyer${i}@example.com`))
      )
    )
    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    const sold = await soldOf('small')
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
        callCreate(order([{ id: 'open', quantity: 1 }]), as('same@example.com'))
      )
    )
    const succeeded = results.filter((r) => r.status === 'fulfilled').length

    t.diagnostic(`${succeeded} of 10 concurrent orders succeeded with a limit of 4`)
    assert.ok(succeeded >= 1 && succeeded <= 4, `bought ${succeeded} with a limit of 4`)
    assert.equal(await countOrdersOf('open'), succeeded)
  })

  test('stock is counted in shards and recorded on the order (PARTY-28)', async () => {
    const { id } = await callCreate(order([{ id: 'open', quantity: 3 }]), as('shard@example.com'))
    const { stockShards } = (await db.doc(`orders/${id}`).get()).data()
    const counted = Object.values(stockShards.open).reduce((a, b) => a + b, 0)

    assert.equal(counted, 3)
    assert.equal(await soldOf('open'), 3)
    assert.equal((await db.doc('ticketSales/open').get()).exists, false, 'the legacy counter is not written')
  })

  test('tickets counted by the legacy counter are not sold again (PARTY-28)', async () => {
    await db.doc('ticketSales/open').set({ sold: 98 }) // 98 of 100 sold before the shards
    await assert.doesNotReject(callCreate(order([{ id: 'open', quantity: 2 }]), as('last@example.com')))
    await assert.rejects(callCreate(order([{ id: 'open', quantity: 1 }]), as('late@example.com')), { code: 'resource-exhausted' })
    assert.equal(await soldOf('open'), 100)
  })

  test('many simultaneous buyers all get tickets while stock lasts (PARTY-28)', async (t) => {
    await db.doc('settings/ticketTypes').set({
      types: TICKET_TYPES.map((type) => (type.id === 'open' ? { ...type, totalTicketQuantity: 1000 } : type))
    })
    const buyers = 60
    const results = await Promise.allSettled(
      Array.from({ length: buyers }, (_, i) =>
        callCreate(order([{ id: 'open', quantity: 2 }]), as(`crowd${i}@example.com`))
      )
    )
    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    t.diagnostic(`${succeeded} of ${buyers} simultaneous buyers succeeded`)

    assert.equal(succeeded, buyers)
    assert.equal(await soldOf('open'), buyers * 2)
  })

  test('the per-person limit ignores email case', async () => {
    await callCreate(order([{ id: 'open', quantity: 4 }]), as('Case@Example.com'))
    await assert.rejects(
      callCreate(order([{ id: 'open', quantity: 1 }]), as('case@example.com')),
      { code: 'failed-precondition' }
    )
  })
})

describe('releaseOrderStock', () => {
  test('deleting an order returns stock and the buyer allowance exactly once (PARTY-5)', async () => {
    const { id } = await callCreate(order([{ id: 'open', quantity: 3 }]), as('a@example.com'))
    const snap = await db.doc(`orders/${id}`).get()
    await db.doc(`orders/${id}`).delete()

    await callRelease(snap, { params: { orderId: id }, eventId: 'e1' })
    await callRelease(snap, { params: { orderId: id }, eventId: 'e2' }) // duplicate delivery

    assert.equal(await soldOf('open'), 0)

    // the buyer can buy the full allowance again
    await assert.doesNotReject(callCreate(order([{ id: 'open', quantity: 4 }]), as('a@example.com')))
  })

  test('orders created before the counters existed are not refunded', async () => {
    await db.doc('ticketSales/open').set({ sold: 2 })
    const legacy = { items: [{ id: 'open', quantity: 2 }], customerEmail: 'old@example.com' }
    await db.doc('orders/CKS202601010001').set(legacy)
    const snap = await db.doc('orders/CKS202601010001').get()
    await callRelease(snap, { params: { orderId: 'CKS202601010001' }, eventId: 'e3' })
    assert.equal((await db.doc('ticketSales/open').get()).data().sold, 2)
  })

  test('orders counted before the shards are refunded to the legacy counter (PARTY-28)', async () => {
    await db.doc('ticketSales/open').set({ sold: 2 })
    const legacy = { items: [{ id: 'open', quantity: 2 }], customerEmail: 'old@example.com', stockCounted: true }
    await db.doc('orders/CKS202601010002').set(legacy)
    const snap = await db.doc('orders/CKS202601010002').get()
    await callRelease(snap, { params: { orderId: 'CKS202601010002' }, eventId: 'e4' })
    assert.equal((await db.doc('ticketSales/open').get()).data().sold, 0)
  })
})
