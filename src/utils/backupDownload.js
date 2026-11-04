// Writes the sheets of buildOrderBackup (src/utils/orderBackup.js) to an
// .xlsx and downloads it; ExcelJS and file-saver load only when called.
// Used by 清除所有訂單 (useOrderPurge) and 歷年資料 (HistoryPage).
export async function downloadWorkbook(sheets, fileName, { createdAt = new Date() } = {}) {
  const [excelModule, saverModule] = await Promise.all([import('exceljs'), import('file-saver')])
  const ExcelJS = excelModule.default
  const saveAs = saverModule.saveAs || saverModule.default.saveAs || saverModule.default
  const workbook = new ExcelJS.Workbook()
  workbook.created = createdAt

  sheets.forEach(({ name, columns, rows }) => {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.columns = columns
    sheet.addRows(rows)
    sheet.getRow(1).font = { bold: true }
    // the invoice links, looking like links
    sheet.eachRow((row) => row.eachCell((cell) => {
      if (cell.hyperlink) cell.font = { color: { argb: 'FF0563C1' }, underline: true }
    }))
  })

  const buffer = await workbook.xlsx.writeBuffer()
  if (!buffer?.byteLength) throw new Error('empty workbook')
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName)
}
