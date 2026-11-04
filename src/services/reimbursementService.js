import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/boot/firebase'
import { RETRYABLE, byCreatedAtDesc } from 'src/services/orderService'
import { PARTY_YEAR } from 'src/services/partySurveyService'

// 報帳 (functions/lib/reimbursements.js). Admins and super admins claim back
// what they spent on the party, with photos or PDFs of the invoices
// (/admin/reimburse); submitReimbursement puts the invoices in the
// council's Google Drive and saves the claim. Super admins approve, pay out
// or reject the claims and see the party's profit (/super_admin/reimbursements).
//   reimbursements/{id}   { name, amount, note, category, year, status, submitterUid,
//                         submitterEmail, invoices: [{ fileId, name,
//                         contentType, size, url }], createdAt }; once
//                         reviewed also reviewedAt, reviewedByUid, reviewedByName
// `year` is the party's, so next year's profit leaves out this year's claims.

const submitCallable = httpsCallable(functions, 'submitReimbursement', { timeout: 120_000 })

const reimbursementsRef = () => collection(db, 'reimbursements')
const reimbursementRef = (id) => doc(db, 'reimbursements', id)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const toItem = (snapshot) => ({ id: snapshot.id, ...snapshot.data() })

/* ---------- admins ---------- */

// This party's claims by this staff member. Must filter on submitterUid:
// the rules reject queries that could return someone else's claims.
export async function fetchMyReimbursements(uid) {
  const snapshot = await getDocs(query(reimbursementsRef(), where('submitterUid', '==', uid)))
  return snapshot.docs.map(toItem).filter((item) => item.year === PARTY_YEAR).sort(byCreatedAtDesc)
}

// { requestId, name, amount, note, category, invoices: [{ name, contentType, data }] }
// (data in base64); returns { id }. Retries a lost or busy call with the same
// requestId, so the claim is saved and its invoices uploaded once.
export async function submitReimbursement(input) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { data } = await submitCallable({ ...input, year: PARTY_YEAR })
      return data
    } catch (error) {
      if (!RETRYABLE.includes(error?.code) || attempt >= 3) throw error
      await wait(500 * attempt + Math.random() * 1000)
    }
  }
}

// The submitter only while it is pending; super admins any (firestore.rules).
// trashReimbursementInvoices moves its invoices to the Drive's trash.
export function deleteReimbursement(id) {
  return deleteDoc(reimbursementRef(id))
}

/* ---------- super admins ---------- */

// Sorted here rather than with orderBy, which would need a composite index
export async function fetchReimbursements(year = PARTY_YEAR) {
  const snapshot = await getDocs(query(reimbursementsRef(), where('year', '==', year)))
  return snapshot.docs.map(toItem).sort(byCreatedAtDesc)
}

// Every year's claims, for the backup before 清除所有訂單
export async function fetchEveryReimbursement() {
  const snapshot = await getDocs(reimbursementsRef())
  return snapshot.docs.map(toItem)
}

// The 科目 alone (firestore.rules): correcting it is not a review
export function setReimbursementCategory(id, category) {
  return updateDoc(reimbursementRef(id), { category })
}

export function setReimbursementStatus(id, status, { uid, name }) {
  return updateDoc(reimbursementRef(id), {
    status,
    reviewedAt: serverTimestamp(),
    reviewedByUid: uid,
    reviewedByName: String(name || '').slice(0, 100)
  })
}
