// Checkout against a real (local) D1: the cases of the old createOrder and
// releaseOrderStock emulator tests (functions/test/emulator/createOrder.test.js).
import assert from 'node:assert/strict'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  HOUR, TICKET_TYPES, anonymous, as, call, countOrdersOf, createOrder, db, iso, ok, order, rejects, resetData,
  setShopOpenAt, setTypes, soldOf
} from './helpers'

beforeEach(async () => {
  await resetData()
  await setTypes()
  // the shop is open unless a test says otherwise
  await setShopOpenAt(new Date(Date.now() - HOUR))
})

const deleteOrder = async (id: string) => ok(call(await as('admin@example.com', { role: 'admin' }), 'DELETE', `/admin/orders/${id}`))

// buys one ticket at a time, one buyer each, until the type is sold out
async function sellOut(ticketTypeId: string, prefix: string) {
  for (let i = 0; ; i++) {
    try {
      await createOrder(order([{ id: ticketTypeId, quantity: 1 }]), await as(`${prefix}${i}@example.com`))
    } catch (error: any) {
      assert.equal(error.code, 'resource-exhausted')
      return
    }
  }
}

describe('checkout', () => {
  test('requires a signed-in account with a verified email', async () => {
    await rejects(createOrder(order([{ id: 'open', quantity: 1 }]), anonymous), { code: 'unauthenticated' })
    await rejects(createOrder(order([{ id: 'open', quantity: 1 }]), await as('a@example.com', { verified: false })), { code: 'failed-precondition' })
  })

  test('ignores tampered prices, totals, flags, userId and email (PARTY-3)', async () => {
    const account = await as('A@Example.com')
    const result = await createOrder({
      orderPayload: {
        customerName: '測試', customerPhone: '0900000000', school: '北一女中', class: '101', number: '1',
        customerEmail: 'victim@example.com', items: [{ id: 'open', quantity: 2, price: 0 }],
        finalTotal: 0, paid: true, delivered: true, userId: 'victim', isAdminOrder: true
      }
    }, account)

    assert.equal(result.status, 201)
    assert.match(result.id, /^TFG\d{8}[A-HJ-NP-Z2-9]{6}$/)
    const { order: saved } = await ok(call(account, 'GET', `/orders/${result.id}`))
    assert.equal(saved.finalTotal, 1800)
    assert.equal(saved.items[0].price, 900)
    assert.equal(saved.paid, false)
    assert.equal(saved.delivered, false)
    assert.equal(saved.userId, account.uid)
    assert.equal(saved.customerEmail, 'a@example.com')
    assert.equal(saved.isAdminOrder, undefined)
  })

  test('order ids carry the school code and Taiwan date', async () => {
    const { id } = await createOrder(order([{ id: 'open', quantity: 1 }], { school: '建國中學' }), await as('b@example.com'))
    assert.match(id, /^CKS\d{8}[A-HJ-NP-Z2-9]{6}$/)
  })

  test('retrying with the same requestId returns the same order, once (PARTY-20)', async () => {
    const payload = { ...order([{ id: 'open', quantity: 2 }]), requestId: 'req-0123456789abcdef' }
    const account = await as('retry@example.com')
    const first = await createOrder(payload, account)
    const second = await createOrder(payload, account)
    assert.equal(first.status, 201)
    assert.equal(second.status, 200)
    assert.equal(second.id, first.id)
    assert.equal(await soldOf('open'), 2)
    // another account cannot claim that order with the same requestId
    await rejects(createOrder(payload, await as('other@example.com')), { code: 'invalid-argument' })
  })

  test('every order gets a secret ticket code and a queued confirmation email (PARTY-19)', async () => {
    const account = await as('code@example.com')
    const { id } = await createOrder(order([{ id: 'open', quantity: 1 }]), account)
    const { order: saved } = await ok(call(account, 'GET', `/orders/${id}`))
    assert.match(saved.ticketCode, /^[\w-]{12}$/)
    assert.equal(saved.emailStatus, 'queued')
    const job = await db.prepare('SELECT kind, status, order_id FROM mail_jobs WHERE id = ?').bind(`confirmation_${id}`).first()
    assert.deepEqual(job, { kind: 'confirmation', status: 'pending', order_id: id })
  })

  test('a ticket type without stock or the unlimited switch sells nothing (PARTY-18)', async () => {
    await setTypes({}, [{ ...TICKET_TYPES[0], id: 'nostock', totalTicketQuantity: 0 }])
    await rejects(createOrder(order([{ id: 'nostock', quantity: 1 }]), await as('a@example.com')), { code: 'resource-exhausted' })
  })

  test('before the site opens only staff can order, whatever the sale window', async () => {
    const payload = order([{ id: 'open', quantity: 1 }])
    await setShopOpenAt(new Date(Date.now() + HOUR))
    await rejects(createOrder(payload, await as('early@example.com')), { code: 'failed-precondition' })
    await createOrder(payload, await as('staff@example.com', { role: 'manager' }))
    // a Taiwan-time string is read the same way
    await setShopOpenAt('2999-01-01T12:00:00+08:00')
    await rejects(createOrder(payload, await as('early@example.com')), { code: 'failed-precondition' })
    await setShopOpenAt(new Date(Date.now() - HOUR))
    await createOrder(payload, await as('early@example.com'))
  })

  test('rejects unknown and not-yet-on-sale tickets', async () => {
    await rejects(createOrder(order([{ id: 'nope', quantity: 1 }]), await as('a@example.com')), { code: 'invalid-argument' })
    await rejects(createOrder(order([{ id: 'future', quantity: 1 }]), await as('a@example.com')), { code: 'failed-precondition' })
  })

  test('本校學生 tickets need a @gl.ck.tp.edu.tw account and 建國中學', async () => {
    const campus = [{ id: 'campus', quantity: 1 }]
    const student = await as('s1234@gl.ck.tp.edu.tw')
    await rejects(createOrder(order(campus, { school: '建國中學' }), await as('s1234@gmail.com')), { code: 'permission-denied' })
    for (const school of ['其他學校或社會人士', '北一女中']) {
      await rejects(createOrder(order(campus, { school }), student), { code: 'permission-denied' })
    }
    await createOrder(order(campus, { school: '建國中學' }), student)
  })

  test('concurrent checkouts never oversell (PARTY-5)', async () => {
    const accounts = await Promise.all(Array.from({ length: 25 }, (_, i) => as(`buyer${i}@example.com`)))
    const results = await Promise.allSettled(accounts.map((account) => createOrder(order([{ id: 'small', quantity: 1 }]), account)))
    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    const rejectionCodes = new Set(results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason?.code))
    assert.equal(succeeded, 5, 'exactly the 5 available tickets should sell')
    assert.deepEqual([...rejectionCodes], ['resource-exhausted'])
    assert.equal(await soldOf('small'), 5)
    assert.equal(await countOrdersOf('small'), 5)
  })

  test('concurrent checkouts by one buyer respect the per-person limit (PARTY-5)', async () => {
    const account = await as('same@example.com')
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => createOrder(order([{ id: 'open', quantity: 1 }]), account)))
    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    assert.equal(succeeded, 4)
    assert.equal(await countOrdersOf('open'), 4)
    assert.equal(await soldOf('open'), 4)
  })

  test('lowering the stock below what was sold is refused; lowering it to the sales stops sales', async () => {
    for (let i = 0; i < 40; i++) await createOrder(order([{ id: 'open', quantity: 1 }]), await as(`early${i}@example.com`))
    const superAdmin = await as('root@example.com', { role: 'super_admin' })
    const save = (total: number) => call(superAdmin, 'PUT', '/admin/ticket-types', {
      types: TICKET_TYPES.map((type) => (type.id === 'open' ? { ...type, totalTicketQuantity: total } : type))
    })
    await ok(save(60))
    await sellOut('open', 'late')
    assert.equal(await soldOf('open'), 60)

    await rejects(ok(save(50)), { code: 'failed-precondition' })
    await ok(save(60))
    await rejects(createOrder(order([{ id: 'open', quantity: 1 }]), await as('after@example.com')), { code: 'resource-exhausted' })
    assert.equal(await soldOf('open'), 60)
  })

  test('limiting a type that sold unlimited never oversells', async () => {
    await setTypes({ open: { unlimitedStock: true, purchaseLimitPerPerson: null } })
    for (let i = 0; i < 30; i++) await createOrder(order([{ id: 'open', quantity: 1 }]), await as(`free${i}@example.com`))
    assert.equal(await soldOf('open'), 30)
    await setTypes({ open: { totalTicketQuantity: 50 } })
    await sellOut('open', 'capped')
    assert.equal(await soldOf('open'), 50)
  })

  test('a retried checkout returns its order even once the type sold out', async () => {
    await setTypes({ open: { totalTicketQuantity: 2 } })
    const payload = { ...order([{ id: 'open', quantity: 2 }]), requestId: 'req-soldout-0123456789' }
    const account = await as('retry@example.com')
    const first = await createOrder(payload, account)
    const second = await createOrder(payload, account)
    assert.equal(second.id, first.id)
  })

  test('a committed checkout can be recovered after the shop is closed', async () => {
    const payload = { ...order([{ id: 'open', quantity: 1 }]), requestId: 'req-closed-0123456789' }
    const account = await as('recover@example.com')
    const first = await createOrder(payload, account)
    await setShopOpenAt(new Date(Date.now() + HOUR))
    await setTypes({ open: { salesEndTime: iso(-1) } })

    const recovered = await createOrder(payload, account)
    assert.equal(recovered.status, 200)
    assert.equal(recovered.id, first.id)
    assert.equal(await soldOf('open'), 1)
    assert.equal((await createOrder({ requestId: payload.requestId }, account)).id, first.id)
    await rejects(createOrder(payload, await as('other@example.com')), { code: 'invalid-argument' })
  })

  test('an authoritative rejected request fences late retries even after stock returns', async () => {
    await setTypes({ open: { totalTicketQuantity: 1 } })
    await createOrder(order([{ id: 'open', quantity: 1 }]), await as('first@example.com'))
    const payload = { ...order([{ id: 'open', quantity: 1 }]), requestId: 'req-rejected-0123456789' }
    const pending = await as('pending@example.com')
    await rejects(createOrder(payload, pending), { code: 'resource-exhausted', checkoutRejected: true })
    const marker = await db.prepare('SELECT * FROM order_requests WHERE request_id = ?').bind(payload.requestId).first()
    assert.equal(marker!.status, 'rejected')
    assert.equal(marker!.user_id, pending.uid)

    await setTypes({ open: { totalTicketQuantity: 2 } })
    await rejects(createOrder(payload, pending), { code: 'resource-exhausted', checkoutRejected: true })
    await rejects(createOrder(payload, await as('other@example.com')), { code: 'invalid-argument', checkoutRejected: false })
    assert.equal(await soldOf('open'), 1)
    assert.deepEqual(await db.prepare('SELECT * FROM order_requests WHERE request_id = ?').bind(payload.requestId).first(), marker)
  })

  test('a rejection racing an in-flight checkout resolves one terminal outcome', async () => {
    const requestId = 'req-racing-0123456789'
    const account = await as('race-resolution@example.com')
    const results = await Promise.allSettled([
      createOrder({ ...order([{ id: 'open', quantity: 1 }]), requestId }, account),
      createOrder({ ...order([{ id: 'unknown', quantity: 1 }]), requestId }, account)
    ])
    const marker = (await db.prepare('SELECT * FROM order_requests WHERE request_id = ?').bind(requestId).first())!
    const orders = (await db.prepare('SELECT count(*) AS n FROM orders').first<number>('n'))!
    if (marker.status === 'rejected') {
      assert.equal(orders, 0)
      assert.ok(results.every((r) => r.status === 'rejected' && (r as PromiseRejectedResult).reason.details.checkoutRejected === true))
      assert.equal(await soldOf('open'), 0)
    } else {
      assert.equal(orders, 1)
      assert.ok(results.every((r) => r.status === 'fulfilled' && r.value.id === marker.order_id))
      assert.equal(await soldOf('open'), 1)
    }
    assert.equal(marker.user_id, account.uid)
  })

  test('replaying a cancelled checkout cannot recreate the deleted order', async () => {
    const account = await as('cancelled-retry@example.com')
    const payload = { ...order([{ id: 'open', quantity: 1 }]), requestId: 'req-cancelled-0123456789' }
    const first = await createOrder(payload, account)
    await deleteOrder(first.id)

    await rejects(createOrder(payload, account), { code: 'not-found', checkoutRejected: true })
    await rejects(createOrder(payload, await as('other@example.com')), { code: 'invalid-argument', checkoutRejected: false })
    assert.equal(await countOrdersOf('open'), 0)
    assert.equal(await soldOf('open'), 0)
    const fresh = await createOrder({ ...payload, requestId: 'req-new-intent-0123456789' }, account)
    assert.equal(fresh.status, 201)
    assert.notEqual(fresh.id, first.id)
    assert.equal(await soldOf('open'), 1)
  })

  test('many simultaneous buyers all get tickets while stock lasts', async () => {
    await setTypes({ open: { totalTicketQuantity: 1000 } })
    const accounts = await Promise.all(Array.from({ length: 60 }, (_, i) => as(`crowd${i}@example.com`)))
    const results = await Promise.allSettled(accounts.map((account) => createOrder(order([{ id: 'open', quantity: 2 }]), account)))
    expect(results.filter((r) => r.status === 'rejected')).toEqual([])
    assert.equal(await soldOf('open'), 120)
  })

  test('the per-person limit ignores email case', async () => {
    await createOrder(order([{ id: 'open', quantity: 4 }]), await as('Case@Example.com'))
    await rejects(createOrder(order([{ id: 'open', quantity: 1 }]), await as('case@example.com', { verified: true })), { code: 'failed-precondition' })
  })

  test('buyers see only their own orders; staff may open any single order', async () => {
    const owner = await as('owner@example.com')
    const { id } = await createOrder(order([{ id: 'open', quantity: 1 }]), owner)
    assert.equal((await ok(call(owner, 'GET', '/orders'))).orders.length, 1)
    assert.equal((await ok(call(await as('stranger@example.com'), 'GET', '/orders'))).orders.length, 0)
    assert.equal((await call(await as('stranger@example.com'), 'GET', `/orders/${id}`)).status, 404)
    assert.equal((await call(await as('door@example.com', { role: 'manager' }), 'GET', `/orders/${id}`)).status, 200)
    assert.equal((await call(anonymous, 'GET', `/orders/${id}`)).status, 401)
  })
})

describe('the checkout gate', () => {
  test('a rush is written in a few batches, and every loser is fenced', async () => {
    const accounts = await Promise.all(Array.from({ length: 40 }, (_, i) => as(`rush${i}@example.com`)))
    const results = await Promise.allSettled(accounts.map((account, i) =>
      createOrder({ ...order([{ id: 'small', quantity: 1 }]), requestId: `req-rush-${String(i).padStart(12, '0')}` }, account)))
    const won = results.filter((r) => r.status === 'fulfilled')
    const lost = results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason)
    assert.equal(won.length, 5)
    assert.ok(lost.every((error) => error.code === 'resource-exhausted' && error.details?.checkoutRejected === true))
    assert.equal(await soldOf('small'), 5)
    assert.equal(await countOrdersOf('small'), 5)
    const markers = await db.prepare(`SELECT count(*) AS n FROM order_requests WHERE status = 'rejected'`).first<number>('n')
    assert.equal(markers, 35)
    // orders written in one batch share its timestamp
    const batches = await db.prepare('SELECT count(DISTINCT created_at) AS n FROM orders').first<number>('n')
    assert.ok(batches! < 5, `expected the 5 orders in fewer batches, got ${batches}`)
  })

  test('simultaneous retries of one checkout get one order', async () => {
    const account = await as('twice@example.com')
    const payload = { ...order([{ id: 'open', quantity: 1 }]), requestId: 'req-twice-0123456789' }
    const [a, b] = await Promise.all([createOrder(payload, account), createOrder(payload, account)])
    assert.equal(a.id, b.id)
    assert.equal(await countOrdersOf('open'), 1)
    assert.equal(await soldOf('open'), 1)
  })

  test('stale counts in the gate never oversell: D1 has the last word', async () => {
    await setTypes({ open: { totalTicketQuantity: 10 } })
    await createOrder(order([{ id: 'open', quantity: 1 }]), await as('before@example.com'))
    // lowered behind the gate's back: it still believes 9 are left
    await db.prepare(`UPDATE ticket_types SET stock = 2 WHERE id = 'open'`).run()
    const accounts = await Promise.all(Array.from({ length: 6 }, (_, i) => as(`stale${i}@example.com`)))
    const results = await Promise.allSettled(accounts.map((account) => createOrder(order([{ id: 'open', quantity: 1 }]), account)))
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.ok(results.every((r) => r.status === 'fulfilled' || (r as PromiseRejectedResult).reason.code === 'resource-exhausted'))
    assert.equal(await soldOf('open'), 2)
    assert.equal(await countOrdersOf('open'), 2)
  })

  test('tickets given back by a deleted order are on sale again at once', async () => {
    await setTypes({ open: { totalTicketQuantity: 1 } })
    const { id } = await createOrder(order([{ id: 'open', quantity: 1 }]), await as('gives-back@example.com'))
    await rejects(createOrder(order([{ id: 'open', quantity: 1 }]), await as('waiting@example.com')), { code: 'resource-exhausted' })
    await deleteOrder(id)
    const again = await createOrder(order([{ id: 'open', quantity: 1 }]), await as('waiting@example.com'))
    assert.equal(again.status, 201)
    assert.equal(await soldOf('open'), 1)
  })
})

describe('deleting an order', () => {
  test('returns stock and the buyer allowance exactly once (PARTY-5)', async () => {
    const account = await as('a@example.com')
    const { id } = await createOrder(order([{ id: 'open', quantity: 3 }]), account)
    await deleteOrder(id)
    // a second delete finds no order and gives nothing back twice
    await rejects(deleteOrder(id), { code: 'not-found' })
    assert.equal(await soldOf('open'), 0)
    // the buyer can buy the full allowance again
    await createOrder(order([{ id: 'open', quantity: 4 }]), account)
    assert.equal(await soldOf('open'), 4)
  })

  test('concurrent deletes of one order release its tickets once', async () => {
    const { id } = await createOrder(order([{ id: 'open', quantity: 3 }]), await as('twice@example.com'))
    await createOrder(order([{ id: 'open', quantity: 2 }]), await as('keep@example.com'))
    await Promise.allSettled([deleteOrder(id), deleteOrder(id), deleteOrder(id)])
    assert.equal(await soldOf('open'), 2)
  })

  test('skips a confirmation email not yet sent', async () => {
    const { id } = await createOrder(order([{ id: 'open', quantity: 1 }]), await as('gone@example.com'))
    await deleteOrder(id)
    assert.equal(await db.prepare('SELECT status FROM mail_jobs WHERE order_id = ?').bind(id).first('status'), 'skipped')
  })
})
