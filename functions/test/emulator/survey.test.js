// Runs submitSurvey against the Firestore emulator: `yarn test:emulator`.
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { PROJECT_ID, db, fft, functions, isEmulator } from './setup.js'
import { CHANNEL_OPTIONS, DEVICE_OPTIONS, IDENTITY_OPTIONS, ISSUE_COUNT_OPTIONS, SCORE_IDS } from '../../lib/survey.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')

const callSubmit = fft.wrap(functions.submitSurvey)

const response = (extra = {}) => ({
  identity: IDENTITY_OPTIONS[0],
  channels: [CHANNEL_OPTIONS[0]],
  device: DEVICE_OPTIONS[0],
  scores: Object.fromEntries(SCORE_IDS.map((id) => [id, 4])),
  issueCount: ISSUE_COUNT_OPTIONS[0],
  issueTypes: [],
  improvement: '',
  suggestion: '',
  ...extra
})

after(() => fft.cleanup())

beforeEach(async () => {
  const res = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  assert.ok(res.ok)
})

describe('submitSurvey', () => {
  test('anyone can answer without signing in; the response gets a server time', async () => {
    await callSubmit({ response: response({ suggestion: ' 很好用 ' }) }, {})
    const responses = await db.collection('surveyResponses').get()
    assert.equal(responses.size, 1)
    const stored = responses.docs[0].data()
    assert.equal(stored.suggestion, '很好用')
    assert.ok(stored.createdAt?.toMillis() > Date.now() - 60_000)
  })

  test('a malformed response is refused and nothing is stored', async () => {
    await assert.rejects(callSubmit({ response: response({ identity: 'hacker' }) }, {}), { code: 'invalid-argument' })
    assert.equal((await db.collection('surveyResponses').get()).size, 0)
  })
})
