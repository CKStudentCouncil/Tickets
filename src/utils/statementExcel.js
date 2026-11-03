// The 收支表 (utils/partyStatement.js) as an Excel sheet laid out like the
// council's 總預算表: the titles, a 預算科目 / 單位 header over 款 項 目 節
// 名稱 收入 支出 附註, then a row per statement row. Amounts are numbers, so
// the sheet can be summed and edited further. ExcelJS is passed in: the page
// loads it only when exporting.

const HEADER_ROW = 4
const COLUMNS = ['款', '項', '目', '節', '名稱', '收入', '支出', '附註']
const thin = { style: 'thin' }
const BORDER = { top: thin, left: thin, bottom: thin, right: thin }

// { organization, title, basisLine } are the three lines above the table,
// as the 總預算表 starts: who, what, then on which basis and when
export function statementWorkbook(ExcelJS, statement, { organization, title, basisLine }) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('收支表', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: 'frozen', ySplit: HEADER_ROW + 1 }]
  })
  sheet.columns = [5, 5, 5, 5, 34, 14, 14, 30].map((width) => ({ width }))

  ;[[organization, 12], [title, 16], [basisLine, 10]].forEach(([text, size], index) => {
    const row = index + 1
    sheet.mergeCells(row, 1, row, 8)
    const cell = sheet.getCell(row, 1)
    cell.value = text
    cell.font = { bold: index < 2, size }
    cell.alignment = { horizontal: index < 2 ? 'center' : 'right' }
  })

  sheet.mergeCells(HEADER_ROW, 1, HEADER_ROW, 5)
  sheet.getCell(HEADER_ROW, 1).value = '預算科目'
  sheet.mergeCells(HEADER_ROW, 6, HEADER_ROW, 7)
  sheet.getCell(HEADER_ROW, 6).value = '單位：新臺幣（元）'
  sheet.getRow(HEADER_ROW + 1).values = COLUMNS
  ;[HEADER_ROW, HEADER_ROW + 1].forEach((row) => {
    for (let column = 1; column <= 8; column++) {
      const cell = sheet.getCell(row, column)
      cell.font = { bold: true }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    }
  })

  statement.rows.forEach((line, index) => {
    const row = HEADER_ROW + 2 + index
    const level = line.codes.findIndex((code) => code !== '')
    const values = [...line.codes, line.name, line.income, line.expense, line.note]
    values.forEach((value, column) => {
      // null and '' leave the cell empty
      if (value !== null && value !== '') sheet.getCell(row, column + 1).value = value
    })
    if (line.kind === 'balance') sheet.mergeCells(row, 6, row, 7)

    const bold = line.kind !== 'item'
    for (let column = 1; column <= 8; column++) {
      const cell = sheet.getCell(row, column)
      cell.font = { bold, size: line.kind === 'total' || level === 0 ? 12 : 11 }
      cell.alignment = { vertical: 'top', wrapText: column === 5 || column === 8, horizontal: column <= 4 ? 'center' : undefined }
    }
    // the hierarchy shows in the name, as indents
    sheet.getCell(row, 5).alignment = { vertical: 'top', wrapText: true, indent: Math.max(0, level) }
    ;[6, 7].forEach((column) => {
      const cell = sheet.getCell(row, column)
      cell.numFmt = '#,##0'
      cell.alignment = { vertical: 'top', horizontal: line.kind === 'balance' ? 'center' : 'right' }
    })
  })

  const lastRow = HEADER_ROW + 1 + statement.rows.length
  for (let row = HEADER_ROW; row <= lastRow; row++) {
    for (let column = 1; column <= 8; column++) sheet.getCell(row, column).border = BORDER
  }

  return workbook
}
