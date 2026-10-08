import { after, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Timestamp } from 'firebase-admin/firestore'
import { PROJECT_ID, db, fft, functions } from './setup.js'
import { createMailQueue, MAIL_LEASE_MS, MAIL_MAX_ATTEMPTS } from '../../lib/mailQueueCore.js'
import { enqueueManualOrderResend } from '../../lib/mailQueue.js'

beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  assert.ok(response.ok)
})
after(() => fft.cleanup())

const payload = (kind = 'confirmation', extra = {}) => ({ kind, recipientCount: 1, buyerCount: 1, ...extra })
function harness({ send, store = db, buildMessage = async (job) => ({ kind: job.kind }), rate = 10 } = {}) {
  let clock = Date.now()
  const sent = []
  const queue = createMailQueue({ db: store, now: () => clock,
    sleep: async (ms) => { clock += ms }, recipientsPerSecond: () => rate,
    buildMessage, send: send || (async (message) => {
      sent.push({ at: clock, ...message })
      return { response: `ses-${sent.length}` }
    }) })
  return { queue, sent, advance: (ms) => { clock += ms } }
}

test('duplicate confirmation enqueue is atomic and confirmation/bulk/resend share persisted pacing', async () => {
  const h = harness()
  const orderRef = db.doc('orders/order1')
  await orderRef.set({ customerEmail: 'buyer@example.com' })
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    h.queue.enqueue('confirmation_order1', payload('confirmation', { orderId: 'order1' }), { orderRef })))
  assert.equal(results.filter((result) => result.created).length, 1)
  await h.queue.enqueue('notification_job1_0', payload('notification', { recipientCount: 50, buyerCount: 49 }))
  await h.queue.enqueue('resend_order1_action1', payload('resend'))
  await h.queue.runWorker()
  assert.equal(h.sent.length, 3)
  for (let i = 1; i < h.sent.length; i++) {
    const precedingRecipients = h.sent[i - 1].kind === 'notification' ? 50 : 1
    assert.ok(h.sent[i].at - h.sent[i - 1].at >= precedingRecipients / 10 * 1000)
  }
  const saved = (await orderRef.get()).data()
  assert.equal(saved.emailStatus, 'accepted')
  assert.match(saved.emailProviderMessageId, /^ses-/)
  const queued = (await db.doc('mailQueue/confirmation_order1').get()).data()
  assert.equal(queued.deliveryStatus, 'unconfirmed')
  await h.queue.runWorker()
  assert.equal(h.sent.length, 3, 'accepted jobs are not sent again')
})

test('overlapping scheduled workers share one Firestore lease', async () => {
  let release
  let entered
  const reached = new Promise((resolve) => { entered = resolve })
  const h = harness({ send: async () => {
    entered()
    await new Promise((resolve) => { release = resolve })
    return { response: 'ses-one' }
  } })
  await h.queue.enqueue('a', payload())
  const first = h.queue.runWorker()
  await reached
  assert.deepEqual(await h.queue.runWorker(), { status: 'busy', processed: 0 })
  release()
  await first
  assert.equal((await db.doc('mailQueue/a').get()).data().attempts, 1)
})

test('explicit SES rejections retry with bounded backoff; lost responses require review', async () => {
  let sends = 0
  const h = harness({ send: async () => {
    sends++
    throw Object.assign(new Error('SES throttled'), { $metadata: { httpStatusCode: 429 } })
  } })
  await h.queue.enqueue('rejected', payload())
  for (let attempt = 1; attempt <= MAIL_MAX_ATTEMPTS; attempt++) {
    await h.queue.runWorker()
    const job = (await db.doc('mailQueue/rejected').get()).data()
    assert.equal(job.attempts, attempt)
    if (attempt < MAIL_MAX_ATTEMPTS) {
      assert.equal(job.status, 'retry')
      assert.ok(job.availableAt.toMillis() > Date.now())
      h.advance(60_000 * 2 ** (attempt - 1))
    } else assert.equal(job.status, 'failed')
  }
  await h.queue.runWorker()
  assert.equal(sends, MAIL_MAX_ATTEMPTS)

  await db.doc('mailQueueControl/global').delete()
  const lost = harness({ send: async () => { throw new Error('socket disconnected after write') } })
  await lost.queue.enqueue('unknown', payload())
  await lost.queue.runWorker()
  assert.equal((await db.doc('mailQueue/unknown').get()).data().status, 'uncertain')
  assert.equal((await lost.queue.runWorker()).processed, 0)
})

test('generic SES server errors and request timeouts remain uncertain instead of automatic resend', async () => {
  for (const status of [500, 503, 408]) {
    const h = harness({ send: async () => {
      throw Object.assign(new Error('provider result unknown'), { $metadata: { httpStatusCode: status } })
    } })
    await h.queue.enqueue(`unknown-${status}`, payload())
    await h.queue.runWorker()
    assert.equal((await db.doc(`mailQueue/unknown-${status}`).get()).data().status, 'uncertain')
    assert.equal((await h.queue.runWorker()).processed, 0)
  }
})

test('a process crash after marking sending becomes uncertain rather than a duplicate send', async () => {
  const h = harness()
  await db.doc('mailQueue/crashed').set({ ...payload(), status: 'sending', attempts: 1,
    leaseUntil: Timestamp.fromMillis(Date.now() - MAIL_LEASE_MS), owner: 'dead-worker' })
  await h.queue.runWorker()
  assert.equal(h.sent.length, 0)
  assert.equal((await db.doc('mailQueue/crashed').get()).data().status, 'uncertain')
})

test('SES acceptance followed by checkpoint failure preserves message ID and stops automatic retries', async () => {
  let failed = false
  const store = {
    doc: (path) => db.doc(path), collection: (path) => db.collection(path),
    runTransaction: (callback) => db.runTransaction((tx) => callback({
      get: (...args) => tx.get(...args), create: (...args) => tx.create(...args),
      set: (...args) => tx.set(...args),
      update: (ref, patch) => {
        if (ref.path.startsWith('mailQueue/') && patch.status === 'accepted' && !failed) {
          failed = true
          throw new Error('simulated Firestore outage after SES accepted')
        }
        return tx.update(ref, patch)
      }
    }))
  }
  const h = harness({ store })
  await h.queue.enqueue('checkpoint', payload())
  await h.queue.runWorker()
  const saved = (await db.doc('mailQueue/checkpoint').get()).data()
  assert.equal(h.sent.length, 1)
  assert.equal(saved.status, 'uncertain')
  assert.equal(saved.providerMessageId, 'ses-1')
  assert.equal(saved.deliveryStatus, 'unconfirmed')
  await h.queue.runWorker()
  assert.equal(h.sent.length, 1)
})

test('deleted orders skip queued confirmation without contacting SES', async () => {
  const orderRef = db.doc('orders/deleted')
  await orderRef.set({ customerEmail: 'buyer@example.com' })
  const h = harness({ buildMessage: async (job) =>
    (await db.doc(`orders/${job.orderId}`).get()).exists ? { kind: job.kind } : null })
  await h.queue.enqueue('confirmation_deleted', payload('confirmation', { orderId: 'deleted' }), { orderRef })
  await orderRef.delete()
  await h.queue.runWorker()
  assert.equal(h.sent.length, 0)
  assert.equal((await db.doc('mailQueue/confirmation_deleted').get()).data().status, 'skipped')
})

test('campaign preparation paginates recipients into immutable batches; repeated sends resume one durable queue', async () => {
  const seed = db.batch()
  seed.set(db.doc('users/staff'), { role: 'manager' })
  for (let i = 0; i < 260; i++) seed.set(db.doc(`orders/order${String(i).padStart(4, '0')}`), {
    customerEmail: `buyer${i}@example.com`
  })
  await seed.commit()
  const context = { auth: { uid: 'staff' } }
  const prepare = fft.wrap(functions.prepareOrderNotification)
  const send = fft.wrap(functions.sendOrderNotification)
  const status = fft.wrap(functions.getOrderNotificationStatus)
  const prepared = await prepare({ type: 'custom', message: 'Test', school: 'all' }, context)
  assert.equal(prepared.total, 260, 'recipient 251 and later were not omitted')
  const ref = db.doc(`notificationJobs/${prepared.jobId}`)
  const campaign = (await ref.get()).data()
  assert.equal(campaign.total, 260)
  assert.equal(campaign.recipients, undefined, 'parent document never contains the entire recipient list')
  const frozen = await ref.collection('batches').get()
  assert.equal(frozen.size, 6)
  assert.equal(new Set(frozen.docs.flatMap((snap) => snap.data().recipients)).size, 260)
  assert.ok(frozen.docs.every((snap) => snap.data().recipients.length <= 49))

  await Promise.all([send({ jobId: prepared.jobId }, context), send({ jobId: prepared.jobId }, context)])
  let progress = await status({ jobId: prepared.jobId }, context)
  assert.equal(progress.status, 'queued')
  assert.equal(progress.pendingCount, 260)
  assert.equal(progress.pendingEnqueueCount, 0)
  assert.equal((await db.collection('mailQueue').get()).size, 6)
  await db.doc(`mailQueue/notification_${prepared.jobId}_245`).delete()
  assert.equal((await status({ jobId: prepared.jobId }, context)).pendingEnqueueCount, 15)
  await send({ jobId: prepared.jobId }, context)
  assert.equal((await db.collection('mailQueue').get()).size, 6, 'resume creates only missing durable batches')
  assert.equal((await status({ jobId: prepared.jobId }, context)).pendingEnqueueCount, 0)
  const h = harness()
  await h.queue.runWorker({ maxJobs: 1 })
  progress = await status({ jobId: prepared.jobId }, context)
  assert.equal(progress.status, 'partial')
  assert.equal(progress.acceptedCount, 49)
  await send({ jobId: prepared.jobId }, context)
  await h.queue.runWorker()
  progress = await status({ jobId: prepared.jobId }, context)
  assert.equal(progress.status, 'done')
  assert.equal(progress.acceptedCount, 260)
  assert.equal(h.sent.length, 6)
  await send({ jobId: prepared.jobId }, context)
  await h.queue.runWorker()
  assert.equal(h.sent.length, 6, 'resuming an accepted campaign cannot duplicate its batches')
  const one = (await db.collection('mailQueue').get()).docs[0]
  await one.ref.update({ status: 'uncertain' })
  progress = await status({ jobId: prepared.jobId }, context)
  assert.equal(progress.status, 'uncertain')
  assert.equal(progress.uncertainCount, 49)
})

test('manual resend action IDs prevent duplicates on callable retries while deliberate new actions remain distinct', async () => {
  const orderId = 'CKS20261105ABCDEFGH'
  const order = { customerEmail: 'buyer@example.com' }
  await db.doc(`orders/${orderId}`).set(order)
  const results = await Promise.all([
    enqueueManualOrderResend(orderId, order, 'staff', { requestId: 'deliberate-action-1' }),
    enqueueManualOrderResend(orderId, order, 'staff', { requestId: 'deliberate-action-1' })
  ])
  assert.equal(results[0].jobId, results[1].jobId)
  assert.equal((await db.collection('mailQueue').get()).size, 1)
  await enqueueManualOrderResend(orderId, order, 'staff', { requestId: 'deliberate-action-2' })
  assert.equal((await db.collection('mailQueue').get()).size, 2)
})
