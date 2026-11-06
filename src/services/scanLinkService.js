import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from 'src/boot/firebase'

// scanLinks/{linkId} (firestore.rules: match /scanLinks), one per computer
// receiving scans at the check-in desk (src/stores/scanDesk.js):
//   ownerUid, ownerName, createdAt  written once, by the computer
//   phone: { uid, name, at }        the phone that last paired or scanned
//   scan: { id, orderId, ticketCode, studentId?, at, byUid }  the last ticket
//     it read; studentId when read off the buyer's student card
//   need: { orderId, name, qr, card, at } | null  written by the computer:
//     what the order it shows still needs (the QR code, the student card),
//     so the phone asks for it
// Staff read a link by its id; after it is made only the phone fields and
// the computer's `need` change, for SCAN_LINK_HOURS (src/utils/scanLink.js).
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

// The computer's request to its phones; null clears it
export function setScanLinkNeed(linkId, need) {
  return updateDoc(linkRef(linkId), {
    need: need
      ? { orderId: need.orderId, name: shortName(need.name), qr: !!need.qr, card: !!need.card, at: serverTimestamp() }
      : null
  })
}
