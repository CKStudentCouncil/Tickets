// 報帳 totals and the party's profit (/super_admin/reimbursements)
import { REIMBURSEMENT_STATUSES } from '../data/reimbursements.js'
import { retainedOf } from './cancellations.js'

export const claimAmount = (claim) => Number(claim?.amount) || 0

const registrationAmount = (registration) =>
  (Number(registration?.price) || 0) * (Number(registration?.quantity) || 0)

const sumOf = (list, amountOf) => list.reduce((total, item) => total + amountOf(item), 0)

// Amount and count per status. `spent` is what counts as the party's
// expenses (approved and paid), `owed` what is approved but not paid out yet.
export function summarizeReimbursements(claims = []) {
  const amounts = Object.fromEntries(REIMBURSEMENT_STATUSES.map((status) => [status, 0]))
  const counts = { ...amounts }

  claims.forEach((claim) => {
    if (!Object.hasOwn(amounts, claim?.status)) return
    amounts[claim.status] += claimAmount(claim)
    counts[claim.status] += 1
  })

  return { amounts, counts, spent: amounts.approved + amounts.paid, owed: amounts.approved }
}

// Income is the orders (路宣 among them; 公關票 are NT$0) and the 學弟賣票
// registrations; expenses are the claims. `realized` counts only money
// collected and claims approved; `projected` assumes every order and
// registration is paid and every pending claim approved.
//   orderSummary   { bookedAmount, paidAmount } (fetchOrderSummary)
//   registrations  sellerRegistrations, { price, quantity, paid }
//   cancelled      cancelledOrders: what was paid and not given back counts
//                  in both (utils/cancellations.js retainedOf)
export function calculateProfit({ orderSummary = {}, registrations = [], claims = [], cancelled = [] } = {}) {
  const orders = {
    realized: Number(orderSummary.paidAmount) || 0,
    projected: Number(orderSummary.bookedAmount) || 0
  }
  const sellers = {
    realized: sumOf(registrations.filter((registration) => registration?.paid === true), registrationAmount),
    projected: sumOf(registrations, registrationAmount)
  }
  const retained = sumOf(cancelled, retainedOf)
  const kept = { realized: retained, projected: retained }
  const income = {
    realized: orders.realized + sellers.realized + kept.realized,
    projected: orders.projected + sellers.projected + kept.projected
  }

  const { amounts, spent } = summarizeReimbursements(claims)
  const expenses = { realized: spent, projected: spent + amounts.pending }

  return {
    orders,
    sellers,
    cancelled: kept,
    income,
    expenses,
    profit: {
      realized: income.realized - expenses.realized,
      projected: income.projected - expenses.projected
    }
  }
}

// Per name typed on the claims (who is paid), most claimed first
export function groupByReimburser(claims = []) {
  const rows = new Map()

  claims.forEach((claim) => {
    const name = String(claim?.name || '').trim() || '（未填姓名）'
    const row = rows.get(name) || { name, claims: 0, pending: 0, owed: 0, paid: 0 }
    row.claims += 1
    if (claim.status === 'pending') row.pending += claimAmount(claim)
    if (claim.status === 'approved') row.owed += claimAmount(claim)
    if (claim.status === 'paid') row.paid += claimAmount(claim)
    rows.set(name, row)
  })

  return [...rows.values()].sort(
    (a, b) => b.owed + b.paid + b.pending - (a.owed + a.paid + a.pending) || a.name.localeCompare(b.name)
  )
}
