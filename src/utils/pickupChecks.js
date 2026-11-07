// What collecting one order needs, worked out from what was scanned at the
// desk: the rows the check-in station shows, whether the one button may be
// pressed, what it says, and what is sent to updateOrderDelivery
// (functions/lib/orderActions.js checks the same).
//
// A scan only ever ticks its own row. Nothing is skipped by itself: a
// forgotten QR code, a missing student card or an admin's override is a
// choice staff make with a button (an "exception"), shown in yellow.
//
// The ticket's own QR code and the buyer's own student card both scanned
// (`auto`): the station collects by itself, and an unpaid order is marked
// paid in the same step (staff take the cash at the desk).
import { ID_CHECK_METHODS } from '../data/pickup.js'
import { accountStudentId, cleanStudentId, studentAccountEmail } from '../data/schools.js'
import { getIdCheck, requiresStudentCard } from './buyerIdentity.js'

// complimentary tickets (guests) cost nothing and are never marked paid
export const isUnpaid = (order) => !!order && order.paid !== true && order.complimentary !== true

// the 學號 on a 建中 student card belongs to the order's school account
export function cardMatches(order, studentId) {
  const id = cleanStudentId(studentId)
  return !!id && String(order?.customerEmail || '').trim().toLowerCase() === studentAccountEmail(id)
}

const methodShort = (method) => ID_CHECK_METHODS.find((entry) => entry.value === method)?.short || ''

// ' NT$ 700', or '' when the order has no total
export function amountText(order) {
  const amount = Number(order?.finalTotal)
  return Number.isFinite(amount) && amount > 0 ? ` NT$ ${amount.toLocaleString('en-US')}` : ''
}

// `scans`: { code, studentId, cardCarried } read at the desk for this order;
// cardCarried: the card was read for the same student's last order (several
// orders, one card), not again for this one
// `exceptions`: { qr: null | { byCard: true } | { reason }, id: null | { method, note } }
// row.state: wait (still to scan) | look (staff look at an ID, confirmed by
// the button) | done | excepted | bad
export function pickupChecks(order, { ticketTypes = [], scans = {}, exceptions = {}, isAdmin = false } = {}) {
  if (!order) return null
  const code = String(scans.code || '')
  const studentId = cleanStudentId(scans.studentId)
  const cardOk = cardMatches(order, studentId)
  const cardText = `學號 ${studentId} 相符${scans.cardCarried ? '（剛才已掃，不用再掃）' : ''}`
  const needsCard = requiresStudentCard(order, ticketTypes)
  const idCheck = getIdCheck(order)
  const lookAtId = !needsCard && !!idCheck?.student
  // the card stands in for the QR code only while it matches
  const qrException = exceptions.qr?.byCard && !cardOk ? null : exceptions.qr || null
  const idException = needsCard && !cardOk ? exceptions.id || null : null
  const rows = []

  const codeOk = !!code && code === order.ticketCode
  // the order belongs to a 建中 school account, so a student card can match it
  const cardPossible = !!accountStudentId(order.customerEmail)
  const unpaid = isUnpaid(order)
  // paid at the desk: the QR code and the card prove it is the buyer
  const autoPay = unpaid && !order.delivered && codeOk && cardOk
  const money = amountText(order)
  if (unpaid && !order.delivered) {
    // collecting money here is part of the job, not a problem
    const pay = { key: 'paid', title: '付款', state: 'pay' }
    if (autoPay) pay.text = `收款${money}；領票時會一併標記已付款`
    else {
      pay.text = cardPossible
        ? `尚未付款：QR Code 和學生證都掃到後，收款${money}就會自動標記付款並領票`
        : `尚未付款：收款${money}後按「已收款，標記付款」，就能接著領票`
      pay.action = { kind: 'paid', label: '已收款，標記付款', allowed: isAdmin }
    }
    rows.push(pay)
  }

  // the ticket
  const qr = { key: 'qr', title: '票券 QR Code' }
  if (codeOk) Object.assign(qr, { state: 'done', text: '驗證碼相符' })
  else if (qrException?.byCard) Object.assign(qr, { state: 'excepted', text: '沒帶 QR Code：以學生證代替（管理員）' })
  else if (qrException?.reason) Object.assign(qr, { state: 'excepted', text: `沒帶 QR Code（管理員）：${qrException.reason}` })
  else if (code) Object.assign(qr, { state: 'bad', text: '驗證碼不符，可能是偽造或舊的 QR Code。請對方重新出示，或請管理員處理' })
  else if (!order.ticketCode) Object.assign(qr, { state: 'bad', text: '這筆訂單沒有 QR 驗證碼，請管理員處理' })
  else Object.assign(qr, { state: 'wait', text: '等待掃描 QR Code…' })
  if (qr.state === 'wait' || qr.state === 'bad') qr.action = { kind: 'qr', label: '沒帶 QR Code？', allowed: isAdmin }
  rows.push(qr)

  // who collects
  if (needsCard) {
    const id = { key: 'id', title: '建中學生證' }
    if (cardOk) Object.assign(id, { state: 'done', text: cardText })
    else if (idException) Object.assign(id, { state: 'excepted', text: `沒帶學生證：已用${methodShort(idException.method)}查驗${idException.note ? `（${idException.note}）` : ''}` })
    else Object.assign(id, { state: 'wait', text: '等待掃描建中學生證…', action: { kind: 'id', label: '沒帶學生證？', allowed: true } })
    rows.push(id)
  } else if (lookAtId) {
    const id = { key: 'id', title: '學生證' }
    if (cardOk) Object.assign(id, { state: 'done', text: cardText })
    else {
      Object.assign(id, {
        state: 'look',
        text: '看學生證（背面有本學期註冊章）或酷課雲，確認是本人',
        hint: idCheck.campus ? '建中學生證放進相機，會自動比對學號' : ''
      })
    }
    rows.push(id)
  }

  const qrOk = qr.state === 'done' || qr.state === 'excepted'
  const idRow = rows.find((row) => row.key === 'id')
  const idOk = !idRow || idRow.state !== 'wait'
  const waitingPay = unpaid && !autoPay
  const canCollect = !order.delivered && !waitingPay && qrOk && idOk
  // collected by itself, no button
  const auto = canCollect && codeOk && cardOk

  let label
  if (order.delivered) label = '已領票'
  else if (waitingPay && !cardPossible) label = '等待收款'
  else if (!qrOk) label = qr.state === 'bad' && code ? 'QR Code 不符，不能領票' : '等待掃描 QR Code'
  else if (waitingPay) label = cardOk ? '等待收款' : '等待掃描學生證'
  else if (!idOk) label = '等待掃描學生證'
  else if (idRow?.state === 'excepted') label = `已用${methodShort(idException.method)}查驗，領票`
  else if (idRow?.state === 'look') label = '已看過學生證，領票'
  else label = autoPay ? `收款${money}，領票` : '領票'

  // what a phone scanning for this order is asked for; an unpaid order a
  // card can match wants the card too, to be paid at the desk
  const need = {
    qr: qr.state === 'wait' || qr.state === 'bad',
    card: (needsCard && idRow?.state === 'wait') || (waitingPay && cardPossible && !cardOk)
  }
  // one of the two scanned and the other still wanted: the camera says so
  need.done = need.qr && !need.card && cardOk ? 'card' : need.card && !need.qr && qr.state === 'done' ? 'qr' : ''

  // updateOrderDelivery's options; `overrideReason` is added by an admin's
  // 強制領票 (the station's dialog)
  const request = {
    ticketCode: code,
    expectedDelivered: !!order.delivered,
    ...(qrException?.reason ? { overrideReason: qrException.reason } : {}),
    ...(cardOk ? { studentId, studentCardChecked: true } : {}),
    ...(qrException?.byCard ? { skipQr: true } : {}),
    ...(idException ? { idCheck: { method: idException.method, note: idException.note || '' } } : {}),
    ...(autoPay ? { markPaid: true } : {})
  }

  return { rows, needsCard, cardOk, unpaid, autoPay, auto, money, canCollect, label, need, request }
}

// rows an admin's 強制領票 skips (listed in its dialog)
export const unfinishedRows = (checks) => (checks?.rows || []).filter((row) => row.key !== 'paid' && (row.state === 'wait' || row.state === 'bad'))
