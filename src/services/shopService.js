import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from 'src/boot/firebase'

// { openAt: "YYYY-MM-DDTHH:mm:00+08:00" }. Publicly readable, written only by
// super admins on the management page (firestore.rules: settings/{settingId}).
const shopRef = () => doc(db, 'settings', 'shop')

export function watchShopSettings(onChange, onError) {
  return onSnapshot(
    shopRef(),
    (snapshot) => onChange(snapshot.exists() ? snapshot.data() : {}),
    onError
  )
}

// Only the editor's uid is stored, since the document is public (PARTY-26)
export function saveShopOpenAt(openAt, updatedByUid) {
  return setDoc(shopRef(), { openAt, updatedAt: new Date(), updatedByUid }, { merge: true })
}
