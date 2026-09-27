import { Timestamp, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from 'src/boot/firebase'

// settings/shop: { openAt: Timestamp, updatedAt, updatedByUid }. Publicly
// readable, written only by super admins on the management page, and checked
// by createOrder (firestore.rules: match /settings/shop). Documents saved
// before openAt became a Timestamp hold a "YYYY-MM-DDTHH:mm:00+08:00"
// string, which parseDate() still reads.
const shopRef = () => doc(db, 'settings', 'shop')

export function watchShopSettings(onChange, onError) {
  return onSnapshot(
    shopRef(),
    // an openAt written with serverTimestamp() is null until the server
    // confirms it; use the local estimate meanwhile
    (snapshot) => onChange(snapshot.exists() ? snapshot.data({ serverTimestamps: 'estimate' }) : {}),
    onError
  )
}

// `openAt` is a Date, or null for "now" (the server's clock, not this
// device's). Only the editor's uid is stored, since the document is public
// (PARTY-26). A plain set replaces the whole document, as the rules only
// accept these three fields.
export function saveShopOpenAt(openAt, updatedByUid) {
  return setDoc(shopRef(), {
    openAt: openAt ? Timestamp.fromDate(openAt) : serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedByUid
  })
}
