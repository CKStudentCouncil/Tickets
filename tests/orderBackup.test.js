import test from 'node:test'
import assert from 'node:assert/strict'
import { backupFileName, backupTotals, buildOrderBackup, splitText, toPlain } from '../src/utils/orderBackup.js'

const ts = (iso) => ({ toDate: () => new Date(iso) })

const orders = [
  {
    id: 'CKS20261105K7Q2MX', createdAt: ts('2026-11-05T04:03:00Z'), school: '建國中學', customerName: '王小明',
    customerPhone: '0912345678', customerEmail: 's1@gl.ck.tp.edu.tw', class: '305', number: '12',
    items: [{ ticketTypeId: 'open', name: '一階票', price: 900, quantity: 2 }, { id: 'free', name: '自由票', price: 500, quantity: 1 }],
    finalTotal: 2300, paid: true, paymentUpdatedAt: ts('2026-11-06T02:00:00Z'), paymentUpdatedByName: '收款人員',
    delivered: false, emailStatus: 'accepted', userId: 'uid-1', ticketCode: 'secret', stockShards: { open: { 3: 2 } }
  },
  // a legacy order missing most fields
  { id: 'CKS202611050001', items: [null, { id: 'open', quantity: '1' }] }
]

test('every order, its line items and all its raw fields are in the backup', () => {
  const [summary, orderSheet, itemSheet, rawSheet] = buildOrderBackup(orders, {
    exportedAt: new Date('2026-12-20T02:00:00Z'), exportedBy: '總召'
  })
  assert.deepEqual([summary, orderSheet, itemSheet, rawSheet].map((sheet) => sheet.name), ['摘要', '訂單', '票券明細', '原始資料'])
  for (const sheet of [summary, orderSheet, itemSheet, rawSheet]) {
    const keys = sheet.columns.map((column) => column.key)
    sheet.rows.forEach((row) => assert.deepEqual(Object.keys(row), keys, sheet.name))
  }

  assert.equal(orderSheet.rows.length, 2)
  const first = orderSheet.rows[0]
  assert.equal(first.id, 'CKS20261105K7Q2MX')
  assert.match(first.createdAt, /2026/)
  assert.equal(first.items, '一階票 ×2（NT$ 900）、自由票 ×1（NT$ 500）')
  assert.equal(first.tickets, 3)
  assert.equal(first.paid, '已付款')
  assert.equal(first.emailStatus, '郵件服務已接受')
  assert.deepEqual([orderSheet.rows[1].createdAt, orderSheet.rows[1].items, orderSheet.rows[1].finalTotal], ['', 'open ×1（NT$ 0）', 0])

  assert.deepEqual(itemSheet.rows.map((row) => [row.id, row.ticketTypeId, row.quantity, row.subtotal]), [
    ['CKS20261105K7Q2MX', 'open', 2, 1800],
    ['CKS20261105K7Q2MX', 'free', 1, 500],
    ['CKS202611050001', 'open', 1, 0]
  ])

  const raw = JSON.parse(rawSheet.rows[0].json)
  assert.equal(raw.createdAt, '2026-11-05T04:03:00.000Z')
  assert.equal(raw.ticketCode, 'secret')
  assert.deepEqual(raw.stockShards, { open: { 3: 2 } })
  assert.equal(raw.id, undefined)

  assert.equal(summary.rows.find((row) => row.label === '訂單應收金額').value, 2300)
  assert.equal(summary.rows.find((row) => row.label === '備份者').value, '總召')
})

test('totals keep order value and collected payment apart', () => {
  assert.deepEqual(backupTotals(orders), { orders: 2, tickets: 4, revenue: 2300, paidRevenue: 2300, deliveredOrders: 0 })
  assert.deepEqual(toPlain({ a: [ts('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z'), null] }), {
    a: ['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', null]
  })
})

test('the file is named after the Taiwan date and the order count', () => {
  assert.equal(backupFileName(1432, new Date('2026-12-20T17:00:00Z')), '完整備份_2026-12-21_1432筆訂單.xlsx')
})

const others = {
  surveyResponses: [
    {
      id: 'later', createdAt: ts('2026-11-07T00:00:00Z'), identity: '社會人士', channels: ['CK APP'], device: '平板',
      scores: { q4: 3 }, issueCount: '沒有遇到問題', issueTypes: []
    },
    {
      id: 'sr1', createdAt: ts('2026-11-06T00:00:00Z'), identity: '建國中學學生', channels: ['CK APP', '搜尋引擎'], device: '手機',
      scores: { q4: 5, q29: 2 }, issueCount: '遇到過一次', issueTypes: ['訂單送出'], improvement: '更快', suggestion: ''
    }
  ],
  partySurveys: [{
    year: 2026,
    survey: {
      id: '2026', year: 2026, open: false,
      sections: [{
        id: 's1', title: '基本資料',
        questions: [
          { id: 'identity', type: 'single', title: '身分', options: ['學生', '家長'] },
          { id: 'channels', type: 'multiple', title: '管道', options: ['IG', '海報'] },
          { id: 'rate', type: 'scale', title: '評分', rows: [{ id: 'r1', text: '音響' }, { id: 'r2', text: '燈光' }] },
          { id: 'wish', type: 'text', title: '想說的話' }
        ]
      }]
    },
    responses: [{
      id: 'pr1', createdAt: ts('2026-12-21T00:00:00Z'),
      answers: { identity: '學生', channels: ['IG', '朋友說的'], rate: { r1: 4 }, wish: '明年見', gone: 'x' }
    }]
  }],
  reimbursements: [
    {
      id: 'rb1', year: 2026, createdAt: ts('2026-11-01T00:00:00Z'), name: '林小華', amount: 1200, note: '場佈', status: 'paid',
      submitterEmail: 'a@gl.ck.tp.edu.tw', submitterUid: 'uid-a', reviewedByName: '總召',
      invoices: [
        { fileId: 'f1', name: '發票.pdf', contentType: 'application/pdf', size: 2048, url: 'https://drive.google.com/file/d/f1/view' },
        { fileId: 'f2', name: '收據.jpg', contentType: 'image/jpeg', size: 10 }
      ]
    },
    { id: 'rb0', year: 2025, name: '舊的', amount: '300', status: 'approved' }
  ],
  sellers: [{ id: 'b@gl.ck.tp.edu.tw', email: 'b@gl.ck.tp.edu.tw', name: '學弟' }, { id: 'a@gl.ck.tp.edu.tw', name: '' }],
  sellerRegistrations: [{
    id: 'reg1', createdAt: ts('2026-11-02T00:00:00Z'), sellerName: '學弟', sellerEmail: 'b@gl.ck.tp.edu.tw', sellerUid: 'uid-b',
    ticketTypeId: 'second', ticketTypeName: '二售', price: 700, quantity: 3, paid: true, delivered: false, stockShards: { second: { 1: 3 } }
  }]
}

test('the surveys, 報帳 and 學弟賣票 are in the backup with every field', () => {
  const sheets = buildOrderBackup(orders, { ...others, exportedAt: new Date('2026-12-20T02:00:00Z') })
  const byName = Object.fromEntries(sheets.map((sheet) => [sheet.name, sheet]))
  assert.deepEqual(sheets.map((sheet) => sheet.name), [
    '摘要', '訂單', '票券明細', '原始資料', '購票系統問卷', '舞會滿意度調查 2026',
    '報帳', '報帳發票', '學弟賣票名單', '學弟賣票登記', '其他原始資料'
  ])
  for (const sheet of sheets) {
    assert.ok(sheet.name.length <= 31, sheet.name)
    const keys = sheet.columns.map((column) => column.key)
    assert.equal(new Set(keys).size, keys.length, sheet.name)
    sheet.rows.forEach((row) => assert.deepEqual(Object.keys(row), keys, sheet.name))
  }

  const survey = byName['購票系統問卷']
  assert.deepEqual(survey.rows.map((row) => row.id), ['sr1', 'later'])
  assert.equal(survey.rows[0].channels, 'CK APP、搜尋引擎')
  assert.deepEqual([survey.rows[0].score_q4, survey.rows[0].score_q29, survey.rows[0].score_q5], [5, 2, ''])
  assert.equal(survey.columns.find((column) => column.key === 'score_q4').header, '我能快速理解本系統的操作方式')

  const party = byName['舞會滿意度調查 2026']
  assert.deepEqual(party.columns.map((column) => column.header), ['回覆ID', '填答時間', '身分', '管道', '評分｜音響', '評分｜燈光', '想說的話'])
  assert.deepEqual(Object.values(party.rows[0]).slice(2), ['學生', 'IG、朋友說的', 4, '', '明年見'])

  const claims = byName['報帳']
  assert.deepEqual(claims.rows.map((row) => [row.id, row.amount, row.status, row.category, row.invoices]), [
    ['rb0', 300, '已核准', '未分類', 0],
    ['rb1', 1200, '已撥款', '未分類', 2]
  ])
  const invoices = byName['報帳發票']
  assert.deepEqual(invoices.rows.map((row) => [row.fileName, row.size, row.link]), [
    ['發票.pdf', 2, { text: 'https://drive.google.com/file/d/f1/view', hyperlink: 'https://drive.google.com/file/d/f1/view' }],
    ['收據.jpg', 1, { text: 'https://drive.google.com/file/d/f2/view', hyperlink: 'https://drive.google.com/file/d/f2/view' }]
  ])

  assert.deepEqual(byName['學弟賣票名單'].rows.map((row) => row.email), ['a@gl.ck.tp.edu.tw', 'b@gl.ck.tp.edu.tw'])
  const registration = byName['學弟賣票登記'].rows[0]
  assert.deepEqual([registration.ticketType, registration.amount, registration.paid, registration.delivered], ['二售', 2100, '已付款', '未領票'])

  // nothing is lost: answers to deleted questions and fields no sheet shows
  const raw = byName['其他原始資料'].rows
  assert.deepEqual(raw.map((row) => `${row.collection}/${row.id}`), [
    'surveyResponses/later', 'surveyResponses/sr1', 'partySurveys/2026', 'partySurveys/2026/responses/pr1',
    'reimbursements/rb1', 'reimbursements/rb0', 'sellers/b@gl.ck.tp.edu.tw', 'sellers/a@gl.ck.tp.edu.tw',
    'sellerRegistrations/reg1'
  ])
  const json = (path) => JSON.parse(raw.find((row) => `${row.collection}/${row.id}` === path).json)
  assert.equal(json('partySurveys/2026/responses/pr1').answers.gone, 'x')
  assert.equal(json('partySurveys/2026').sections[0].questions.length, 4)
  assert.deepEqual(json('sellerRegistrations/reg1').stockShards, { second: { 1: 3 } })
  assert.equal(json('surveyResponses/sr1').createdAt, '2026-11-06T00:00:00.000Z')

  const summary = Object.fromEntries(byName['摘要'].rows.map((row) => [row.label, row.value]))
  assert.equal(summary['購票系統問卷回覆數'], 2)
  assert.equal(summary['舞會滿意度調查回覆數'], '2026 年 1 份')
  assert.equal(summary['報帳發票檔案數'], 2)
  assert.equal(summary['學弟賣票登記筆數'], 1)
})

test('without the other records the backup still has their empty sheets', () => {
  const sheets = buildOrderBackup(orders)
  assert.deepEqual(sheets.slice(4).map((sheet) => [sheet.name, sheet.rows.length]), [
    ['購票系統問卷', 0], ['報帳', 0], ['報帳發票', 0], ['學弟賣票名單', 0], ['學弟賣票登記', 0], ['其他原始資料', 0]
  ])
  assert.equal(sheets[0].rows.find((row) => row.label === '舞會滿意度調查回覆數').value, '無')
})

test('a year imported from Excel keeps its sale rows, and the file says what it covers', () => {
  const importedSales = [{
    year: 2024,
    names: { open: '一階票' },
    rows: [
      { t: Date.parse('2024-11-05T04:03:00Z'), v: 1800, p: true, d: false, s: '建國中學', g: 2, i: [{ k: 'open', q: 2, u: 900 }] },
      { t: null, v: 0, p: false, d: true, s: '未填寫', g: 0, i: [{ k: 'gone', q: 1, u: 0 }] }
    ]
  }]
  const sheets = buildOrderBackup([], { importedSales, scope: '2024 年', description: '從歷年資料頁下載' })
  assert.deepEqual(sheets.map((sheet) => sheet.name).slice(0, 6), ['摘要', '訂單', '票券明細', '原始資料', '匯入銷售資料 2024', '購票系統問卷'])

  const sales = sheets[4]
  sales.rows.forEach((row) => assert.deepEqual(Object.keys(row), sales.columns.map((column) => column.key)))
  assert.deepEqual(sales.rows.map((row) => [row.grade, row.items, row.tickets, row.value, row.paid, row.delivered]), [
    ['高二', '一階票 ×2（NT$ 900）', 2, 1800, '已付款', '未領票'],
    ['', 'gone ×1（NT$ 0）', 1, 0, '未付款', '已領票']
  ])
  assert.match(sales.rows[0].time, /2024/)
  assert.equal(sales.rows[1].time, '')

  const summary = Object.fromEntries(sheets[0].rows.map((row) => [row.label, row.value]))
  assert.equal(summary['資料範圍'], '2024 年')
  assert.equal(summary['匯入的銷售資料筆數'], '2024 年 2 筆')
  assert.match(summary['說明'], /^從歷年資料頁下載；「原始資料」/)
  assert.equal(buildOrderBackup([])[0].rows.some((row) => row.label === '資料範圍'), false)
})

test('a document too long for one cell continues on the next rows', () => {
  const text = `${'a'.repeat(9)}😀${'b'.repeat(5)}`
  const parts = splitText(text, 10)
  assert.equal(parts.join(''), text)
  assert.ok(parts.every((part) => part.length <= 10 && !/[\ud800-\udbff]$/.test(part)))
  assert.deepEqual(splitText(''), [''])

  const long = { id: 'big', note: 'x'.repeat(70_000) }
  const raw = buildOrderBackup([], { reimbursements: [long] }).at(-1).rows
  assert.deepEqual(raw.map((row) => row.part), ['1/3', '2/3', '3/3'])
  assert.equal(JSON.parse(raw.map((row) => row.json).join('')).note.length, 70_000)
})
