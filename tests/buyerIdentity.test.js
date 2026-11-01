import test from 'node:test'
import assert from 'node:assert/strict'
import { getItemIdentityLabel, getOrderIdentity } from '../src/utils/buyerIdentity.js'

test('labels each item by who its type was sold to', () => {
  assert.equal(getItemIdentityLabel({ eligibleBuyerIdentity: 'edu_students' }), '學生票')
  assert.equal(getItemIdentityLabel({ eligibleBuyerIdentity: 'campus_students' }), '建中學生票')
  assert.equal(getItemIdentityLabel({ eligibleBuyerIdentity: 'all_users' }), '社會人士票')
  assert.equal(getItemIdentityLabel({}), '')
  assert.equal(getItemIdentityLabel(null), '')
})

test('counts the 學生 tickets that need a student ID at pickup', () => {
  const order = {
    items: [
      { eligibleBuyerIdentity: 'edu_students', quantity: 2 },
      { eligibleBuyerIdentity: 'all_users', quantity: 1 }
    ]
  }
  assert.deepEqual(getOrderIdentity(order), { known: true, studentTickets: 2, generalOnly: false })
  assert.deepEqual(
    getOrderIdentity({ items: [{ eligibleBuyerIdentity: 'all_users', quantity: 3 }] }),
    { known: true, studentTickets: 0, generalOnly: true }
  )
  assert.deepEqual(
    getOrderIdentity({ items: [{ eligibleBuyerIdentity: 'campus_students', quantity: 1 }] }),
    { known: true, studentTickets: 0, generalOnly: false }
  )
})

test('orders made before items carried an identity show nothing', () => {
  const none = { known: false, studentTickets: 0, generalOnly: false }
  assert.deepEqual(getOrderIdentity({ items: [{ name: '二售', quantity: 1 }] }), none)
  assert.deepEqual(getOrderIdentity({}), none)
  assert.deepEqual(getOrderIdentity(null), none)
})
