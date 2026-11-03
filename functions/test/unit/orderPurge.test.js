import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_PURGE_ORDERS,
  PURGE_CONFIRM_PHRASE,
  archiveYearOf,
  planPurgeCommits,
  purgeWriteKeys,
  sanitizePurgeInput
} from '../../lib/orderPurge.js'

const PURGE_ID = 'purge-request-00000001'
const input = (extra) => ({ purgeId: PURGE_ID, confirm: PURGE_CONFIRM_PHRASE, orderIds: ['CKS20261105K7Q2MX'], ...extra })
const rejects = (data) => assert.throws(() => sanitizePurgeInput(data), { code: 'invalid-argument' })

test('a purge needs the exact confirmation phrase and a request id', () => {
  rejects(input({ confirm: undefined }))
  rejects(input({ confirm: 'delete all orders' }))
  rejects(input({ confirm: ` ${PURGE_CONFIRM_PHRASE}` }))
  rejects(input({ purgeId: 'short' }))
  rejects(input({ purgeId: 'has/slash-0000000000' }))
  rejects(null)
})

test('order ids must be document ids; duplicates collapse; resuming sends none', () => {
  for (const orderIds of [[], 'CKS20261105K7Q2MX', [''], ['orders/x'], ['.'], ['__name__'], [42], ['x'.repeat(201)]]) {
    rejects(input({ orderIds }))
  }
  // hand-made and legacy ids do not all follow ORDER_ID_PATTERN
  assert.deepEqual(sanitizePurgeInput(input({ orderIds: ['A', 'B', 'A', 'test-order'] })).orderIds, ['A', 'B', 'test-order'])
  assert.deepEqual(sanitizePurgeInput(input({ orderIds: undefined })), { purgeId: PURGE_ID, orderIds: null })
  rejects(input({ orderIds: Array.from({ length: MAX_PURGE_ORDERS + 1 }, (_, i) => `O${i}`) }))
})

test('orders are archived under the Taiwan year they were placed in', () => {
  const at = (iso) => ({ createdAt: { toDate: () => new Date(iso) } })
  assert.equal(archiveYearOf(at('2025-12-31T16:00:00Z'), 1999), 2026)
  assert.equal(archiveYearOf(at('2025-12-31T15:59:59Z'), 1999), 2025)
  assert.equal(archiveYearOf({}, 1999), 1999)
  assert.equal(archiveYearOf(null, 1999), 1999)
})

test('delete transactions stay under the write limit, counting shared counters once', () => {
  const order = (i, extra = {}) => ({
    id: `O${i}`,
    order: {
      stockCounted: true, customerEmail: `buyer${i}@example.com`,
      items: [{ id: 'open', quantity: 1 }], stockShards: { open: { [i % 20]: 1 } }, ...extra
    }
  })

  // archived copy, order, marker, buyer, the type's legacy counter and one shard
  assert.deepEqual(purgeWriteKeys('O1', order(1).order).length, 6)
  // uncounted orders only lose the order and its copy; missing ones at most the copy
  assert.deepEqual(purgeWriteKeys('O2', { items: [{ id: 'open', quantity: 1 }] }), ['copy/O2', 'order/O2'])
  assert.deepEqual(purgeWriteKeys('O3', null), ['copy/O3'])

  const entries = Array.from({ length: 250 }, (_, i) => order(i))
  const commits = planPurgeCommits(entries, 450, 1000)
  // 4 writes per order plus 21 shared counters: 107 orders fit in 449 writes
  assert.deepEqual(commits.map((ids) => ids.length), [107, 107, 36])
  assert.deepEqual(commits.flat(), entries.map(({ id }) => id))

  assert.deepEqual(planPurgeCommits(entries.slice(0, 5), 450, 2).map((ids) => ids.length), [2, 2, 1])
  // a single order is never split, even above the limit
  assert.deepEqual(planPurgeCommits([order(0)], 3), [['O0']])
  assert.deepEqual(planPurgeCommits([]), [])
})
