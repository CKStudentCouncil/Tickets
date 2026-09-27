import { test } from 'node:test'
import assert from 'node:assert/strict'

import { batchDelayMs, resolveSubject } from '../../lib/notifications.js'

test('pacing counts recipients, not messages (PARTY-17)', () => {
  // 49 BCC + 1 To at 14 recipients/s = 50/14 s
  assert.equal(batchDelayMs(50, 14), 3572)
  // ~3000 buyers => 62 batches => over 3.5 minutes, not ~4.5 seconds
  const batches = Math.ceil(3000 / 49)
  assert.ok(batches * batchDelayMs(50, 14) > 200_000)
  assert.equal(batchDelayMs(10, 0), 10_000) // never divide by zero
})

test('a leftover custom subject never replaces a payment / pickup subject (PARTY-22)', () => {
  assert.equal(resolveSubject('payment', '舞會延期'), '【建中舞會購票系統】繳費通知')
  assert.equal(resolveSubject('pickup', '舞會延期'), '【建中舞會購票系統】取票通知')
  assert.equal(resolveSubject('custom', '舞會延期'), '舞會延期')
  assert.equal(resolveSubject('custom', ''), '【建中舞會購票系統】通知')
})
