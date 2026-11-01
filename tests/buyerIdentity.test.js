import test from 'node:test'
import assert from 'node:assert/strict'
import { getBuyerTypeLabel, getIdCheck } from '../src/utils/buyerIdentity.js'

test('labels orders 學生 or 社會人士', () => {
  assert.equal(getBuyerTypeLabel({ buyerType: 'student' }), '學生')
  assert.equal(getBuyerTypeLabel({ buyerType: 'public' }), '社會人士')
  assert.equal(getBuyerTypeLabel({}), '')
  assert.equal(getBuyerTypeLabel(null), '')
})

test('says whether to check a student ID when the order has a type sold to students first', () => {
  const items = [{ checkId: true, quantity: 2 }, { quantity: 1 }]
  assert.deepEqual(getIdCheck({ buyerType: 'student', items }), { student: true })
  assert.deepEqual(getIdCheck({ buyerType: 'public', items }), { student: false })
})

test('orders without such a type, or made before, need no check', () => {
  assert.equal(getIdCheck({ buyerType: 'student', items: [{ quantity: 1 }] }), null)
  assert.equal(getIdCheck({ items: [{ name: '二售', quantity: 1 }] }), null)
  assert.equal(getIdCheck({}), null)
  assert.equal(getIdCheck(null), null)
})
