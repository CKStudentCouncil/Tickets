import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/boot/firebase'
import { RETRYABLE, byCreatedAtDesc } from 'src/services/orderService'

// 學弟登記賣票 (functions/lib/sellers.js). Sellers on the list take tickets
// of the type chosen in settings/sellerProgram (二售) from its stock to sell
// themselves; the registration cannot be returned.
//   sellers/{email}                 the list, kept by super admins
//   sellerRegistrations/{id}        created by registerSellerTickets
//   sellerStats/summary             { total } registered by everyone
//   sellerPickups/{id}              { sellerEmail, quantity } each pickup,
//                                   recorded by admins
//   settings/sellerProgram          { enabled, ticketTypeId, goal }

const registerCallable = httpsCallable(functions, 'registerSellerTickets')
const updateQuantityCallable = httpsCallable(functions, 'updateSellerRegistrationQuantity')

export const DEFAULT_SELLER_GOAL = 750

const programRef = () => doc(db, 'settings', 'sellerProgram')
const summaryRef = () => doc(db, 'sellerStats', 'summary')
const sellerRef = (email) => doc(db, 'sellers', email.trim().toLowerCase())
const registrationRef = (id) => doc(db, 'sellerRegistrations', id)
const pickupsRef = () => collection(db, 'sellerPickups')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const toRegistration = (snapshot) => ({ id: snapshot.id, ...snapshot.data() })

/* ---------- everyone ---------- */

// Never throws: a failed look just hides the registration page
export async function isOnSellerList(email) {
  try {
    return (await getDoc(sellerRef(email))).exists()
  } catch {
    return false
  }
}

export async function fetchSellerProgram() {
  const snapshot = await getDoc(programRef())
  const data = snapshot.exists() ? snapshot.data() : {}

  return {
    enabled: data.enabled === true,
    ticketTypeId: String(data.ticketTypeId || ''),
    goal: Number.isInteger(data.goal) ? data.goal : DEFAULT_SELLER_GOAL
  }
}

// readable by sellers and admins
export async function fetchSellerTotal() {
  const snapshot = await getDoc(summaryRef())
  return Number(snapshot.data()?.total) || 0
}

/* ---------- sellers ---------- */

export async function fetchSellerEntry(email) {
  const snapshot = await getDoc(sellerRef(email))
  return snapshot.exists() ? snapshot.data() : null
}

// Must filter on sellerUid: the rules reject queries that could return
// other sellers' registrations
export async function fetchMyRegistrations(uid) {
  const snapshot = await getDocs(query(collection(db, 'sellerRegistrations'), where('sellerUid', '==', uid)))
  return snapshot.docs.map(toRegistration).sort(byCreatedAtDesc)
}

// Must filter on sellerEmail: the rules reject queries that could return
// other sellers' pickups
export async function fetchMyPickups(email) {
  const snapshot = await getDocs(query(pickupsRef(), where('sellerEmail', '==', email.trim().toLowerCase())))
  return snapshot.docs.map(toRegistration).sort(byCreatedAtDesc)
}

// The requestId of a registration whose outcome is unknown (the response
// was lost), kept across reloads so sending it again cannot register twice.
// The registration's document id is its requestId.
const pendingKey = (uid) => `cksc.sellerRequest.${uid}`

export function getPendingSellerRequest(uid) {
  try {
    return window.localStorage.getItem(pendingKey(uid)) || null
  } catch {
    return null
  }
}

export function setPendingSellerRequest(uid, requestId) {
  try {
    if (requestId) window.localStorage.setItem(pendingKey(uid), requestId)
    else window.localStorage.removeItem(pendingKey(uid))
  } catch {
    // without storage a reload loses it; the in-page retry still reuses it
  }
}

// Retries a lost or busy call with the same requestId, so it is saved once
export async function registerSellerTickets({ requestId, quantity, sellerName }) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { data } = await registerCallable({ requestId, quantity, sellerName })
      return data
    } catch (error) {
      if (!RETRYABLE.includes(error?.code) || attempt >= 3) throw error
      await wait(500 * attempt + Math.random() * 1000)
    }
  }
}

/* ---------- admins ---------- */

export async function fetchSellers() {
  const snapshot = await getDocs(collection(db, 'sellers'))
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function fetchAllRegistrations() {
  const snapshot = await getDocs(query(collection(db, 'sellerRegistrations'), orderBy('createdAt', 'desc')))
  return snapshot.docs.map(toRegistration)
}

// Takes more tickets from the stock or gives some back, at once. Not
// retried: a lost response shows up as the new quantity on the next load.
export async function updateRegistrationQuantity(id, quantity, expectedQuantity) {
  const { data } = await updateQuantityCallable({ registrationId: id, quantity, expectedQuantity })
  return data
}

export async function fetchAllPickups() {
  const snapshot = await getDocs(query(pickupsRef(), orderBy('createdAt', 'desc')))
  return snapshot.docs.map(toRegistration)
}

// Returns the saved pickup, with the local time until the next load
export async function addPickup(sellerEmail, quantity, createdByUid) {
  const email = sellerEmail.trim().toLowerCase()
  const ref = await addDoc(pickupsRef(), { sellerEmail: email, quantity, createdAt: serverTimestamp(), createdByUid })
  return { id: ref.id, sellerEmail: email, quantity, createdAt: new Date(), createdByUid }
}

export function deletePickup(id) {
  return deleteDoc(doc(db, 'sellerPickups', id))
}

// key: 'delivered' or 'paid'. Only that field is written, so two admins
// recording pickup and payment at once do not undo each other.
export function setRegistrationFlag(id, key, value, updatedByUid) {
  return updateDoc(registrationRef(id), { [key]: value, updatedAt: serverTimestamp(), updatedByUid })
}

// releaseSellerStock gives the tickets back to the stock
export function deleteRegistration(id) {
  return deleteDoc(registrationRef(id))
}

/* ---------- super admins ---------- */

// The document is public, so only the editor's uid is stored (PARTY-26)
export function saveSellerProgram({ enabled, ticketTypeId, goal }, updatedByUid) {
  return setDoc(programRef(), {
    enabled,
    ticketTypeId,
    goal,
    updatedAt: serverTimestamp(),
    updatedByUid
  })
}

// Firestore batches accept at most 500 writes
const BATCH_SIZE = 450

// entries: [{ email, name }] with lower-case emails
export async function addSellers(entries) {
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    entries.slice(i, i + BATCH_SIZE).forEach(({ email, name }) => {
      batch.set(sellerRef(email), { email, name, createdAt: serverTimestamp() })
    })
    await batch.commit()
  }
}

export function removeSeller(email) {
  return deleteDoc(sellerRef(email))
}
