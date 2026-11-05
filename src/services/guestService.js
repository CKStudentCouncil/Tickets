import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
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
// 登記連結: super admins share one link with a group; each person signs up on
// /join/{id}, super admins approve or reject them here, then send the
// approved ones their ticket.
//   guestSignupLinks/{id}      { title, quantity (per person), open }
//   guestSignupLinks/{id}/signups/{uid}
//                              { name, email, note, status: 'pending' |
//                              'approved' | 'rejected' | 'sent', orderId,
//                              updatedAt (what the guest last wrote) };
//                              deletedOrderId once its ticket was deleted

const callables = {
  sendGuestInvitation: httpsCallable(functions, 'sendGuestInvitation'),
  sendOfficerTicket: httpsCallable(functions, 'sendOfficerTicket'),
  createOfficerInvite: httpsCallable(functions, 'createOfficerInvite'),
  revokeOfficerInvite: httpsCallable(functions, 'revokeOfficerInvite'),
  claimOfficerInvite: httpsCallable(functions, 'claimOfficerInvite'),
  createGuestSignupLink: httpsCallable(functions, 'createGuestSignupLink'),
  submitGuestSignup: httpsCallable(functions, 'submitGuestSignup'),
  sendGuestSignupTicket: httpsCallable(functions, 'sendGuestSignupTicket')
}

const officerRef = (email) => doc(db, 'officers', email.trim().toLowerCase())
const inviteRef = (id) => doc(db, 'officerInvites', id)
const signupLinkRef = (id) => doc(db, 'guestSignupLinks', id)
const signupRef = (linkId, uid) => doc(db, 'guestSignupLinks', linkId, 'signups', uid)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const toItem = (snapshot) => ({ id: snapshot.id, ...snapshot.data() })

export const inviteUrl = (id) => `${SITE_URL}/invite/${encodeURIComponent(id)}`
export const signupUrl = (id) => `${SITE_URL}/join/${encodeURIComponent(id)}`

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

/* ---------- guests with a sign-up link ---------- */

// null when the link is unknown (mistyped)
export async function fetchSignupLink(id) {
  const snapshot = await getDoc(signupLinkRef(id))
  return snapshot.exists() ? toItem(snapshot) : null
}

// The signed-in guest's sign-up on a link, or null before they sign up
export async function fetchMySignup(linkId, uid) {
  const snapshot = await getDoc(signupRef(linkId, uid))
  return snapshot.exists() ? toItem(snapshot) : null
}

// { linkId, name, note }; signing up again while pending changes it
export const submitGuestSignup = (input) => call('submitGuestSignup', input)

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

/* ---------- 登記連結 (super admins) ---------- */

export async function fetchSignupLinks() {
  const snapshot = await getDocs(collection(db, 'guestSignupLinks'))
  return snapshot.docs.map(toItem).sort(byCreatedAtDesc)
}

const signupsRef = (linkId) => collection(db, 'guestSignupLinks', linkId, 'signups')

// The sign-ups of these links, newest first; `key` tells apart one guest's
// sign-ups on two links
export async function fetchSignups(linkIds) {
  const lists = await Promise.all(
    linkIds.map(async (linkId) =>
      (await getDocs(signupsRef(linkId))).docs.map((d) => ({ ...d.data(), key: d.ref.path, linkId, uid: d.id }))
    )
  )
  return lists.flat().sort(byCreatedAtDesc)
}

// Whether a link still has sign-ups to review or send; reads one at most
export async function hasWaitingSignups(linkId) {
  const snapshot = await getDocs(query(signupsRef(linkId), where('status', 'in', ['pending', 'approved']), limit(1)))
  return !snapshot.empty
}

// { requestId, title, quantity }; returns { id } of the link
export const createSignupLink = (input) => call('createGuestSignupLink', input)

// closes a link to new sign-ups, or opens it again
export const setSignupLinkOpen = (id, open) => updateDoc(signupLinkRef(id), { open })

// Firestore takes at most 500 writes a batch, so a longer list goes in
// batches one after another: each is all or none, but a failed one leaves
// those before it written. Its error then carries `done`, the items written.
async function writeInBatches(items, write) {
  let done = 0
  for (let start = 0; start < items.length; start += 500) {
    const chunk = items.slice(start, start + 500)
    const batch = writeBatch(db)
    chunk.forEach((item) => write(batch, item))
    try {
      await batch.commit()
    } catch (error) {
      throw Object.assign(error, { done })
    }
    done += chunk.length
  }
}

// Sets the review of sign-ups ({ linkId, uid, updatedAt }) to 'pending',
// 'approved' or 'rejected', each naming the updatedAt it was shown with: one
// sent, or changed by its guest, since then fails its batch (writeInBatches).
export function reviewSignups(signups, status, reviewerUid) {
  return writeInBatches(signups, (batch, { linkId, uid, updatedAt }) =>
    batch.update(signupRef(linkId, uid), {
      status,
      reviewedAt: serverTimestamp(),
      reviewedByUid: reviewerUid,
      reviewedUpdatedAt: updatedAt ?? null
    })
  )
}

// Deletes rejected sign-ups ({ linkId, uid }); see writeInBatches
export function deleteSignups(signups) {
  return writeInBatches(signups, (batch, { linkId, uid }) => batch.delete(signupRef(linkId, uid)))
}

// Sends an approved sign-up, as it was shown, its ticket; returns { id } of
// the order. Sending one already sent returns the same order. Unless
// `allowDuplicate`, an email that already has a 公關票 is refused with
// already-exists and details { duplicate: true }.
export const sendSignupTicket = ({ linkId, uid, updatedAt }, allowDuplicate = false) =>
  call('sendGuestSignupTicket', { linkId, uid, updatedAt: updatedAt?.toMillis?.() ?? null, allowDuplicate })
