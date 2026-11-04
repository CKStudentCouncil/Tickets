import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { buildStatement, summarizeOrders } from '../src/utils/partyStatement.js'
import { calculateProfit } from '../src/utils/reimbursements.js'
import { statementWorkbook } from '../src/utils/statementExcel.js'

const item = (id, name, price, quantity) => ({ ticketTypeId: id, name, price, quantity })
const order = (items, extra = {}) => ({
  items,
  finalTotal: items.reduce((total, line) => total + line.price * line.quantity, 0),
  paid: false,
  ...extra
})

const orders = [
  order([item('early', '早鳥票', 600, 2)], { paid: true }),
  order([item('early', '早鳥票', 600, 1), item('open', '一般票', 900, 1)], { paid: true }),
  order([item('open', '一般票', 900, 3)]),
  order([item('open', '一般票', 900, 2)], { streetSale: true, paid: true }),
  order([item('open', '一般票', 0, 2)], { complimentary: true, paid: true })
]
const registrations = [
  { ticketTypeId: 'second', ticketTypeName: '二售票', price: 500, quantity: 10, paid: true },
  { ticketTypeId: 'second', ticketTypeName: '二售票', price: 500, quantity: 4, paid: false }
]
const claims = [
  { name: '林小明', amount: 3480, note: '燈條、膠帶', category: '場佈', status: 'pending', createdAt: '2026-11-03T10:00:00+08:00' },
  { name: '林小明', amount: 820, note: '工作人員餐點', category: '餐食', status: 'approved', createdAt: '2026-11-02T10:00:00+08:00' },
  { name: '陳大華', amount: 12000, note: '音響訂金', category: '廠商', status: 'paid', createdAt: '2026-10-28T10:00:00+08:00' },
  { name: '王同學', amount: 450, note: '', category: '餐食', status: 'rejected', createdAt: '2026-10-27T10:00:00+08:00' },
  { name: '舊報帳', amount: 300, note: '膠帶', status: 'paid', createdAt: '2026-10-20T10:00:00+08:00' }
]

const table = (statement) => statement.rows.map((row) => [row.codes.join(' '), row.name, row.income, row.expense, row.note])

test('the realized statement counts money collected and claims approved, laid out like the 總預算表', () => {
  const statement = buildStatement({ orders, registrations, claims, basis: 'realized' })
  assert.deepEqual(table(statement), [
    ['   ', '合計', 9500, 13120, ''],
    ['1 0 0 0', '舞會收入', 9500, null, ''],
    [' 1 0 0', '線上售票', 2700, null, '4 張'],
    ['  1 0', '早鳥票', 1800, null, '3 張'],
    ['  2 0', '一般票', 900, null, '1 張'],
    [' 2 0 0', '路宣', 1800, null, '2 張'],
    ['  1 0', '一般票', 1800, null, '2 張'],
    [' 3 0 0', '學弟賣票', 5000, null, '10 張'],
    ['  1 0', '二售票', 5000, null, '10 張'],
    [' 4 0 0', '公關票', 0, null, '2 張，不收費'],
    ['2 0 0 0', '舞會支出', null, 13120, ''],
    [' 1 0 0', '廠商', null, 12000, '1 筆'],
    ['  1 0', '音響訂金', null, 12000, '陳大華・已撥款'],
    [' 2 0 0', '餐食', null, 820, '1 筆'],
    ['  1 0', '工作人員餐點', null, 820, '林小明・已核准'],
    [' 3 0 0', '未分類', null, 300, '1 筆'],
    ['  1 0', '膠帶', null, 300, '舊報帳・已撥款'],
    ['   ', '結餘', -3620, null, '收入減支出']
  ])
})

test('the projected statement counts every order and registration and every claim not rejected', () => {
  const statement = buildStatement({ orders, registrations, claims, basis: 'projected' })
  const rows = table(statement)
  assert.deepEqual(rows.find((row) => row[1] === '線上售票'), [' 1 0 0', '線上售票', 5400, null, '7 張'])
  assert.deepEqual(rows.find((row) => row[1] === '學弟賣票'), [' 3 0 0', '學弟賣票', 7000, null, '14 張'])
  // 場佈 comes before 餐食 (REIMBURSEMENT_CATEGORIES order); no 未填用途 claim is left nameless
  const expenses = statement.rows.slice(statement.rows.findIndex((row) => row.name === '舞會支出') + 1)
  assert.deepEqual(expenses.filter((row) => row.kind === 'group').map((row) => row.name), ['廠商', '場佈', '餐食', '未分類'])
  assert.equal(statement.expense, 16600)
  assert.equal(statement.balance, statement.income - 16600)
})

test('its totals are the profit\'s, on either basis', () => {
  for (const basis of ['realized', 'projected']) {
    const statement = buildStatement({ orders, registrations, claims, basis })
    const profit = calculateProfit({ orderSummary: summarizeOrders(orders), registrations, claims })
    assert.equal(statement.income, profit.income[basis], basis)
    assert.equal(statement.expense, profit.expenses[basis], basis)
    assert.equal(statement.balance, profit.profit[basis], basis)
  }
})

test('with nothing yet, it still has its frame', () => {
  const statement = buildStatement()
  assert.deepEqual(table(statement).map((row) => row[1]), ['合計', '舞會收入', '舞會支出', '結餘'])
  assert.equal(statement.balance, 0)
  assert.equal(buildStatement({ claims: [{ amount: 100, status: 'approved', note: ' ' }] }).rows.at(-2).name, '（未填用途）')
})

test('the Excel sheet has the titles, the two header rows and a row per line, amounts as numbers', async () => {
  const statement = buildStatement({ orders, registrations, claims, basis: 'realized' })
  const workbook = statementWorkbook(ExcelJS, statement, { organization: '班聯會', title: '收支表', basisLine: '依據' })
  const read = new ExcelJS.Workbook()
  await read.xlsx.load(await workbook.xlsx.writeBuffer())
  const sheet = read.getWorksheet('收支表')
  const cells = (row) => Array.from({ length: 8 }, (_, index) => sheet.getCell(row, index + 1).value)

  assert.equal(sheet.getCell('A1').value, '班聯會')
  assert.equal(sheet.getCell('A2').value, '收支表')
  assert.equal(sheet.getCell('A3').value, '依據')
  assert.equal(sheet.getCell('A4').value, '預算科目')
  assert.equal(sheet.getCell('F4').value, '單位：新臺幣（元）')
  assert.deepEqual(cells(5), ['款', '項', '目', '節', '名稱', '收入', '支出', '附註'])
  assert.deepEqual(cells(6), [null, null, null, null, '合計', 9500, 13120, null])
  assert.deepEqual(cells(7), [1, 0, 0, 0, '舞會收入', 9500, null, null])
  assert.deepEqual(cells(9), [null, null, 1, 0, '早鳥票', 1800, null, '3 張'])
  assert.equal(sheet.getCell('F6').numFmt, '#,##0')
  assert.equal(sheet.getCell('E7').font.bold, true)
  assert.ok(!sheet.getCell('E9').font?.bold)

  const last = 5 + statement.rows.length
  assert.equal(sheet.getCell(`E${last}`).value, '結餘')
  assert.equal(sheet.getCell(`F${last}`).value, -3620)
  assert.equal(sheet.getCell(`G${last}`).master.address, `F${last}`)
  assert.equal(sheet.rowCount, last)
})
