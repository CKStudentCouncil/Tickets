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
  updateDoc,
  where
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/boot/firebase'
import { SITE_URL } from 'src/config/app'
import { RETRYABLE, byCreatedAtDesc } from 'src/services/orderService'

// 公關票 (functions/lib/guests.js). Super admins keep the officers (幹部)
// and their quotas; an officer gives tickets out on /officer by name and
// email or as one-time invite links, which guests claim on /invite/{id}.
//   officers/{email}           { email, name, quota, used }; used is kept by the functions
//   officerInvites/{id}        an invite link; status 'open' or 'claimed'; a
//                              super admin's has council: true and no officer
//   officerInviteNotes/{id}    { note }: what the link is for, for its officer
//                              and super admins only
//   orders/{id}                the tickets, NT$0 orders with complimentary: true

const callables = {
  sendGuestInvitation: httpsCallable(functions, 'sendGuestInvitation'),
  sendOfficerTicket: httpsCallable(functions, 'sendOfficerTicket'),
  createOfficerInvite: httpsCallable(functions, 'createOfficerInvite'),
  revokeOfficerInvite: httpsCallable(functions, 'revokeOfficerInvite'),
  claimOfficerInvite: httpsCallable(functions, 'claimOfficerInvite')
}

const officerRef = (email) => doc(db, 'officers', email.trim().toLowerCase())
const inviteRef = (id) => doc(db, 'officerInvites', id)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const toItem = (snapshot) => ({ id: snapshot.id, ...snapshot.data() })

export const inviteUrl = (id) => `${SITE_URL}/invite/${encodeURIComponent(id)}`

// Tickets an officer may still give out
export const remainingOf = (officer) => Math.max(0, (Number(officer?.quota) || 0) - (Number(officer?.used) || 0))

// Tickets in a 公關票 order
export const quantityOf = (ticket) =>
  (Array.isArray(ticket?.items) ? ticket.items : []).reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0)

// Retries a lost or busy call with the same input (and so the same
// requestId, where it has one), so it takes effect once
async function call(name, input) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { data } = await callables[name](input)
      return data
    } catch (error) {
      if (!RETRYABLE.includes(error?.code) || attempt >= 3) throw error
      await wait(500 * attempt + Math.random() * 1000)
    }
  }
}

/* ---------- officers ---------- */

// null when the account is not on the officer list
export async function fetchMyOfficer(email) {
  const snapshot = await getDoc(officerRef(email))
  return snapshot.exists() ? toItem(snapshot) : null
}

// Never throws: a failed look just hides the officer page from the menu
export async function isOnOfficerList(email) {
  try {
    return (await getDoc(officerRef(email))).exists()
  } catch {
    return false
  }
}

export async function fetchMyOfficerTickets(email) {
  const snapshot = await getDocs(query(collection(db, 'orders'), where('officerEmail', '==', email.trim().toLowerCase())))
  return snapshot.docs.map(toItem).sort(byCreatedAtDesc)
}

export async function fetchMyInvites(email) {
  const snapshot = await getDocs(query(collection(db, 'officerInvites'), where('officerEmail', '==', email.trim().toLowerCase())))
  return snapshot.docs.map(toItem).sort(byCreatedAtDesc)
}

// { [inviteId]: note }
const notesOf = (snapshot) => Object.fromEntries(snapshot.docs.map((d) => [d.id, String(d.data().note || '')]))

export async function fetchMyInviteNotes(email) {
  return notesOf(await getDocs(query(collection(db, 'officerInviteNotes'), where('officerEmail', '==', email.trim().toLowerCase()))))
}

// { requestId, name, email, quantity, allowDuplicate }; returns { id } of the order
export const sendOfficerTicket = (input) => call('sendOfficerTicket', input)

// { requestId, quantity, note }; returns { id } of the invite
export const createOfficerInvite = (input) => call('createOfficerInvite', input)

export const revokeOfficerInvite = (inviteId) => call('revokeOfficerInvite', { inviteId })

/* ---------- guests with an invite link ---------- */

// null when the link is unknown (revoked, mistyped)
export async function fetchInvite(id) {
  const snapshot = await getDoc(inviteRef(id))
  return snapshot.exists() ? toItem(snapshot) : null
}

// returns { id } of the order
export const claimOfficerInvite = (inviteId, name) => call('claimOfficerInvite', { inviteId, name })

/* ---------- super admins ---------- */

export async function fetchOfficers() {
  const snapshot = await getDocs(query(collection(db, 'officers'), orderBy('createdAt', 'desc')))
  return snapshot.docs.map(toItem)
}

export async function fetchAllInvites() {
  const snapshot = await getDocs(collection(db, 'officerInvites'))
  return snapshot.docs.map(toItem).sort(byCreatedAtDesc)
}

export async function fetchAllInviteNotes() {
  return notesOf(await getDocs(collection(db, 'officerInviteNotes')))
}

// A link in the council's name, outside any quota: { requestId, quantity,
// note }; returns { id } of the invite
export const createCouncilInvite = (input) => call('createOfficerInvite', { ...input, council: true })

export function addOfficer({ email, name, quota }) {
  const address = email.trim().toLowerCase()
  return setDoc(officerRef(address), { email: address, name, quota, used: 0, createdAt: serverTimestamp() })
}

export function updateOfficer(email, { name, quota }) {
  return updateDoc(officerRef(email), { name, quota })
}

export function deleteOfficer(email) {
  return deleteDoc(officerRef(email))
}

// Sorted here rather than with orderBy, which would need a composite index;
// there are only a few of them
export async function fetchGuestTickets() {
  const snapshot = await getDocs(query(collection(db, 'orders'), where('complimentary', '==', true)))
  return snapshot.docs.map(toItem).sort(byCreatedAtDesc)
}

// { requestId, quantity, name, email }; returns { id } of its order
export const sendGuestInvitation = (input) => call('sendGuestInvitation', input)
