// Runs the 公關票 callables (functions/lib/guests.js) against the Firestore
// emulator: `yarn test:emulator` (needs Java).
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { HOUR, PROJECT_ID, db, fft, functions, isEmulator } from './setup.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')

const callSend = fft.wrap(functions.sendGuestInvitation)
const callOfficerSend = fft.wrap(functions.sendOfficerTicket)
const callCreateInvite = fft.wrap(functions.createOfficerInvite)
const callRevokeInvite = fft.wrap(functions.revokeOfficerInvite)
const callClaimInvite = fft.wrap(functions.claimOfficerInvite)
const callRelease = fft.wrap(functions.releaseOfficerQuota)
const callPrepare = fft.wrap(functions.prepareOrderNotification)

const SUPER = { uid: 'super-uid', email: 'super@example.com' }
const ADMIN = { uid: 'admin-uid', email: 'admin@example.com' }
const OFFICER = { uid: 'officer-uid', email: 'Officer@Example.com' }
const OTHER_OFFICER = { uid: 'officer2-uid', email: 'officer2@example.com' }
const GUEST = { uid: 'guest-uid', email: 'Guest@Example.com' }
const STRANGER = { uid: 'stranger-uid', email: 'stranger@example.com' }
const as = ({ uid, email }, verified = true) => ({ auth: { uid, token: { email, email_verified: verified } } })

let requestCount = 0
const nextRequestId = () => `guest-request-${String(++requestCount).padStart(8, '0')}`
const send = (extra = {}) => ({
  requestId: nextRequestId(),
  name: '王大明',
  email: 'Alumni@Example.com',
  quantity: 1,
  ...extra
})
const invite = (quantity = 1) => ({ requestId: nextRequestId(), quantity })

const orderOf = async (id) => (await db.doc(`orders/${id}`).get()).data()
const officerOf = async (email = 'officer@example.com') => (await db.doc(`officers/${email}`).get()).data()
const inviteOf = async (id) => (await db.doc(`officerInvites/${id}`).get()).data()

// what deleting an order does: the trigger gets the deleted snapshot
async function deleteOrder(id) {
  const snap = await db.doc(`orders/${id}`).get()
  await db.doc(`orders/${id}`).delete()
  return () => callRelease(snap, { params: { orderId: id } })
}

after(() => fft.cleanup())

beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  assert.ok(response.ok)
  const batch = db.batch()
  batch.set(db.doc(`users/${SUPER.uid}`), { email: SUPER.email, role: 'super_admin' })
  batch.set(db.doc(`users/${ADMIN.uid}`), { email: ADMIN.email, role: 'admin' })
  batch.set(db.doc('settings/shop'), { openAt: new Date(Date.now() - HOUR) })
  batch.set(db.doc('officers/officer@example.com'), { email: 'officer@example.com', name: '林幹部', quota: 5, used: 0, createdAt: new Date() })
  batch.set(db.doc('officers/officer2@example.com'), { email: 'officer2@example.com', name: '張幹部', quota: 5, used: 0, createdAt: new Date() })
  await batch.commit()
})

describe('sendGuestInvitation (super admins, outside any quota)', () => {
  test('creates an NT$0 公關票 order for the guest, touching no stock', async () => {
    const { id } = await callSend(send({ quantity: 2 }), as(SUPER))

    assert.match(id, /^PR\d{8}/)
    const order = await orderOf(id)
    assert.equal(order.complimentary, true)
    assert.equal(order.customerName, '王大明')
    assert.equal(order.customerEmail, 'alumni@example.com')
    assert.equal(order.officerEmail, null)
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
    assert.equal((await officerOf()).used, 0)
  })

  test('a retried request returns the same ticket instead of a second one', async () => {
    const request = send()
    const first = await callSend(request, as(SUPER))
    const again = await callSend(request, as(SUPER))

    assert.equal(again.id, first.id)
    assert.equal((await db.collection('orders').get()).size, 1)
  })

  test('only super admins may send', async () => {
    await assert.rejects(callSend(send(), {}), { code: 'unauthenticated' })
    await assert.rejects(callSend(send(), as(ADMIN)), { code: 'permission-denied' })
    await assert.rejects(callSend(send(), as(OFFICER)), { code: 'permission-denied' })
    assert.equal((await db.collection('orders').get()).size, 0)
  })
})

describe('sendOfficerTicket', () => {
  test('sends from the officer\'s quota and names them on the ticket', async () => {
    const { id } = await callOfficerSend(send({ quantity: 2 }), as(OFFICER))

    const order = await orderOf(id)
    assert.equal(order.complimentary, true)
    assert.equal(order.customerEmail, 'alumni@example.com')
    assert.equal(order.officerEmail, 'officer@example.com')
    assert.equal(order.officerName, '林幹部')
    assert.equal(order.invitedByUid, OFFICER.uid)
    assert.equal(order.items[0].quantity, 2)
    assert.equal((await officerOf()).used, 2)
  })

  test('a retried request returns the same ticket and counts once', async () => {
    const request = send({ quantity: 2 })
    const first = await callOfficerSend(request, as(OFFICER))
    const again = await callOfficerSend(request, as(OFFICER))

    assert.equal(again.id, first.id)
    assert.equal((await db.collection('orders').get()).size, 1)
    assert.equal((await officerOf()).used, 2)
  })

  test('never goes over the quota', async () => {
    await callOfficerSend(send({ quantity: 4 }), as(OFFICER))
    await assert.rejects(callOfficerSend(send({ quantity: 2, email: 'b@example.com' }), as(OFFICER)), {
      code: 'failed-precondition',
      message: '額度只剩 1 張'
    })
    await callOfficerSend(send({ quantity: 1, email: 'b@example.com' }), as(OFFICER))
    await assert.rejects(callOfficerSend(send({ email: 'c@example.com' }), as(OFFICER)), { message: '額度已用完' })
    assert.equal((await officerOf()).used, 5)
  })

  test('simultaneous sends share the quota', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) => callOfficerSend(send({ quantity: 2, email: `g${i}@example.com` }), as(OFFICER)))
    )
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2)
    assert.equal((await officerOf()).used, 4)
  })

  test('an email that already has a 公關票 waits for a second yes', async () => {
    await callSend(send(), as(SUPER))

    await assert.rejects(callOfficerSend(send(), as(OFFICER)), (error) => {
      assert.equal(error.code, 'already-exists')
      assert.deepEqual(error.details, { duplicate: true })
      return true
    })
    assert.equal((await officerOf()).used, 0)

    const { id } = await callOfficerSend(send({ allowDuplicate: true }), as(OFFICER))
    assert.equal((await orderOf(id)).officerEmail, 'officer@example.com')
  })

  test('only officers may send', async () => {
    await assert.rejects(callOfficerSend(send(), {}), { code: 'unauthenticated' })
    await assert.rejects(callOfficerSend(send(), as(OFFICER, false)), { code: 'failed-precondition' })
    await assert.rejects(callOfficerSend(send(), as(STRANGER)), { code: 'permission-denied' })
    // super admins send through sendGuestInvitation
    await assert.rejects(callOfficerSend(send(), as(SUPER)), { code: 'permission-denied' })
    assert.equal((await db.collection('orders').get()).size, 0)
  })
})

describe('invite links', () => {
  test('a link holds its tickets from the quota until it is claimed', async () => {
    const { id } = await callCreateInvite(invite(3), as(OFFICER))

    assert.match(id, /^[A-Za-z0-9_-]{24}$/)
    const link = await inviteOf(id)
    assert.equal(link.status, 'open')
    assert.equal(link.quantity, 3)
    assert.equal(link.officerEmail, 'officer@example.com')
    assert.equal(link.officerName, '林幹部')
    assert.equal((await officerOf()).used, 3)
    await assert.rejects(callCreateInvite(invite(3), as(OFFICER)), { code: 'failed-precondition' })
  })

  test('a retried request returns the same link and holds once', async () => {
    const request = invite(2)
    const first = await callCreateInvite(request, as(OFFICER))
    const again = await callCreateInvite(request, as(OFFICER))

    assert.equal(again.id, first.id)
    assert.equal((await db.collection('officerInvites').get()).size, 1)
    assert.equal((await officerOf()).used, 2)
  })

  test('the guest claims it once, with their own account', async () => {
    const { id: inviteId } = await callCreateInvite(invite(2), as(OFFICER))
    const { id } = await callClaimInvite({ inviteId, name: ' 陳小華 ', email: 'ignored@example.com' }, as(GUEST))

    const order = await orderOf(id)
    assert.equal(order.customerName, '陳小華')
    assert.equal(order.customerEmail, 'guest@example.com')
    assert.equal(order.userId, GUEST.uid)
    assert.equal(order.officerEmail, 'officer@example.com')
    assert.equal(order.officerName, '林幹部')
    assert.equal(order.inviteId, inviteId)
    assert.equal(order.items[0].quantity, 2)

    const link = await inviteOf(inviteId)
    assert.equal(link.status, 'claimed')
    assert.equal(link.orderId, id)
    assert.equal(link.claimedByUid, GUEST.uid)
    // claiming takes nothing more from the quota
    assert.equal((await officerOf()).used, 2)

    // the same account gets the same ticket; anyone else is refused
    assert.equal((await callClaimInvite({ inviteId, name: '陳小華' }, as(GUEST))).id, id)
    await assert.rejects(callClaimInvite({ inviteId, name: '冒名' }, as(STRANGER)), { code: 'failed-precondition' })
    assert.equal((await db.collection('orders').get()).size, 1)
  })

  test('simultaneous claims create one ticket', async () => {
    const { id: inviteId } = await callCreateInvite(invite(1), as(OFFICER))
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) => callClaimInvite({ inviteId, name: '來賓' }, as({ uid: `guest${i}`, email: `g${i}@example.com` })))
    )
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal((await db.collection('orders').get()).size, 1)
  })

  test('revoking an open link gives its tickets back; a claimed one cannot be revoked', async () => {
    const open = await callCreateInvite(invite(2), as(OFFICER))
    const claimed = await callCreateInvite(invite(1), as(OFFICER))
    await callClaimInvite({ inviteId: claimed.id, name: '陳小華' }, as(GUEST))
    assert.equal((await officerOf()).used, 3)

    // not someone else's links
    await assert.rejects(callRevokeInvite({ inviteId: open.id }, as(OTHER_OFFICER)), { code: 'permission-denied' })

    assert.deepEqual(await callRevokeInvite({ inviteId: open.id }, as(OFFICER)), { revoked: true })
    assert.equal(await inviteOf(open.id), undefined)
    assert.equal((await officerOf()).used, 1)
    // again is a no-op, and the link no longer works
    assert.deepEqual(await callRevokeInvite({ inviteId: open.id }, as(OFFICER)), { revoked: false })
    assert.equal((await officerOf()).used, 1)
    await assert.rejects(callClaimInvite({ inviteId: open.id, name: '陳小華' }, as(GUEST)), { code: 'not-found' })

    await assert.rejects(callRevokeInvite({ inviteId: claimed.id }, as(OFFICER)), { code: 'failed-precondition' })
    assert.equal((await officerOf()).used, 1)
  })

  test('super admins may revoke any officer\'s link', async () => {
    const { id } = await callCreateInvite(invite(2), as(OFFICER))
    assert.deepEqual(await callRevokeInvite({ inviteId: id }, as(SUPER)), { revoked: true })
    assert.equal((await officerOf()).used, 0)
  })

  test('the links of an officer taken off the list stop working', async () => {
    const { id } = await callCreateInvite(invite(1), as(OFFICER))
    await db.doc('officers/officer@example.com').delete()

    await assert.rejects(callClaimInvite({ inviteId: id, name: '陳小華' }, as(GUEST)), { code: 'not-found' })
    await assert.rejects(callCreateInvite(invite(1), as(OFFICER)), { code: 'permission-denied' })
    assert.equal((await db.collection('orders').get()).size, 0)
  })

  test('unknown links and malformed claims are refused', async () => {
    await assert.rejects(callClaimInvite({ inviteId: 'A'.repeat(24), name: '陳小華' }, as(GUEST)), { code: 'not-found' })
    await assert.rejects(callClaimInvite({ inviteId: '../orders/x', name: '陳小華' }, as(GUEST)), { code: 'not-found' })
    const { id } = await callCreateInvite(invite(1), as(OFFICER))
    await assert.rejects(callClaimInvite({ inviteId: id, name: ' ' }, as(GUEST)), { code: 'invalid-argument' })
    await assert.rejects(callClaimInvite({ inviteId: id, name: '陳小華' }, {}), { code: 'unauthenticated' })
  })

  test('only officers make links', async () => {
    await assert.rejects(callCreateInvite(invite(), as(STRANGER)), { code: 'permission-denied' })
    await assert.rejects(callCreateInvite(invite(), as(SUPER)), { code: 'permission-denied' })
  })
})

describe('releaseOfficerQuota', () => {
  test('deleting an officer\'s ticket gives its tickets back, once', async () => {
    const { id } = await callOfficerSend(send({ quantity: 3 }), as(OFFICER))
    const release = await deleteOrder(id)
    await release()
    assert.equal((await officerOf()).used, 0)

    // a repeated delivery of the same deletion
    await callOfficerSend(send({ quantity: 2, email: 'b@example.com' }), as(OFFICER))
    await release()
    assert.equal((await officerOf()).used, 2)
  })

  test('a claimed link\'s ticket goes back to the officer who made it', async () => {
    const { id: inviteId } = await callCreateInvite(invite(2), as(OFFICER))
    const { id } = await callClaimInvite({ inviteId, name: '陳小華' }, as(GUEST))
    await (await deleteOrder(id))()
    assert.equal((await officerOf()).used, 0)
  })

  test('tickets a super admin sent, and those of an officer since removed, change nothing', async () => {
    const direct = await callSend(send(), as(SUPER))
    await (await deleteOrder(direct.id))()

    const { id } = await callOfficerSend(send({ email: 'b@example.com' }), as(OFFICER))
    await db.doc('officers/officer@example.com').delete()
    await (await deleteOrder(id))()
    assert.equal(await officerOf(), undefined)
    assert.equal((await officerOf('officer2@example.com')).used, 0)
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

  test('the party survey goes to buyers and guests, only while that year is open', async () => {
    await callSend(send(), as(SUPER))
    await db.doc('orders/O20261026AAAAAA').set({ customerEmail: 'buyer@example.com', school: '其他學校或社會人士', paid: true, delivered: true })

    await assert.rejects(callPrepare({ type: 'survey', year: 2026 }, as(ADMIN)), { code: 'failed-precondition' })
    await db.doc('partySurveys/2026').set({ year: 2026, open: false, sections: [] })
    await assert.rejects(callPrepare({ type: 'survey', year: 2026 }, as(ADMIN)), { code: 'failed-precondition' })
    await assert.rejects(callPrepare({ type: 'survey' }, as(ADMIN)), { code: 'invalid-argument' })

    await db.doc('partySurveys/2026').set({ year: 2026, open: true, sections: [] })
    const survey = await callPrepare({ type: 'survey', year: 2026 }, as(ADMIN))
    assert.deepEqual(await recipientsOf(survey.jobId), ['alumni@example.com', 'buyer@example.com'])
    assert.equal((await db.doc(`notificationJobs/${survey.jobId}`).get()).data().subject, '【建中舞會購票系統】舞會滿意度調查')
  })
})
