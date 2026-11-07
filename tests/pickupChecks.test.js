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
  assert.deepEqual(qrFirst.need, { qr: false, card: true, done: 'qr' })

  // the card alone never stands in for the QR code, even for an admin
  const cardFirst = check(early, { scans: { studentId: '1130524' }, isAdmin: true })
  assert.deepEqual(states(cardFirst), { qr: 'wait', id: 'done' })
  assert.equal(cardFirst.canCollect, false)
  assert.equal(cardFirst.label, '等待掃描 QR Code')
  assert.deepEqual(cardFirst.need, { qr: true, card: false, done: 'card' })

  const both = check(early, { scans: { code: 'code-1', studentId: '1130524' } })
  assert.equal(both.canCollect, true)
  assert.equal(both.label, '領票')
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
  assert.equal(campusScanned.label, '領票')
})

test('unpaid orders are blocked until marked paid; complimentary ones are not', () => {
  const unpaid = check({ ...general, paid: false }, { scans: { code: 'code-1' } })
  assert.equal(states(unpaid).paid, 'pay')
  assert.equal(unpaid.canCollect, false)
  assert.equal(unpaid.label, '等待收款')
  assert.equal(check({ ...general, paid: false, complimentary: true }, { scans: { code: 'code-1' } }).canCollect, true)
})

test('the ticket QR code and the buyer\'s own card both scanned: collected by itself', () => {
  assert.equal(check(early, { scans: { code: 'code-1' } }).auto, false)
  assert.equal(check(early, { scans: { studentId: '1130524' } }).auto, false)
  assert.equal(check(early, { scans: { code: 'forged', studentId: '1130524' } }).auto, false)
  assert.equal(check(early, { scans: { code: 'code-1', studentId: '1139999' } }).auto, false)
  // the card standing in for a forgotten QR code still takes the button
  assert.equal(check(early, { scans: { studentId: '1130524' }, exceptions: { qr: { byCard: true } }, isAdmin: true }).auto, false)
  // a general ticket alone has nothing to match a card against
  assert.equal(check(general, { scans: { code: 'code-1' } }).auto, false)

  const both = check(early, { scans: { code: 'code-1', studentId: '1130524' } })
  assert.equal(both.auto, true)
  assert.equal(both.autoPay, false)
  assert.equal(both.request.markPaid, undefined)
  assert.equal(check(priorityCampus, { scans: { code: 'code-1', studentId: '1130524' } }).auto, true)
  assert.equal(check({ ...early, delivered: true }, { scans: { code: 'code-1', studentId: '1130524' } }).auto, false)
})

test('unpaid, with the QR code and the card: paid at the desk and collected, by any staff', () => {
  const unpaid = { ...early, paid: false, finalTotal: 700 }
  const qrOnly = check(unpaid, { scans: { code: 'code-1' } })
  assert.equal(qrOnly.canCollect, false)
  assert.equal(qrOnly.label, '等待掃描學生證')
  assert.deepEqual(qrOnly.need, { qr: false, card: true, done: 'qr' })
  assert.match(qrOnly.rows[0].text, /自動標記付款並領票/)
  assert.equal(qrOnly.rows[0].action.kind, 'paid')

  const cardOnly = check(unpaid, { scans: { studentId: '1130524' } })
  assert.equal(cardOnly.label, '等待掃描 QR Code')

  const both = check(unpaid, { scans: { code: 'code-1', studentId: '1130524' } })
  assert.equal(states(both).paid, 'pay')
  assert.equal(both.rows[0].action, undefined)
  assert.match(both.rows[0].text, /NT\$ 700/)
  assert.equal(both.canCollect, true)
  assert.equal(both.auto, true)
  assert.equal(both.autoPay, true)
  assert.equal(both.label, '收款 NT$ 700，領票')
  assert.equal(both.request.markPaid, true)

  // a general ticket on a 建中 account works the same way
  const campusGeneral = { ...general, ...campus, paid: false }
  assert.equal(check(campusGeneral, { scans: { code: 'code-1' } }).need.card, true)
  assert.equal(check(campusGeneral, { scans: { code: 'code-1', studentId: '1130524' } }).request.markPaid, true)

  // no card can match: an admin marks it paid, as before
  const other = check({ ...general, paid: false }, { scans: { code: 'code-1' } })
  assert.equal(other.need.card, false)
  assert.equal(other.label, '等待收款')
  // an admin's exceptions never mark it paid
  const excepted = check(unpaid, { scans: { studentId: '1130524' }, exceptions: { qr: { byCard: true } }, isAdmin: true })
  assert.equal(excepted.canCollect, false)
  assert.equal(excepted.label, '等待收款')
})

test('several orders, one card: a card carried over from the last order ticks the row and says so', () => {
  const carried = check(early, { scans: { code: 'code-1', studentId: '1130524', cardCarried: true } })
  assert.equal(states(carried).id, 'done')
  assert.match(carried.rows.find((row) => row.key === 'id').text, /剛才已掃/)
  assert.equal(carried.auto, true)
  assert.equal(carried.request.studentCardChecked, true)
  assert.doesNotMatch(check(early, { scans: { code: 'code-1', studentId: '1130524' } }).rows[1].text, /剛才已掃/)
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
