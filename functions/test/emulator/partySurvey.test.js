// Runs submitPartySurvey against the Firestore emulator: `yarn test:emulator`.
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { PROJECT_ID, db, fft, functions, isEmulator } from './setup.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')

const callSubmit = fft.wrap(functions.submitPartySurvey)

const SECTIONS = [
  { id: 'about', title: '基本資料', questions: [{ id: 'mood', type: 'single', title: '開心嗎？', required: true, options: ['開心', '普通'] }] }
]
const as = (uid) => ({ auth: { uid, token: { email: `${uid}@example.com`, email_verified: true } } })

after(() => fft.cleanup())

beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  assert.ok(response.ok)
  await db.doc('partySurveys/2026').set({ year: 2026, open: true, sections: SECTIONS })
})

describe('submitPartySurvey', () => {
  test('only signed-in accounts may answer', async () => {
    await assert.rejects(callSubmit({ year: 2026, answers: { mood: '開心' } }, {}), { code: 'unauthenticated' })
    assert.equal((await db.collection('partySurveys/2026/responses').get()).size, 0)
  })

  test('a signed-in answer is stored without the account', async () => {
    await callSubmit({ year: 2026, answers: { mood: '開心' } }, as('buyer1'))
    const responses = await db.collection('partySurveys/2026/responses').get()
    assert.equal(responses.size, 1)
    assert.deepEqual(Object.keys(responses.docs[0].data()).sort(), ['answers', 'createdAt'])
    assert.deepEqual(responses.docs[0].data().answers, { mood: '開心' })
  })
})
