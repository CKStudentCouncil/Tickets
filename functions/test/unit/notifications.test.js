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

test('payment / pickup notices skip orders that no longer need them', async () => {
  const { needsNotice } = await import('../../lib/notifications.js')
  const order = (fields) => ({ paid: false, delivered: false, ...fields })
  assert.equal(needsNotice(order({}), 'payment'), true)
  assert.equal(needsNotice(order({ paid: true }), 'payment'), false)
  assert.equal(needsNotice(order({ delivered: true }), 'pickup'), false)
  assert.equal(needsNotice(order({ paid: true }), 'pickup'), true)
  assert.equal(needsNotice(order({ paid: true }), 'both'), true)
  assert.equal(needsNotice(order({ paid: true, delivered: true }), 'both'), false)
  assert.equal(needsNotice(order({ paid: true, delivered: true }), 'custom'), true)
  assert.equal(needsNotice(order({ complimentary: true }), 'payment'), false)
  assert.equal(needsNotice(order({ complimentary: true }), 'pickup'), true)
  assert.equal(needsNotice(order({ complimentary: true, delivered: true }), 'pickup'), false)
})

test('the survey invitation goes to every buyer and 公關票 guest, under its own subject', async () => {
  const { needsNotice } = await import('../../lib/notifications.js')
  assert.equal(resolveSubject('survey', '舞會延期'), '【建中舞會購票系統】舞會滿意度調查')
  assert.equal(needsNotice({ paid: false, delivered: false }, 'survey'), true)
  assert.equal(needsNotice({ paid: true, delivered: true }, 'survey'), true)
  assert.equal(needsNotice({ complimentary: true }, 'survey'), true)
})

test('a survey notice is the party survey invitation, linking to /party-survey only', async () => {
  const { generateOrderNotificationHTML } = await import('../../templates/notification.js')
  const { generatePartySurveyInvitationHTML } = await import('../../templates/partySurvey.js')
  const { SITE_URL } = await import('../../lib/constants.js')
  const html = generateOrderNotificationHTML({ type: 'survey', message: '' })
  assert.equal(html, generatePartySurveyInvitationHTML())
  assert.ok(html.includes(`${SITE_URL}/party-survey`))
  assert.ok(!html.includes(`${SITE_URL}/survey"`))
})
