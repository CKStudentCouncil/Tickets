import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_INVOICE_BYTES,
  invoiceDescription,
  invoiceFileName,
  sanitizeReimbursementInput
} from '../../lib/reimbursements.js'
import { multipartBody } from '../../lib/drive.js'

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 2)])
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(60, 3)])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(60, 4)])

const file = (content, contentType, name = 'receipt') => ({ name, contentType, data: content.toString('base64') })
const CLAIM = {
  requestId: 'reimburse-request-0001',
  name: ' 林小明 ',
  amount: 1200,
  note: ' 場佈材料 ',
  category: '場佈道具',
  year: 2026,
  invoices: [file(JPEG, 'image/jpeg', 'IMG_0001.jpg')]
}

const code = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.code
  }
  return null
}

test('a claim keeps its trimmed fields and the decoded invoices', () => {
  const claim = sanitizeReimbursementInput({
    ...CLAIM,
    invoices: [file(JPEG, 'image/jpeg', 'a.jpg'), file(PNG, 'image/png'), file(PDF, 'application/pdf'), file(WEBP, 'image/webp')]
  })
  assert.equal(claim.name, '林小明')
  assert.equal(claim.note, '場佈材料')
  assert.equal(claim.amount, 1200)
  assert.equal(claim.year, 2026)
  assert.equal(claim.category, '場佈道具')
  assert.deepEqual(claim.invoices.map((invoice) => invoice.ext), ['jpg', 'png', 'pdf', 'webp'])
  assert.ok(claim.invoices[0].content.equals(JPEG))
  assert.equal(claim.invoices[0].name, 'a.jpg')
})

test('name, amount, note and year are checked', () => {
  for (const fields of [
    { requestId: 'short' },
    { name: '' }, { name: '   ' }, { name: 'x'.repeat(51) }, { name: 3 },
    { amount: 0 }, { amount: -1 }, { amount: 12.5 }, { amount: '1200' }, { amount: 1000001 },
    { note: 'x'.repeat(201) },
    { category: undefined }, { category: '交通' }, { category: ' 餐飲' },
    { year: '2026' }, { year: 1999 }
  ]) {
    assert.equal(code(() => sanitizeReimbursementInput({ ...CLAIM, ...fields })), 'invalid-argument', JSON.stringify(fields))
  }
  // the note is optional
  assert.equal(sanitizeReimbursementInput({ ...CLAIM, note: undefined }).note, '')
})

test('an invoice is required, of an accepted type, really that type, and not too big', () => {
  const big = Buffer.concat([JPEG, Buffer.alloc(MAX_INVOICE_BYTES)])
  for (const invoices of [
    undefined,
    [],
    Array(6).fill(file(JPEG, 'image/jpeg')),
    [file(JPEG, 'image/gif')],
    [file(JPEG, 'image/heic')],
    // a PDF called a JPEG, an empty file, text sent as a PDF
    [file(PDF, 'image/jpeg')],
    [file(Buffer.alloc(0), 'image/jpeg')],
    [file(Buffer.from('<html><script>alert(1)</script></html>'), 'application/pdf')],
    [file(big, 'image/jpeg')]
  ]) {
    assert.equal(code(() => sanitizeReimbursementInput({ ...CLAIM, invoices })), 'invalid-argument')
  }
})

test('file names are safe and fall back to the type', () => {
  const claim = sanitizeReimbursementInput({
    ...CLAIM,
    invoices: [file(JPEG, 'image/jpeg', '../../etc/passwd'), file(PDF, 'application/pdf', '')]
  })
  assert.equal(claim.invoices[0].name, '.._.._etc_passwd')
  assert.equal(claim.invoices[1].name, 'invoice.pdf')
})

test('Drive file names sort by date and say whose claim and how much', () => {
  const claim = sanitizeReimbursementInput({ ...CLAIM, name: '林/小明' })
  assert.equal(invoiceFileName(claim, claim.invoices[0], 0, '20261103'), '20261103_林_小明_NT$1200_reimbu_1.jpg')
  assert.equal(
    invoiceDescription(claim, 'admin@example.com'),
    '報帳：林/小明 NT$ 1,200（場佈道具）\n用途：場佈材料\n申請人：admin@example.com\n報帳編號：reimburse-request-0001'
  )
  assert.equal(invoiceDescription({ ...claim, note: '' }, 'a@b.c').includes('用途'), false)
})

test('the upload body carries the metadata, then the bytes untouched', () => {
  const body = multipartBody({ name: '發票.jpg', parents: ['folder'] }, 'image/jpeg', JPEG, 'b')
  const text = body.toString('latin1')
  assert.ok(text.startsWith('--b\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'))
  assert.ok(body.includes(Buffer.from(JSON.stringify({ name: '發票.jpg', parents: ['folder'] }))))
  assert.ok(text.includes('\r\n--b\r\nContent-Type: image/jpeg\r\n\r\n'))
  assert.ok(body.includes(JPEG))
  assert.ok(text.endsWith('\r\n--b--\r\n'))
})
