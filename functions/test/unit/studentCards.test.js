import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cleanStudentId, orderSummary, studentAccountEmail } from '../../lib/studentCards.js'

test('student IDs are 6–8 digits; spaces and full-width digits are tidied', () => {
  assert.equal(cleanStudentId('1130524'), '1130524')
  assert.equal(cleanStudentId(' 113 0524 '), '1130524')
  assert.equal(cleanStudentId('１１３０５２４'), '1130524')
  for (const bad of ['12345', '123456789', 'B1234567', '1130524@x', '', null, 1130524, ['1130524']]) {
    assert.equal(cleanStudentId(bad), '', String(bad))
  }
})

test('a student ID maps to its school account', () => {
  assert.equal(studentAccountEmail('1130524'), 'ck1130524@gl.ck.tp.edu.tw')
  assert.equal(studentAccountEmail('abc'), '')
})

test('order summaries carry only what staff need to pick the order', () => {
  const createdAt = { toDate: () => new Date('2026-11-01T02:03:04Z') }
  const summary = orderSummary('CKS20261101ABCDEF', {
    customerName: '王小明', customerPhone: '0912345678', ticketCode: 'secret', delivered: true, paid: false,
    items: [{ name: '一階票', quantity: 2, price: 900 }], createdAt
  })
  assert.deepEqual(summary, {
    id: 'CKS20261101ABCDEF', customerName: '王小明', delivered: true, paid: false,
    items: [{ name: '一階票', quantity: 2 }], createdAt: '2026-11-01T02:03:04.000Z'
  })
})
