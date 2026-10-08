import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldPollNotification, needsNotificationEnqueue, canClearNotification } from '../src/utils/notificationProgress.js'

test('an uncertain batch keeps polling while independent batches remain pending', () => {
  const partial = { status: 'uncertain', uncertainCount: 49, pendingCount: 50, pendingEnqueueCount: 0 }
  assert.equal(shouldPollNotification(partial), true)
  assert.equal(canClearNotification(partial), false)
  const terminal = { ...partial, pendingCount: 0 }
  assert.equal(shouldPollNotification(terminal), false)
  assert.equal(canClearNotification(terminal), true)
})

test('lost enqueue acknowledgement can resume missing batches after status becomes queued', () => {
  const interrupted = { status: 'queued', pendingCount: 100, pendingEnqueueCount: 51 }
  assert.equal(needsNotificationEnqueue(interrupted), true)
  assert.equal(shouldPollNotification(interrupted), true)
  assert.equal(needsNotificationEnqueue({ ...interrupted, pendingEnqueueCount: 0 }), false)
})

test('older saved jobs retain a safe same-campaign resume after interrupted enqueue', () => {
  assert.equal(needsNotificationEnqueue({ status: 'ready' }), true)
  assert.equal(needsNotificationEnqueue({ status: 'queued', enqueueUnconfirmed: true }), true)
  assert.equal(needsNotificationEnqueue({ status: 'done', pendingEnqueueCount: 0, enqueueUnconfirmed: true }), false)
  assert.equal(canClearNotification({ status: 'done', pendingCount: 0, pendingEnqueueCount: 0 }), true)
})
