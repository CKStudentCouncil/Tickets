// Staff tools and who may use them: the old orderActions emulator tests and
// the Firestore rules tests (tests/firestore.rules.test.js), as API calls.
import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'vitest'
import { activateInvite } from '../../src/server/auth'
import {
  HOUR, TICKET_TYPES, anonymous, as, call, createOrder, db, iso, ok, order, rejects, resetData, setShopOpenAt, setTypes, type Account
} from './helpers'

let orderId: string
let ticketCode: string
let manager1: Account, manager2: Account, admin: Account, superAdmin: Account, buyer: Account

beforeEach(async () => {
  await resetData()
  await setTypes()
  await setShopOpenAt(new Date(Date.now() - HOUR))
  manager1 = await as('manager1@example.com', { role: 'manager' })
  manager2 = await as('manager2@example.com', { role: 'manager' })
  admin = await as('admin@example.com', { role: 'admin' })
  superAdmin = await as('root@example.com', { role: 'super_admin' })
  buyer = await as('buyer@example.com')
  await db.prepare(`UPDATE user SET staffName = 'Administrator' WHERE id = ?`).bind(admin.uid).run()
  orderId = (await createOrder(order([{ id: 'open', quantity: 1 }]), buyer)).id
  ticketCode = (await db.prepare('SELECT ticket_code FROM orders WHERE id = ?').bind(orderId).first<string>('ticket_code'))!
})

const collect = (extra: Record<string, unknown> = {}) => ({ delivered: true, expectedDelivered: false, ticketCode, ...extra })
const deliver = (input: Record<string, unknown>, account: Account, id = orderId) => ok(call(account, 'POST', `/admin/orders/${id}/delivery`, input))
const pay = (input: Record<string, unknown>, account: Account) => ok(call(account, 'POST', `/admin/orders/${orderId}/payment`, input))
const history = async () => (await db.prepare('SELECT * FROM order_history WHERE order_id = ? ORDER BY id').bind(orderId).all()).results
const saved = async () => (await ok(call(admin, 'GET', `/orders/${orderId}`))).order

describe('check-in', () => {
  test('concurrent scans collect once and preserve the first actor and one audit record', async () => {
    const results = await Promise.allSettled([deliver(collect(), manager1), deliver(collect(), manager2)])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    const conflict = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason
    assert.equal(conflict.code, 'already-exists')

    const current = await saved()
    const events = await history()
    assert.equal(current.delivered, true)
    assert.equal(events.length, 1)
    assert.equal(events[0].actor_uid, current.deliveryUpdatedByUid)
    assert.equal(conflict.details.deliveryUpdatedByUid, current.deliveryUpdatedByUid)
    assert.equal(conflict.details.deliveryUpdatedAt, current.deliveryUpdatedAt)
    assert.equal(events[0].code_verification, 'verified')

    await rejects(deliver(collect(), admin), { code: 'already-exists' })
    assert.deepEqual(await saved(), current)
    assert.equal((await history()).length, 1)
  })

  test('manager needs a valid scanned code and cannot reset or override identity', async () => {
    for (const code of ['', 'wrong-code']) {
      await rejects(deliver(collect({ ticketCode: code, overrideReason: 'Claimed manual check' }), manager1), { code: 'permission-denied' })
    }
    assert.equal((await history()).length, 0)
    await deliver(collect(), manager1)
    await rejects(deliver({ delivered: false, expectedDelivered: true, overrideReason: 'Reset' }, manager1), { code: 'permission-denied' })
    assert.equal((await saved()).delivered, true)
  })

  test('admin override and reset require recorded reasons; forged staff metadata is ignored', async () => {
    await rejects(deliver(collect({ ticketCode: '' }), admin), { code: 'failed-precondition' })
    await rejects(deliver(collect({ ticketCode: '', overrideReason: 'x'.repeat(501) }), admin), { code: 'failed-precondition' })
    const result = await deliver(collect({
      ticketCode: 'wrong-code', overrideReason: '  Checked original ID  ',
      deliveryUpdatedByUid: 'forged', deliveryUpdatedByName: 'Forged Name', deliveryUpdatedAt: '2000-01-01'
    }), admin)
    assert.equal(result.deliveryUpdatedByUid, admin.uid)
    assert.equal(result.deliveryUpdatedByName, 'Administrator')
    assert.match(result.deliveryUpdatedAt, /^\d{4}-\d{2}-\d{2}T/)
    const [event] = await history()
    assert.equal(event.code_verification, 'admin_override')
    assert.equal(event.override_reason, 'Checked original ID')

    await rejects(deliver({ delivered: false, expectedDelivered: true }, admin), { code: 'failed-precondition' })
    await deliver({ delivered: false, expectedDelivered: true, overrideReason: 'Accidental collection corrected' }, admin)
    assert.equal((await saved()).delivered, false)
    assert.equal((await history()).length, 2)
  })

  test('rejects anonymous, nonstaff, missing orders and invalid states before any audit writes', async () => {
    await rejects(deliver(collect(), anonymous), { code: 'unauthenticated' })
    await rejects(deliver(collect(), buyer), { code: 'permission-denied' })
    await rejects(deliver(collect({ delivered: 'yes' }), manager1), { code: 'invalid-argument' })
    await rejects(deliver(collect({ expectedDelivered: undefined }), manager1), { code: 'invalid-argument' })
    await rejects(deliver(collect(), manager1, 'not-an-order'), { code: 'invalid-argument' })
    await rejects(deliver(collect(), manager1, 'CKS20261105XYZ234'), { code: 'not-found' })
    assert.equal((await history()).length, 0)
  })

  test('a revoked role stops working at once', async () => {
    await db.prepare('UPDATE user SET role = NULL WHERE id = ?').bind(manager1.uid).run()
    await rejects(deliver(collect(), manager1), { code: 'permission-denied' })
  })
})

describe('payment', () => {
  test('only admins can change payment, with canonical metadata and one audit record per transition', async () => {
    const input = { paid: true, expectedPaid: false, paymentUpdatedByName: 'Forged' }
    await rejects(pay(input, manager1), { code: 'permission-denied' })
    const result = await pay(input, admin)
    assert.equal(result.paid, true)
    assert.equal(result.paymentUpdatedByName, 'Administrator')
    assert.equal(result.paymentUpdatedByUid, admin.uid)
    assert.equal(result.paymentUpdatedAt, (await saved()).paymentUpdatedAt)
    await rejects(pay(input, admin), { code: 'failed-precondition' })
    assert.equal((await history()).length, 1)
    await pay({ paid: false, expectedPaid: true }, admin)
    assert.equal((await history()).length, 2)
  })
})

describe('permissions (the old Firestore rules)', () => {
  test('only admins list orders and their totals; managers read history', async () => {
    for (const account of [anonymous, buyer, manager1]) {
      assert.ok([401, 403].includes((await call(account, 'GET', '/admin/orders')).status))
      assert.ok([401, 403].includes((await call(account, 'GET', '/admin/orders/summary')).status))
    }
    const page = await ok(call(admin, 'GET', '/admin/orders?limit=10'))
    assert.equal(page.orders.length, 1)
    assert.equal(page.hasNext, false)
    const summary = await ok(call(admin, 'GET', '/admin/orders/summary'))
    assert.deepEqual(summary, { orderCount: 1, bookedAmount: 900, paidAmount: 0, deliveredOrderCount: 0 })
    assert.equal((await call(manager1, 'GET', `/admin/orders/${orderId}/history`)).status, 200)
    assert.equal((await call(buyer, 'GET', `/admin/orders/${orderId}/history`)).status, 403)
  })

  test('only admins delete orders and resend email', async () => {
    assert.equal((await call(manager1, 'DELETE', `/admin/orders/${orderId}`)).status, 403)
    assert.equal((await call(manager1, 'POST', `/admin/orders/${orderId}/resend`, {})).status, 403)
    const resent = await ok(call(admin, 'POST', `/admin/orders/${orderId}/resend`, { requestId: 'resend-0001' }))
    assert.equal(resent.status, 'queued')
    // a retry of the same resend action does not queue a second email
    const again = await ok(call(admin, 'POST', `/admin/orders/${orderId}/resend`, { requestId: 'resend-0001' }))
    assert.equal(again.created, false)
    assert.equal(await db.prepare(`SELECT count(*) AS n FROM mail_jobs WHERE id LIKE 'resend_%'`).first('n'), 1)
    assert.equal((await saved()).emailStatus, 'queued')
  })

  test('only super admins edit ticket types, the opening time, staff and content', async () => {
    const types = (await ok(call(superAdmin, 'GET', '/admin/ticket-types'))).types
    for (const account of [anonymous, buyer, manager1, admin]) {
      assert.ok([401, 403].includes((await call(account, 'PUT', '/admin/ticket-types', { types })).status))
      assert.ok([401, 403].includes((await call(account, 'PUT', '/admin/shop', { openAt: null })).status))
      assert.ok([401, 403].includes((await call(account, 'GET', '/admin/staff')).status))
      assert.ok([401, 403].includes((await call(account, 'GET', '/admin/content/stories')).status))
    }
    await ok(call(superAdmin, 'PUT', '/admin/ticket-types', { types }))
    const { openAt } = await ok(call(superAdmin, 'PUT', '/admin/shop', { openAt: '2026-11-05T12:00:00+08:00' }))
    assert.equal(openAt, '2026-11-05T04:00:00.000Z')
    assert.equal((await ok(call(anonymous, 'GET', '/public/shop'))).openAt, openAt)
  })

  test('visitors see only ticket types on sale; staff see them all', async () => {
    await setTypes({}, [...TICKET_TYPES, { id: 'ended', name: '已結束票', price: 1, salesStartTime: iso(-2 * HOUR), salesEndTime: iso(-HOUR), totalTicketQuantity: 5 }])
    const ids = async (account: Account) =>
      (await ok(call(account, 'GET', '/public/ticket-types'))).types.map((t: { id: string }) => t.id).sort()
    for (const account of [anonymous, buyer]) {
      assert.deepEqual(await ids(account), ['campus', 'open', 'small'])
    }
    assert.deepEqual(await ids(manager1), ['campus', 'ended', 'future', 'open', 'small'])

    for (const account of [anonymous, buyer, manager1, admin]) {
      assert.ok([401, 403].includes((await call(account, 'GET', '/admin/ticket-types')).status))
    }
    assert.equal((await ok(call(superAdmin, 'GET', '/admin/ticket-types'))).types.length, 5)
  })

  test('removing a ticket type keeps it while it has sales', async () => {
    const types = (await ok(call(superAdmin, 'GET', '/admin/ticket-types'))).types
    await ok(call(superAdmin, 'PUT', '/admin/ticket-types', { types: types.filter((t: { id: string }) => !['open', 'small'].includes(t.id)) }))
    const rows = (await db.prepare('SELECT id, active FROM ticket_types ORDER BY id').all()).results
    assert.deepEqual(rows, [{ id: 'campus', active: 1 }, { id: 'future', active: 1 }, { id: 'open', active: 0 }])
    assert.deepEqual((await ok(call(superAdmin, 'GET', '/admin/ticket-types'))).types.map((t: { id: string }) => t.id), ['campus', 'future'])
  })
})

describe('staff accounts', () => {
  test('an invite gives its role on the invitee’s first sign-in, once', async () => {
    await ok(call(superAdmin, 'POST', '/admin/staff/invites', { email: 'New.Staff@Example.com', name: '王小明', role: 'manager' }))
    const invitee = await as('new.staff@example.com')
    await activateInvite(db, invitee.uid)
    const me = (await ok(call(invitee, 'GET', '/me'))).user
    assert.equal(me.role, 'manager')
    assert.equal(me.name, '王小明')
    assert.equal(await db.prepare('SELECT count(*) AS n FROM staff_invites').first('n'), 0)
  })

  test('an unverified email does not consume an invite', async () => {
    await ok(call(superAdmin, 'POST', '/admin/staff/invites', { email: 'unverified@example.com', role: 'admin' }))
    const invitee = await as('unverified@example.com', { verified: false })
    await activateInvite(db, invitee.uid)
    assert.equal((await ok(call(invitee, 'GET', '/me'))).user.role, null)
    assert.equal(await db.prepare('SELECT count(*) AS n FROM staff_invites').first('n'), 1)
  })

  test('lists staff and invites; role changes and removal take effect at once', async () => {
    await ok(call(superAdmin, 'POST', '/admin/staff/invites', { email: 'later@example.com', role: 'admin' }))
    const { users } = await ok(call(superAdmin, 'GET', '/admin/staff'))
    assert.deepEqual(users.map((u: { email: string; pending: boolean }) => [u.email, u.pending]).sort(), [
      ['admin@example.com', false], ['later@example.com', true], ['manager1@example.com', false],
      ['manager2@example.com', false], ['root@example.com', false]
    ])
    await ok(call(superAdmin, 'PATCH', `/admin/staff/${manager1.uid}`, { role: 'admin', pending: false }))
    assert.equal((await call(manager1, 'GET', '/admin/orders')).status, 200)
    await ok(call(superAdmin, 'DELETE', `/admin/staff/${manager1.uid}`))
    assert.equal((await call(manager1, 'GET', '/me')).body.user, null, 'signed out everywhere')
    await rejects(ok(call(superAdmin, 'DELETE', `/admin/staff/${superAdmin.uid}`)), { code: 'failed-precondition' })
  })

  test('delete-all keeps every super admin', async () => {
    const { deleted } = await ok(call(superAdmin, 'POST', '/admin/staff/delete-all'))
    assert.equal(deleted, 3)
    assert.equal((await ok(call(superAdmin, 'GET', '/admin/staff'))).users.length, 1)
  })
})

describe('content and survey', () => {
  test('the public sees only published, enabled content', async () => {
    const story = (id: string, publishAt: string, enabled = true) =>
      ok(call(superAdmin, 'PUT', `/admin/content/stories/${id}`, { title: id, content: 'x', publishAt, enabled }))
    await story('past', iso(-HOUR))
    await story('future', iso(HOUR))
    await story('disabled', iso(-HOUR), false)
    await ok(call(superAdmin, 'PUT', '/admin/content/lineup/l1', { name: 'DJ', publishAt: iso(-HOUR) }))
    await ok(call(superAdmin, 'PUT', '/admin/content/lineup/l2', { name: 'Later', publishAt: iso(HOUR) }))

    assert.deepEqual((await ok(call(anonymous, 'GET', '/public/stories'))).items.map((s: { id: string }) => s.id), ['past'])
    assert.deepEqual((await ok(call(anonymous, 'GET', '/public/lineup'))).items.map((s: { id: string }) => s.id), ['l1'])
    assert.equal((await ok(call(superAdmin, 'GET', '/admin/content/stories'))).items.length, 3)
  })

  test('lineup images go to R2 and are served from /media', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    assert.equal((await call(admin, 'POST', '/admin/media/lineup/l1', { contentType: 'image/png', fileData: png })).status, 403)
    const uploaded = await ok(call(superAdmin, 'POST', '/admin/media/lineup/l1', { contentType: 'image/png', fileData: png }))
    assert.match(uploaded.storagePath, /^lineup\/l1\/\d+\.png$/)
    await ok(call(superAdmin, 'PUT', '/admin/content/lineup/l1', { name: 'DJ', publishAt: iso(-HOUR), imageStoragePath: uploaded.storagePath }))
    const [item] = (await ok(call(anonymous, 'GET', '/public/lineup'))).items
    assert.equal(item.imageUrl, `/media/${uploaded.storagePath}`)
    await rejects(ok(call(superAdmin, 'DELETE', '/admin/media', { storagePath: 'other/../secret' })), { code: 'invalid-argument' })
    await ok(call(superAdmin, 'DELETE', '/admin/media', { storagePath: uploaded.storagePath }))
  })

  const response = () => ({
    identity: '建國中學學生', channels: ['CK APP'], device: '手機',
    scores: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`q${i + 4}`, 5])),
    issueCount: '沒有遇到問題', issueTypes: [], improvement: '', suggestion: '很好'
  })

  test('anyone may answer the survey, only with listed options; managers read the results', async () => {
    assert.equal((await call(anonymous, 'POST', '/survey', response())).status, 201)
    for (const bad of [
      { ...response(), identity: '外星人' },
      { ...response(), channels: [] },
      { ...response(), scores: { ...response().scores, q4: 6 } },
      { ...response(), scores: { q4: 5 } },
      { ...response(), suggestion: 'x'.repeat(2001) },
      { ...response(), createdAt: '2000-01-01' }
    ]) {
      assert.equal((await call(anonymous, 'POST', '/survey', bad)).status, 400)
    }
    assert.equal((await call(buyer, 'GET', '/admin/survey')).status, 403)
    const { responses } = await ok(call(manager1, 'GET', '/admin/survey'))
    assert.equal(responses.length, 1)
    assert.equal(responses[0].suggestion, '很好')
  })
})
