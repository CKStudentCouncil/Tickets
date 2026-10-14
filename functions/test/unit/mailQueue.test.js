import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isExplicitMailRejection, notificationProgress } from '../../lib/mailQueueCore.js'

test('only a provider response proves explicit rejection; network errors remain uncertain', () => {
  assert.equal(isExplicitMailRejection({ $metadata: { httpStatusCode: 429 } }), true)
  assert.equal(isExplicitMailRejection({ $metadata: { httpStatusCode: 500 } }), false)
  assert.equal(isExplicitMailRejection({ $metadata: { httpStatusCode: 408 } }), false)
  assert.equal(isExplicitMailRejection({ code: 'ETIMEDOUT' }), false)
  assert.equal(isExplicitMailRejection({ $metadata: { httpStatusCode: 200 } }), false)
})

test('notification progress counts accepted buyers, excludes the council To recipient, and reports uncertainty', () => {
  assert.deepEqual(notificationProgress('job', 100, [
    { status: 'accepted', buyerCount: 49 }, { status: 'uncertain', buyerCount: 49 },
    { status: 'pending', buyerCount: 2 }
  ]), { jobId: 'job', status: 'uncertain', sentCount: 49, acceptedCount: 49, total: 100,
    failedCount: 0, uncertainCount: 49, pendingCount: 2, pendingEnqueueCount: 0 })
  assert.equal(notificationProgress('job', 49, [{ status: 'accepted', buyerCount: 49 }]).status, 'done')
  assert.equal(notificationProgress('job', 49, [{ status: 'failed', buyerCount: 49 }]).status, 'failed')
})
