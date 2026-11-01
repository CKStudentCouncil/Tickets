import test from 'node:test'
import assert from 'node:assert/strict'
import { getBuyerTypeLabel, getIdCheck } from '../src/utils/buyerIdentity.js'

test('labels orders 學生 or 社會人士', () => {
  assert.equal(getBuyerTypeLabel({ buyerType: 'student' }), '學生')
  assert.equal(getBuyerTypeLabel({ buyerType: 'public' }), '社會人士')
  assert.equal(getBuyerTypeLabel({}), '')
  assert.equal(getBuyerTypeLabel(null), '')
})

test('says what to check when the order has a type checked at pickup', () => {
  const items = [{ checkId: true, maxAge: 30, quantity: 2 }, { quantity: 1 }]
  assert.deepEqual(getIdCheck({ buyerType: 'student', items }), { student: true, maxAge: 30 })
  assert.deepEqual(getIdCheck({ buyerType: 'public', items: [{ checkId: true }] }), { student: false, maxAge: null })
  assert.deepEqual(
    getIdCheck({ buyerType: 'public', items: [{ checkId: true, maxAge: 30 }, { checkId: true, maxAge: 25 }] }),
    { student: false, maxAge: 25 }
  )
})

test('orders without such a type, or made before, need no check', () => {
  assert.equal(getIdCheck({ buyerType: 'student', items: [{ quantity: 1 }] }), null)
  assert.equal(getIdCheck({ items: [{ name: '二售', quantity: 1 }] }), null)
  assert.equal(getIdCheck({}), null)
  assert.equal(getIdCheck(null), null)
})
