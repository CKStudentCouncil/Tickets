// What collecting one order needs, worked out from what was scanned at the
// desk: the rows the check-in station shows, whether the one button may be
// pressed, what it says, and what is sent to updateOrderDelivery
// (functions/lib/orderActions.js checks the same).
//
// A scan only ever ticks its own row. Nothing is skipped by itself: a
// forgotten QR code, a missing student card or an admin's override is a
// choice staff make with a button (an "exception"), shown in yellow.
import { ID_CHECK_METHODS } from '../data/pickup.js'
import { cleanStudentId, studentAccountEmail } from '../data/schools.js'
import { getIdCheck, requiresStudentCard } from './buyerIdentity.js'

// complimentary tickets (guests) cost nothing and are never marked paid
export const isUnpaid = (order) => !!order && order.paid !== true && order.complimentary !== true

// the 學號 on a 建中 student card belongs to the order's school account
export function cardMatches(order, studentId) {
  const id = cleanStudentId(studentId)
  return !!id && String(order?.customerEmail || '').trim().toLowerCase() === studentAccountEmail(id)
}

const methodShort = (method) => ID_CHECK_METHODS.find((entry) => entry.value === method)?.short || ''

// `scans`: { code, studentId } read at the desk for this order
// `exceptions`: { qr: null | { byCard: true } | { reason }, id: null | { method, note } }
// row.state: wait (still to scan) | look (staff look at an ID, confirmed by
// the button) | done | excepted | bad
export function pickupChecks(order, { ticketTypes = [], scans = {}, exceptions = {}, isAdmin = false } = {}) {
  if (!order) return null
  const code = String(scans.code || '')
  const studentId = cleanStudentId(scans.studentId)
  const cardOk = cardMatches(order, studentId)
  const needsCard = requiresStudentCard(order, ticketTypes)
  const idCheck = getIdCheck(order)
  const lookAtId = !needsCard && !!idCheck?.student
  // the card stands in for the QR code only while it matches
  const qrException = exceptions.qr?.byCard && !cardOk ? null : exceptions.qr || null
  const idException = needsCard && !cardOk ? exceptions.id || null : null
  const rows = []

  const unpaid = isUnpaid(order)
  if (unpaid && !order.delivered) {
    rows.push({
      key: 'paid',
      title: '付款',
      state: 'bad',
      text: '尚未付款：先收款，標記已付款後才能領票',
      action: { kind: 'paid', label: '已收款，標記付款', allowed: isAdmin }
    })
  }

  // the ticket
  const qr = { key: 'qr', title: '票券 QR Code' }
  if (code && code === order.ticketCode) Object.assign(qr, { state: 'done', text: '驗證碼相符' })
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
    if (cardOk) Object.assign(id, { state: 'done', text: `學號 ${studentId} 相符` })
    else if (idException) Object.assign(id, { state: 'excepted', text: `沒帶學生證：已用${methodShort(idException.method)}查驗${idException.note ? `（${idException.note}）` : ''}` })
    else Object.assign(id, { state: 'wait', text: '等待掃描建中學生證…', action: { kind: 'id', label: '沒帶學生證？', allowed: true } })
    rows.push(id)
  } else if (lookAtId) {
    const id = { key: 'id', title: '學生證' }
    if (cardOk) Object.assign(id, { state: 'done', text: `學號 ${studentId} 相符` })
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
  const canCollect = !order.delivered && !unpaid && qrOk && idOk

  let label
  if (order.delivered) label = '已領票'
  else if (unpaid) label = '尚未付款，不能領票'
  else if (!qrOk) label = qr.state === 'bad' && code ? 'QR Code 不符，不能領票' : '等待掃描 QR Code'
  else if (!idOk) label = '等待掃描學生證'
  else if (idRow?.state === 'excepted') label = `已用${methodShort(idException.method)}查驗，領票`
  else if (idRow?.state === 'look') label = '已看過學生證，領票'
  else label = '領票'

  // what a phone scanning for this order is asked for
  const need = {
    qr: qr.state === 'wait' || qr.state === 'bad',
    card: needsCard && idRow?.state === 'wait'
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
    ...(idException ? { idCheck: { method: idException.method, note: idException.note || '' } } : {})
  }

  return { rows, needsCard, cardOk, unpaid, canCollect, label, need, request }
}

// rows an admin's 強制領票 skips (listed in its dialog)
export const unfinishedRows = (checks) => (checks?.rows || []).filter((row) => row.key !== 'paid' && (row.state === 'wait' || row.state === 'bad'))
