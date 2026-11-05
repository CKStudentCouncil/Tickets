// 取消訂單與退款 and the notices recorded on orders, against the Firestore
// emulator: `yarn test:emulator` (needs Java).
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { Timestamp } from 'firebase-admin/firestore'

import { HOUR, PROJECT_ID, db, fft, functions, iso, soldOf, isEmulator } from './setup.js'
import { getTaiwanYear } from '../../lib/time.js'
import { createMailQueue } from '../../lib/mailQueueCore.js'
import { buildMessage, enqueueOrderConfirmation } from '../../lib/mailQueue.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')

const callCancel = fft.wrap(functions.cancelOrders)
const callRefund = fft.wrap(functions.updateRefundStatus)
const callRelease = fft.wrap(functions.releaseOrderStock)
const callRecord = fft.wrap(functions.recordOrderNotices)
const prepare = fft.wrap(functions.prepareOrderNotification)
const send = fft.wrap(functions.sendOrderNotification)
const wrappedCreate = fft.wrap(functions.createOrder)
const callCreate = (data, context = {}) => wrappedCreate({ data, ...context })

const TICKET_TYPES = [
  { id: 'open', name: '一階票', price: 900, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 300, purchaseLimitPerPerson: 4 }
]
const as = (uid, email = `${uid}@example.com`) => ({ auth: { uid, token: { email, email_verified: true, name: 'Token Name' } } })
const SUPER = as('super')
const buy = (email, quantity = 1) => callCreate({
  orderPayload: { customerName: '測試', customerPhone: '0900000000', school: '北一女中', class: '101', number: '1', items: [{ id: 'open', quantity }] }
}, as(`uid-${email}`, email))
const orderOf = async (id) => (await db.doc(`orders/${id}`).get()).data()
const cancelledOf = async (id) => (await db.doc(`cancelledOrders/${id}`).get()).data()
const notices = (...types) => Object.fromEntries(types.map((type, i) => [`job${i}`, { type, at: Timestamp.now() }]))

after(() => fft.cleanup())
beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  assert.ok(response.ok)
  const batch = db.batch()
  batch.set(db.doc('settings/ticketTypes'), { types: TICKET_TYPES })
  batch.set(db.doc('settings/shop'), { openAt: new Date(Date.now() - HOUR) })
  batch.set(db.doc('users/admin'), { role: 'admin', name: '管理員' })
  batch.set(db.doc('users/super'), { role: 'super_admin', name: '總召' })
  batch.set(db.doc('users/dev'), { role: 'developer', name: '開發者' })
  batch.set(db.doc('users/manager'), { role: 'manager', name: '門口' })
  await batch.commit()
})

describe('cancelOrders', () => {
  test('moves the order to cancelledOrders with who, why and when; its tickets come back', async () => {
    const { id } = await buy('a@example.com', 3)
    assert.equal(await soldOf('open'), 3)
    const before = await db.doc(`orders/${id}`).get()

    const result = await callCancel({ orderIds: [id], reason: 'buyer_request', note: '改天再買' }, SUPER)
    assert.deepEqual(result, { results: [{ orderId: id, status: 'cancelled', refundAmount: 0, emailQueued: true }], cancelledCount: 1 })
    assert.equal(await orderOf(id), undefined)

    const cancelled = await cancelledOf(id)
    assert.equal(cancelled.customerEmail, 'a@example.com')
    assert.equal(cancelled.userId, before.data().userId)
    assert.equal(cancelled.cancelReason, 'buyer_request')
    assert.equal(cancelled.cancelNote, '改天再買')
    assert.equal(cancelled.cancelledByName, '總召')
    assert.equal(cancelled.cancelledByUid, 'super')
    assert.equal(cancelled.cancelYear, getTaiwanYear())
    assert.equal(cancelled.refundStatus, 'none')
    assert.ok(cancelled.cancelledAt)

    // the deletion trigger gives the stock and the allowance back
    await callRelease(before, { params: { orderId: id }, eventId: 'cancel-a' })
    assert.equal(await soldOf('open'), 0)
    await assert.doesNotReject(buy('a@example.com', 4))

    // cancelling again reports it as already done
    const again = await callCancel({ orderIds: [id], reason: 'buyer_request' }, SUPER)
    assert.equal(again.results[0].status, 'already')
    assert.equal(again.cancelledCount, 0)
  })

  test('only super admins and developers cancel', async () => {
    const { id } = await buy('b@example.com')
    for (const who of ['manager', 'admin']) {
      await assert.rejects(callCancel({ orderIds: [id], reason: 'buyer_request' }, as(who)), { code: 'permission-denied' })
    }
    await assert.rejects(callCancel({ orderIds: [id], reason: 'buyer_request' }, {}), { code: 'unauthenticated' })
    assert.ok(await orderOf(id))
    const result = await callCancel({ orderIds: [id], reason: 'buyer_request' }, as('dev'))
    assert.equal(result.cancelledCount, 1)
  })

  test('a paid order records what is owed back; the refund is marked with the state the admin saw', async () => {
    const { id } = await buy('c@example.com', 2)
    await db.doc(`orders/${id}`).update({ paid: true })

    const missing = await callCancel({ orderIds: [id], reason: 'buyer_request' }, SUPER)
    assert.equal(missing.results[0].status, 'skipped')
    assert.match(missing.results[0].message, /退款方式/)
    const tooMuch = await callCancel({ orderIds: [id], reason: 'buyer_request', refund: 1801 }, SUPER)
    assert.equal(tooMuch.results[0].status, 'skipped')
    assert.ok(await orderOf(id))

    const result = await callCancel({ orderIds: [id], reason: 'buyer_request', refund: 'full' }, SUPER)
    assert.equal(result.results[0].refundAmount, 1800)
    assert.equal((await cancelledOf(id)).refundStatus, 'pending')

    for (const who of ['manager', 'admin']) {
      await assert.rejects(callRefund({ orderId: id, refunded: true, expectedRefunded: false }, as(who)), { code: 'permission-denied' })
    }
    const done = await callRefund({ orderId: id, refunded: true, expectedRefunded: false }, SUPER)
    assert.equal(done.refundStatus, 'done')
    assert.equal(done.refundedByName, '總召')
    await assert.rejects(callRefund({ orderId: id, refunded: true, expectedRefunded: false }, SUPER), { code: 'failed-precondition' })

    const undone = await callRefund({ orderId: id, refunded: false, expectedRefunded: true }, SUPER)
    assert.equal(undone.refundStatus, 'pending')
    const saved = await cancelledOf(id)
    assert.equal(saved.refundStatus, 'pending')
    assert.equal(saved.refundedAt, undefined)
  })

  test('nothing to refund cannot be marked refunded', async () => {
    const { id } = await buy('d@example.com')
    await db.doc(`orders/${id}`).update({ paid: true })
    await callCancel({ orderIds: [id], reason: 'violation', note: '黃牛加價轉售', refund: 'none' }, SUPER)
    assert.equal((await cancelledOf(id)).refundStatus, 'none')
    await assert.rejects(callRefund({ orderId: id, refunded: true, expectedRefunded: false }, SUPER), { code: 'failed-precondition' })
  })

  test('逾期 reasons are checked against the order in the transaction; one refusal does not stop the rest', async () => {
    const ids = []
    for (const email of ['e1@example.com', 'e2@example.com', 'e3@example.com', 'e4@example.com']) ids.push((await buy(email)).id)
    const [enough, tooFew, collected, paid] = ids
    await db.doc(`orders/${enough}`).update({ notices: notices('pickup', 'both', 'pickup') })
    await db.doc(`orders/${tooFew}`).update({ notices: notices('pickup', 'pickup') })
    await db.doc(`orders/${collected}`).update({ delivered: true, notices: notices('pickup', 'pickup', 'pickup') })
    await db.doc(`orders/${paid}`).update({ paid: true, notices: notices('pickup', 'pickup', 'pickup') })

    const result = await callCancel({ orderIds: ids, reason: 'uncollected', refund: 'none' }, SUPER)
    const byId = Object.fromEntries(result.results.map((item) => [item.orderId, item]))
    assert.equal(result.cancelledCount, 2)
    assert.equal(byId[enough].status, 'cancelled')
    assert.equal(byId[paid].status, 'cancelled')
    assert.equal(byId[paid].refundAmount, 0)
    assert.equal(byId[tooFew].status, 'skipped')
    assert.match(byId[tooFew].message, /2 次/)
    assert.equal(byId[collected].status, 'skipped')
    assert.ok(await orderOf(tooFew))
    assert.ok(await orderOf(collected))
    // the notices go along with the cancelled order
    assert.equal(Object.keys((await cancelledOf(enough)).notices).length, 3)
  })

  test('公關票 are deleted, not cancelled', async () => {
    const id = 'PR20261105ABC234'
    await db.doc(`orders/${id}`).set({ complimentary: true, paid: true, delivered: false, finalTotal: 0, items: [] })
    const result = await callCancel({ orderIds: [id], reason: 'other', note: 'x' }, SUPER)
    assert.equal(result.results[0].status, 'skipped')
    assert.ok(await orderOf(id))
  })
})

describe('訂單取消通知', () => {
  const worker = () => {
    const sent = []
    let clock = Date.now()
    const queue = createMailQueue({ db, buildMessage, now: () => clock, sleep: async (ms) => { clock += ms },
      send: async (message) => { sent.push(message); return { response: `ses-${sent.length}` } } })
    return { queue, sent }
  }

  test('is queued with the cancellation and sent to the buyer; the outcome is kept on the cancelled order', async () => {
    const { id } = await buy('mail@example.com', 2)
    await db.doc(`orders/${id}`).update({ paid: true })
    // what sendOrderQRCode does when the order is created
    await enqueueOrderConfirmation(id, await orderOf(id))
    await callCancel({ orderIds: [id], reason: 'buyer_request', refund: 'full' }, SUPER)

    const job = (await db.doc(`mailQueue/cancellation_${id}`).get()).data()
    assert.equal(job.kind, 'cancellation')
    assert.equal(job.cancelledOrderId, id)
    let cancelled = await cancelledOf(id)
    assert.equal(cancelled.cancelEmailJobId, `cancellation_${id}`)
    assert.equal(cancelled.cancelEmailStatus, 'queued')
    // the order's own confirmation fields are left as they were
    assert.equal(cancelled.emailJobId, `confirmation_${id}`)

    const { queue, sent } = worker()
    await queue.runWorker()
    // the confirmation of the order, now gone, is skipped; only the notice goes
    assert.equal(sent.length, 1)
    assert.equal(sent[0].to, 'mail@example.com')
    assert.match(sent[0].subject, /訂單取消通知/)
    assert.match(sent[0].html, /退款金額/)
    cancelled = await cancelledOf(id)
    assert.equal(cancelled.cancelEmailStatus, 'accepted')
    assert.equal(cancelled.cancelEmailProviderMessageId, 'ses-1')
    assert.equal((await db.doc(`mailQueue/confirmation_${id}`).get()).data().status, 'skipped')
  })

  test('is not sent when turned off', async () => {
    const { id } = await buy('quiet@example.com')
    const result = await callCancel({ orderIds: [id], reason: 'other', note: '重複下單', notify: false }, SUPER)
    assert.equal(result.results[0].emailQueued, false)
    assert.equal((await db.doc(`mailQueue/cancellation_${id}`).get()).exists, false)
    assert.equal((await cancelledOf(id)).cancelEmailStatus, 'skipped')
  })
})

describe('notices recorded on orders', () => {
  test('a pickup notice records its order ids per batch; only an accepted batch stamps the orders', async () => {
    const a = await buy('n1@example.com')
    const b = await buy('n1@example.com')
    const c = await buy('n2@example.com')
    await db.doc(`orders/${c.id}`).update({ delivered: true })

    const prepared = await prepare({ type: 'pickup', pickupTime: '11/20 中午', location: '川堂' }, as('manager'))
    assert.equal(prepared.total, 1, 'one email for both of its orders; the collected order is left out')
    const [batch] = (await db.collection(`notificationJobs/${prepared.jobId}/batches`).get()).docs
    assert.deepEqual(batch.data().orderIds.sort(), [a.id, b.id].sort())

    await send({ jobId: prepared.jobId }, as('manager'))
    const mailRef = db.doc(`mailQueue/notification_${prepared.jobId}_0`)
    const queued = await mailRef.get()
    assert.deepEqual(queued.data().orderIds.sort(), [a.id, b.id].sort())

    // pending -> sending: nothing recorded yet
    await mailRef.update({ status: 'sending' })
    const sending = await mailRef.get()
    await callRecord(fft.makeChange(queued, sending), { params: { mailId: mailRef.id } })
    assert.equal((await orderOf(a.id)).notices, undefined)

    // b is cancelled before the mail is accepted: skipped, not recreated
    await callCancel({ orderIds: [b.id], reason: 'buyer_request' }, SUPER)
    await mailRef.update({ status: 'accepted', acceptedAt: Timestamp.now() })
    const accepted = await mailRef.get()
    await callRecord(fft.makeChange(sending, accepted), { params: { mailId: mailRef.id } })
    await callRecord(fft.makeChange(sending, accepted), { params: { mailId: mailRef.id } })

    const stamped = (await orderOf(a.id)).notices
    assert.deepEqual(Object.keys(stamped), [prepared.jobId])
    assert.equal(stamped[prepared.jobId].type, 'pickup')
    assert.ok(stamped[prepared.jobId].at instanceof Timestamp)
    assert.equal(await orderOf(b.id), undefined)
    assert.equal((await orderOf(c.id)).notices, undefined)
  })

  test('custom notices carry no order ids and stamp nothing', async () => {
    const a = await buy('m1@example.com')
    const prepared = await prepare({ type: 'custom', message: '舞會資訊' }, as('manager'))
    const [batch] = (await db.collection(`notificationJobs/${prepared.jobId}/batches`).get()).docs
    assert.equal(batch.data().orderIds, undefined)
    await send({ jobId: prepared.jobId }, as('manager'))
    const mailRef = db.doc(`mailQueue/notification_${prepared.jobId}_0`)
    const queued = await mailRef.get()
    await mailRef.update({ status: 'accepted' })
    await callRecord(fft.makeChange(queued, await mailRef.get()), { params: { mailId: mailRef.id } })
    assert.equal((await orderOf(a.id)).notices, undefined)
  })
})
