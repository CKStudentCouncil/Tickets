import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { cellValue, compactRowOf, parseExportTime, readHistoricalFormWorkbook, readSalesWorkbook, sheetsOf } from '../src/utils/salesImport.js'
import { buildOrderBackup } from '../src/utils/orderBackup.js'

const at = (iso) => new Date(iso).getTime()

// a workbook written and read back the way the browser does
async function roundTrip(fill) {
  const workbook = new ExcelJS.Workbook()
  fill(workbook)
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(await workbook.xlsx.writeBuffer())
  return sheetsOf(back)
}

test('export times are read as Taiwan time', () => {
  assert.equal(parseExportTime('2025/11/5 下午12:03:21'), at('2025-11-05T12:03:21+08:00'))
  assert.equal(parseExportTime('2025/11/5 上午12:03:21'), at('2025-11-05T00:03:21+08:00'))
  assert.equal(parseExportTime('2025/11/5 下午1:05'), at('2025-11-05T13:05:00+08:00'))
  assert.equal(parseExportTime('2025/11/5 13:05:00'), at('2025-11-05T13:05:00+08:00'))
  assert.equal(parseExportTime('2025-11-05T04:03:00.000Z'), at('2025-11-05T04:03:00Z'))
  // a date cell holds the wall-clock time
  assert.equal(parseExportTime(new Date('2025-11-05T12:03:00Z')), at('2025-11-05T12:03:00+08:00'))
  for (const junk of ['', '昨天', null, 42]) assert.equal(parseExportTime(junk), null)
})

test('a sale row from an export keeps no names, phones, emails, classes or seats', () => {
  const row = compactRowOf({
    at: 1, finalTotal: 1800, paid: true, delivered: false, school: '建國中學', class: '305', number: '12',
    customerName: '王小明', customerPhone: '0912345678',
    items: [{ name: '一階票', quantity: 2, price: 900 }, { name: '空', quantity: 0, price: 1 }]
  })
  assert.deepEqual(row, { t: 1, v: 1800, p: true, d: false, s: '建國中學', g: 3, i: [{ k: '一階票', q: 2, u: 900 }] })
})

test("the /admin export's detail sheet, with an order's later rows merged", async () => {
  const sheets = await roundTrip((workbook) => {
    const sheet = workbook.addWorksheet('全部訂單明細')
    sheet.columns = ['訂單ID', '建立時間', '訂單總金額', '領票狀態', '付款狀態', '客戶姓名', '學校', '班級', '座號', '票種名稱', '數量', '單價', '小計']
      .map((header) => ({ header, key: header }))
    sheet.addRows([
      { 訂單ID: 'CKS20251105AAAAAA', 建立時間: '2025/11/5 下午12:03:21', 訂單總金額: 2300, 領票狀態: '已領票', 付款狀態: '已付款', 客戶姓名: '王小明', 學校: '建國中學', 班級: '205', 座號: '7', 票種名稱: '一階票', 數量: 2, 單價: 900, 小計: 1800 },
      { 訂單ID: '', 建立時間: '', 訂單總金額: '', 領票狀態: '', 付款狀態: '', 客戶姓名: '', 學校: '', 班級: '', 座號: '', 票種名稱: '自由票', 數量: 1, 單價: 500, 小計: 500 },
      { 訂單ID: 'TFG20251106BBBBBB', 建立時間: '2025/11/6 上午9:00:00', 訂單總金額: 900, 領票狀態: '未領票', 付款狀態: '未付款', 客戶姓名: '林小華', 學校: '北一女中', 班級: '101', 座號: '3', 票種名稱: '一階票', 數量: 1, 單價: 900, 小計: 900 },
      { 訂單ID: 'O20251107CCCCCC', 建立時間: '看不懂', 訂單總金額: 900, 學校: '其他學校或社會人士', 票種名稱: '一階票', 數量: 1, 單價: 900 }
    ])
    // as useAdminOrders merges an order's own columns over its item rows
    for (let column = 1; column <= 9; column++) sheet.mergeCells(2, column, 3, column)
  })

  const result = readSalesWorkbook(sheets)
  assert.equal(result.skipped, 1)
  assert.equal(result.firstAt, at('2025-11-05T12:03:21+08:00'))
  assert.equal(result.lastAt, at('2025-11-06T09:00:00+08:00'))
  assert.deepEqual(result.rows, [
    { t: at('2025-11-05T12:03:21+08:00'), v: 2300, p: true, d: true, s: '建國中學', g: 2, i: [{ k: '一階票', q: 2, u: 900 }, { k: '自由票', q: 1, u: 500 }] },
    { t: at('2025-11-06T09:00:00+08:00'), v: 900, p: false, d: false, s: '北一女中', g: 0, i: [{ k: '一階票', q: 1, u: 900 }] }
  ])
  assert.deepEqual(result.names, { 一階票: '一階票', 自由票: '自由票' })
})

test("the purge backup's 原始資料 sheet", async () => {
  const orders = [{
    id: 'CKS20251105AAAAAA', createdAt: { toDate: () => new Date('2025-11-05T04:03:00Z') }, school: '建國中學', class: '三數',
    customerName: '王小明', finalTotal: 1800, paid: true, delivered: true,
    items: [{ ticketTypeId: 'open', name: '一階票', price: 900, quantity: 2 }]
  }]
  const sheets = await roundTrip((workbook) => {
    buildOrderBackup(orders).forEach(({ name, columns, rows }) => {
      const sheet = workbook.addWorksheet(name)
      sheet.columns = columns
      sheet.addRows(rows)
    })
  })

  const result = readSalesWorkbook(sheets)
  assert.deepEqual(result.rows, [{ t: at('2025-11-05T04:03:00Z'), v: 1800, p: true, d: true, s: '建國中學', g: 3, i: [{ k: 'open', q: 2, u: 900 }] }])
  assert.deepEqual(result.names, { open: '一階票' })
})

test('files that are not a full order export are refused with a reason', () => {
  const header = ['訂單ID', '建立時間', '訂單總金額', '票種名稱', '數量', '單價']
  assert.match(readSalesWorkbook([{ name: '已領票訂單明細', rows: [header] }]).error, /已領票/)
  assert.match(readSalesWorkbook([{ name: '工作表1', rows: [['姓名', '電話']] }]).error, /無法辨識/)
  assert.match(readSalesWorkbook([{ name: '全部訂單明細', rows: [header] }]).error, /沒有可匯入的訂單/)
  assert.match(readSalesWorkbook([{ name: '原始資料', rows: [['訂單ID', 'JSON'], ['A', '{not json']] }]).error, /無法讀取/)
})

test('cell values come out as plain text, numbers or dates', () => {
  assert.equal(cellValue({ richText: [{ text: '一階' }, { text: '票' }] }), '一階票')
  assert.equal(cellValue({ formula: 'A1*2', result: 1800 }), 1800)
  assert.equal(cellValue({ text: 'site', hyperlink: 'https://tickets.cksc.tw' }), 'site')
  assert.equal(cellValue(null), '')
  assert.equal(cellValue(12), 12)
})

test('legacy early-bird and first-sale form rows become analytics-only orders', () => {
  const result = readHistoricalFormWorkbook([{
    name: '表單回應 1',
    rows: [
      ['時間戳記', '電子郵件地址', '班級', '座號', '姓名', '電話', '購買張數\n票種：校內早鳥票｜270元/張'],
      ['2025-10-30T12:00:00.000Z', 'buyer@example.com', 219, 32, '姓名', '0900000000', '一張'],
      ['2025-11-05T12:00:00.000Z', 'buyer2@example.com', 321, 1, '姓名2', '0900000001', '十二張']
    ]
  }])
  assert.equal(result.rows.length, 2)
  assert.deepEqual(result.rows[0].i, [{ k: '校內早鳥票', q: 1, u: 270 }])
  assert.equal(result.rows[1].g, 3)
  assert.equal(result.rows[1].v, 3240)
  assert.equal(result.rows[1].d, true)
  assert.equal(result.names['校內早鳥票'], '校內早鳥票')
})

test('legacy second-sale forms keep regular and partner ticket types', () => {
  const result = readHistoricalFormWorkbook([{
    name: '表單回應 1',
    rows: [
      ['時間戳記', '電子郵件地址', '姓名', '身分', '購買張數\n票種：二售票｜370元/張', '電話', '是否為以下友校學生', '班級', '座號', '購買張數\n票種：二售票｜370元/張\n（友校預購）'],
      ['2025-11-12T12:00:00.000Z', 'buyer@example.com', '姓名', '他校高中學生', 2, '0900000000', '北一', 101, 2, 1],
      ['2025-11-12T12:01:00.000Z', 'buyer2@example.com', '姓名2', '社會人士', 0, '0900000001', '非以下學校學生', '', '', 3]
    ]
  }])
  assert.deepEqual(result.rows.map((row) => row.s), ['北一女中', '其他學校或社會人士'])
  assert.deepEqual(result.rows[0].i, [
    { k: '二售票', q: 2, u: 370 },
    { k: '二售票（友校預購）', q: 1, u: 370 }
  ])
  assert.deepEqual(result.rows[1].i, [{ k: '二售票（友校預購）', q: 3, u: 370 }])
})
