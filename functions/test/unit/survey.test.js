import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CHANNEL_OPTIONS,
  DEVICE_OPTIONS,
  IDENTITY_OPTIONS,
  ISSUE_COUNT_OPTIONS,
  ISSUE_TYPE_OPTIONS,
  MAX_TEXT,
  SCORE_IDS,
  cleanSurveyResponse
} from '../../lib/survey.js'

const allScores = (value = 5) => Object.fromEntries(SCORE_IDS.map((id) => [id, value]))
const response = (extra = {}) => ({
  identity: IDENTITY_OPTIONS[0],
  channels: [CHANNEL_OPTIONS[0]],
  device: DEVICE_OPTIONS[0],
  scores: allScores(),
  issueCount: ISSUE_COUNT_OPTIONS[0],
  issueTypes: [],
  improvement: '',
  suggestion: '',
  ...extra
})
const rejects = (input) => assert.throws(() => cleanSurveyResponse(input), { code: 'invalid-argument' })

test('a well-formed response is kept with only the known fields', () => {
  const cleaned = cleanSurveyResponse(response({ admin: true, createdAt: 'yesterday', suggestion: '  謝謝  ' }))
  assert.deepEqual(Object.keys(cleaned).sort(), [
    'channels', 'device', 'identity', 'improvement', 'issueCount', 'issueTypes', 'scores', 'suggestion'
  ])
  assert.equal(cleaned.suggestion, '謝謝')
})

test('every option the page offers is accepted', () => {
  IDENTITY_OPTIONS.forEach((identity) => cleanSurveyResponse(response({ identity })))
  DEVICE_OPTIONS.forEach((device) => cleanSurveyResponse(response({ device })))
  ISSUE_COUNT_OPTIONS.forEach((issueCount) => cleanSurveyResponse(response({ issueCount })))
  cleanSurveyResponse(response({ channels: CHANNEL_OPTIONS, issueCount: ISSUE_COUNT_OPTIONS[1], issueTypes: ISSUE_TYPE_OPTIONS }))
  ;[1, 2, 3, 4, 5].forEach((value) => cleanSurveyResponse(response({ scores: allScores(value) })))
})

test('issue types are dropped when no issue was met', () => {
  const cleaned = cleanSurveyResponse(response({ issueTypes: [ISSUE_TYPE_OPTIONS[0]] }))
  assert.deepEqual(cleaned.issueTypes, [])
})

test('out-of-range, non-integer, unknown or missing scores are rejected', () => {
  rejects(response({ scores: { ...allScores(), q4: 1000000 } }))
  rejects(response({ scores: { ...allScores(), q4: '5' } }))
  rejects(response({ scores: { ...allScores(), q4: 0 } }))
  rejects(response({ scores: { ...allScores(), q4: 4.5 } }))
  rejects(response({ scores: { ...allScores(), q99: 5 } }))
  const missing = allScores()
  delete missing.q25
  rejects(response({ scores: missing }))
})

test('unknown options and malformed fields are rejected', () => {
  rejects(undefined)
  rejects(response({ identity: 'hacker' }))
  rejects(response({ channels: ['<script>'] }))
  rejects(response({ channels: [] }))
  rejects(response({ channels: 'CK APP' }))
  rejects(response({ issueCount: ISSUE_COUNT_OPTIONS[1], issueTypes: ['whatever'] }))
  rejects(response({ suggestion: 'x'.repeat(MAX_TEXT + 1) }))
  rejects(response({ improvement: { text: 'x' } }))
})
