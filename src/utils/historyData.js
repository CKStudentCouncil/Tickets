// 歷年資料 (/super_admin/history): every year's stored records, to download
// as the Excel of src/utils/orderBackup.js long after the event. A year's
// orders are those 清除所有訂單 archived (salesArchives/{year}/archivedOrders)
// or the sale rows imported for it (匯入往年資料); 報帳 carry their party
// year and 舞會滿意度調查 are kept per year; the 購票系統 survey, the 學弟賣票
// list and registrations go by the Taiwan year they were created in, as
// orders are archived. Pure, so tests/historyData.test.js runs it with node.
import { parseDate } from './datetime.js'
import { summarizeReimbursements } from './reimbursements.js'

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
        ? { source: archive.source || 'purge', orderCount: Number(archive.orderCount) || 0, revenue: Number(archive.revenue) || 0 }
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
