import test from 'node:test'
import assert from 'node:assert/strict'
import { cardMatches, pickupChecks, unfinishedRows } from '../src/utils/pickupChecks.js'

const types = [
  { id: 'early', name: '早鳥票', eligibleBuyerIdentity: 'campus_students' },
  { id: 'general', name: '一般票', eligibleBuyerIdentity: 'all' }
]
const base = { id: 'CKS20261107TESTAA', paid: true, delivered: false, ticketCode: 'code-1' }
const campus = { customerEmail: 'ck1130524@gl.ck.tp.edu.tw', school: '建國中學', buyerType: 'student' }
const early = { ...base, ...campus, items: [{ ticketTypeId: 'early', name: '早鳥票', quantity: 1 }] }
const general = { ...base, customerEmail: 'guest@example.com', buyerType: 'public', items: [{ ticketTypeId: 'general', name: '一般票', quantity: 1 }] }
const priorityOther = { ...base, customerEmail: 's@ms.hs.edu.tw', school: '師大附中', buyerType: 'student', items: [{ ticketTypeId: 'general', name: '學生優先票', quantity: 1, checkId: true }] }
const priorityCampus = { ...priorityOther, ...campus }

const check = (order, options = {}) => pickupChecks(order, { ticketTypes: types, ...options })
const states = (checks) => Object.fromEntries(checks.rows.map((row) => [row.key, row.state]))

test('a general ticket needs its QR code, then one tap', () => {
  const waiting = check(general)
  assert.deepEqual(states(waiting), { qr: 'wait' })
  assert.equal(waiting.canCollect, false)
  assert.equal(waiting.label, '等待掃描 QR Code')
  const ready = check(general, { scans: { code: 'code-1' } })
  assert.deepEqual(states(ready), { qr: 'done' })
  assert.equal(ready.canCollect, true)
  assert.equal(ready.label, '領票')
  assert.deepEqual(ready.request, { ticketCode: 'code-1', expectedDelivered: false })
})

test('早鳥票 waits for both the QR code and the card, in either order', () => {
  const qrFirst = check(early, { scans: { code: 'code-1' } })
  assert.deepEqual(states(qrFirst), { qr: 'done', id: 'wait' })
  assert.equal(qrFirst.label, '等待掃描學生證')
  assert.deepEqual(qrFirst.need, { qr: false, card: true })

  // the card alone never stands in for the QR code, even for an admin
  const cardFirst = check(early, { scans: { studentId: '1130524' }, isAdmin: true })
  assert.deepEqual(states(cardFirst), { qr: 'wait', id: 'done' })
  assert.equal(cardFirst.canCollect, false)
  assert.equal(cardFirst.label, '等待掃描 QR Code')
  assert.deepEqual(cardFirst.need, { qr: true, card: false })

  const both = check(early, { scans: { code: 'code-1', studentId: '1130524' } })
  assert.equal(both.canCollect, true)
  assert.equal(both.label, '照片是本人，領票')
  assert.deepEqual(both.request, { ticketCode: 'code-1', expectedDelivered: false, studentId: '1130524', studentCardChecked: true })
})

test('a wrong QR code is red and blocks; another student\'s card does not tick the row', () => {
  const wrong = check(early, { scans: { code: 'forged', studentId: '1130524' } })
  assert.equal(states(wrong).qr, 'bad')
  assert.equal(wrong.label, 'QR Code 不符，不能領票')
  assert.equal(wrong.canCollect, false)
  assert.equal(states(check(early, { scans: { code: 'code-1', studentId: '1139999' } })).id, 'wait')
  assert.equal(cardMatches(early, '1130524'), true)
  assert.equal(cardMatches(early, '1139999'), false)
})

test('exceptions are chosen, shown in yellow, and sent to the server', () => {
  const noCard = check(early, { scans: { code: 'code-1' }, exceptions: { id: { method: 'kuclass', note: '' } } })
  assert.equal(states(noCard).id, 'excepted')
  assert.equal(noCard.label, '已用酷課雲查驗，領票')
  assert.deepEqual(noCard.request.idCheck, { method: 'kuclass', note: '' })

  const noQr = check(early, { scans: { studentId: '1130524' }, exceptions: { qr: { byCard: true } }, isAdmin: true })
  assert.equal(states(noQr).qr, 'excepted')
  assert.equal(noQr.canCollect, true)
  assert.equal(noQr.request.skipQr, true)

  // the card has to match for it to stand in
  assert.equal(states(check(early, { exceptions: { qr: { byCard: true } }, isAdmin: true })).qr, 'wait')

  const reason = check(general, { exceptions: { qr: { reason: '手機沒電，核對身分證' } }, isAdmin: true })
  assert.equal(reason.canCollect, true)
  assert.equal(reason.request.overrideReason, '手機沒電，核對身分證')
})

test('沒帶 QR Code is for admins; managers see it greyed out', () => {
  assert.equal(check(general).rows[0].action.allowed, false)
  assert.equal(check(general, { isAdmin: true }).rows[0].action.allowed, true)
  assert.equal(check(general, { scans: { code: 'code-1' } }).rows[0].action, undefined)
})

test('student-priority tickets: staff look at the ID; a 建中 card scanned is checked too', () => {
  const other = check(priorityOther, { scans: { code: 'code-1' } })
  assert.deepEqual(states(other), { qr: 'done', id: 'look' })
  assert.equal(other.canCollect, true)
  assert.equal(other.label, '已看過學生證，領票')
  assert.equal(other.need.card, false)

  const campusScanned = check(priorityCampus, { scans: { code: 'code-1', studentId: '1130524' } })
  assert.equal(states(campusScanned).id, 'done')
  assert.equal(campusScanned.label, '照片是本人，領票')
})

test('unpaid orders are blocked until marked paid; complimentary ones are not', () => {
  const unpaid = check({ ...general, paid: false }, { scans: { code: 'code-1' } })
  assert.equal(states(unpaid).paid, 'bad')
  assert.equal(unpaid.canCollect, false)
  assert.equal(unpaid.label, '尚未付款，不能領票')
  assert.equal(check({ ...general, paid: false, complimentary: true }, { scans: { code: 'code-1' } }).canCollect, true)
})

test('an admin\'s 強制領票 lists what it skips', () => {
  const checks = check(early, { scans: { studentId: '1130524' } })
  assert.deepEqual(unfinishedRows(checks).map((row) => row.key), ['qr'])
  assert.deepEqual(unfinishedRows(check(early)).map((row) => row.key), ['qr', 'id'])
})

test('a collected order cannot be collected again', () => {
  const done = check({ ...general, delivered: true }, { scans: { code: 'code-1' } })
  assert.equal(done.canCollect, false)
  assert.equal(done.label, '已領票')
})
