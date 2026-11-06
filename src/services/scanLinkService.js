import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from 'src/boot/firebase'

// scanLinks/{linkId} (firestore.rules: match /scanLinks), one per computer
// receiving scans at the check-in desk (src/stores/scanDesk.js):
//   ownerUid, ownerName, createdAt  written once, by the computer
//   phone: { uid, name, at }        the phone that last paired or scanned
//   scan: { id, orderId, ticketCode, studentId?, at, byUid }  the last ticket
//     it read; studentId when found by scanning the buyer's student card
// Staff read a link by its id; after it is made only the phone fields
// change, for SCAN_LINK_HOURS (src/utils/scanLink.js).
const linksRef = () => collection(db, 'scanLinks')
const linkRef = (linkId) => doc(db, 'scanLinks', linkId)

// staff names are short; the rules cap them at 200 characters
const shortName = (name) => String(name || '').slice(0, 100)

export async function createScanLink({ uid, name }) {
  const ref = doc(linksRef())
  await setDoc(ref, { ownerUid: uid, ownerName: shortName(name), createdAt: serverTimestamp() })
  return ref.id
}

// onChange(link), or onChange(null) once the link is deleted
export function watchScanLink(linkId, onChange, onError) {
  return onSnapshot(
    linkRef(linkId),
    (snapshot) => onChange(snapshot.exists() ? snapshot.data({ serverTimestamps: 'estimate' }) : null),
    onError
  )
}

export function deleteScanLink(linkId) {
  return deleteDoc(linkRef(linkId))
}

const phoneField = ({ uid, name }) => ({ uid, name: shortName(name), at: serverTimestamp() })

// Fails (permission-denied) when the link is gone or has expired
export function joinScanLink(linkId, phone) {
  return updateDoc(linkRef(linkId), { phone: phoneField(phone) })
}

export function sendScan(linkId, phone, { orderId, ticketCode = '', studentId = '' }) {
  return updateDoc(linkRef(linkId), {
    phone: phoneField(phone),
    scan: {
      // tells the computer this is a new scan, even of the same ticket
      id: doc(linksRef()).id,
      orderId,
      ticketCode,
      ...(studentId ? { studentId } : {}),
      at: serverTimestamp(),
      byUid: phone.uid
    }
  })
}
