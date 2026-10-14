import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTicketQr } from '../src/utils/ticketQr.js'

const origins = ['https://tickets.cksc.tw', 'http://localhost:9000']

test('reads the order id and ticket code from a ticket QR', () => {
  assert.deepEqual(
    parseTicketQr('https://tickets.cksc.tw/admin/orders/CKS20261027ABCDEF?c=x_Y-z9', origins),
    { orderId: 'CKS20261027ABCDEF', ticketCode: 'x_Y-z9' }
  )
  assert.deepEqual(
    parseTicketQr('  http://localhost:9000/admin/orders/CKS202611050123/  ', origins),
    { orderId: 'CKS202611050123', ticketCode: '' }
  )
})

test('ignores QR codes that are not this site\'s ticket links', () => {
  for (const text of [
    '',
    'CKS20261027ABCDEF',
    'https://evil.example/admin/orders/CKS20261027ABCDEF?c=abc',
    'https://tickets.cksc.tw.evil.example/admin/orders/CKS20261027ABCDEF',
    'https://tickets.cksc.tw/orders/CKS20261027ABCDEF?c=abc',
    'https://tickets.cksc.tw/admin/orders/not-an-order?c=abc',
    'https://tickets.cksc.tw/admin/orders/CKS20261027ABCDEF/history',
    'https://tickets.cksc.tw/admin/orders/%E0%A4%A'
  ]) assert.equal(parseTicketQr(text, origins), null, text)
})
