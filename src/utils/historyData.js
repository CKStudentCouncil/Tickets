// 歷年資料 (/super_admin/history): every year's stored records, to download
// as the Excel of src/utils/orderBackup.js long after the event. A year's
// orders are those 清除所有訂單 archived (salesArchives/{year}/archivedOrders)
// or the sale rows imported for it (匯入往年資料); 報帳 carry their party
// year and 舞會滿意度調查 are kept per year; the 購票系統 survey, the 學弟賣票
// list and registrations go by the Taiwan year they were created in, as
// orders are archived. Pure, so tests/historyData.test.js runs it with node.
import { REIMBURSEMENT_CATEGORIES, UNCATEGORIZED } from '../data/reimbursements.js'
import { parseDate } from './datetime.js'
import { calculateProfit, claimAmount, summarizeReimbursements } from './reimbursements.js'
import { IDENTITY_GROUPS, groupOf, taipeiDayStart } from './salesAnalytics.js'

const TAIPEI_YEAR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric' })

export function taiwanYearOf(value) {
  const date = parseDate(value)
  return date ? Number(TAIPEI_YEAR.format(date)) : null
}

const createdIn = (year) => (record) => taiwanYearOf(record?.createdAt) === year
const claimedIn = (year) => (claim) => Number(claim?.year) === year
const invoiceCount = (claims) => claims.reduce((sum, claim) => sum + (Array.isArray(claim.invoices) ? claim.invoices.filter(Boolean).length : 0), 0)

// The sale's ticket type names of an archived year, by key
export const archiveNamesOf = (archive) =>
  Object.fromEntries(Object.entries(archive?.byTicketType || {}).map(([key, type]) => [key, type?.name || key]))

// Every year with any record, latest first, and what it holds.
//   archives            salesArchives docs with their ids (the year)
//   archivedCounts      { [year]: archivedOrders count }
//   partySurveys        partySurveys docs with their ids (the year)
//   partySurveyCounts   { [year]: responses count }
//   surveyResponses, reimbursements, sellers, sellerRegistrations
export function historyYears({
  archives = [],
  archivedCounts = {},
  partySurveys = [],
  partySurveyCounts = {},
  surveyResponses = [],
  reimbursements = [],
  sellers = [],
  sellerRegistrations = []
} = {}) {
  const years = new Set([
    ...archives.map((archive) => Number(archive.id)),
    ...partySurveys.map((survey) => Number(survey.id)),
    ...reimbursements.map((claim) => Number(claim.year)),
    ...[...surveyResponses, ...sellers, ...sellerRegistrations].map((record) => taiwanYearOf(record.createdAt))
  ].filter(Number.isInteger))

  return [...years].sort((a, b) => b - a).map((year) => {
    const archive = archives.find((item) => Number(item.id) === year)
    const claims = reimbursements.filter(claimedIn(year))
    const hasPartySurvey = partySurveys.some((survey) => Number(survey.id) === year)

    return {
      year,
      archive: archive
        ? {
            source: archive.source || 'purge',
            orderCount: Number(archive.orderCount) || 0,
            ticketCount: Number(archive.ticketCount) || 0,
            revenue: Number(archive.revenue) || 0
          }
        : null,
      archivedOrders: Number(archivedCounts[year]) || 0,
      surveyResponses: surveyResponses.filter(createdIn(year)).length,
      // null: that year had no 舞會滿意度調查
      partySurveyResponses: hasPartySurvey ? Number(partySurveyCounts[year]) || 0 : null,
      reimbursements: claims.length,
      spent: summarizeReimbursements(claims).spent,
      invoices: invoiceCount(claims),
      sellers: sellers.filter(createdIn(year)).length,
      sellerRegistrations: sellerRegistrations.filter(createdIn(year)).length
    }
  })
}

const DAY_MS = 86_400_000

// How fast the latest `count` archived sales sold, latest first: the
// tickets sold by the end of each day from openDate to closeDate (from the
// archive's byDay). As on /super_admin/analytics, days before the opening
// count as day 1 and after the close as the last day; orders without a
// time are in no day.
//   -> [{ year, start (ms), daily: [tickets per day], tickets: [running total] }]
export function salePaces(archives = [], count = 3) {
  return archives
    .map((archive) => ({
      archive,
      year: Number(archive.id),
      start: taipeiDayStart(archive.openDate),
      end: taipeiDayStart(archive.closeDate)
    }))
    .filter(({ year, start, end }) => Number.isInteger(year) && start !== null && end !== null && end >= start)
    .sort((a, b) => b.year - a.year)
    .slice(0, count)
    .map(({ archive, year, start, end }) => {
      const daily = new Array(Math.round((end - start) / DAY_MS) + 1).fill(0)
      Object.entries(archive.byDay || {}).forEach(([date, totals]) => {
        const at = taipeiDayStart(date)
        if (at === null) return
        const day = Math.min(daily.length - 1, Math.max(0, Math.round((at - start) / DAY_MS)))
        daily[day] += Number(totals?.ticketCount) || 0
      })
      let sold = 0
      return { year, start, daily, tickets: daily.map((tickets) => (sold += tickets)) }
    })
}

// How front-loaded a sale (salePaces) was: the shares of its tickets sold
// on day 1 and in the first 7 days, and how many days it took to sell half
// and nine tenths of them. null for a sale without tickets.
export function paceStats({ daily = [], tickets = [] } = {}) {
  const total = tickets[tickets.length - 1] || 0
  if (!total) return null
  const daysToSell = (share) => tickets.findIndex((sold) => sold >= total * share) + 1
  return {
    firstDay: daily[0] / total,
    firstWeek: tickets[Math.min(6, tickets.length - 1)] / total,
    half: daysToSell(0.5),
    most: daysToSell(0.9)
  }
}

// The tickets each 購買者身分 bought in an archived year (its bySchool), in
// IDENTITY_GROUPS order, as /super_admin/analytics groups them
export function identityTicketsOf(archive) {
  const tickets = IDENTITY_GROUPS.map(() => 0)
  Object.entries(archive?.bySchool || {}).forEach(([school, totals]) => {
    tickets[IDENTITY_GROUPS.findIndex((group) => group.key === groupOf(school))] += Number(totals?.ticketCount) || 0
  })
  return tickets
}

// 科目 as the 收支表 lists the expenses: REIMBURSEMENT_CATEGORIES, then 未分類
export const EXPENSE_CATEGORIES = [...REIMBURSEMENT_CATEGORIES, UNCATEGORIZED]

// A party year's expenses (approved and paid claims) per EXPENSE_CATEGORIES
export function expensesByCategory(claims = [], year) {
  const amounts = EXPENSE_CATEGORIES.map(() => 0)
  claims
    .filter((claim) => claimedIn(year)(claim) && (claim.status === 'approved' || claim.status === 'paid'))
    .forEach((claim) => {
      const index = REIMBURSEMENT_CATEGORIES.indexOf(claim.category)
      amounts[index < 0 ? amounts.length - 1 : index] += claimAmount(claim)
    })
  return amounts
}

// A year's 收支 as the 收支 page's 目前利潤 counts it (calculateProfit,
// realized): the archived orders' collected total (salesArchives'
// paidRevenue, the paid orders' finalTotal), the 學弟賣票 registrations made
// and paid that year, and the approved and paid claims per
// EXPENSE_CATEGORIES. null for a year without archived orders.
export function balanceOf(records = {}, year) {
  const archive = (records.archives || []).find((item) => Number(item.id) === year)
  if (!archive) return null
  const { sellerRegistrations, reimbursements } = recordsOf(records, year)
  const profit = calculateProfit({
    orderSummary: { paidAmount: Number(archive.paidRevenue) || 0, bookedAmount: Number(archive.revenue) || 0 },
    registrations: sellerRegistrations,
    claims: reimbursements
  })
  return {
    orders: profit.orders.realized,
    sellers: profit.sellers.realized,
    expenses: expensesByCategory(reimbursements, year),
    income: profit.income.realized,
    expense: profit.expenses.realized,
    balance: profit.profit.realized
  }
}

// A year's records as buildOrderBackup takes them; every record for null
// (records without a time are only in that one)
export function recordsOf(records, year = null) {
  const pick = (list = [], belongs) => (year === null ? list : list.filter(belongs(year)))
  return {
    surveyResponses: pick(records.surveyResponses, createdIn),
    reimbursements: pick(records.reimbursements, claimedIn),
    sellers: pick(records.sellers, createdIn),
    sellerRegistrations: pick(records.sellerRegistrations, createdIn)
  }
}

// The year a page is asked to show (?year=2025), or null
export function yearFromQuery(value) {
  const text = Array.isArray(value) ? value[0] : value
  if (!/^\d{4}$/.test(String(text ?? ''))) return null
  const year = Number(text)
  return year >= 2000 && year <= 2999 ? year : null
}

// A year imported from Excel keeps only sale rows ({ t, v, p, d, s, g, i:
// [{ k, q, u }] }); as orders for the 收支表. 路宣 and 公關票 cannot be told
// apart in them, so all count as online sales.
export function ordersFromSaleRows(rows = [], names = {}) {
  return rows.filter(Boolean).map((row) => ({
    createdAt: row.t ? new Date(row.t) : null,
    finalTotal: Number(row.v) || 0,
    paid: row.p === true,
    delivered: row.d === true,
    school: row.s || '',
    items: (Array.isArray(row.i) ? row.i : []).filter(Boolean).map((item) => ({
      ticketTypeId: item.k,
      name: names[item.k] || item.k,
      price: Number(item.u) || 0,
      quantity: Number(item.q) || 0
    }))
  }))
}

export function historyFileName(year = null, exportedAt = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(exportedAt)
  return `${year === null ? '歷年' : `${year}年`}資料_${date}.xlsx`
}
