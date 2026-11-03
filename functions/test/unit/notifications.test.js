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

test('recipient filters narrow by school, ticket type, status, 公關票 and order date', async () => {
  const { readRecipientFilters, matchesRecipientFilters } = await import('../../lib/notifications.js')
  const at = (iso) => ({ toMillis: () => new Date(iso).getTime() })
  const order = (fields) => ({
    school: '北一女中', paid: false, delivered: false, createdAt: at('2026-10-20T12:00:00+08:00'),
    items: [{ id: 'early', ticketTypeId: 'early', quantity: 2 }], ...fields
  })
  const guest = order({ school: '公關票', complimentary: true, paid: true, items: [{ id: 'guest', quantity: 1 }] })
  const custom = (filters) => readRecipientFilters({ type: 'custom', filters }, 'custom')

  const all = custom({})
  assert.deepEqual(all, { schools: [], ticketTypeIds: [], paid: 'any', delivered: 'any', complimentary: 'include', createdFrom: '', createdTo: '' })
  assert.equal(matchesRecipientFilters(order({}), all), true)
  assert.equal(matchesRecipientFilters(guest, all), true)

  const schools = custom({ schools: ['北一女中', '中山女高'] })
  assert.equal(matchesRecipientFilters(order({}), schools), true)
  assert.equal(matchesRecipientFilters(order({ school: '建國中學' }), schools), false)
  assert.equal(matchesRecipientFilters(guest, schools), false)

  const types = custom({ ticketTypeIds: ['early', 'vip'] })
  assert.equal(matchesRecipientFilters(order({}), types), true)
  assert.equal(matchesRecipientFilters(order({ items: [{ id: 'normal', quantity: 1 }] }), types), false)
  assert.equal(matchesRecipientFilters(order({ items: [{ id: 'vip', quantity: 0 }] }), types), false)

  assert.equal(matchesRecipientFilters(order({ paid: true }), custom({ paid: 'unpaid' })), false)
  assert.equal(matchesRecipientFilters(order({ paid: true }), custom({ paid: 'paid' })), true)
  assert.equal(matchesRecipientFilters(guest, custom({ paid: 'unpaid' })), false)
  assert.equal(matchesRecipientFilters(order({ delivered: true }), custom({ delivered: 'undelivered' })), false)
  assert.equal(matchesRecipientFilters(order({ delivered: true }), custom({ delivered: 'delivered' })), true)

  assert.equal(matchesRecipientFilters(guest, custom({ complimentary: 'exclude' })), false)
  assert.equal(matchesRecipientFilters(order({}), custom({ complimentary: 'only' })), false)
  // the school list never hides 公關票 guests when only they are wanted
  const onlyGuests = custom({ complimentary: 'only', schools: ['北一女中'] })
  assert.deepEqual(onlyGuests.schools, [])
  assert.equal(matchesRecipientFilters(guest, onlyGuests), true)

  // inclusive Taiwan calendar days
  const day = custom({ createdFrom: '2026-10-20', createdTo: '2026-10-20' })
  assert.equal(matchesRecipientFilters(order({ createdAt: at('2026-10-20T00:00:00+08:00') }), day), true)
  assert.equal(matchesRecipientFilters(order({ createdAt: at('2026-10-20T23:59:59+08:00') }), day), true)
  assert.equal(matchesRecipientFilters(order({ createdAt: at('2026-10-21T00:00:00+08:00') }), day), false)
  assert.equal(matchesRecipientFilters(order({ createdAt: at('2026-10-19T23:59:59+08:00') }), day), false)
  assert.equal(matchesRecipientFilters(order({ createdAt: null }), day), false)
})

test('recipient filters reject bad input and keep payment / pickup rules', async () => {
  const { readRecipientFilters } = await import('../../lib/notifications.js')
  assert.throws(() => readRecipientFilters({ filters: { schools: ['不存在的學校'] } }, 'custom'), /學校篩選不正確/)
  assert.throws(() => readRecipientFilters({ filters: { schools: '北一女中' } }, 'custom'), /學校篩選不正確/)
  assert.throws(() => readRecipientFilters({ filters: { ticketTypeIds: ['a b'] } }, 'custom'), /票種篩選不正確/)
  assert.throws(() => readRecipientFilters({ filters: { paid: 'maybe' } }, 'custom'), /篩選條件不正確/)
  assert.throws(() => readRecipientFilters({ filters: { createdFrom: '2026/10/01' } }, 'custom'), /日期格式/)
  assert.throws(() => readRecipientFilters({ filters: { createdFrom: '2026-10-02', createdTo: '2026-10-01' } }, 'custom'), /開始日/)

  // a payment notice cannot be pointed at paid orders
  const payment = readRecipientFilters({ filters: { paid: 'paid', delivered: 'delivered' } }, 'payment')
  assert.equal(payment.paid, 'any')
  assert.equal(payment.delivered, 'any')

  // the older single-school field still works (the survey page sends 'all')
  assert.deepEqual(readRecipientFilters({ school: '北一女中' }, 'pickup').schools, ['北一女中'])
  assert.deepEqual(readRecipientFilters({ school: 'all' }, 'survey').schools, [])
})
