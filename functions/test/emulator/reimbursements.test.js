// Runs submitReimbursement and trashReimbursementInvoices against the
// Firestore emulator and a fake Google Drive: `yarn test:emulator` (needs
// Java). Nothing reaches Google; requests to its hosts are answered here.
import { after, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'

import { PROJECT_ID, db, fft, functions, isEmulator } from './setup.js'

assert.ok(isEmulator, 'these tests clear the database: emulator only')

const callSubmit = fft.wrap(functions.submitReimbursement)
const callTrash = fft.wrap(functions.trashReimbursementInvoices)

const STAFF = {
  admin: { uid: 'admin-uid', email: 'Admin@Example.com', role: 'admin', name: '林管理' },
  superAdmin: { uid: 'super-uid', email: 'super@example.com', role: 'super_admin', name: '王總召' },
  manager: { uid: 'manager-uid', email: 'manager@example.com', role: 'manager', name: '門口' }
}
const as = ({ uid, email }) => ({ auth: { uid, token: { email, email_verified: true } } })

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg body')])
const PDF = Buffer.from('%PDF-1.7\nreceipt body')
const invoice = (content, contentType, name) => ({ name, contentType, data: content.toString('base64') })

let requestCount = 0
const claim = (extra = {}) => ({
  requestId: `reimburse-request-${String(++requestCount).padStart(8, '0')}`,
  name: '林小明',
  amount: 1200,
  note: '場佈材料',
  category: '場佈道具',
  year: 2026,
  invoices: [invoice(JPEG, 'image/jpeg', 'IMG_0001.jpg'), invoice(PDF, 'application/pdf', '收據.pdf')],
  ...extra
})

const rejection = async (promise) => {
  try {
    await promise
  } catch (error) {
    return error.code
  }
  return null
}

/* ---------- a fake Google Drive ---------- */

const drive = { files: new Map(), nextId: 0, uploads: 0, failUpload: null, tokenError: null }
const realFetch = globalThis.fetch

function parseUpload(body, contentType) {
  const boundary = contentType.match(/boundary=(.+)$/)[1]
  const buffer = Buffer.from(body)
  const separator = Buffer.from(`\r\n--${boundary}`)
  const metaStart = buffer.indexOf('\r\n\r\n') + 4
  const metaEnd = buffer.indexOf(separator, metaStart)
  const fileStart = buffer.indexOf('\r\n\r\n', metaEnd) + 4
  const fileEnd = buffer.indexOf(separator, fileStart)
  return { metadata: JSON.parse(buffer.subarray(metaStart, metaEnd).toString()), content: buffer.subarray(fileStart, fileEnd) }
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (url.hostname === 'oauth2.googleapis.com') {
    if (drive.tokenError) return Response.json({ error: drive.tokenError }, { status: 400 })
    // short-lived, so every call asks again and a revoked grant shows at once
    return Response.json({ access_token: 'fake-token', expires_in: 30 })
  }
  if (url.hostname !== 'www.googleapis.com') return realFetch(input, init)

  assert.equal(init.headers.Authorization, 'Bearer fake-token')
  const method = init.method || 'GET'
  const live = (id) => drive.files.has(id)

  if (method === 'GET' && url.pathname === '/drive/v3/files') {
    const name = url.searchParams.get('q').match(/^name = '(.*?)' and/)[1]
    const files = [...drive.files.entries()]
      .filter(([, file]) => file.folder && file.name === name && !file.trashed)
      .map(([id]) => ({ id }))
    return Response.json({ files })
  }
  if (method === 'POST' && url.pathname === '/drive/v3/files') {
    const id = `folder-${++drive.nextId}`
    drive.files.set(id, { ...JSON.parse(init.body), folder: true, trashed: false })
    return Response.json({ id })
  }
  if (method === 'POST' && url.pathname === '/upload/drive/v3/files') {
    const { metadata, content } = parseUpload(init.body, init.headers['Content-Type'])
    if (!live(metadata.parents[0])) return Response.json({ error: { message: 'File not found' } }, { status: 404 })
    if (drive.failUpload?.(++drive.uploads)) return Response.json({ error: { message: 'backend error' } }, { status: 500 })
    const id = `file-${++drive.nextId}`
    drive.files.set(id, { ...metadata, content, trashed: false })
    return Response.json({ id, webViewLink: `https://drive.google.com/file/d/${id}/view` })
  }
  if (method === 'PATCH' && url.pathname.startsWith('/drive/v3/files/')) {
    const id = decodeURIComponent(url.pathname.split('/').pop())
    if (!live(id)) return Response.json({ error: { message: 'File not found' } }, { status: 404 })
    Object.assign(drive.files.get(id), JSON.parse(init.body))
    return Response.json({ id })
  }
  throw new Error(`unexpected Drive call ${method} ${url}`)
}

const folders = () => [...drive.files.values()].filter((file) => file.folder && !file.trashed)
const invoicesIn = (folderId) => [...drive.files.values()].filter((file) => file.parents?.[0] === folderId && !file.trashed)

after(() => {
  globalThis.fetch = realFetch
  fft.cleanup()
})

beforeEach(async () => {
  Object.assign(process.env, { DRIVE_CLIENT_ID: 'client', DRIVE_CLIENT_SECRET: 'secret', DRIVE_REFRESH_TOKEN: 'refresh' })
  Object.assign(drive, { files: new Map(), uploads: 0, failUpload: null, tokenError: null })
  const response = await realFetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
  assert.ok(response.ok)
  const batch = db.batch()
  Object.values(STAFF).forEach(({ uid, email, role, name }) => batch.set(db.doc(`users/${uid}`), { uid, email, role, name }))
  await batch.commit()
})

describe('submitReimbursement', () => {
  test('puts the invoices in the year\'s Drive folder, then saves the pending claim', async () => {
    const input = claim()
    const { id } = await callSubmit(input, as(STAFF.admin))
    assert.equal(id, input.requestId)

    const saved = (await db.doc(`reimbursements/${id}`).get()).data()
    assert.equal(saved.name, '林小明')
    assert.equal(saved.amount, 1200)
    assert.equal(saved.note, '場佈材料')
    assert.equal(saved.category, '場佈道具')
    assert.equal(saved.year, 2026)
    assert.equal(saved.status, 'pending')
    assert.equal(saved.submitterUid, 'admin-uid')
    assert.equal(saved.submitterEmail, 'admin@example.com')
    assert.deepEqual(saved.invoices.map(({ name, contentType, size }) => [name, contentType, size]), [
      ['IMG_0001.jpg', 'image/jpeg', JPEG.length],
      ['收據.pdf', 'application/pdf', PDF.length]
    ])

    const [folder] = folders()
    assert.equal(folders().length, 1)
    assert.equal(folder.name, 'CK Party Night 報帳發票 2026')
    const { folderId } = (await db.doc('reimbursementFolders/2026').get()).data()
    const files = invoicesIn(folderId)
    assert.equal(files.length, 2)
    assert.ok(files[0].content.equals(JPEG))
    assert.ok(files[1].content.equals(PDF))
    assert.match(files[0].name, /^\d{8}_林小明_NT\$1200_reimbu_1\.jpg$/)
    assert.match(files[1].description, /申請人：admin@example\.com/)
    assert.equal(saved.invoices[0].url, `https://drive.google.com/file/d/${saved.invoices[0].fileId}/view`)
  })

  test('later claims use the same folder; a retried claim is saved and uploaded once', async () => {
    const input = claim()
    await callSubmit(input, as(STAFF.admin))
    assert.deepEqual(await callSubmit(input, as(STAFF.admin)), { id: input.requestId })
    await callSubmit(claim({ invoices: [invoice(PDF, 'application/pdf', 'a.pdf')] }), as(STAFF.superAdmin))

    assert.equal(folders().length, 1)
    const { folderId } = (await db.doc('reimbursementFolders/2026').get()).data()
    assert.equal(invoicesIn(folderId).length, 3)
    assert.equal((await db.collection('reimbursements').get()).size, 2)
    // someone else's request id is not theirs to read back
    assert.equal(await rejection(callSubmit(input, as(STAFF.superAdmin))), 'invalid-argument')
  })

  test('only admins and super admins may claim; nothing is uploaded otherwise', async () => {
    assert.equal(await rejection(callSubmit(claim(), {})), 'unauthenticated')
    assert.equal(await rejection(callSubmit(claim(), as(STAFF.manager))), 'permission-denied')
    assert.equal(await rejection(callSubmit(claim(), as({ uid: 'buyer', email: 'buyer@example.com' }))), 'permission-denied')
    assert.equal(await rejection(callSubmit(claim({ invoices: [] }), as(STAFF.admin))), 'invalid-argument')
    assert.equal(drive.files.size, 0)
    assert.equal((await db.collection('reimbursements').get()).size, 0)
  })

  test('a failed upload trashes what went up and saves nothing', async () => {
    drive.failUpload = (n) => n === 2
    assert.equal(await rejection(callSubmit(claim(), as(STAFF.admin))), 'unavailable')
    assert.equal((await db.collection('reimbursements').get()).size, 0)
    const { folderId } = (await db.doc('reimbursementFolders/2026').get()).data()
    assert.equal(invoicesIn(folderId).length, 0)
  })

  test('a revoked grant is reported as such, not as busy', async () => {
    drive.tokenError = 'invalid_grant'
    assert.equal(await rejection(callSubmit(claim(), as(STAFF.admin))), 'failed-precondition')
    assert.equal((await db.collection('reimbursements').get()).size, 0)
  })

  test('a folder the owner deleted is made again on the next try', async () => {
    await callSubmit(claim(), as(STAFF.admin))
    const { folderId } = (await db.doc('reimbursementFolders/2026').get()).data()
    drive.files.delete(folderId)

    assert.equal(await rejection(callSubmit(claim(), as(STAFF.admin))), 'unavailable')
    await callSubmit(claim(), as(STAFF.admin))
    const renewed = (await db.doc('reimbursementFolders/2026').get()).data().folderId
    assert.notEqual(renewed, folderId)
    assert.equal(invoicesIn(renewed).length, 2)
  })
})

describe('trashReimbursementInvoices', () => {
  test('a deleted claim\'s invoices go to the trash; trashing twice is fine', async () => {
    const { id } = await callSubmit(claim(), as(STAFF.admin))
    const snap = await db.doc(`reimbursements/${id}`).get()
    await snap.ref.delete()
    await callTrash(snap, { params: { claimId: id } })
    await callTrash(snap, { params: { claimId: id } })

    const fileIds = snap.data().invoices.map((item) => item.fileId)
    assert.deepEqual(fileIds.map((fileId) => drive.files.get(fileId).trashed), [true, true])
    // the folder stays for the year's other claims
    assert.equal(folders().length, 1)
  })
})
