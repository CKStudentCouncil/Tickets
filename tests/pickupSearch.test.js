import { accountStudentId } from '../src/data/schools.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { choices, classifySearch, notFoundText, pickOrder } from '../src/utils/pickupSearch.js'

test('what was typed is an order number, a 學號, an email or a name', () => {
  assert.deepEqual(classifySearch(' cks20261027abcdef '), { kind: 'order', orderId: 'CKS20261027ABCDEF' })
  assert.deepEqual(classifySearch('１１３０５２４'), { kind: 'studentId', studentId: '1130524' })
  assert.deepEqual(classifySearch(' Lee@Example.com '), { kind: 'email', email: 'Lee@Example.com' })
  assert.deepEqual(classifySearch(' 王小明 '), { kind: 'name', name: '王小明' })
  assert.deepEqual(classifySearch('Amy   Chen'), { kind: 'name', name: 'Amy Chen' })
  assert.equal(classifySearch('lee@'), null)
  assert.equal(classifySearch('   '), null)
  assert.equal(classifySearch('名'.repeat(51)), null)
})

test('one order not yet collected opens at once; otherwise staff pick', () => {
  const a = { id: 'a', delivered: true }
  const b = { id: 'b', delivered: false }
  const c = { id: 'c', delivered: false }
  assert.equal(pickOrder([a, b]), b)
  assert.equal(pickOrder([a]), a)
  assert.equal(pickOrder([b, c]), null)
  assert.deepEqual(choices([a, b, c]), [b, c])
  assert.deepEqual(choices([a]), [a])
  assert.match(notFoundText({ kind: 'name', name: '王小明' }), /完全相同/)
})

test('the 學號 of a school account', () => {
  assert.equal(accountStudentId(' CK1130524@gl.ck.tp.edu.tw '), '1130524')
  assert.equal(accountStudentId('ck11305@gl.ck.tp.edu.tw'), '')
  assert.equal(accountStudentId('ck1130524@gmail.com'), '')
  assert.equal(accountStudentId('1130524@gl.ck.tp.edu.tw'), '')
  assert.equal(accountStudentId(''), '')
})
