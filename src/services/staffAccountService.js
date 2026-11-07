import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { isStaffRole } from 'src/data/roles'

// A super admin's invite for this email (pendingUsers/{email}, set in
// 帳號管理), or null. A verified Google account may read only its own.
export async function fetchStaffInvite(email) {
  const key = String(email || '').trim().toLowerCase()
  if (!key) return null

  try {
    const snapshot = await getDoc(doc(db, 'pendingUsers', key))
    const invite = snapshot.exists() ? snapshot.data() : null
    return isStaffRole(invite?.role) ? invite : null
  } catch {
    return null
  }
}

// uid -> the activation started for it, kept after it finishes: a load that
// read users/{uid} before the activation's write, and the invite after it,
// finds neither, and gets the new profile from here instead
const activations = new Map()

export function startedActivation(uid) {
  return activations.get(uid) || null
}

// An invited staff member's account: turn pendingUsers/{email} into
// users/{uid}, the first time the site sees them signed in, whether they
// just signed in or already were before being invited. The rules allow it
// only with the invite's exact role and name, deleting the invite in the
// same write, so nobody can grant themselves a role or reuse an invite.
// Resolves to the new users/{uid} data.
export function activateStaffInvite(user, invite) {
  const started = activations.get(user.uid)
  if (started) return started

  const now = new Date().toISOString()
  const profile = {
    email: String(user.email).trim().toLowerCase(),
    displayName: user.displayName || invite.name || '',
    photoURL: user.photoURL || '',
    name: invite.name || '',
    role: invite.role,
    uid: user.uid,
    createdAt: invite.createdAt || now,
    updatedAt: now
  }

  const batch = writeBatch(db)
  batch.set(doc(db, 'users', user.uid), profile)
  batch.delete(doc(db, 'pendingUsers', profile.email))

  const activation = batch.commit().then(
    () => profile,
    (error) => {
      activations.delete(user.uid) // a later load may try again
      throw error
    }
  )
  activations.set(user.uid, activation)
  return activation
}

// Staff keep their Google name and photo current on each sign-in
export function updateStaffProfile(user) {
  return setDoc(
    doc(db, 'users', user.uid),
    {
      email: user.email,
      ...(user.displayName ? { displayName: user.displayName } : {}),
      photoURL: user.photoURL || '',
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  )
}
