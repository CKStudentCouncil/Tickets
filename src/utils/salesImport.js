// 匯入往年資料: reads an earlier year's orders from an Excel file this site
// exported, either the backup downloaded before 清除所有訂單 (its 原始資料
// sheet) or the 匯出完整篩選結果 export of /admin, into the sale rows
// importSalesArchive stores. Names, phones, emails, classes and seats stay
// in the browser. Pure, so tests/salesImport.test.js runs it with node.
import { gradeOf } from './salesAnalytics.js'

const TAIPEI_MS = 8 * 60 * 60 * 1000
const HOME_SCHOOL = '建國中學'
const SCHOOL_NAMES = {
  附中: '師大附中',
  建中: HOME_SCHOOL,
  景美: '景美女中',
  師大附中: '師大附中',
  松山: '松山高中',
  中山: '中山女高',
  北一: '北一女中',
  成功: '成功高中'
}

// A map key Firestore accepts (functions/lib/salesArchive.js mapKey)
function mapKey(value, fallback) {
  const key = String(value ?? '').trim().slice(0, 100)
  return key && !/^__.*__$/.test(key) ? key : fallback
}

// "2025/11/5 下午12:03:21" (zh-TW, as formatDateTime writes it), an ISO
// string, or a date cell (its wall-clock time is Taiwan time)
export function parseExportTime(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime() - TAIPEI_MS
  const text = String(value ?? '').trim()
  const local = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(上午|下午)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (local) {
    const [, year, month, day, half, hour, minute, second = '0'] = local
    let h = Number(hour) % 12
    if (half === '下午') h += 12
    else if (!half) h = Number(hour)
    return Date.UTC(Number(year), Number(month) - 1, Number(day), h, Number(minute), Number(second)) - TAIPEI_MS
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const ms = Date.parse(text)
    return Number.isNaN(ms) ? null : ms
  }
  return null
}

// An exported order as a sale row (functions/lib/salesArchive.js saleRowOf)
export function compactRowOf(order) {
  return {
    t: order.at,
    v: Math.max(0, Number(order.finalTotal) || 0),
    p: order.paid === true,
    d: order.delivered === true,
    s: mapKey(order.school, '未填寫'),
    g: gradeOf(order.school, order.class),
    i: order.items
      .map((item) => ({
        k: mapKey(item.ticketTypeId || item.id || item.name, '未知票種'),
        q: Math.round(Number(item.quantity) || 0),
        u: Math.max(0, Number(item.price) || 0)
      }))
      .filter((item) => item.q > 0)
  }
}

// The backup's 原始資料 sheet: one order as JSON per row
function ordersFromRawSheet(rows) {
  return rows.slice(1).filter((row) => row[1]).map((row) => {
    const order = JSON.parse(String(row[1]))
    return { ...order, at: parseExportTime(order.createdAt), items: Array.isArray(order.items) ? order.items.filter(Boolean) : [] }
  })
}

// The /admin export: one row per ticket type; an order's further rows leave
// its own columns blank (merged in Excel)
function ordersFromDetailSheet(rows) {
  const header = rows[0].map((cell) => String(cell ?? '').trim())
  const column = (name) => header.indexOf(name)
  const at = {
    id: column('訂單ID'), time: column('建立時間'), total: column('訂單總金額'), paid: column('付款狀態'),
    delivered: column('領票狀態'), school: column('學校'), class: column('班級'), name: column('票種名稱'),
    quantity: column('數量'), price: column('單價')
  }
  const orders = []

  rows.slice(1).forEach((row) => {
    const id = String(row[at.id] ?? '').trim()
    const item = { name: row[at.name], quantity: row[at.quantity], price: row[at.price] }
    if (id && id !== orders.at(-1)?.id) {
      orders.push({
        id,
        at: parseExportTime(row[at.time]),
        finalTotal: row[at.total],
        paid: String(row[at.paid] ?? '').trim() === '已付款',
        delivered: String(row[at.delivered] ?? '').trim() === '已領票',
        school: row[at.school],
        class: row[at.class],
        items: []
      })
    }
    if (orders.length && String(item.name ?? '').trim()) orders.at(-1).items.push(item)
  })
  return orders
}

const hasColumns = (rows, names) => {
  const header = (rows[0] || []).map((cell) => String(cell ?? '').trim())
  return names.every((name) => header.includes(name))
}

// sheets: [{ name, rows: [[cell values]] }], header first. Returns the sale
// rows, ticket type names, orders whose time could not be read (left out),
// and the earliest and latest order time; or { error }.
export function readSalesWorkbook(sheets) {
  let orders
  const raw = sheets.find((sheet) => sheet.name === '原始資料' && hasColumns(sheet.rows, ['訂單ID', 'JSON']))
  const detail = sheets.find((sheet) => hasColumns(sheet.rows, ['訂單ID', '建立時間', '訂單總金額', '票種名稱', '數量', '單價']))

  try {
    if (raw) orders = ordersFromRawSheet(raw.rows)
    else if (detail && detail.name.includes('已領票')) return { error: '這是只含已領票訂單的匯出，請改用全部訂單的 Excel' }
    else if (detail) orders = ordersFromDetailSheet(detail.rows)
    else return readHistoricalFormWorkbook(sheets)
  } catch {
    return { error: '檔案內容無法讀取，請確認是本站後台匯出的訂單 Excel' }
  }

  const timed = orders.filter((order) => order.at !== null)
  if (!timed.length) return { error: '檔案中沒有可匯入的訂單' }

  const names = {}
  timed.forEach((order) => order.items.forEach((item) => {
    if (item.name) names[mapKey(item.ticketTypeId || item.id || item.name, '未知票種')] = String(item.name).slice(0, 100)
  }))
  const times = timed.map((order) => order.at)

  return {
    rows: timed.map(compactRowOf),
    names,
    skipped: orders.length - timed.length,
    firstAt: Math.min(...times),
    lastAt: Math.max(...times)
  }
}

// An ExcelJS cell value as plain text, number or date
export function cellValue(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date || typeof value !== 'object') return value
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('')
  if ('result' in value) return value.result ?? ''
  if ('text' in value) return value.text
  return ''
}

// An ExcelJS workbook's sheets as [{ name, rows: [[cell values]] }]
export function sheetsOf(workbook) {
  return workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    // getSheetValues() and its rows are 1-based and sparse
    rows: sheet.getSheetValues().slice(1).map((row) => Array.from((row || []).slice(1), cellValue))
  }))
}

const CHINESE_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function quantityOf(value) {
  if (typeof value === 'number') return Math.round(value)
  const text = String(value ?? '').trim()
  if (/^\d+$/.test(text)) return Number(text)
  if (text === '十') return 10
  const match = /^([一二三四五六七八九])?十([一二三四五六七八九])?/.exec(text)
  if (match) return (CHINESE_DIGITS[match[1]] || 1) * 10 + (CHINESE_DIGITS[match[2]] || 0)
  return CHINESE_DIGITS[text[0]] || 0
}

function headerColumns(rows) {
  return (rows[0] || []).map((cell) => String(cell ?? '').trim())
}

function columnOf(header, text) {
  return header.findIndex((name) => name.includes(text))
}

function historicalFormRows(rows) {
  const header = headerColumns(rows)
  const time = columnOf(header, '時間戳記')
  const quantityColumns = header
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => name.includes('購買張數'))
  const identity = columnOf(header, '身分')
  const school = columnOf(header, '友校學生')
  const classColumn = columnOf(header, '班級')
  if (time < 0 || !quantityColumns.length) return null

  const isSecondSale = identity >= 0
  const ticketNames = quantityColumns.map(({ name }) => name.includes('友校預購') ? '二售票（友校預購）' : (
    isSecondSale ? '二售票' : name.includes('早鳥') ? '校內早鳥票' : '校內一售票'
  ))
  const orders = []
  rows.slice(1).forEach((row) => {
    const at = parseExportTime(row[time])
    if (at === null) return
    const quantities = quantityColumns.map(({ index }) => quantityOf(row[index]))
    const items = quantities
      .map((quantity, index) => ({ name: ticketNames[index], quantity, price: isSecondSale ? 370 : ticketNames[index] === '校內早鳥票' ? 270 : 320 }))
      .filter((item) => item.quantity > 0)
    if (!items.length) return

    let orderSchool = HOME_SCHOOL
    if (isSecondSale) {
      const selectedSchool = String(row[school] ?? '').trim()
      orderSchool = selectedSchool === '非以下學校學生'
        ? '其他學校或社會人士'
        : SCHOOL_NAMES[selectedSchool] || (
            String(row[identity] ?? '').trim() === '建中校內學生' ? HOME_SCHOOL : '其他學校或社會人士'
          )
    }
    orders.push({
      at,
      finalTotal: items.reduce((sum, item) => sum + item.quantity * item.price, 0),
      paid: true,
      delivered: true,
      school: orderSchool,
      class: classColumn >= 0 ? row[classColumn] : '',
      items
    })
  })
  return orders
}

// Legacy Google Form workbooks used before the site's order system existed.
// The returned rows intentionally exclude all form identity/contact fields.
export function readHistoricalFormWorkbook(sheets) {
  const parsed = sheets.map((sheet) => historicalFormRows(sheet.rows)).find(Boolean)
  if (!parsed?.length) return { error: '無法辨識這個檔案，請選擇本站後台或歷史售票表單的 Excel' }
  const times = parsed.map((order) => order.at)
  const names = {}
  parsed.forEach((order) => order.items.forEach((item) => { names[item.name] = item.name }))
  return {
    rows: parsed.map(compactRowOf),
    names,
    skipped: 0,
    firstAt: Math.min(...times),
    lastAt: Math.max(...times)
  }
}
