import { test } from 'node:test'
import assert from 'node:assert/strict'

import { LIMITS, cleanAnswers } from '../../lib/partySurvey.js'

const SECTIONS = [
  {
    id: 's1',
    title: '基本',
    questions: [
      { id: 'reason', type: 'single', title: '原因', required: true, options: ['藝人', '朋友'], allowOther: true },
      { id: 'identity', type: 'single', title: '身分', required: false, options: ['學生', '家長'], allowOther: false },
      { id: 'channels', type: 'multiple', title: '管道', required: false, options: ['IG', '海報'], allowOther: true }
    ]
  },
  {
    id: 's2',
    title: '綜合評分',
    questions: [
      { id: 'ratings', type: 'scale', title: '', required: true, rows: [{ id: 'sound', text: '音響' }, { id: 'staff', text: '工作人員' }] },
      { id: 'feedback', type: 'text', title: '意見', required: false }
    ]
  }
]

const VALID = { reason: '藝人', ratings: { sound: 4, staff: 5 } }

const failure = (answers) => {
  try {
    cleanAnswers(SECTIONS, answers)
  } catch (error) {
    return [error.code, error.message]
  }
  return null
}

test('a sheet keeps its answers, trimmed, and drops what the survey does not ask', () => {
  assert.deepEqual(
    cleanAnswers(SECTIONS, {
      ...VALID,
      reason: ' 自己想來 ',
      channels: ['IG', 'IG', ' 學長說的 ', ''],
      feedback: '  很好玩  ',
      identity: '',
      admin: true,
      ratings: { sound: 4, staff: 5, extra: 3 }
    }),
    { reason: '自己想來', channels: ['IG', '學長說的'], ratings: { sound: 4, staff: 5 }, feedback: '很好玩' }
  )
})

test('required questions must be answered; a rating question goes by its section title', () => {
  assert.deepEqual(failure({ ratings: VALID.ratings }), ['invalid-argument', '尚未回答「原因」'])
  assert.deepEqual(failure({ reason: '藝人' }), ['invalid-argument', '尚未回答「綜合評分」'])
  assert.deepEqual(failure({ reason: '藝人', ratings: { sound: 4 } }), ['invalid-argument', '請完成「綜合評分」的所有評分'])
  assert.equal(failure(null)?.[0], 'invalid-argument')
})

test('answers a question cannot take are refused', () => {
  assert.equal(failure({ ...VALID, identity: '駭客' })?.[1], '「身分」沒有這個選項')
  assert.equal(failure({ ...VALID, channels: ['甲', '乙'] })?.[1], '「管道」只能自填一個其他')
  assert.equal(failure({ ...VALID, reason: 'x'.repeat(LIMITS.other + 1) })?.[0], 'invalid-argument')
  assert.equal(failure({ ...VALID, feedback: 'x'.repeat(LIMITS.text + 1) })?.[0], 'invalid-argument')
  for (const score of [0, 6, 4.5, '5']) {
    assert.equal(failure({ ...VALID, ratings: { sound: score, staff: 5 } })?.[1], '評分只能是 1 到 5 分', String(score))
  }
})
