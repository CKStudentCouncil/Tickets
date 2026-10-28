import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  GUEST_ORDER_PREFIX,
  guestOrderOf,
  newInviteId,
  remainingOf,
  sanitizeClaimInput,
  sanitizeGuestInput,
  sanitizeInviteId,
  sanitizeInviteInput,
  ticketCountOf
} from '../../lib/guests.js'
import { includesGuests } from '../../lib/notifications.js'
import { stockReleaseOf } from '../../lib/orders.js'
import { ORDER_ID_PATTERN, generateOrderId } from '../../lib/orderValidation.js'
import { SITE_URL, guestRelationText } from '../../lib/constants.js'
import { generateGuestInvitationHTML } from '../../templates/guestInvitation.js'

const REQUEST_ID = 'guest-request-0001'
const GUEST = { name: ' 王大明 ', email: ' Alumni@Example.com ' }

const code = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.code
  }
  return null
}

test('a send keeps the trimmed name and a lower-case email', () => {
  assert.deepEqual(sanitizeGuestInput({ requestId: REQUEST_ID, quantity: 2, ...GUEST, relation: 'ignored' }), {
    requestId: REQUEST_ID,
    quantity: 2,
    guest: { name: '王大明', email: 'alumni@example.com' }
  })
})

test('malformed sends are refused', () => {
  const cases = [
    { ...GUEST, quantity: 1 }, // no requestId
    { requestId: 'short', ...GUEST },
    { requestId: REQUEST_ID, ...GUEST, quantity: 0 },
    { requestId: REQUEST_ID, ...GUEST, quantity: 11 },
    { requestId: REQUEST_ID, ...GUEST, quantity: 1.5 },
    { requestId: REQUEST_ID, ...GUEST, name: '  ' },
    { requestId: REQUEST_ID, ...GUEST, email: 'not-an-email' }
  ]
  cases.forEach((data) => assert.equal(code(() => sanitizeGuestInput(data)), 'invalid-argument', JSON.stringify(data)))
})

test('an invite link takes a request id and a quantity', () => {
  assert.deepEqual(sanitizeInviteInput({ requestId: REQUEST_ID, quantity: 3 }), { requestId: REQUEST_ID, quantity: 3 })
  assert.equal(code(() => sanitizeInviteInput({ requestId: REQUEST_ID, quantity: 11 })), 'invalid-argument')
  assert.equal(code(() => sanitizeInviteInput({ quantity: 1 })), 'invalid-argument')
})

test('invite ids are random, link-safe and checked before any read', () => {
  const id = newInviteId()
  assert.match(id, /^[A-Za-z0-9_-]{24}$/)
  assert.notEqual(newInviteId(), id)
  assert.equal(sanitizeInviteId({ inviteId: id }), id)
  for (const inviteId of [undefined, '', 'short', '../orders/PR20261026K7Q2MX', `${id}x`]) {
    assert.equal(code(() => sanitizeInviteId({ inviteId })), 'not-found', String(inviteId))
  }
  assert.deepEqual(sanitizeClaimInput({ inviteId: id, name: ' 陳小華 ' }), { inviteId: id, name: '陳小華' })
  assert.equal(code(() => sanitizeClaimInput({ inviteId: id, name: ' ' })), 'invalid-argument')
})

test('what an officer may still give out', () => {
  assert.equal(remainingOf({ quota: 10, used: 3 }), 7)
  assert.equal(remainingOf({ quota: 10 }), 10)
  assert.equal(remainingOf({ quota: 2, used: 5 }), 0)
  assert.equal(remainingOf(null), 0)
})

test('a 公關票 is an NT$0 paid order that no stock or allowance counts', () => {
  const order = guestOrderOf({
    guest: { name: '王大明', email: 'alumni@example.com' },
    quantity: 2,
    userId: null,
    invitedByUid: 'officer-uid',
    ticketCode: 'code',
    officer: { email: 'officer@example.com', name: '林幹部' }
  })

  assert.equal(order.complimentary, true)
  assert.equal(order.finalTotal, 0)
  assert.equal(order.paid, true)
  assert.equal(order.delivered, false)
  assert.equal(order.customerEmail, 'alumni@example.com')
  assert.equal(order.officerEmail, 'officer@example.com')
  assert.equal(order.officerName, '林幹部')
  assert.equal(order.inviteId, null)
  assert.equal(ticketCountOf(order), 2)
  assert.deepEqual(order.items.map(({ name, price, quantity }) => ({ name, price, quantity })), [
    { name: '公關票', price: 0, quantity: 2 }
  ])
  // deleting it gives nothing back to the stock or the buyer's allowance
  assert.equal(stockReleaseOf(order), null)
})

test('a ticket a super admin sends names no officer', () => {
  const order = guestOrderOf({ guest: { name: '王', email: 'a@b.co' }, quantity: 1, userId: null, invitedByUid: 'u', ticketCode: 'c' })
  assert.equal(order.officerEmail, null)
  assert.equal(order.officerName, null)
})

test('公關票 order ids are valid order ids', () => {
  assert.match(generateOrderId(GUEST_ORDER_PREFIX, '20261026'), ORDER_ID_PATTERN)
})

test('guests are left out of payment notices only', () => {
  assert.equal(includesGuests('payment'), false)
  assert.equal(includesGuests('both'), false)
  assert.equal(includesGuests('pickup'), true)
  assert.equal(includesGuests('custom'), true)
})

test('the invitation escapes the guest and names the officer who invited them', () => {
  const html = generateGuestInvitationHTML('PR20261026K7Q2MX', {
    customerName: '<b>王</b>',
    officerEmail: 'officer@example.com',
    officerName: '林<i>幹部</i>',
    items: [{ name: '公關票', price: 0, quantity: 2 }]
  })

  assert.ok(html.includes('&lt;b&gt;王&lt;/b&gt;'))
  assert.ok(!html.includes('<b>王</b>'))
  assert.ok(html.includes('林&lt;i&gt;幹部&lt;/i&gt; 誠摯邀請您'))
  assert.ok(html.includes('邀請人'))
  assert.ok(html.includes('2 張'))
  assert.ok(html.includes('cid:qrcode'))
  assert.ok(html.includes(`${SITE_URL}/survey`))
  assert.ok(!html.includes('NT$'))
})

test('an earlier invitation still shows how the guest knew the council', () => {
  const guest = { relation: 'friend', relationDetail: '班聯會 陳同學' }
  const html = generateGuestInvitationHTML('PR20261026K7Q2MX', {
    customerName: '王',
    guest,
    items: [{ name: '公關票', price: 0, quantity: 1 }]
  })

  assert.ok(html.includes(guestRelationText(guest)))
  assert.ok(!html.includes('邀請人'))
})
