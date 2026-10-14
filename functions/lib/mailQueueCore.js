import { randomUUID } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'

export const MAIL_MAX_ATTEMPTS = 5
export const MAIL_LEASE_MS = 180_000
export const MAIL_SEND_TIMEOUT_MS = 20_000
const terminal = new Set(['accepted', 'failed', 'uncertain', 'skipped'])
const millis = (value) => value?.toMillis?.() ?? 0

export function batchDelayMs(recipientCount, recipientsPerSecond) {
  return Math.ceil((recipientCount / Math.max(1, recipientsPerSecond)) * 1000)
}

// Only an explicit provider rejection is safe to retry. A socket timeout,
// aborted request, lost response, or unknown error may follow acceptance.
export function isExplicitMailRejection(error) {
  const status = Number(error?.$metadata?.httpStatusCode)
  // A generic server error or request timeout does not establish whether SES
  // accepted before failing. Explicit client-side rejects/throttles do.
  return status >= 400 && status < 500 && status !== 408
}

export function notificationProgress(jobId, total, batches) {
  const count = (status) => batches.filter((batch) => batch.status === status)
    .reduce((sum, batch) => sum + batch.buyerCount, 0)
  const acceptedCount = count('accepted')
  const failedCount = count('failed') + count('skipped')
  const uncertainCount = count('uncertain')
  const pendingCount = Math.max(0, total - acceptedCount - failedCount - uncertainCount)
  const pendingEnqueueCount = Math.max(0, total - batches.reduce((sum, batch) => sum + batch.buyerCount, 0))
  const status = uncertainCount ? 'uncertain'
    : pendingCount ? (acceptedCount ? 'partial' : batches.some((b) => b.status === 'sending') ? 'sending' : 'queued')
      : failedCount ? 'failed' : 'done'
  return { jobId, status, sentCount: acceptedCount, acceptedCount, total, failedCount, uncertainCount, pendingCount, pendingEnqueueCount }
}

/** Firestore-backed queue, injected sender/clock so tests never contact SES.
 * mailQueue/{id}: pending/retry -> sending -> accepted/failed/uncertain/skipped.
 * mailQueueControl/global serializes EVERY mail source and reserves pacing.
 * A crashed sending job becomes uncertain after its lease; it is not resent.
 */
export function createMailQueue({ db, send, buildMessage, now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  recipientsPerSecond = () => 14, sendTimeoutMs = MAIL_SEND_TIMEOUT_MS }) {
  const controlRef = db.doc('mailQueueControl/global')
  const jobs = db.collection('mailQueue')

  async function enqueue(id, payload, { tx: externalTx, orderRef } = {}) {
    const ref = jobs.doc(id)
    const write = async (tx) => {
      const [existing, orderSnap] = await Promise.all([
        tx.get(ref), orderRef ? tx.get(orderRef) : Promise.resolve(null)
      ])
      if (existing.exists) {
        const status = ['pending', 'retry'].includes(existing.data().status) ? 'queued' : existing.data().status
        return { jobId: id, status, emailStatus: status, created: false }
      }
      if (orderRef && !orderSnap.exists) return { jobId: null, status: 'skipped', created: false }
      const job = { ...payload, status: 'pending', attempts: 0,
        availableAt: Timestamp.fromMillis(now()), createdAt: FieldValue.serverTimestamp() }
      tx.create(ref, job)
      if (orderRef) tx.update(orderRef, {
        emailStatus: 'queued', emailJobId: id, emailError: FieldValue.delete(),
        emailUpdatedAt: FieldValue.serverTimestamp()
      })
      return { jobId: id, status: 'queued', emailStatus: 'queued', created: true }
    }
    return externalTx ? write(externalTx) : db.runTransaction(write)
  }

  async function updateOrderInTransaction(tx, job, id, patch) {
    if (!job.orderId) return
    const ref = db.doc(`orders/${job.orderId}`)
    const snap = await tx.get(ref)
    // A prior confirmation must not overwrite a newer deliberate resend.
    if (snap.exists && snap.data().emailJobId === id) tx.update(ref, {
      emailStatus: patch.status, emailUpdatedAt: FieldValue.serverTimestamp(),
      emailError: patch.error || FieldValue.delete(),
      ...(patch.providerMessageId ? { emailProviderMessageId: patch.providerMessageId } : {})
    })
  }

  async function claimWorker(owner) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(controlRef)
      if (millis(snap.data()?.leaseUntil) > now()) return false
      tx.set(controlRef, { owner, leaseUntil: Timestamp.fromMillis(now() + MAIL_LEASE_MS) }, { merge: true })
      return true
    })
  }

  async function releaseWorker(owner) {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(controlRef)
      if (snap.data()?.owner === owner) tx.update(controlRef, {
        owner: FieldValue.delete(), leaseUntil: FieldValue.delete()
      })
    })
  }

  async function recoverInterrupted() {
    const stale = await jobs.where('leaseUntil', '<=', Timestamp.fromMillis(now())).limit(100).get()
    for (const snapshot of stale.docs) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(snapshot.ref)
        const job = snap.data()
        if (job?.status !== 'sending' || millis(job.leaseUntil) > now()) return
        const patch = { status: 'uncertain', error: 'Worker interrupted after send was reserved; review SES before any deliberate resend.' }
        await updateOrderInTransaction(tx, job, snap.id, patch)
        tx.update(snap.ref, { ...patch, leaseUntil: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp() })
      })
    }
  }

  async function claimMail(ref, owner, deadline) {
    return db.runTransaction(async (tx) => {
      const [control, snap] = await Promise.all([tx.get(controlRef), tx.get(ref)])
      const job = snap.data()
      if (control.data()?.owner !== owner || millis(control.data()?.leaseUntil) <= now()) return null
      if (!job || !['pending', 'retry'].includes(job.status) || millis(job.availableAt) > now()) return null
      const startAt = Math.max(now(), millis(control.data()?.nextSendAt))
      if (startAt + sendTimeoutMs + 1000 >= deadline) return null
      await updateOrderInTransaction(tx, job, ref.id, { status: 'sending' })
      // Reserve rate capacity before the external side effect, even on a crash.
      tx.update(controlRef, { leaseUntil: Timestamp.fromMillis(now() + MAIL_LEASE_MS),
        nextSendAt: Timestamp.fromMillis(startAt + batchDelayMs(job.recipientCount, recipientsPerSecond())) })
      tx.update(ref, { status: 'sending', attempts: job.attempts + 1, owner,
        sendStartedAt: Timestamp.fromMillis(startAt), leaseUntil: Timestamp.fromMillis(now() + MAIL_LEASE_MS),
        availableAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
      return { ...job, attempts: job.attempts + 1, startAt }
    })
  }

  async function checkpoint(ref, owner, job, patch) {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (snap.data()?.status !== 'sending' || snap.data()?.owner !== owner) return
      await updateOrderInTransaction(tx, job, ref.id, patch)
      tx.update(ref, { ...patch, owner: FieldValue.delete(), leaseUntil: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp() })
    })
  }

  async function runWorker({ budgetMs = 100_000, maxJobs = 2000 } = {}) {
    const owner = randomUUID()
    const deadline = now() + budgetMs
    if (!await claimWorker(owner)) return { status: 'busy', processed: 0 }
    let processed = 0
    try {
      await recoverInterrupted()
      while (processed < maxJobs && now() + sendTimeoutMs + 1000 < deadline) {
        // One-field query uses the automatic single-field index. Terminal and
        // in-flight documents have no availableAt and cannot block the queue.
        const candidates = await jobs.where('availableAt', '<=', Timestamp.fromMillis(now()))
          .orderBy('availableAt').limit(1).get()
        if (candidates.empty) break
        const ref = candidates.docs[0].ref
        const job = await claimMail(ref, owner, deadline)
        if (!job) break
        let message
        try { message = await buildMessage(job) } catch (error) {
          // No provider call has begun, so rendering/read failures can be
          // retried safely within the same bounded attempt policy.
          const retry = job.attempts < MAIL_MAX_ATTEMPTS
          await checkpoint(ref, owner, job, { status: retry ? 'retry' : 'failed', error: String(error.message).slice(0, 500),
            ...(retry ? { availableAt: Timestamp.fromMillis(now() + 60_000 * 2 ** (job.attempts - 1)) } : {}) })
          processed++
          continue
        }
        if (!message) {
          await checkpoint(ref, owner, job, { status: 'skipped', error: 'Order no longer exists or has no recipient.' })
          processed++
          continue
        }
        if (job.startAt > now()) await sleep(job.startAt - now())
        // Rendering or a slow Firestore read may have delayed the reservation.
        // Rebase the next slot to the actual send time so mail sources cannot
        // bunch together after a late start.
        await db.runTransaction(async (tx) => {
          const control = await tx.get(controlRef)
          if (control.data()?.owner !== owner || millis(control.data()?.leaseUntil) <= now()) throw new Error('Mail worker lease lost before send')
          tx.update(controlRef, { nextSendAt: Timestamp.fromMillis(Math.max(
            millis(control.data()?.nextSendAt), now() + batchDelayMs(job.recipientCount, recipientsPerSecond())
          )) })
        })
        let timeout
        let outcome
        try {
          const info = await Promise.race([
            send(message), new Promise((_, reject) => {
              timeout = setTimeout(() => reject(new Error('SES response timeout; acceptance is unknown.')), sendTimeoutMs)
            })
          ])
          // Nodemailer's SES response is the provider ID. An RFC Message-ID
          // generated locally is not evidence that SES accepted the message.
          const providerMessageId = String(info?.response || info?.providerMessageId || '')
          outcome = providerMessageId
            ? { status: 'accepted', providerMessageId, acceptedAt: FieldValue.serverTimestamp(), deliveryStatus: 'unconfirmed' }
            : { status: 'uncertain', error: 'Provider response omitted a message ID; review SES before resending.' }
        } catch (error) {
          const explicit = isExplicitMailRejection(error)
          const retry = explicit && job.attempts < MAIL_MAX_ATTEMPTS
          outcome = { status: retry ? 'retry' : explicit ? 'failed' : 'uncertain',
            error: String(error.message || error).slice(0, 500),
            ...(retry ? { availableAt: Timestamp.fromMillis(now() + 60_000 * 2 ** (job.attempts - 1)) } : {}) }
        } finally { clearTimeout(timeout) }
        try {
          await checkpoint(ref, owner, job, outcome)
        } catch (error) {
          // Never call send again because a successful external send was not
          // checkpointed. Recovery changes its durable sending marker to
          // uncertain. Preserve a known provider ID when Firestore returns.
          console.error('[mailQueue] checkpoint failed', ref.id, outcome.providerMessageId || '', error.message)
          try { await checkpoint(ref, owner, job, { status: 'uncertain',
            error: 'SES outcome could not be checkpointed reliably; staff review required.',
            ...(outcome.providerMessageId ? { providerMessageId: outcome.providerMessageId, deliveryStatus: 'unconfirmed' } : {}) }) }
          catch { /* The expired sending marker remains recoverable. */ }
        }
        processed++
      }
      return { status: 'finished', processed }
    } finally { await releaseWorker(owner) }
  }

  return { enqueue, runWorker, recoverInterrupted }
}

export const isTerminalMailStatus = (status) => terminal.has(status)
