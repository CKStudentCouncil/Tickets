import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SCAN_LINK_HOURS,
  createRepeatFilter,
  getScanLinkUrl,
  isScanLinkExpired,
  parseScanLinkQr
} from '../src/utils/scanLink.js'
import { parseTicketQr } from '../src/utils/ticketQr.js'

const origins = ['https://tickets.cksc.tw', 'http://localhost:9000']
const LINK_ID = 'AbCdEfGhIjKlMnOpQrSt'

test('a pairing QR code reads back into its link id', () => {
  const url = getScanLinkUrl(LINK_ID, 'https://tickets.cksc.tw')
  assert.equal(url, `https://tickets.cksc.tw/admin/scan?link=${LINK_ID}`)
  assert.equal(parseScanLinkQr(url, origins), LINK_ID)
  assert.equal(parseScanLinkQr(`  http://localhost:9000/admin/scan/?link=${LINK_ID}&x=1  `, origins), LINK_ID)
})

test('pairing and ticket QR codes are never mistaken for each other', () => {
  const pairing = getScanLinkUrl(LINK_ID, 'https://tickets.cksc.tw')
  const ticket = 'https://tickets.cksc.tw/admin/orders/CKS20261027ABCDEF?c=abc'
  assert.equal(parseTicketQr(pairing, origins), null)
  assert.equal(parseScanLinkQr(ticket, origins), null)
})

test('ignores QR codes that are not this site\'s pairing links', () => {
  for (const text of [
    '',
    LINK_ID,
    `https://evil.example/admin/scan?link=${LINK_ID}`,
    `https://tickets.cksc.tw.evil.example/admin/scan?link=${LINK_ID}`,
    `https://tickets.cksc.tw/admin/scan/desk?link=${LINK_ID}`,
    `https://tickets.cksc.tw/scan?link=${LINK_ID}`,
    'https://tickets.cksc.tw/admin/scan',
    'https://tickets.cksc.tw/admin/scan?link=short',
    `https://tickets.cksc.tw/admin/scan?link=${LINK_ID}x`,
    'https://tickets.cksc.tw/admin/scan?link=AbCdEfGhIjKlMnOpQr/.'
  ]) assert.equal(parseScanLinkQr(text, origins), null, text)
})

test(`a link expires ${SCAN_LINK_HOURS} hours after it was made`, () => {
  const created = new Date('2026-12-13T17:00:00+08:00')
  const at = (hours) => new Date(created.getTime() + hours * 60 * 60 * 1000)
  assert.equal(isScanLinkExpired(created, at(0)), false)
  assert.equal(isScanLinkExpired(created, at(SCAN_LINK_HOURS - 0.01)), false)
  assert.equal(isScanLinkExpired(created, at(SCAN_LINK_HOURS)), true)
  // a Firestore Timestamp
  assert.equal(isScanLinkExpired({ toDate: () => created }, at(SCAN_LINK_HOURS + 1)), true)
  // still being created: no time yet
  assert.equal(isScanLinkExpired(null, at(100)), false)
  assert.equal(isScanLinkExpired(undefined), false)
})

test('a code held in view counts once, and again after it was out of view', () => {
  let time = 0
  const repeats = createRepeatFilter(2000, () => time)
  assert.equal(repeats.isNew('A'), true)
  // read every 150 ms for 10 s while held up
  for (time = 150; time <= 10000; time += 150) assert.equal(repeats.isNew('A'), false)
  // another ticket at once
  assert.equal(repeats.isNew('B'), true)
  time += 500
  assert.equal(repeats.isNew('A'), true)
  // out of view for longer than the gap
  time += 2500
  assert.equal(repeats.isNew('A'), true)
  time += 1999
  assert.equal(repeats.isNew('A'), false)
})
