// The party's 收支表 on /super_admin/reimbursements, laid out like the
// council's 總預算表: each row has 款 / 項 / 目 / 節 codes, a name, income or
// expense and a note, with 合計 first and 結餘 last. The page, the Excel file
// and the PDF are all drawn from these rows.
//
//   款 1 舞會收入   項: 線上售票, 路宣, 學弟賣票 (目: each ticket type),
//                   取消訂單未退還款項 (目: each 取消原因), 公關票 (NT$0,
//                   only how many)
//   款 2 舞會支出   項: each 科目 in REIMBURSEMENT_CATEGORIES order (目: each claim)
//
// `basis` is the profit's (utils/reimbursements.js): 'realized' counts money
// collected and claims approved or paid out; 'projected' every order and
// registration and every claim not rejected.
import {
  REIMBURSEMENT_CATEGORIES,
  REIMBURSEMENT_STATUS_LABELS,
  UNCATEGORIZED
} from '../data/reimbursements.js'
import { CANCEL_REASONS } from '../data/cancellations.js'
import { parseDate } from './datetime.js'
import { claimAmount } from './reimbursements.js'
import { retainedOf } from './cancellations.js'

export const STATEMENT_BASES = {
  realized: { label: '目前', detail: '已收款的訂單與學弟賣票，已核准及已撥款的報帳' },
  projected: { label: '預估', detail: '全部訂單與學弟賣票（含未收款），未退回的報帳' }
}

const COUNTED_CLAIMS = {
  realized: ['approved', 'paid'],
  projected: ['pending', 'approved', 'paid']
}

const quantityOf = (items) => items.reduce((total, item) => total + (Number(item?.quantity) || 0), 0)
const time = (value) => parseDate(value)?.getTime() || 0

// codes as the 總預算表 prints them: blank above the row's level, 0 below
function codesOf(level, number) {
  return [0, 1, 2, 3].map((index) => (index < level ? '' : index === level ? number : 0))
}

// Ticket types sold, each { name, quantity, amount }, most income first
function byTicketType(lines) {
  const types = new Map()
  lines.forEach(({ key, name, price, quantity }) => {
    const type = types.get(key) || { name, quantity: 0, amount: 0 }
    type.quantity += quantity
    type.amount += price * quantity
    types.set(key, type)
  })
  return [...types.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
}

const orderLines = (orders) => orders.flatMap((order) => (Array.isArray(order.items) ? order.items : []).map((item) => ({
  key: String(item?.ticketTypeId || item?.id || item?.name || ''),
  name: String(item?.name || '未命名票種'),
  price: Number(item?.price) || 0,
  quantity: Number(item?.quantity) || 0
})))

const registrationLines = (registrations) => registrations.map((registration) => ({
  key: String(registration?.ticketTypeId || registration?.ticketTypeName || ''),
  name: String(registration?.ticketTypeName || '學弟賣票'),
  price: Number(registration?.price) || 0,
  quantity: Number(registration?.quantity) || 0
}))

// { rows, income, expense, balance }; a row is { codes, name, income,
// expense, note, kind }, kind 'total' | 'group' | 'item' | 'balance'
// `cancelled` are cancelledOrders: what was paid and not given back is income
// on both bases.
export function buildStatement({ orders = [], registrations = [], claims = [], cancelled = [], basis = 'realized' } = {}) {
  const realized = basis === 'realized'
  const collected = (record) => !realized || record?.paid === true

  const street = orders.filter((order) => order?.streetSale === true)
  const guests = orders.filter((order) => order?.complimentary === true)
  const online = orders.filter((order) => order?.streetSale !== true && order?.complimentary !== true)

  // [項 name, 目 rows (ticket types), how many records the 項 has at all]
  const incomeSections = [
    ['線上售票', byTicketType(orderLines(online.filter(collected))), online.length],
    ['路宣', byTicketType(orderLines(street.filter(collected))), street.length],
    ['學弟賣票', byTicketType(registrationLines(registrations.filter(collected))), registrations.length]
  ].filter(([, , count]) => count > 0)

  const counted = claims.filter((claim) => COUNTED_CLAIMS[realized ? 'realized' : 'projected'].includes(claim?.status))
  const categoryOf = (claim) => (REIMBURSEMENT_CATEGORIES.includes(claim?.category) ? claim.category : UNCATEGORIZED)
  const expenseSections = [...REIMBURSEMENT_CATEGORIES, UNCATEGORIZED]
    .map((category) => [category, counted.filter((claim) => categoryOf(claim) === category).sort((a, b) => time(a.createdAt) - time(b.createdAt))])
    .filter(([, list]) => list.length > 0)

  const incomeRows = []
  incomeSections.forEach(([name, types], index) => {
    incomeRows.push({
      codes: codesOf(1, index + 1),
      name,
      income: types.reduce((total, type) => total + type.amount, 0),
      expense: null,
      note: types.length ? `${types.reduce((total, type) => total + type.quantity, 0)} 張` : '',
      kind: 'group'
    })
    types.forEach((type, typeIndex) => incomeRows.push({
      codes: codesOf(2, typeIndex + 1),
      name: type.name,
      income: type.amount,
      expense: null,
      note: `${type.quantity} 張`,
      kind: 'item'
    }))
  })
  let groupCount = incomeSections.length
  const kept = cancelled.filter((order) => retainedOf(order) > 0)
  if (kept.length) {
    const reasons = new Map()
    kept.forEach((order) => {
      const key = Object.hasOwn(CANCEL_REASONS, order.cancelReason) ? order.cancelReason : 'other'
      const reason = reasons.get(key) || { amount: 0, count: 0 }
      reason.amount += retainedOf(order)
      reason.count += 1
      reasons.set(key, reason)
    })
    // in CANCEL_REASONS order
    const list = Object.keys(CANCEL_REASONS).filter((key) => reasons.has(key)).map((key) => [key, reasons.get(key)])
    incomeRows.push({
      codes: codesOf(1, ++groupCount),
      name: '取消訂單未退還款項',
      income: list.reduce((total, [, reason]) => total + reason.amount, 0),
      expense: null,
      note: `${kept.length} 筆`,
      kind: 'group'
    })
    list.forEach(([key, reason], index) => incomeRows.push({
      codes: codesOf(2, index + 1),
      name: CANCEL_REASONS[key],
      income: reason.amount,
      expense: null,
      note: `${reason.count} 筆`,
      kind: 'item'
    }))
  }
  if (guests.length) {
    incomeRows.push({
      codes: codesOf(1, groupCount + 1),
      name: '公關票',
      income: 0,
      expense: null,
      note: `${guests.reduce((total, order) => total + quantityOf(order.items || []), 0)} 張，不收費`,
      kind: 'group'
    })
  }

  const expenseRows = []
  expenseSections.forEach(([category, list], index) => {
    expenseRows.push({
      codes: codesOf(1, index + 1),
      name: category,
      income: null,
      expense: list.reduce((total, claim) => total + claimAmount(claim), 0),
      note: `${list.length} 筆`,
      kind: 'group'
    })
    list.forEach((claim, claimIndex) => expenseRows.push({
      codes: codesOf(2, claimIndex + 1),
      name: String(claim.note || '').trim() || '（未填用途）',
      income: null,
      expense: claimAmount(claim),
      note: `${String(claim.name || '').trim()}・${REIMBURSEMENT_STATUS_LABELS[claim.status] || claim.status}`,
      kind: 'item'
    }))
  })

  // the 項 rows: every 目 is counted in its 項
  const income = incomeRows.filter((row) => row.kind === 'group').reduce((total, row) => total + row.income, 0)
  const expense = expenseRows.filter((row) => row.kind === 'group').reduce((total, row) => total + row.expense, 0)

  const rows = [
    { codes: ['', '', '', ''], name: '合計', income, expense, note: '', kind: 'total' },
    { codes: codesOf(0, 1), name: '舞會收入', income, expense: null, note: '', kind: 'group' },
    ...incomeRows,
    { codes: codesOf(0, 2), name: '舞會支出', income: null, expense, note: '', kind: 'group' },
    ...expenseRows,
    { codes: ['', '', '', ''], name: '結餘', income: income - expense, expense: null, note: '收入減支出', kind: 'balance' }
  ]

  return { rows, income, expense, balance: income - expense }
}

// Orders as the profit takes them (calculateProfit's orderSummary)
export function summarizeOrders(orders = []) {
  return orders.reduce((summary, order) => {
    const total = Number(order?.finalTotal) || 0
    summary.bookedAmount += total
    if (order?.paid === true) summary.paidAmount += total
    return summary
  }, { bookedAmount: 0, paidAmount: 0 })
}
