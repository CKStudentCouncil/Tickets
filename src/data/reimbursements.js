// 報帳: admins claim back what they spent on the party (/admin/reimburse);
// super admins review the claims and see the profit (/super_admin/reimbursements)

// Keep in sync with functions/lib/reimbursements.js
export const MAX_REIMBURSER_NAME = 50
export const MAX_REIMBURSEMENT_AMOUNT = 1000000
export const MAX_REIMBURSEMENT_NOTE = 200

// Invoices: photos or PDFs, saved to the council's Google Drive
// (ckhssc@gl.ck.tp.edu.tw) by submitReimbursement. Photos are shrunk in the
// browser first; together they must fit one call (7 MB before base64).
export const MAX_INVOICE_FILES = 5
export const MAX_INVOICE_BYTES = 7 * 1024 * 1024
export const INVOICE_ACCEPT = 'image/*,application/pdf'
export const INVOICE_DRIVE_OWNER = 'ckhssc@gl.ck.tp.edu.tw'

// 科目: what a claim was spent on. The claimant picks one, super admins may
// change it; the 收支表 on /super_admin/reimbursements groups the expenses by
// it, in this order. Keep in sync with functions/lib/reimbursements.js.
export const REIMBURSEMENT_CATEGORIES = ['場地', '廠商', '場佈', '文書', '票務', '餐食', '其他']
// claims made before 科目 existed
export const UNCATEGORIZED = '未分類'

// approved and paid claims are the party's expenses; pending ones may still
// become expenses, rejected ones never do
export const REIMBURSEMENT_STATUSES = ['pending', 'approved', 'paid', 'rejected']

export const REIMBURSEMENT_STATUS_LABELS = {
  pending: '待審核',
  approved: '已核准',
  paid: '已撥款',
  rejected: '已退回'
}

// how a claim goes, in order
export const REIMBURSE_STEPS = [
  '填寫花錢的人的姓名、花費金額和科目，可以補充用途',
  '拍下或選擇發票、收據（可多張），會存到班聯會的雲端硬碟',
  '送出後是「待審核」，送錯了可以先撤回再重新申請',
  '核准後撥款，狀態會變成「已撥款」'
]
