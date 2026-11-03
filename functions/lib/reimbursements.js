import * as functions from 'firebase-functions/v1'
import { FieldValue } from 'firebase-admin/firestore'

import { db, HttpsError } from './common.js'
import { REGION, ROLE_RANK } from './constants.js'
import { isValidRequestId } from './orderValidation.js'
import { DRIVE_SECRETS, createFolder, findFolder, trashFile, uploadFile } from './drive.js'
import { getTaiwanDateKey } from './time.js'

// 報帳 (/admin/reimburse). An admin or super admin claims back what they
// spent on the party: the name of whoever spent it (who is paid), a whole
// NT$ amount, an optional note, and photos or PDFs of the invoices. The
// invoices go to the council's Google Drive (drive.js), into a folder per
// party year, and only then is the claim saved, so every claim has them.
// Super admins review the claims on /super_admin/reimbursements (the status
// and review fields, written by the client under firestore.rules).
// Deleting a claim moves its invoices to the Drive's trash.
//
//   reimbursements/{requestId}   { name, amount, note, category, year, status: 'pending',
//                                submitterUid, submitterEmail, invoices:
//                                [{ fileId, name, contentType, size, url }],
//                                createdAt }. A retried call returns it.
//   reimbursementFolders/{year}  { folderId, name }: that year's Drive
//                                folder. Written only here (denied by the rules).

// Keep in sync with src/data/reimbursements.js
export const MAX_REIMBURSER_NAME = 50
export const MAX_REIMBURSEMENT_AMOUNT = 1000000
export const MAX_REIMBURSEMENT_NOTE = 200
export const MAX_INVOICE_FILES = 5
// Callable payloads are capped at 10 MB and base64 adds ~33%
export const MAX_INVOICE_BYTES = 7 * 1024 * 1024
export const REIMBURSEMENT_CATEGORIES = ['場地', '音響燈光', '舞台演出', '場佈道具', '宣傳印刷', '票務', '餐飲', '其他']
export const FOLDER_NAME = 'CK Party Night 報帳發票'

// Firestore's gRPC code when create() finds the document already there
const ALREADY_EXISTS = 6

// What each accepted type's content starts with, so a file is what it claims
const INVOICE_TYPES = {
  'image/jpeg': { ext: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', matches: (b) => b.toString('latin1', 1, 4) === 'PNG' && b[0] === 0x89 },
  'image/webp': { ext: 'webp', matches: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  'application/pdf': { ext: 'pdf', matches: (b) => b.toString('latin1', 0, 5) === '%PDF-' }
}

const invalid = (message) => new HttpsError('invalid-argument', message)

// Characters Drive takes but a downloaded copy's file system may not
const fileSafe = (value) => String(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()

// { requestId, name, amount, note, category, year, invoices: [{ name,
// contentType, data (base64) }] }; returns the invoices' content decoded
export function sanitizeReimbursementInput(data) {
  if (!isValidRequestId(data?.requestId)) throw invalid('報帳請求無效，請重新整理後再試')

  const name = typeof data?.name === 'string' ? data.name.trim() : ''
  if (!name || name.length > MAX_REIMBURSER_NAME) throw invalid(`請填寫姓名，最多 ${MAX_REIMBURSER_NAME} 字`)

  const amount = data?.amount
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_REIMBURSEMENT_AMOUNT) {
    throw invalid(`金額必須是 1 到 ${MAX_REIMBURSEMENT_AMOUNT.toLocaleString()} 的整數`)
  }

  const note = typeof data?.note === 'string' ? data.note.trim() : ''
  if (note.length > MAX_REIMBURSEMENT_NOTE) throw invalid(`用途最多 ${MAX_REIMBURSEMENT_NOTE} 字`)

  const category = data?.category
  if (!REIMBURSEMENT_CATEGORIES.includes(category)) throw invalid('請選擇科目')

  const year = data?.year
  if (!Number.isInteger(year) || year < 2000 || year > 2999) throw invalid('報帳年度不正確')

  const files = Array.isArray(data?.invoices) ? data.invoices : []
  if (files.length === 0) throw invalid('請附上發票或收據')
  if (files.length > MAX_INVOICE_FILES) throw invalid(`發票最多 ${MAX_INVOICE_FILES} 個檔案`)

  const invoices = files.map((file) => {
    const contentType = String(file?.contentType || '')
    const type = INVOICE_TYPES[contentType]
    if (!type) throw invalid('發票只接受 JPG、PNG、WEBP 圖片或 PDF')

    const content = Buffer.from(typeof file?.data === 'string' ? file.data : '', 'base64')
    if (content.length < 12 || !type.matches(content)) throw invalid('無法讀取發票檔案，請重新選擇')

    return { name: fileSafe(file?.name || '').slice(0, 100) || `invoice.${type.ext}`, contentType, ext: type.ext, content }
  })
  if (invoices.reduce((total, invoice) => total + invoice.content.length, 0) > MAX_INVOICE_BYTES) {
    throw invalid('發票檔案合計最多 7 MB')
  }

  return { requestId: data.requestId, name, amount, note, category, year, invoices }
}

// Sorts by date in the Drive folder: 20261103_林小明_NT$1200_a1b2c3_1.jpg
export function invoiceFileName(claim, invoice, index, dateKey) {
  const id = claim.requestId.replace(/[^\w]/g, '').slice(0, 6)
  return `${dateKey}_${fileSafe(claim.name)}_NT$${claim.amount}_${id}_${index + 1}.${invoice.ext}`
}

export function invoiceDescription(claim, submitterEmail) {
  return [
    `報帳：${claim.name} NT$ ${claim.amount.toLocaleString()}（${claim.category}）`,
    claim.note && `用途：${claim.note}`,
    `申請人：${submitterEmail}`,
    `報帳編號：${claim.requestId}`
  ].filter(Boolean).join('\n')
}

const folderRef = (year) => db.doc(`reimbursementFolders/${year}`)

// That year's folder in the council's Drive, made with its first claim
async function folderFor(year) {
  const saved = (await folderRef(year).get()).data()?.folderId
  if (saved) return saved

  const name = `${FOLDER_NAME} ${year}`
  const found = await findFolder(name)
  const folderId = found || (await createFolder(name))
  try {
    await folderRef(year).create({ folderId, name, createdAt: FieldValue.serverTimestamp() })
    return folderId
  } catch (error) {
    if (error.code !== ALREADY_EXISTS) throw error
    // another claim made one at the same time: theirs is kept
    if (!found) await trashFile(folderId).catch(() => {})
    return (await folderRef(year).get()).data().folderId
  }
}

// Never throws: a file left behind in the Drive is only untidy
async function trashInvoices(invoices) {
  const results = await Promise.allSettled(invoices.map((invoice) => trashFile(invoice.fileId)))
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[reimbursements] could not trash ${invoices[index].fileId}:`, result.reason)
    }
  })
}

export const submitReimbursement = functions
  .region(REGION)
  .runWith({ secrets: DRIVE_SECRETS, memory: '512MB', timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) throw new HttpsError('unauthenticated', '請先登入')
    const uid = context.auth.uid
    const claim = sanitizeReimbursementInput(data)
    const claimRef = db.doc(`reimbursements/${claim.requestId}`)

    const [actorSnap, claimSnap] = await Promise.all([db.doc(`users/${uid}`).get(), claimRef.get()])
    const role = actorSnap.data()?.role
    const rank = Object.hasOwn(ROLE_RANK, role) ? ROLE_RANK[role] : 0
    if (rank < ROLE_RANK.admin) throw new HttpsError('permission-denied', '只有管理員可以報帳')

    // the same claim was already saved (e.g. the response was lost)
    if (claimSnap.exists) {
      if (claimSnap.data().submitterUid !== uid) throw invalid('報帳請求無效，請重新整理後再試')
      return { id: claimRef.id }
    }

    const submitterEmail = String(context.auth.token?.email || '').toLowerCase()
    const dateKey = getTaiwanDateKey()
    const uploaded = []
    try {
      const folderId = await folderFor(claim.year)
      for (const [index, invoice] of claim.invoices.entries()) {
        const file = await uploadFile({
          name: invoiceFileName(claim, invoice, index, dateKey),
          contentType: invoice.contentType,
          content: invoice.content,
          folderId,
          description: invoiceDescription(claim, submitterEmail)
        })
        uploaded.push({
          fileId: file.id,
          name: invoice.name,
          contentType: invoice.contentType,
          size: invoice.content.length,
          url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`
        })
      }
    } catch (error) {
      console.error('[submitReimbursement] Drive upload failed:', error)
      await trashInvoices(uploaded)
      // the owner deleted the folder: the next try makes a new one
      if (error.status === 404) await folderRef(claim.year).delete().catch(() => {})
      if (error.auth) {
        throw new HttpsError('failed-precondition', '雲端硬碟的授權失效了，請通知系統管理員重新授權')
      }
      throw new HttpsError('unavailable', '發票上傳失敗，請稍後再試')
    }

    try {
      await claimRef.create({
        name: claim.name,
        amount: claim.amount,
        note: claim.note,
        category: claim.category,
        year: claim.year,
        status: 'pending',
        submitterUid: uid,
        submitterEmail,
        invoices: uploaded,
        createdAt: FieldValue.serverTimestamp()
      })
    } catch (error) {
      await trashInvoices(uploaded)
      // a retry of the same claim was saved first, with its own copies
      if (error.code === ALREADY_EXISTS) return { id: claimRef.id }
      console.error('[submitReimbursement] save failed:', error)
      throw new HttpsError('internal', '報帳失敗，請稍後再試')
    }

    return { id: claimRef.id }
  })

// A withdrawn or deleted claim's invoices go to the Drive's trash
export const trashReimbursementInvoices = functions
  .region(REGION)
  .runWith({ secrets: DRIVE_SECRETS })
  .firestore.document('reimbursements/{claimId}')
  .onDelete(async (snapshot) => {
    const invoices = snapshot.data()?.invoices
    await trashInvoices(Array.isArray(invoices) ? invoices.filter((invoice) => invoice?.fileId) : [])
  })
