import test from 'node:test'
import assert from 'node:assert/strict'
import { CARD_ID_PATTERN, repairCardId } from '../src/data/schools.js'

test('a 學號 read right stays as read', () => {
  assert.equal(repairCardId('11400527'), '11400527')
})

test('a misread leading 11 is put back', () => {
  assert.equal(repairCardId('41400527'), '11400527')
  assert.equal(repairCardId('1400527'), '11400527')
  assert.equal(repairCardId('741400527'), '11400527')
  assert.equal(repairCardId('71300003'), '11300003')
})

test('numbers that cannot be a 學號 are left out', () => {
  assert.equal(repairCardId('11401527'), '')
  assert.equal(repairCardId('400527'), '')
  assert.equal(repairCardId('1234567890'), '')
  assert.equal(repairCardId('abc'), '')
  assert.equal(repairCardId(''), '')
  assert.equal(repairCardId(undefined), '')
})

test('every repair is a 學號 a card prints', () => {
  for (const digits of ['41400527', '1400527', '99999000123', '8700001']) {
    const fixed = repairCardId(digits)
    assert.ok(fixed === '' || CARD_ID_PATTERN.test(fixed), digits)
  }
})
