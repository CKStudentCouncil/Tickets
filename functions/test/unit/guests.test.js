import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GUEST_ORDER_PREFIX, guestOrderOf, sanitizeGuest, sanitizeGuestInput } from '../../lib/guests.js'
import { includesGuests } from '../../lib/notifications.js'
import { stockReleaseOf } from '../../lib/orders.js'
import { ORDER_ID_PATTERN, generateOrderId } from '../../lib/orderValidation.js'
import { SITE_URL, guestRelationText } from '../../lib/constants.js'
import { generateGuestInvitationHTML } from '../../templates/guestInvitation.js'

const REQUEST_ID = 'guest-request-0001'
const GUEST = { name: ' 王大明 ', email: ' Alumni@Example.com ', relation: 'alumni', relationDetail: ' 78 屆 ' }

const code = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.code
  }
  return null
}

test('a direct send keeps the trimmed guest and a lower-case email', () => {
  assert.deepEqual(sanitizeGuestInput({ requestId: REQUEST_ID, quantity: 2, ...GUEST }), {
    requestId: REQUEST_ID,
    quantity: 2,
    guest: { name: '王大明', email: 'alumni@example.com', relation: 'alumni', relationDetail: '78 屆' }
  })
})

test('a send to a registration takes only its id; the server reads the rest', () => {
  assert.deepEqual(sanitizeGuestInput({ requestId: REQUEST_ID, registrationId: 'uid123', name: 'ignored' }), {
    requestId: REQUEST_ID,
    quantity: 1,
    registrationId: 'uid123'
  })
  assert.equal(code(() => sanitizeGuestInput({ requestId: REQUEST_ID, registrationId: '../orders/x' })), 'invalid-argument')
})

test('malformed sends are refused', () => {
  const cases = [
    { ...GUEST, quantity: 1 }, // no requestId
    { requestId: 'short', ...GUEST },
    { requestId: REQUEST_ID, ...GUEST, quantity: 0 },
    { requestId: REQUEST_ID, ...GUEST, quantity: 11 },
    { requestId: REQUEST_ID, ...GUEST, quantity: 1.5 },
    { requestId: REQUEST_ID, ...GUEST, name: '  ' },
    { requestId: REQUEST_ID, ...GUEST, email: 'not-an-email' },
    { requestId: REQUEST_ID, ...GUEST, relation: 'vip' },
    { requestId: REQUEST_ID, ...GUEST, relationDetail: '' }
  ]
  cases.forEach((data) => assert.equal(code(() => sanitizeGuestInput(data)), 'invalid-argument', JSON.stringify(data)))
})

test('a stored registration is checked like a direct send', () => {
  assert.equal(code(() => sanitizeGuest({ name: '王小明', email: 'a@b.co', relation: 'friend' })), 'invalid-argument')
  assert.equal(sanitizeGuest({ name: '王小明', email: 'a@b.co', relation: 'friend', relationDetail: '陳同學' }).relation, 'friend')
})

test('a 公關票 is an NT$0 paid order that no stock or allowance counts', () => {
  const order = guestOrderOf({
    guest: sanitizeGuest(GUEST),
    quantity: 2,
    userId: null,
    invitedByUid: 'super-uid',
    ticketCode: 'code'
  })

  assert.equal(order.complimentary, true)
  assert.equal(order.finalTotal, 0)
  assert.equal(order.paid, true)
  assert.equal(order.delivered, false)
  assert.equal(order.customerEmail, 'alumni@example.com')
  assert.deepEqual(order.guest, { relation: 'alumni', relationDetail: '78 屆' })
  assert.deepEqual(order.items.map(({ name, price, quantity }) => ({ name, price, quantity })), [
    { name: '公關票', price: 0, quantity: 2 }
  ])
  // deleting it gives nothing back to the stock or the buyer's allowance
  assert.equal(stockReleaseOf(order), null)
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

test('the invitation escapes the guest and shows how they were invited', () => {
  const html = generateGuestInvitationHTML('PR20261026K7Q2MX', {
    customerName: '<b>王</b>',
    guest: { relation: 'friend', relationDetail: '班聯會 陳同學' },
    items: [{ name: '公關票', price: 0, quantity: 2 }]
  })

  assert.ok(html.includes('&lt;b&gt;王&lt;/b&gt;'))
  assert.ok(!html.includes('<b>王</b>'))
  assert.ok(html.includes(guestRelationText({ relation: 'friend', relationDetail: '班聯會 陳同學' })))
  assert.ok(html.includes('2 張'))
  assert.ok(html.includes('cid:qrcode'))
  assert.ok(html.includes(`${SITE_URL}/survey`))
  assert.ok(!html.includes('NT$'))
})
