// Firestore security rules tests. Run with `npm run test:rules` (needs Java
// for the Firestore emulator).
import { after, before, beforeEach, describe, test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore'

let env

const ORDER_ID = 'CKS202611050001'
const ORDER = {
  customerName: '王小明',
  customerEmail: 'buyer@example.com',
  customerPhone: '0912345678',
  school: '建國中學',
  items: [{ id: 'campus_ticket', name: '校內票', price: 700, quantity: 1 }],
  finalTotal: 700,
  accessToken: 'secret',
  delivered: false,
  paid: false
}

const staff = {
  manager: { uid: 'manager-uid', email: 'manager@example.com' },
  admin: { uid: 'admin-uid', email: 'admin@example.com' },
  superAdmin: { uid: 'super-uid', email: 'super@example.com' }
}

const as = ({ uid, email }, verified = true) =>
  env.authenticatedContext(uid, { email, email_verified: verified }).firestore()
const anon = () => env.unauthenticatedContext().firestore()

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cksc-ticket',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
  })
})

after(async () => {
  await env?.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'users', staff.manager.uid), { email: staff.manager.email, role: 'manager' })
    await setDoc(doc(db, 'users', staff.admin.uid), { email: staff.admin.email, role: 'admin' })
    await setDoc(doc(db, 'users', staff.superAdmin.uid), { email: staff.superAdmin.email, role: 'super_admin' })
    await setDoc(doc(db, 'orders', ORDER_ID), ORDER)
    await setDoc(doc(db, 'settings', 'ticketTypes'), { types: [] })
    await setDoc(doc(db, 'ticketSales', 'campus_ticket'), { sold: 1 })
    await setDoc(doc(db, 'pendingUsers', 'invitee@example.com'), {
      email: 'invitee@example.com',
      name: '新幹部',
      role: 'manager'
    })
  })
})

describe('orders (PARTY-2)', () => {
  test('signed-out visitors cannot get, list or create orders', async () => {
    await assertFails(getDoc(doc(anon(), 'orders', ORDER_ID)))
    await assertFails(getDocs(collection(anon(), 'orders')))
    await assertFails(setDoc(doc(anon(), 'orders', 'CKS202611050002'), ORDER))
  })

  test('a signed-in non-staff user cannot read or create orders', async () => {
    const user = { uid: 'random', email: 'random@example.com' }
    await assertFails(getDoc(doc(as(user), 'orders', ORDER_ID)))
    await assertFails(setDoc(doc(as(user), 'orders', 'CKS202611050002'), ORDER))
  })

  test('staff can read orders', async () => {
    await assertSucceeds(getDoc(doc(as(staff.manager), 'orders', ORDER_ID)))
    await assertSucceeds(getDocs(collection(as(staff.admin), 'orders')))
  })

  test('managers can only change the pickup status', async () => {
    const db = as(staff.manager)
    await assertSucceeds(updateDoc(doc(db, 'orders', ORDER_ID), {
      delivered: true,
      deliveryUpdatedAt: serverTimestamp(),
      deliveryUpdatedByName: 'M'
    }))
    await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), { paid: true }))
    await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), { finalTotal: 0 }))
    await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), { delivered: 'yes' }))
    await assertFails(deleteDoc(doc(db, 'orders', ORDER_ID)))
  })

  test('admins can change payment status and delete, but not prices', async () => {
    const db = as(staff.admin)
    await assertSucceeds(updateDoc(doc(db, 'orders', ORDER_ID), {
      paid: true,
      paymentUpdatedAt: serverTimestamp(),
      paymentUpdatedByName: 'A'
    }))
    await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), { finalTotal: 0 }))
    await assertSucceeds(deleteDoc(doc(db, 'orders', ORDER_ID)))
  })

  test('function-only counters are not readable or writable by anyone', async () => {
    await assertFails(getDoc(doc(as(staff.superAdmin), 'ticketSales', 'campus_ticket')))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'ticketSales', 'campus_ticket'), { sold: 0 }))
    await assertFails(setDoc(doc(anon(), 'buyerPurchases', 'x'), { quantities: {} }))
  })
})

describe('users (PARTY-1)', () => {
  const stranger = { uid: 'stranger', email: 'stranger@example.com' }

  test('nobody can grant themselves a role without an invite', async () => {
    await assertFails(setDoc(doc(as(stranger), 'users', stranger.uid), { role: 'super_admin' }))
    await assertFails(setDoc(doc(as(stranger), 'users', stranger.uid), {
      email: stranger.email, role: 'manager', uid: stranger.uid
    }))
  })

  test('staff cannot change their own role', async () => {
    await assertFails(updateDoc(doc(as(staff.manager), 'users', staff.manager.uid), { role: 'super_admin' }))
    await assertSucceeds(updateDoc(doc(as(staff.manager), 'users', staff.manager.uid), {
      displayName: 'New name',
      updatedAt: 'now'
    }))
  })

  test('users can only read their own profile unless super admin', async () => {
    await assertSucceeds(getDoc(doc(as(staff.manager), 'users', staff.manager.uid)))
    await assertFails(getDoc(doc(as(staff.manager), 'users', staff.admin.uid)))
    await assertFails(getDocs(collection(as(staff.admin), 'users')))
    await assertSucceeds(getDocs(collection(as(staff.superAdmin), 'users')))
  })

  const invitee = { uid: 'invitee-uid', email: 'invitee@example.com' }
  const profile = (role = 'manager') => ({
    email: invitee.email,
    displayName: 'Invitee',
    photoURL: '',
    name: '新幹部',
    role,
    uid: invitee.uid,
    createdAt: 'now',
    updatedAt: 'now'
  })

  test('an invited user activates with the invited role while consuming the invite', async () => {
    const db = as(invitee)
    const batch = writeBatch(db)
    batch.set(doc(db, 'users', invitee.uid), profile())
    batch.delete(doc(db, 'pendingUsers', invitee.email))
    await assertSucceeds(batch.commit())
  })

  test('activation fails with another role, without consuming the invite, or unverified email', async () => {
    const db = as(invitee)
    const wrongRole = writeBatch(db)
    wrongRole.set(doc(db, 'users', invitee.uid), profile('super_admin'))
    wrongRole.delete(doc(db, 'pendingUsers', invitee.email))
    await assertFails(wrongRole.commit())

    await assertFails(setDoc(doc(db, 'users', invitee.uid), profile()))

    const unverified = as(invitee, false)
    const batch = writeBatch(unverified)
    batch.set(doc(unverified, 'users', invitee.uid), profile())
    batch.delete(doc(unverified, 'pendingUsers', invitee.email))
    await assertFails(batch.commit())
  })
})

describe('pendingUsers (PARTY-7)', () => {
  const invitee = { uid: 'invitee-uid', email: 'invitee@example.com' }
  const other = { uid: 'other', email: 'other@example.com' }

  test('only super admins can list invites', async () => {
    await assertFails(getDocs(collection(as(other), 'pendingUsers')))
    await assertFails(getDocs(collection(as(staff.admin), 'pendingUsers')))
    await assertSucceeds(getDocs(collection(as(staff.superAdmin), 'pendingUsers')))
  })

  test('an invitee can read only their own invite', async () => {
    await assertSucceeds(getDoc(doc(as(invitee), 'pendingUsers', invitee.email)))
    await assertFails(getDoc(doc(as(other), 'pendingUsers', invitee.email)))
  })

  test("nobody but super admins can delete someone else's invite, or an invite outside activation", async () => {
    await assertFails(deleteDoc(doc(as(other), 'pendingUsers', invitee.email)))
    await assertFails(deleteDoc(doc(as(invitee), 'pendingUsers', invitee.email)))
    await assertSucceeds(deleteDoc(doc(as(staff.superAdmin), 'pendingUsers', invitee.email)))
  })

  test('only super admins create invites, keyed by email with a staff role', async () => {
    const invite = { email: 'x@example.com', name: 'X', role: 'admin' }
    await assertFails(setDoc(doc(as(staff.admin), 'pendingUsers', 'x@example.com'), invite))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'pendingUsers', 'y@example.com'), invite))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'pendingUsers', 'x@example.com'), { ...invite, role: 'owner' }))
    await assertSucceeds(setDoc(doc(as(staff.superAdmin), 'pendingUsers', 'x@example.com'), invite))
  })
})

describe('settings and public content', () => {
  test('everyone can read; only super admins can write', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'settings', 'ticketTypes')))
    await assertSucceeds(getDocs(collection(anon(), 'partyStories')))
    await assertSucceeds(getDocs(collection(anon(), 'partyLineup')))
    await assertFails(setDoc(doc(as(staff.admin), 'settings', 'ticketTypes'), { types: [] }))
    await assertFails(setDoc(doc(as(staff.admin), 'partyStories', 's1'), { title: 't' }))
    await assertSucceeds(setDoc(doc(as(staff.superAdmin), 'settings', 'ticketTypes'), { types: [] }))
    await assertSucceeds(setDoc(doc(as(staff.superAdmin), 'partyLineup', 'l1'), { name: 'n' }))
  })
})

describe('surveyResponses', () => {
  const response = () => ({
    identity: '建中學生',
    channels: ['Instagram'],
    device: '手機',
    scores: { q1: 5 },
    issueCount: '沒有遇到問題',
    issueTypes: [],
    improvement: '',
    suggestion: '',
    createdAt: serverTimestamp()
  })

  test('anyone can submit a well-formed response', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'surveyResponses', 'r1'), response()))
  })

  test('malformed responses are rejected', async () => {
    await assertFails(setDoc(doc(anon(), 'surveyResponses', 'r2'), { ...response(), admin: true }))
    await assertFails(setDoc(doc(anon(), 'surveyResponses', 'r3'), { ...response(), createdAt: 'yesterday' }))
    await assertFails(setDoc(doc(anon(), 'surveyResponses', 'r4'), { ...response(), suggestion: 'x'.repeat(2001) }))
  })

  test('only staff can read responses', async () => {
    await assertFails(getDocs(collection(anon(), 'surveyResponses')))
    await assertSucceeds(getDocs(collection(as(staff.manager), 'surveyResponses')))
  })
})
