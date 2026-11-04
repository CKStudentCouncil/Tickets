// The Excel backup downloaded before 清除所有訂單 (useOrderPurge): every
// order with all its fields, so nothing is lost even if the Firestore
// archive were; with them the year's other records, which the purge keeps:
// the 購票系統 survey, every year's 舞會滿意度調查, the 報帳 claims (with
// links to their invoices in Drive) and the 學弟賣票 list and registrations.
// Pure, so tests/orderBackup.test.js runs it with node.
import { formatDateTime } from './datetime.js'
import { SCALE_SECTIONS } from '../data/surveyQuestions.js'
import { INVOICE_DRIVE_OWNER, REIMBURSEMENT_STATUS_LABELS, UNCATEGORIZED } from '../data/reimbursements.js'

export const EMAIL_STATUS = {
  sent: '郵件服務已接受',
  accepted: '郵件服務已接受',
  retry: '等待重試',
  queued: '已排入寄送佇列',
  sending: '寄送中',
  uncertain: '寄送結果待查',
  failed: '寄送失敗',
  pending: '尚未寄出',
  skipped: '無 Email'
}

// Excel keeps at most 32,767 characters in a cell
export const MAX_CELL_TEXT = 32_000

const quantityOf = (item) => Number(item?.quantity) || 0
const itemsOf = (order) => (Array.isArray(order.items) ? order.items.filter(Boolean) : [])
const invoicesOf = (claim) => (Array.isArray(claim.invoices) ? claim.invoices.filter(Boolean) : [])
const invoiceUrl = (file) => file.url || (file.fileId ? `https://drive.google.com/file/d/${file.fileId}/view` : '')

function millisOf(value) {
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  if (value instanceof Date) return value.getTime()
  return 0
}

const byCreatedAt = (list) => [...list].sort((a, b) => millisOf(a.createdAt) - millisOf(b.createdAt))

// a survey answer as one cell: a multiple choice as 「A、B」
function answerText(value) {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.map(answerText).filter((text) => text !== '').join('、')
  if (typeof value === 'object') return JSON.stringify(toPlain(value))
  return value
}

// Text split to fit Excel's cells, never inside a surrogate pair
export function splitText(text, size = MAX_CELL_TEXT) {
  const parts = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + size, text.length)
    const last = text.charCodeAt(end - 1)
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1
    parts.push(text.slice(start, end))
    start = end
  }
  return parts.length ? parts : ['']
}

// Firestore values as JSON: timestamps become ISO strings
export function toPlain(value) {
  if (value === null || value === undefined) return value ?? null
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toPlain)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlain(item)]))
  return value
}

export function backupTotals(orders) {
  return orders.reduce((totals, order) => {
    const revenue = Number(order.finalTotal) || 0
    totals.orders += 1
    totals.tickets += itemsOf(order).reduce((sum, item) => sum + quantityOf(item), 0)
    totals.revenue += revenue
    if (order.paid) totals.paidRevenue += revenue
    if (order.delivered) totals.deliveredOrders += 1
    return totals
  }, { orders: 0, tickets: 0, revenue: 0, paidRevenue: 0, deliveredOrders: 0 })
}

export const PURGE_DESCRIPTION = '清除所有訂單前的完整備份；問卷、舞會滿意度調查、報帳與學弟賣票資料只有備份，沒有被刪除'
const RAW_NOTE = '「原始資料」（訂單）與「其他原始資料」工作表保留每份文件的全部欄位（JSON），太長的分成多列，依「段落」順序接起來即可'

// [{ name, columns: [{ header, key, width }], rows }], one per worksheet.
//   scope                what the file covers, e.g. 「2026 年」 (歷年資料)
//   description          what it is, before the note on the raw sheets
//   importedSales        [{ year, rows, names }]: the sale rows of a year
//                        imported from Excel (functions/lib/salesArchive.js)
//   surveyResponses      surveyResponses, with their ids
//   partySurveys         [{ year, survey: partySurveys/{year} with its id, responses }]
//   reimbursements       the claims
//   sellers              the 學弟賣票 list (id: the email)
//   sellerRegistrations  their registrations
export function buildOrderBackup(orders, {
  exportedAt = new Date(),
  exportedBy = '',
  scope = '',
  description = PURGE_DESCRIPTION,
  importedSales = [],
  surveyResponses = [],
  partySurveys = [],
  reimbursements = [],
  sellers = [],
  sellerRegistrations = []
} = {}) {
  const totals = backupTotals(orders)
  const invoiceCount = reimbursements.reduce((sum, claim) => sum + invoicesOf(claim).length, 0)

  const summary = {
    name: '摘要',
    columns: [{ header: '項目', key: 'label', width: 22 }, { header: '內容', key: 'value', width: 48 }],
    rows: [
      { label: '備份時間', value: formatDateTime(exportedAt) },
      { label: '備份者', value: exportedBy },
      ...(scope ? [{ label: '資料範圍', value: scope }] : []),
      { label: '訂單數', value: totals.orders },
      { label: '票券張數', value: totals.tickets },
      { label: '訂單應收金額', value: totals.revenue },
      { label: '已收款金額', value: totals.paidRevenue },
      { label: '已領票訂單數', value: totals.deliveredOrders },
      ...(importedSales.length
        ? [{ label: '匯入的銷售資料筆數', value: importedSales.map(({ year, rows }) => `${year} 年 ${rows.length} 筆`).join('；') }]
        : []),
      { label: '購票系統問卷回覆數', value: surveyResponses.length },
      {
        label: '舞會滿意度調查回覆數',
        value: partySurveys.map(({ year, responses }) => `${year} 年 ${responses.length} 份`).join('；') || '無'
      },
      { label: '報帳筆數', value: reimbursements.length },
      { label: '報帳發票檔案數', value: invoiceCount },
      {
        label: '報帳發票存放處',
        value: `班聯會 Google 雲端硬碟（${INVOICE_DRIVE_OWNER}）的「CK Party Night 報帳發票」資料夾；「報帳發票」工作表有每個檔案的連結`
      },
      { label: '學弟賣票名單人數', value: sellers.length },
      { label: '學弟賣票登記筆數', value: sellerRegistrations.length },
      { label: '說明', value: `${description}；${RAW_NOTE}` }
    ]
  }

  const orderSheet = {
    name: '訂單',
    columns: [
      { header: '訂單ID', key: 'id', width: 22 },
      { header: '建立時間', key: 'createdAt', width: 22 },
      { header: '購買者身分（學校）', key: 'school', width: 18 },
      { header: '姓名', key: 'customerName', width: 14 },
      { header: '電話', key: 'customerPhone', width: 16 },
      { header: 'Email', key: 'customerEmail', width: 30 },
      { header: '班級', key: 'class', width: 8 },
      { header: '座號', key: 'number', width: 8 },
      { header: '辦公室', key: 'office', width: 12 },
      { header: '票券明細', key: 'items', width: 36 },
      { header: '票券張數', key: 'tickets', width: 10 },
      { header: '訂單金額', key: 'finalTotal', width: 12 },
      { header: '付款狀態', key: 'paid', width: 10 },
      { header: '付款更新時間', key: 'paymentUpdatedAt', width: 22 },
      { header: '付款更新者', key: 'paymentUpdatedByName', width: 14 },
      { header: '領票狀態', key: 'delivered', width: 10 },
      { header: '領票更新時間', key: 'deliveryUpdatedAt', width: 22 },
      { header: '領票更新者', key: 'deliveryUpdatedByName', width: 14 },
      { header: '確認信', key: 'emailStatus', width: 16 },
      { header: '購買帳號 UID', key: 'userId', width: 30 }
    ],
    rows: orders.map((order) => ({
      id: order.id,
      createdAt: formatDateTime(order.createdAt),
      school: order.school || '',
      customerName: order.customerName || '',
      customerPhone: order.customerPhone || '',
      customerEmail: order.customerEmail || '',
      class: order.class || '',
      number: order.number || '',
      office: order.office || '',
      items: itemsOf(order).map((item) => `${item.name || item.ticketTypeId || item.id} ×${quantityOf(item)}（NT$ ${Number(item.price) || 0}）`).join('、'),
      tickets: itemsOf(order).reduce((sum, item) => sum + quantityOf(item), 0),
      finalTotal: Number(order.finalTotal) || 0,
      paid: order.paid ? '已付款' : '未付款',
      paymentUpdatedAt: formatDateTime(order.paymentUpdatedAt),
      paymentUpdatedByName: order.paymentUpdatedByName || '',
      delivered: order.delivered ? '已領票' : '未領票',
      deliveryUpdatedAt: formatDateTime(order.deliveryUpdatedAt),
      deliveryUpdatedByName: order.deliveryUpdatedByName || '',
      emailStatus: EMAIL_STATUS[order.emailStatus] || order.emailStatus || '',
      userId: order.userId || ''
    }))
  }

  const itemSheet = {
    name: '票券明細',
    columns: [
      { header: '訂單ID', key: 'id', width: 22 },
      { header: '建立時間', key: 'createdAt', width: 22 },
      { header: '購買者身分（學校）', key: 'school', width: 18 },
      { header: '票種ID', key: 'ticketTypeId', width: 18 },
      { header: '票種名稱', key: 'name', width: 18 },
      { header: '單價', key: 'price', width: 10 },
      { header: '數量', key: 'quantity', width: 8 },
      { header: '小計', key: 'subtotal', width: 12 },
      { header: '付款狀態', key: 'paid', width: 10 }
    ],
    rows: orders.flatMap((order) => itemsOf(order).map((item) => ({
      id: order.id,
      createdAt: formatDateTime(order.createdAt),
      school: order.school || '',
      ticketTypeId: item.ticketTypeId || item.id || '',
      name: item.name || '',
      price: Number(item.price) || 0,
      quantity: quantityOf(item),
      subtotal: (Number(item.price) || 0) * quantityOf(item),
      paid: order.paid ? '已付款' : '未付款'
    })))
  }

  const rawSheet = {
    name: '原始資料',
    columns: [{ header: '訂單ID', key: 'id', width: 22 }, { header: 'JSON', key: 'json', width: 120 }],
    rows: orders.map(({ id, ...data }) => ({ id, json: JSON.stringify(toPlain(data)) }))
  }

  return [
    summary,
    orderSheet,
    itemSheet,
    rawSheet,
    ...importedSales.map(importedSalesSheet),
    surveySheet(surveyResponses),
    ...partySurveys.map(partySurveySheet),
    ...reimbursementSheets(reimbursements),
    sellerSheet(sellers),
    registrationSheet(sellerRegistrations),
    otherRawSheet({ surveyResponses, partySurveys, reimbursements, sellers, sellerRegistrations })
  ]
}

// A year imported from its Excel (匯入往年資料) keeps only what the charts
// need of each order: t time (ms), v value, p paid, d collected, s school,
// g grade (1–3, 0 unknown), i items { k ticket type, q quantity, u unit price }
function importedSalesSheet({ year, rows = [], names = {} }) {
  return {
    name: `匯入銷售資料 ${year}`,
    columns: [
      { header: '購票時間', key: 'time', width: 22 },
      { header: '學校', key: 'school', width: 18 },
      { header: '年級', key: 'grade', width: 8 },
      { header: '票券明細', key: 'items', width: 36 },
      { header: '票券張數', key: 'tickets', width: 10 },
      { header: '訂單金額', key: 'value', width: 12 },
      { header: '付款狀態', key: 'paid', width: 10 },
      { header: '領票狀態', key: 'delivered', width: 10 }
    ],
    rows: rows.filter(Boolean).map((row) => {
      const items = Array.isArray(row.i) ? row.i.filter(Boolean) : []
      return {
        time: row.t ? formatDateTime(new Date(row.t)) : '',
        school: row.s || '',
        grade: [1, 2, 3].includes(row.g) ? `高${'一二三'[row.g - 1]}` : '',
        items: items.map((item) => `${names[item.k] || item.k} ×${Number(item.q) || 0}（NT$ ${Number(item.u) || 0}）`).join('、'),
        tickets: items.reduce((sum, item) => sum + (Number(item.q) || 0), 0),
        value: Number(row.v) || 0,
        paid: row.p ? '已付款' : '未付款',
        delivered: row.d ? '已領票' : '未領票'
      }
    })
  }
}

const SCORE_QUESTIONS = SCALE_SECTIONS.flatMap((section) => section.questions)

// 購票系統使用回饋問卷 (src/pages/SurveyPage.vue)
function surveySheet(responses) {
  return {
    name: '購票系統問卷',
    columns: [
      { header: '回覆ID', key: 'id', width: 22 },
      { header: '填答時間', key: 'createdAt', width: 22 },
      { header: '身分', key: 'identity', width: 16 },
      { header: '得知管道', key: 'channels', width: 30 },
      { header: '主要裝置', key: 'device', width: 12 },
      ...SCORE_QUESTIONS.map((question) => ({ header: question.text, key: `score_${question.id}`, width: 14 })),
      { header: '是否遇到操作問題', key: 'issueCount', width: 16 },
      { header: '問題發生的部分', key: 'issueTypes', width: 30 },
      { header: '最希望改善的地方', key: 'improvement', width: 40 },
      { header: '其他建議', key: 'suggestion', width: 40 }
    ],
    rows: byCreatedAt(responses).map((response) => ({
      id: response.id || '',
      createdAt: formatDateTime(response.createdAt),
      identity: response.identity || '',
      channels: answerText(response.channels),
      device: response.device || '',
      ...Object.fromEntries(SCORE_QUESTIONS.map((question) => [`score_${question.id}`, response.scores?.[question.id] ?? ''])),
      issueCount: response.issueCount || '',
      issueTypes: answerText(response.issueTypes),
      improvement: response.improvement || '',
      suggestion: response.suggestion || ''
    }))
  }
}

// One year's 舞會滿意度調查 by that year's questions: a column per question,
// and per rated row for a rating question
function partySurveySheet({ year, survey, responses }) {
  const questions = (survey?.sections || []).flatMap((section) => section?.questions || []).filter(Boolean)
  const fields = questions.flatMap((question) => (question.type === 'scale'
    ? (question.rows || []).map((row) => ({
        header: [question.title, row.text].filter(Boolean).join('｜'),
        value: (answers) => answers?.[question.id]?.[row.id] ?? ''
      }))
    : [{ header: question.title || question.id, value: (answers) => answerText(answers?.[question.id]) }]
  )).map((field, i) => ({ ...field, key: `answer${i}` }))

  return {
    name: `舞會滿意度調查 ${year}`,
    columns: [
      { header: '回覆ID', key: 'id', width: 22 },
      { header: '填答時間', key: 'createdAt', width: 22 },
      ...fields.map(({ header, key }) => ({ header, key, width: 24 }))
    ],
    rows: byCreatedAt(responses).map((response) => ({
      id: response.id || '',
      createdAt: formatDateTime(response.createdAt),
      ...Object.fromEntries(fields.map(({ key, value }) => [key, value(response.answers)]))
    }))
  }
}

// 報帳: the claims, and each invoice with its link in the council's Drive
function reimbursementSheets(claims) {
  const sorted = byCreatedAt(claims).sort((a, b) => (Number(a.year) || 0) - (Number(b.year) || 0))

  const claimSheet = {
    name: '報帳',
    columns: [
      { header: '報帳ID', key: 'id', width: 22 },
      { header: '年度', key: 'year', width: 8 },
      { header: '送出時間', key: 'createdAt', width: 22 },
      { header: '姓名', key: 'name', width: 14 },
      { header: '金額', key: 'amount', width: 12 },
      { header: '科目', key: 'category', width: 10 },
      { header: '用途說明', key: 'note', width: 36 },
      { header: '狀態', key: 'status', width: 10 },
      { header: '審核時間', key: 'reviewedAt', width: 22 },
      { header: '審核者', key: 'reviewedByName', width: 14 },
      { header: '發票數', key: 'invoices', width: 8 },
      { header: '送出者 Email', key: 'submitterEmail', width: 30 },
      { header: '送出者 UID', key: 'submitterUid', width: 30 }
    ],
    rows: sorted.map((claim) => ({
      id: claim.id || '',
      year: claim.year ?? '',
      createdAt: formatDateTime(claim.createdAt),
      name: claim.name || '',
      amount: Number(claim.amount) || 0,
      category: claim.category || UNCATEGORIZED,
      note: claim.note || '',
      status: REIMBURSEMENT_STATUS_LABELS[claim.status] || claim.status || '',
      reviewedAt: formatDateTime(claim.reviewedAt),
      reviewedByName: claim.reviewedByName || '',
      invoices: invoicesOf(claim).length,
      submitterEmail: claim.submitterEmail || '',
      submitterUid: claim.submitterUid || ''
    }))
  }

  const invoiceSheet = {
    name: '報帳發票',
    columns: [
      { header: '報帳ID', key: 'id', width: 22 },
      { header: '年度', key: 'year', width: 8 },
      { header: '姓名', key: 'name', width: 14 },
      { header: '金額', key: 'amount', width: 12 },
      { header: '檔名', key: 'fileName', width: 30 },
      { header: '檔案類型', key: 'contentType', width: 18 },
      { header: '大小（KB）', key: 'size', width: 10 },
      { header: '雲端硬碟連結', key: 'link', width: 60 },
      { header: '雲端硬碟檔案ID', key: 'fileId', width: 36 }
    ],
    rows: sorted.flatMap((claim) => invoicesOf(claim).map((file) => {
      const url = invoiceUrl(file)
      return {
        id: claim.id || '',
        year: claim.year ?? '',
        name: claim.name || '',
        amount: Number(claim.amount) || 0,
        fileName: file.name || '',
        contentType: file.contentType || '',
        size: Number(file.size) > 0 ? Math.ceil(Number(file.size) / 1024) : '',
        // an ExcelJS hyperlink cell
        link: url ? { text: url, hyperlink: url } : '',
        fileId: file.fileId || ''
      }
    }))
  }

  return [claimSheet, invoiceSheet]
}

function sellerSheet(sellers) {
  return {
    name: '學弟賣票名單',
    columns: [
      { header: 'Email', key: 'email', width: 32 },
      { header: '姓名', key: 'name', width: 14 },
      { header: '加入時間', key: 'createdAt', width: 22 }
    ],
    rows: [...sellers]
      .map((seller) => ({ email: seller.email || seller.id || '', name: seller.name || '', createdAt: formatDateTime(seller.createdAt) }))
      .sort((a, b) => a.email.localeCompare(b.email))
  }
}

function registrationSheet(registrations) {
  return {
    name: '學弟賣票登記',
    columns: [
      { header: '登記ID', key: 'id', width: 22 },
      { header: '登記時間', key: 'createdAt', width: 22 },
      { header: '姓名', key: 'sellerName', width: 14 },
      { header: 'Email', key: 'sellerEmail', width: 30 },
      { header: '票種', key: 'ticketType', width: 14 },
      { header: '單價', key: 'price', width: 10 },
      { header: '張數', key: 'quantity', width: 8 },
      { header: '金額', key: 'amount', width: 12 },
      { header: '付款狀態', key: 'paid', width: 10 },
      { header: '領票狀態', key: 'delivered', width: 10 },
      { header: '最後更新', key: 'updatedAt', width: 22 },
      { header: '帳號 UID', key: 'sellerUid', width: 30 }
    ],
    rows: byCreatedAt(registrations).map((registration) => ({
      id: registration.id || '',
      createdAt: formatDateTime(registration.createdAt),
      sellerName: registration.sellerName || '',
      sellerEmail: registration.sellerEmail || '',
      ticketType: registration.ticketTypeName || registration.ticketTypeId || '',
      price: Number(registration.price) || 0,
      quantity: Number(registration.quantity) || 0,
      amount: (Number(registration.price) || 0) * (Number(registration.quantity) || 0),
      paid: registration.paid ? '已付款' : '未付款',
      delivered: registration.delivered ? '已領票' : '未領票',
      updatedAt: formatDateTime(registration.updatedAt),
      sellerUid: registration.sellerUid || ''
    }))
  }
}

// Every document besides the orders as JSON, by its Firestore path; one too
// long for a cell continues on the next rows (段落 1/2, 2/2…)
function otherRawSheet({ surveyResponses, partySurveys, reimbursements, sellers, sellerRegistrations }) {
  const rowsOf = (collection, docs) => docs.flatMap(({ id, ...data }) => {
    const parts = splitText(JSON.stringify(toPlain(data)))
    return parts.map((json, i) => ({
      collection,
      id: id ?? '',
      part: parts.length > 1 ? `${i + 1}/${parts.length}` : '',
      json
    }))
  })

  return {
    name: '其他原始資料',
    columns: [
      { header: '集合', key: 'collection', width: 30 },
      { header: '文件ID', key: 'id', width: 30 },
      { header: '段落', key: 'part', width: 8 },
      { header: 'JSON', key: 'json', width: 120 }
    ],
    rows: [
      ...rowsOf('surveyResponses', surveyResponses),
      ...partySurveys.flatMap(({ year, survey, responses }) => [
        ...rowsOf('partySurveys', survey ? [{ id: String(year), ...survey }] : []),
        ...rowsOf(`partySurveys/${year}/responses`, responses)
      ]),
      ...rowsOf('reimbursements', reimbursements),
      ...rowsOf('sellers', sellers),
      ...rowsOf('sellerRegistrations', sellerRegistrations)
    ]
  }
}

export function backupFileName(count, exportedAt = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(exportedAt)
  return `完整備份_${date}_${count}筆訂單.xlsx`
}
