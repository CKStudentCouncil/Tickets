// Runs importSalesArchive (匯入往年資料) against the Firestore emulator:
// `yarn test:emulator` (needs Java).
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { PROJECT_ID, db, fft, functions, isEmulator } from './setup.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')

const callImport = fft.wrap(functions.importSalesArchive)

const SUPER = { uid: 'super-uid', email: 'super@example.com' }
const ADMIN = { uid: 'admin-uid', email: 'admin@example.com' }
const as = ({ uid, email }) => ({ auth: { uid, token: { email, email_verified: true } } })

const row = (n, extra = {}) => ({
  t: Date.parse('2025-11-03T04:00:00Z') + n * 60_000, v: 900, p: n % 2 === 0, d: false,
  s: '建國中學', g: 1 + (n % 3), i: [{ k: '一階票', q: 1, u: 900 }], ...extra
})
const draft = (count, extra = {}) => ({
  openDate: '2025-11-03', closeDate: '2025-12-10', names: { 一階票: '一階票' },
  rows: Array.from({ length: count }, (_, n) => row(n)), ...extra
})
const chunkIds = async (year) => (await db.collection(`salesArchives/${year}/rows`).get()).docs.map((doc) => doc.id).sort()

after(() => fft.cleanup())

beforeEach(async () => {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  assert.ok(response.ok)
  await db.doc(`users/${SUPER.uid}`).set({ email: SUPER.email, role: 'super_admin', name: '總召' })
  await db.doc(`users/${ADMIN.uid}`).set({ email: ADMIN.email, role: 'admin' })
})

describe('importSalesArchive', () => {
  test("stores an earlier year's sale rows and summary under its opening year, and logs it", async () => {
    const result = await callImport(draft(3), as(SUPER))

    assert.deepEqual(result, { year: 2025, orderCount: 3, revenue: 2700 })
    const summary = (await db.doc('salesArchives/2025').get()).data()
    assert.equal(summary.source, 'import')
    assert.equal(summary.openDate, '2025-11-03')
    assert.equal(summary.closeDate, '2025-12-10')
    assert.equal(summary.paidRevenue, 1800)
    assert.deepEqual(summary.byTicketType['一階票'], { name: '一階票', ticketCount: 3, revenue: 2700 })
    assert.equal(summary.importedByUid, SUPER.uid)
    assert.deepEqual((await db.doc('salesArchives/2025/rows/000').get()).data().rows, draft(3).rows)

    const logs = await db.collection('systemLogs').where('type', '==', 'sales.import').get()
    assert.equal(logs.size, 1)
    assert.equal(logs.docs[0].data().actorName, '總召')
  })

  test('importing the year again replaces it, without leftover rows', async () => {
    await callImport(draft(2500), as(SUPER))
    assert.deepEqual(await chunkIds(2025), ['000', '001'])

    await callImport(draft(10), as(SUPER))
    assert.deepEqual(await chunkIds(2025), ['000'])
    assert.equal((await db.doc('salesArchives/2025').get()).data().orderCount, 10)
  })

  test('a year archived by purging orders is never replaced by an import', async () => {
    await db.doc('salesArchives/2025').set({ year: 2025, source: 'purge', orderCount: 1200 })

    await assert.rejects(callImport(draft(3), as(SUPER)), { code: 'failed-precondition' })
    assert.equal((await db.doc('salesArchives/2025').get()).data().orderCount, 1200)
  })

  test('only super admins import, and only well-formed rows', async () => {
    await assert.rejects(callImport(draft(1), {}), { code: 'unauthenticated' })
    await assert.rejects(callImport(draft(1), as(ADMIN)), { code: 'permission-denied' })
    await assert.rejects(callImport(draft(1, { rows: [row(0, { customerName: 'x', s: '' })] }), as(SUPER)), { code: 'invalid-argument' })
    assert.equal((await db.doc('salesArchives/2025').get()).exists, false)
  })
})
