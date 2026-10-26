import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/boot/firebase'
import { RETRYABLE, byCreatedAtDesc } from 'src/services/orderService'

// 公關票 (functions/lib/guests.js). Invited guests leave their details on
// /guest; super admins send the tickets, to them or by name and email.
//   guestRegistrations/{uid}   a guest's details; sendGuestInvitation adds orderId
//   orders/{id}                the tickets, NT$0 orders with complimentary: true

const sendCallable = httpsCallable(functions, 'sendGuestInvitation')

const registrationRef = (uid) => doc(db, 'guestRegistrations', uid)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const toItem = (snapshot) => ({ id: snapshot.id, ...snapshot.data() })

/* ---------- guests ---------- */

export async function fetchMyGuestRegistration(uid) {
  const snapshot = await getDoc(registrationRef(uid))
  return snapshot.exists() ? toItem(snapshot) : null
}

// `createdAt` of the earlier registration, kept when it is changed
export function saveGuestRegistration(uid, { name, email, relation, relationDetail }, createdAt = null) {
  return setDoc(registrationRef(uid), {
    name,
    email,
    relation,
    relationDetail,
    createdAt: createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  })
}

/* ---------- super admins ---------- */

export async function fetchGuestRegistrations() {
  const snapshot = await getDocs(query(collection(db, 'guestRegistrations'), orderBy('createdAt', 'desc')))
  return snapshot.docs.map(toItem)
}

export function deleteGuestRegistration(uid) {
  return deleteDoc(registrationRef(uid))
}

// Sorted here rather than with orderBy, which would need a composite index;
// there are only a few of them
export async function fetchGuestTickets() {
  const snapshot = await getDocs(query(collection(db, 'orders'), where('complimentary', '==', true)))
  return snapshot.docs.map(toItem).sort(byCreatedAtDesc)
}

// { requestId, quantity } and either { registrationId } or { name, email,
// relation, relationDetail }. Retries a lost or busy call with the same
// requestId, so the ticket is sent once; returns { id } of its order.
export async function sendGuestInvitation(input) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { data } = await sendCallable(input)
      return data
    } catch (error) {
      if (!RETRYABLE.includes(error?.code) || attempt >= 3) throw error
      await wait(500 * attempt + Math.random() * 1000)
    }
  }
}
