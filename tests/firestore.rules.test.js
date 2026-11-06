// Firestore security rules tests. Run with `yarn test:rules` (needs Java
// for the Firestore emulator).
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing'
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  updateDoc,
  writeBatch
} from 'firebase/firestore'
import * as SURVEY from '../src/data/surveyQuestions.js'
import * as PARTY_SURVEY from '../src/data/partySurveyQuestions.js'

let env

const ORDER_ID = 'CKS202611050001'
const buyer = { uid: 'buyer-uid', email: 's1234@gl.ck.tp.edu.tw' }
const ORDER = {
  userId: buyer.uid,
  customerName: '王小明',
  customerEmail: 'buyer@example.com',
  customerPhone: '0912345678',
  school: '建國中學',
  items: [{ id: 'campus_ticket', name: '校內票', price: 700, quantity: 1 }],
  finalTotal: 700,
  delivered: false,
  paid: false
}

const staff = {
  manager: { uid: 'manager-uid', email: 'manager@example.com' },
  admin: { uid: 'admin-uid', email: 'admin@example.com' },
  superAdmin: { uid: 'super-uid', email: 'super@example.com' },
  developer: { uid: 'developer-uid', email: 'developer@example.com' }
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
    await setDoc(doc(db, 'users', staff.developer.uid), { email: staff.developer.email, role: 'developer' })
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

  test("a signed-in buyer cannot read someone else's orders or create orders", async () => {
    const user = { uid: 'random', email: 'random@example.com' }
    await assertFails(getDoc(doc(as(user), 'orders', ORDER_ID)))
    await assertFails(getDocs(query(collection(as(user), 'orders'), where('userId', '==', buyer.uid))))
    await assertFails(setDoc(doc(as(user), 'orders', 'CKS202611050002'), { ...ORDER, userId: user.uid }))
  })

  test('a buyer reads their own orders, and only with a userId filter', async () => {
    const db = as(buyer)
    await assertSucceeds(getDoc(doc(db, 'orders', ORDER_ID)))
    await assertSucceeds(getDocs(query(collection(db, 'orders'), where('userId', '==', buyer.uid))))
    await assertFails(getDocs(collection(db, 'orders')))
    // a missing id looks the same as someone else's order
    await assertFails(getDoc(doc(db, 'orders', 'CKS202611059999')))
  })

  test('a buyer cannot change or delete their own order', async () => {
    const db = as(buyer)
    await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), { delivered: true }))
    await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), { paid: true }))
    await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), { userId: 'someone-else' }))
    await assertFails(deleteDoc(doc(db, 'orders', ORDER_ID)))
  })

  test('managers open single orders; only admins list every order', async () => {
    await assertSucceeds(getDoc(doc(as(staff.manager), 'orders', ORDER_ID)))
    await assertFails(getDocs(collection(as(staff.manager), 'orders')))
    await assertSucceeds(getDocs(collection(as(staff.admin), 'orders')))
    await assertSucceeds(getDocs(collection(as(staff.superAdmin), 'orders')))
  })

  test('managers cannot bypass atomic pickup actions with direct updates', async () => {
    const db = as(staff.manager)
    await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), {
      delivered: true,
      deliveryUpdatedAt: serverTimestamp(),
      deliveryUpdatedByName: 'M'
    }))
    await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), { paid: true }))
    await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), { finalTotal: 0 }))
    await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), { delivered: 'yes' }))
    await assertFails(deleteDoc(doc(db, 'orders', ORDER_ID)))
  })

  test('admins cannot directly change payment status but retain order deletion', async () => {
    const db = as(staff.admin)
    await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), {
      paid: true,
      paymentUpdatedAt: serverTimestamp(),
      paymentUpdatedByName: 'A'
    }))
    await assertFails(updateDoc(doc(db, 'orders', ORDER_ID), { finalTotal: 0 }))
    await assertSucceeds(deleteDoc(doc(db, 'orders', ORDER_ID)))
  })

  test('a paid order is cancelled with cancelOrders, never deleted; 公關票 and 路宣 still are', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'orders', 'CKS202611050002'), { ...ORDER, paid: true })
      await setDoc(doc(db, 'orders', 'PR20261105ABC234'), { ...ORDER, paid: true, complimentary: true, school: '公關票' })
      await setDoc(doc(db, 'orders', 'ST20261105ABC234'), { ...ORDER, paid: true, delivered: true, streetSale: true, school: '路宣' })
    })
    for (const who of [staff.admin, staff.superAdmin, staff.developer]) {
      await assertFails(deleteDoc(doc(as(who), 'orders', 'CKS202611050002')))
    }
    await assertSucceeds(deleteDoc(doc(as(staff.admin), 'orders', 'PR20261105ABC234')))
    await assertSucceeds(deleteDoc(doc(as(staff.admin), 'orders', 'ST20261105ABC234')))
  })

  test('all staff roles are denied direct status, identity and metadata rewrites', async () => {
    for (const who of Object.values(staff)) {
      const target = doc(as(who), 'orders', ORDER_ID)
      for (const patch of [
        { delivered: true },
        { paid: true },
        { deliveryUpdatedByUid: who.uid, deliveryUpdatedByName: 'Forged', deliveryUpdatedAt: serverTimestamp() },
        { paymentUpdatedByUid: 'someone-else', paymentUpdatedAt: Timestamp.fromDate(new Date('2000-01-01')) },
        { userId: who.uid, ticketCode: 'replacement', finalTotal: 0 },
        { delivered: true, extraData: 'x'.repeat(10000) }
      ]) {
        await assertFails(updateDoc(target, patch))
      }
    }
  })

  test('history is staff-readable and immutable to every client, including after deletion', async () => {
    const event = { action: 'delivery', previousValue: false, value: true, actorUid: staff.manager.uid, actorName: 'Manager', occurredAt: Timestamp.now() }
    await env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'orders', ORDER_ID, 'history', 'event1'), event))
    for (const who of Object.values(staff)) {
      const db = as(who)
      await assertSucceeds(getDoc(doc(db, 'orders', ORDER_ID, 'history', 'event1')))
      await assertSucceeds(getDocs(collection(db, 'orders', ORDER_ID, 'history')))
      await assertFails(setDoc(doc(db, 'orders', ORDER_ID, 'history', 'forged'), event))
      await assertFails(updateDoc(doc(db, 'orders', ORDER_ID, 'history', 'event1'), { actorUid: who.uid }))
      await assertFails(deleteDoc(doc(db, 'orders', ORDER_ID, 'history', 'event1')))
    }
    await assertFails(getDoc(doc(anon(), 'orders', ORDER_ID, 'history', 'event1')))
    await assertFails(getDoc(doc(as(buyer), 'orders', ORDER_ID, 'history', 'event1')))
    await assertFails(getDocs(collection(as(buyer), 'orders', ORDER_ID, 'history')))
    await assertFails(setDoc(doc(as(buyer), 'orders', ORDER_ID, 'history', 'forged'), event))

    await assertSucceeds(deleteDoc(doc(as(staff.admin), 'orders', ORDER_ID)))
    await assertSucceeds(getDoc(doc(as(staff.manager), 'orders', ORDER_ID, 'history', 'event1')))
    await assertFails(getDoc(doc(as(buyer), 'orders', ORDER_ID, 'history', 'event1')))
  })

  test('function-only counters are not readable or writable by anyone', async () => {
    await assertFails(getDoc(doc(as(staff.superAdmin), 'ticketSales', 'campus_ticket')))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'ticketSales', 'campus_ticket'), { sold: 0 }))
    await assertFails(getDoc(doc(as(staff.superAdmin), 'ticketSales', 'campus_ticket', 'shards', '0')))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'ticketSales', 'campus_ticket', 'shards', '0'), { sold: 0 }))
    await assertFails(setDoc(doc(anon(), 'buyerPurchases', 'x'), { quantities: {} }))
  })
})

describe('取消訂單 (cancelledOrders)', () => {
  const CANCELLED_ID = 'CKS202611050009'
  const CANCELLED = { ...ORDER, paid: true, cancelReason: 'buyer_request', refundAmount: 700, refundStatus: 'pending', cancelYear: 2026 }

  beforeEach(async () => {
    await env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'cancelledOrders', CANCELLED_ID), CANCELLED))
  })

  test('the buyer reads their own, with a userId filter; nobody else', async () => {
    await assertSucceeds(getDoc(doc(as(buyer), 'cancelledOrders', CANCELLED_ID)))
    await assertSucceeds(getDocs(query(collection(as(buyer), 'cancelledOrders'), where('userId', '==', buyer.uid))))
    await assertFails(getDocs(collection(as(buyer), 'cancelledOrders')))
    const other = { uid: 'other-uid', email: 'other@example.com' }
    await assertFails(getDoc(doc(as(other), 'cancelledOrders', CANCELLED_ID)))
    await assertFails(getDocs(query(collection(as(other), 'cancelledOrders'), where('userId', '==', buyer.uid))))
    await assertFails(getDoc(doc(anon(), 'cancelledOrders', CANCELLED_ID)))
  })

  test('door staff open one; only super admins and developers list them all', async () => {
    for (const who of [staff.manager, staff.admin]) {
      await assertSucceeds(getDoc(doc(as(who), 'cancelledOrders', CANCELLED_ID)))
      await assertFails(getDocs(query(collection(as(who), 'cancelledOrders'), where('cancelYear', '==', 2026))))
    }
    for (const who of [staff.superAdmin, staff.developer]) {
      await assertSucceeds(getDocs(query(collection(as(who), 'cancelledOrders'), where('cancelYear', '==', 2026))))
    }
  })

  test('only the functions write them: no client cancels, refunds or restores', async () => {
    for (const who of [buyer, ...Object.values(staff)]) {
      const db = as(who)
      await assertFails(setDoc(doc(db, 'cancelledOrders', 'CKS202611050010'), CANCELLED))
      await assertFails(updateDoc(doc(db, 'cancelledOrders', CANCELLED_ID), { refundStatus: 'done' }))
      await assertFails(updateDoc(doc(db, 'cancelledOrders', CANCELLED_ID), { refundAmount: 0 }))
      await assertFails(deleteDoc(doc(db, 'cancelledOrders', CANCELLED_ID)))
    }
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

describe('activation edge cases (PARTY-1)', () => {
  const activate = (user, email, data) => {
    const db = as(user)
    const batch = writeBatch(db)
    batch.set(doc(db, 'users', user.uid), data)
    batch.delete(doc(db, 'pendingUsers', email))
    return batch.commit()
  }
  const profileFor = (uid, email, extra = {}) => ({
    email, displayName: 'D', photoURL: '', name: '新幹部', role: 'manager', uid,
    createdAt: 'now', updatedAt: 'now', ...extra
  })

  test('a mixed-case Google email still matches its lower-case invite', async () => {
    const user = { uid: 'mixed', email: 'Invitee@Example.com' }
    await assertSucceeds(activate(user, 'invitee@example.com', profileFor(user.uid, 'invitee@example.com')))
  })

  test('extra keys, a different name, or someone else\'s invite are rejected', async () => {
    const invitee = { uid: 'invitee-uid', email: 'invitee@example.com' }
    await assertFails(activate(invitee, invitee.email, profileFor(invitee.uid, invitee.email, { isAdmin: true })))
    await assertFails(activate(invitee, invitee.email, profileFor(invitee.uid, invitee.email, { name: '冒名' })))
    const thief = { uid: 'thief', email: 'thief@example.com' }
    await assertFails(activate(thief, 'invitee@example.com', profileFor(thief.uid, 'invitee@example.com')))
  })

  test('super admins can only assign staff roles', async () => {
    await assertFails(updateDoc(doc(as(staff.superAdmin), 'users', staff.manager.uid), { role: 'owner' }))
    await assertSucceeds(updateDoc(doc(as(staff.superAdmin), 'users', staff.manager.uid), { role: 'admin' }))
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

  test('an invitee can read only their own invite, with a verified email', async () => {
    await assertSucceeds(getDoc(doc(as(invitee), 'pendingUsers', invitee.email)))
    await assertFails(getDoc(doc(as(invitee, false), 'pendingUsers', invitee.email)))
    await assertFails(getDoc(doc(as(other), 'pendingUsers', invitee.email)))
  })

  test('super admins can change an invite role but not its email or casing', async () => {
    const db = as(staff.superAdmin)
    await assertSucceeds(updateDoc(doc(db, 'pendingUsers', invitee.email), { role: 'admin', updatedAt: 'now' }))
    await assertFails(updateDoc(doc(db, 'pendingUsers', invitee.email), { email: 'x@example.com' }))
    await assertFails(setDoc(doc(db, 'pendingUsers', 'Upper@example.com'), { email: 'Upper@example.com', role: 'manager' }))
  })

  test('delete-all: a super admin can delete 40 accounts and invites in one batch', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const seed = context.firestore()
      for (let i = 0; i < 20; i++) {
        await setDoc(doc(seed, 'users', `m${i}`), { email: `m${i}@example.com`, role: 'manager' })
        await setDoc(doc(seed, 'pendingUsers', `p${i}@example.com`), { email: `p${i}@example.com`, role: 'manager' })
      }
    })
    const db = as(staff.superAdmin)
    const batch = writeBatch(db)
    for (let i = 0; i < 20; i++) {
      batch.delete(doc(db, 'users', `m${i}`))
      batch.delete(doc(db, 'pendingUsers', `p${i}@example.com`))
    }
    await assertSucceeds(batch.commit())
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

describe('developers', () => {
  const devInvite = { email: 'dev2@example.com', name: '開發者', role: 'developer' }
  const seedDevInvite = () =>
    env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), 'pendingUsers', devInvite.email), devInvite))

  test('developers have super admin access', async () => {
    const db = as(staff.developer)
    await assertSucceeds(getDocs(collection(db, 'users')))
    await assertSucceeds(getDocs(collection(db, 'pendingUsers')))
    await assertSucceeds(updateDoc(doc(db, 'users', staff.manager.uid), { role: 'admin' }))
    await assertSucceeds(setDoc(doc(db, 'pendingUsers', 'x@example.com'), { email: 'x@example.com', role: 'super_admin' }))
  })

  test('only developers can invite or make developers', async () => {
    await assertFails(setDoc(doc(as(staff.superAdmin), 'pendingUsers', devInvite.email), devInvite))
    await assertFails(updateDoc(doc(as(staff.superAdmin), 'users', staff.manager.uid), { role: 'developer' }))
    await assertFails(updateDoc(doc(as(staff.superAdmin), 'pendingUsers', 'invitee@example.com'), { role: 'developer' }))
    await assertFails(updateDoc(doc(as(staff.superAdmin), 'users', staff.superAdmin.uid), { role: 'developer' }))
    await assertSucceeds(setDoc(doc(as(staff.developer), 'pendingUsers', devInvite.email), devInvite))
    await assertSucceeds(updateDoc(doc(as(staff.developer), 'users', staff.manager.uid), { role: 'developer' }))
  })

  test('super admins cannot delete or demote a developer, or their invite', async () => {
    await seedDevInvite()
    const db = as(staff.superAdmin)
    await assertFails(deleteDoc(doc(db, 'users', staff.developer.uid)))
    await assertFails(updateDoc(doc(db, 'users', staff.developer.uid), { role: 'manager' }))
    await assertFails(setDoc(doc(db, 'users', staff.developer.uid), { email: staff.developer.email, role: 'manager' }))
    await assertFails(deleteDoc(doc(db, 'pendingUsers', devInvite.email)))
    await assertFails(updateDoc(doc(db, 'pendingUsers', devInvite.email), { role: 'manager' }))
  })

  test('developers can demote or delete other developers and their invites', async () => {
    await seedDevInvite()
    const other = { uid: 'developer2-uid', email: 'developer2@example.com' }
    await env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), 'users', other.uid), { email: other.email, role: 'developer' }))
    const db = as(staff.developer)
    await assertSucceeds(updateDoc(doc(db, 'users', other.uid), { role: 'super_admin' }))
    await assertSucceeds(deleteDoc(doc(db, 'users', other.uid)))
    await assertSucceeds(deleteDoc(doc(db, 'pendingUsers', devInvite.email)))
  })

  test('an invited developer activates with the developer role', async () => {
    await seedDevInvite()
    const invitee = { uid: 'dev2-uid', email: devInvite.email }
    const db = as(invitee)
    const batch = writeBatch(db)
    batch.set(doc(db, 'users', invitee.uid), {
      email: invitee.email, displayName: 'D', photoURL: '', name: devInvite.name, role: 'developer',
      uid: invitee.uid, createdAt: 'now', updatedAt: 'now'
    })
    batch.delete(doc(db, 'pendingUsers', devInvite.email))
    await assertSucceeds(batch.commit())
  })

  test('no one creates a staff account for someone else, so an invite cannot be pre-empted', async () => {
    await seedDevInvite()
    const invitee = { uid: 'dev2-uid', email: devInvite.email }
    const account = (role) => ({ email: invitee.email, role, uid: invitee.uid })
    await assertFails(setDoc(doc(as(staff.superAdmin), 'users', invitee.uid), account('manager')))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'users', invitee.uid), account('developer')))
    await assertFails(setDoc(doc(as(staff.developer), 'users', invitee.uid), account('developer')))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'users', 'fresh-uid'), { email: 'f@example.com', role: 'admin' }))
  })

  test("super admins cannot edit any field of a developer's account", async () => {
    const target = doc(as(staff.superAdmin), 'users', staff.developer.uid)
    await assertFails(updateDoc(target, { name: '改名' }))
    await assertFails(updateDoc(target, { role: 'developer', name: '改名' }))
  })

  test('nobody changes their own role or deletes their own account', async () => {
    for (const who of [staff.superAdmin, staff.developer]) {
      const own = doc(as(who), 'users', who.uid)
      await assertFails(updateDoc(own, { role: 'admin' }))
      await assertFails(deleteDoc(own))
    }
    await assertFails(updateDoc(doc(as(staff.superAdmin), 'users', staff.superAdmin.uid), { role: 'developer' }))
    // their own profile otherwise stays theirs to edit
    await assertSucceeds(updateDoc(doc(as(staff.superAdmin), 'users', staff.superAdmin.uid), { name: '總副召' }))
  })

  test('a developer can demote or delete the only super admin', async () => {
    const target = doc(as(staff.developer), 'users', staff.superAdmin.uid)
    await assertSucceeds(updateDoc(target, { role: 'admin' }))
    await assertSucceeds(deleteDoc(target))
  })

  test('super admins can still delete managers, admins and invites', async () => {
    const db = as(staff.superAdmin)
    await assertSucceeds(deleteDoc(doc(db, 'users', staff.manager.uid)))
    await assertSucceeds(deleteDoc(doc(db, 'pendingUsers', 'invitee@example.com')))
  })
})

describe('settings and public content', () => {
  test('everyone can read; only super admins can write', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'settings', 'ticketTypes')))
    await assertFails(setDoc(doc(as(staff.admin), 'settings', 'ticketTypes'), { types: [] }))
    await assertFails(setDoc(doc(as(staff.admin), 'partyStories', 's1'), { title: 't' }))
    await assertSucceeds(setDoc(doc(as(staff.superAdmin), 'settings', 'ticketTypes'), { types: [] }))
    await assertSucceeds(setDoc(doc(as(staff.superAdmin), 'partyLineup', 'l1'), { name: 'n' }))
  })

  test('settings documents without their own rule are read-only, even for super admins', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'settings', 'other')))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'settings', 'other'), { x: 1 }))
  })
})

describe('settings/shop (opening time)', () => {
  const shop = (who, fields = {}) => ({
    openAt: Timestamp.fromDate(new Date('2026-11-05T12:00:00+08:00')),
    updatedAt: serverTimestamp(),
    updatedByUid: who.uid,
    ...fields
  })
  const shopDoc = (who) => doc(as(who), 'settings', 'shop')
  const seed = (data) =>
    env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'settings', 'shop'), data))

  // each is rejected on create and on update
  const malformed = [
    { openAt: '2026-11-05T12:00:00+08:00' }, // the old string format
    { openAt: null },
    { updatedAt: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')) }, // client-chosen time
    { updatedAt: 'now' },
    { updatedByUid: staff.admin.uid },
    { note: 'x' }
  ]

  test('anyone can read; only super admins write, the way saveShopOpenAt does', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'settings', 'shop')))
    await assertFails(setDoc(doc(anon(), 'settings', 'shop'), shop({ uid: 'anon' })))
    await assertFails(setDoc(shopDoc(staff.manager), shop(staff.manager)))
    await assertFails(setDoc(shopDoc(staff.admin), shop(staff.admin)))

    await assertSucceeds(setDoc(shopDoc(staff.superAdmin), shop(staff.superAdmin))) // create
    await assertSucceeds(setDoc(shopDoc(staff.superAdmin), shop(staff.superAdmin))) // update
    // 立即開賣 stores the server time
    await assertSucceeds(setDoc(shopDoc(staff.superAdmin), shop(staff.superAdmin, { openAt: serverTimestamp() })))
  })

  test('a malformed or incomplete document is rejected on create', async () => {
    for (const fields of malformed) {
      await assertFails(setDoc(shopDoc(staff.superAdmin), shop(staff.superAdmin, fields)))
    }
    for (const key of ['openAt', 'updatedAt', 'updatedByUid']) {
      const data = shop(staff.superAdmin)
      delete data[key]
      await assertFails(setDoc(shopDoc(staff.superAdmin), data))
    }
  })

  test('a malformed or incomplete document is rejected on update', async () => {
    await seed({ openAt: Timestamp.now(), updatedAt: Timestamp.now(), updatedByUid: staff.superAdmin.uid })

    for (const fields of malformed) {
      await assertFails(setDoc(shopDoc(staff.superAdmin), shop(staff.superAdmin, fields)))
      await assertFails(updateDoc(shopDoc(staff.superAdmin), { updatedAt: serverTimestamp(), ...fields }))
    }
    // a partial update keeps the old updatedAt, which is not this request's time
    await assertFails(updateDoc(shopDoc(staff.superAdmin), { openAt: Timestamp.now() }))
  })

  test('a stray field already on the document does not block later saves', async () => {
    await seed({ openAt: Timestamp.now(), note: 'added in the console' })
    await assertSucceeds(setDoc(shopDoc(staff.superAdmin), shop(staff.superAdmin)))
  })

  test('only super admins can delete it', async () => {
    await seed({ openAt: Timestamp.now() })

    await assertFails(deleteDoc(doc(anon(), 'settings', 'shop')))
    for (const who of [staff.manager, staff.admin]) {
      await assertFails(deleteDoc(shopDoc(who)))
    }
    await assertSucceeds(deleteDoc(shopDoc(staff.superAdmin)))
  })
})

describe('scheduled content (PARTY-16)', () => {
  const HOUR = 60 * 60 * 1000
  const at = (offset) => Timestamp.fromMillis(Date.now() + offset)

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'partyStories', 'live'), { title: 'live', enabled: true, publishAt: at(-HOUR) })
      await setDoc(doc(db, 'partyStories', 'future'), { title: 'future', enabled: true, publishAt: at(HOUR) })
      await setDoc(doc(db, 'partyStories', 'off'), { title: 'off', enabled: false, publishAt: at(-HOUR) })
      await setDoc(doc(db, 'partyLineup', 'live'), { name: 'live', publishAt: at(-HOUR) })
      await setDoc(doc(db, 'partyLineup', 'future'), { name: 'future', publishAt: at(HOUR) })
      await setDoc(doc(db, 'partyLineup', 'legacy'), { name: 'legacy', publishAt: '2026-01-01T00:00' })
    })
  })

  test('the public query used by the site works and returns only published items', async () => {
    const stories = await assertSucceeds(getDocs(query(
      collection(anon(), 'partyStories'),
      where('enabled', '==', true),
      where('publishAt', '<=', Timestamp.now())
    )))
    assert.deepEqual(stories.docs.map((d) => d.id), ['live'])

    const lineup = await assertSucceeds(getDocs(query(
      collection(anon(), 'partyLineup'),
      where('publishAt', '<=', Timestamp.now())
    )))
    assert.deepEqual(lineup.docs.map((d) => d.id), ['live'])
  })

  test('unfiltered listing and direct reads of hidden items are denied', async () => {
    await assertFails(getDocs(collection(anon(), 'partyStories')))
    await assertFails(getDocs(collection(anon(), 'partyLineup')))
    await assertFails(getDoc(doc(anon(), 'partyStories', 'future')))
    await assertFails(getDoc(doc(anon(), 'partyStories', 'off')))
    await assertFails(getDoc(doc(anon(), 'partyLineup', 'future')))
    await assertFails(getDoc(doc(anon(), 'partyLineup', 'legacy')))
    await assertSucceeds(getDoc(doc(anon(), 'partyLineup', 'live')))
  })

  test('super admins still see drafts', async () => {
    await assertSucceeds(getDocs(collection(as(staff.superAdmin), 'partyStories')))
    await assertSucceeds(getDoc(doc(as(staff.superAdmin), 'partyLineup', 'future')))
  })
})

describe('surveyResponses (PARTY-23)', () => {
  const allScores = (value = 5) =>
    Object.fromEntries(
      SURVEY.SCALE_SECTIONS.flatMap((section) => section.questions).map((q) => [q.id, value])
    )

  const response = (extra = {}) => ({
    identity: SURVEY.IDENTITY_OPTIONS[0],
    channels: [SURVEY.CHANNEL_OPTIONS[0]],
    device: SURVEY.DEVICE_OPTIONS[0],
    scores: allScores(),
    issueCount: SURVEY.ISSUE_COUNT_OPTIONS[0],
    issueTypes: [],
    improvement: '',
    suggestion: '',
    createdAt: serverTimestamp(),
    ...extra
  })

  test('no client writes responses; they go through submitSurvey', async () => {
    await assertFails(setDoc(doc(anon(), 'surveyResponses', 'r1'), response()))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'surveyResponses', 'r2'), response()))
  })

  test('only staff can read responses, and only super admins delete them', async () => {
    await assertFails(getDocs(collection(anon(), 'surveyResponses')))
    await assertSucceeds(getDocs(collection(as(staff.manager), 'surveyResponses')))

    await env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), 'surveyResponses', 'r1'), { identity: '其他' })
    )
    for (const who of [staff.manager, staff.admin]) {
      await assertFails(deleteDoc(doc(as(who), 'surveyResponses', 'r1')))
    }
    await assertSucceeds(deleteDoc(doc(as(staff.superAdmin), 'surveyResponses', 'r1')))
  })
})

describe('舞會滿意度調查', () => {
  const sections = PARTY_SURVEY.defaultSections()
  const survey = (who, year, extra = {}) => ({ year, open: false, sections, updatedAt: serverTimestamp(), updatedByUid: who.uid, ...extra })
  const save = (who, id, data) => setDoc(doc(as(who), 'partySurveys', id), data)

  test('only super admins save a year\'s questions and open it; anyone can read them', async () => {
    await assertSucceeds(save(staff.superAdmin, '2026', survey(staff.superAdmin, 2026)))
    await assertSucceeds(save(staff.superAdmin, '2026', survey(staff.superAdmin, 2026, { open: true })))
    await assertSucceeds(getDoc(doc(anon(), 'partySurveys', '2026')))

    for (const who of [staff.manager, staff.admin]) {
      await assertFails(save(who, '2026', survey(who, 2026)))
    }
    await assertFails(setDoc(doc(anon(), 'partySurveys', '2026'), { year: 2026, open: true, sections }))
    await assertFails(deleteDoc(doc(as(staff.superAdmin), 'partySurveys', '2026')))
  })

  test('a year document is checked: its year, its fields, and questions before it opens', async () => {
    const boss = staff.superAdmin
    await assertFails(save(boss, '2026', survey(boss, 2025)))
    await assertFails(save(boss, 'latest', survey(boss, 2026)))
    await assertFails(save(boss, '2026', { ...survey(boss, 2026), note: 'x' }))
    await assertFails(save(boss, '2026', survey(staff.admin, 2026)))
    await assertFails(save(boss, '2026', survey(boss, 2026, { open: 'yes' })))
    await assertFails(save(boss, '2026', survey(boss, 2026, { sections: 'all of them' })))
    await assertFails(save(boss, '2026', survey(boss, 2026, { sections: Array(21).fill(sections[0]) })))
    await assertFails(save(boss, '2026', survey(boss, 2026, { open: true, sections: [] })))
    // a year may be saved without questions while it is closed
    await assertSucceeds(save(boss, '2026', survey(boss, 2026, { sections: [] })))
  })

  test('no client writes answers; only super admins read and delete them', async () => {
    await env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), 'partySurveys', '2026'), { year: 2026, open: true, sections }))
    const answer = { answers: { identity: PARTY_SURVEY.defaultSections()[0].questions[0].options[0] }, createdAt: serverTimestamp() }
    for (const who of [anon(), as(staff.superAdmin)]) {
      await assertFails(setDoc(doc(who, 'partySurveys', '2026', 'responses', 'r1'), answer))
    }

    await env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), 'partySurveys', '2026', 'responses', 'r1'), { answers: {} }))
    for (const who of [anon(), as(staff.manager), as(staff.admin)]) {
      await assertFails(getDocs(collection(who, 'partySurveys', '2026', 'responses')))
    }
    await assertSucceeds(getDocs(collection(as(staff.superAdmin), 'partySurveys', '2026', 'responses')))
    await assertFails(updateDoc(doc(as(staff.superAdmin), 'partySurveys', '2026', 'responses', 'r1'), { answers: { x: 1 } }))
    for (const who of [staff.manager, staff.admin]) {
      await assertFails(deleteDoc(doc(as(who), 'partySurveys', '2026', 'responses', 'r1')))
    }
    await assertSucceeds(deleteDoc(doc(as(staff.superAdmin), 'partySurveys', '2026', 'responses', 'r1')))
  })
})

describe('學弟登記賣票', () => {
  const seller = { uid: 'seller-uid', email: 's1001@gl.ck.tp.edu.tw' }
  const other = { uid: 'other-uid', email: 's1002@gl.ck.tp.edu.tw' }
  const registration = (who, extra = {}) => ({
    sellerUid: who.uid,
    sellerEmail: who.email,
    sellerName: '王小明',
    ticketTypeId: 'second',
    quantity: 5,
    delivered: false,
    paid: false,
    ...extra
  })
  const program = (who, fields = {}) => ({
    enabled: true,
    ticketTypeId: 'second',
    goal: 750,
    updatedAt: serverTimestamp(),
    updatedByUid: who.uid,
    ...fields
  })
  const flags = (who, fields = {}) => ({ delivered: true, paid: false, updatedAt: serverTimestamp(), updatedByUid: who.uid, ...fields })

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'sellers', seller.email), { email: seller.email, name: '王小明' })
      await setDoc(doc(db, 'sellerRegistrations', 'r1'), registration(seller))
      await setDoc(doc(db, 'sellerRegistrations', 'r2'), registration(other))
      await setDoc(doc(db, 'sellerStats', 'summary'), { total: 10 })
    })
  })

  test('only super admins save the program settings, the way the seller page does', async () => {
    const programDoc = (who) => doc(as(who), 'settings', 'sellerProgram')
    await assertSucceeds(getDoc(doc(anon(), 'settings', 'sellerProgram')))
    for (const who of [seller, staff.manager, staff.admin]) {
      await assertFails(setDoc(programDoc(who), program(who)))
    }
    await assertSucceeds(setDoc(programDoc(staff.superAdmin), program(staff.superAdmin)))
    for (const fields of [{ goal: -1 }, { goal: 7.5 }, { goal: '750' }, { enabled: 'yes' }, { ticketTypeId: 3 }, { updatedByUid: staff.admin.uid }, { note: 'x' }]) {
      await assertFails(setDoc(programDoc(staff.superAdmin), program(staff.superAdmin, fields)))
    }
  })

  test('a seller reads only their own list entry; admins list it; super admins edit it', async () => {
    await assertSucceeds(getDoc(doc(as(seller), 'sellers', seller.email)))
    await assertFails(getDoc(doc(as(seller, false), 'sellers', seller.email)))
    await assertFails(getDoc(doc(as(other), 'sellers', seller.email)))
    await assertFails(getDocs(collection(as(seller), 'sellers')))
    await assertFails(getDocs(collection(as(staff.manager), 'sellers')))
    await assertSucceeds(getDocs(collection(as(staff.admin), 'sellers')))

    // nobody puts themselves on the list
    await assertFails(setDoc(doc(as(other), 'sellers', other.email), { email: other.email }))
    await assertFails(setDoc(doc(as(staff.admin), 'sellers', other.email), { email: other.email }))
    await assertSucceeds(setDoc(doc(as(staff.superAdmin), 'sellers', other.email), { email: other.email, name: '李同學', createdAt: serverTimestamp() }))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'sellers', 'Upper@example.com'), { email: 'Upper@example.com' }))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'sellers', 'x@example.com'), { email: 'y@example.com' }))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'sellers', 'x@example.com'), { email: 'x@example.com', role: 'admin' }))
    await assertFails(deleteDoc(doc(as(staff.admin), 'sellers', seller.email)))
    await assertSucceeds(deleteDoc(doc(as(staff.superAdmin), 'sellers', seller.email)))
  })

  test('sellers read their own registrations, with a sellerUid filter; nobody creates them', async () => {
    await assertSucceeds(getDoc(doc(as(seller), 'sellerRegistrations', 'r1')))
    await assertFails(getDoc(doc(as(seller), 'sellerRegistrations', 'r2')))
    await assertSucceeds(getDocs(query(collection(as(seller), 'sellerRegistrations'), where('sellerUid', '==', seller.uid))))
    await assertFails(getDocs(collection(as(seller), 'sellerRegistrations')))
    await assertFails(getDocs(collection(as(staff.manager), 'sellerRegistrations')))
    await assertSucceeds(getDocs(collection(as(staff.admin), 'sellerRegistrations')))

    for (const who of [seller, staff.admin, staff.superAdmin]) {
      await assertFails(setDoc(doc(as(who), 'sellerRegistrations', 'new'), registration(seller)))
    }
  })

  test('sellers cannot change or return a registration; admins record pickup and payment only', async () => {
    await assertFails(updateDoc(doc(as(seller), 'sellerRegistrations', 'r1'), { quantity: 1 }))
    await assertFails(updateDoc(doc(as(seller), 'sellerRegistrations', 'r1'), flags(seller)))
    await assertFails(deleteDoc(doc(as(seller), 'sellerRegistrations', 'r1')))
    await assertFails(updateDoc(doc(as(staff.manager), 'sellerRegistrations', 'r1'), flags(staff.manager)))

    await assertSucceeds(updateDoc(doc(as(staff.admin), 'sellerRegistrations', 'r1'), flags(staff.admin)))
    await assertSucceeds(updateDoc(doc(as(staff.admin), 'sellerRegistrations', 'r1'), flags(staff.admin, { paid: true })))
    // the seller page writes only the box that was ticked
    await assertSucceeds(updateDoc(doc(as(staff.admin), 'sellerRegistrations', 'r1'), { paid: false, updatedAt: serverTimestamp(), updatedByUid: staff.admin.uid }))
    await assertFails(updateDoc(doc(as(staff.admin), 'sellerRegistrations', 'r1'), { ...flags(staff.admin), quantity: 1 }))
    await assertFails(updateDoc(doc(as(staff.admin), 'sellerRegistrations', 'r1'), flags(staff.admin, { paid: 'yes' })))
    await assertFails(updateDoc(doc(as(staff.admin), 'sellerRegistrations', 'r1'), flags(staff.admin, { updatedByUid: 'someone' })))
    await assertSucceeds(deleteDoc(doc(as(staff.admin), 'sellerRegistrations', 'r2')))
  })

  test('admins record each pickup and delete a mistaken one; sellers read only their own', async () => {
    const pickup = (who, fields = {}) => ({
      sellerEmail: seller.email,
      quantity: 3,
      createdAt: serverTimestamp(),
      createdByUid: who.uid,
      ...fields
    })
    const pickupDoc = (who, id) => doc(as(who), 'sellerPickups', id)

    for (const who of [seller, staff.manager]) {
      await assertFails(setDoc(pickupDoc(who, 'p0'), pickup(who)))
    }
    await assertSucceeds(setDoc(pickupDoc(staff.admin, 'p1'), pickup(staff.admin)))
    await assertSucceeds(setDoc(pickupDoc(staff.admin, 'p2'), pickup(staff.admin, { sellerEmail: other.email, quantity: 200 })))
    for (const fields of [{ quantity: 0 }, { quantity: 201 }, { quantity: 1.5 }, { quantity: '3' }, { sellerEmail: 'Upper@example.com' }, { createdByUid: 'someone' }, { note: 'x' }]) {
      await assertFails(setDoc(pickupDoc(staff.admin, 'bad'), pickup(staff.admin, fields)))
    }

    await assertSucceeds(getDoc(pickupDoc(seller, 'p1')))
    await assertFails(getDoc(pickupDoc(seller, 'p2')))
    await assertFails(getDoc(doc(as(seller, false), 'sellerPickups', 'p1')))
    await assertSucceeds(getDocs(query(collection(as(seller), 'sellerPickups'), where('sellerEmail', '==', seller.email))))
    await assertFails(getDocs(collection(as(seller), 'sellerPickups')))
    await assertFails(getDocs(collection(as(staff.manager), 'sellerPickups')))
    await assertSucceeds(getDocs(collection(as(staff.admin), 'sellerPickups')))

    await assertFails(updateDoc(pickupDoc(staff.admin, 'p1'), { quantity: 4 }))
    await assertFails(deleteDoc(pickupDoc(seller, 'p1')))
    await assertSucceeds(deleteDoc(pickupDoc(staff.admin, 'p1')))
  })

  test('admins record each payment, in NT$, and delete a mistaken one; sellers read only their own', async () => {
    const payment = (who, fields = {}) => ({
      sellerEmail: seller.email,
      amount: 1600,
      createdAt: serverTimestamp(),
      createdByUid: who.uid,
      ...fields
    })
    const paymentDoc = (who, id) => doc(as(who), 'sellerPayments', id)

    for (const who of [seller, staff.manager]) {
      await assertFails(setDoc(paymentDoc(who, 'm0'), payment(who)))
    }
    await assertSucceeds(setDoc(paymentDoc(staff.admin, 'm1'), payment(staff.admin)))
    await assertSucceeds(setDoc(paymentDoc(staff.admin, 'm2'), payment(staff.admin, { sellerEmail: other.email, amount: 1000000 })))
    for (const fields of [{ amount: 0 }, { amount: 1000001 }, { amount: 99.5 }, { amount: '800' }, { sellerEmail: 'Upper@example.com' }, { createdByUid: 'someone' }, { note: 'x' }]) {
      await assertFails(setDoc(paymentDoc(staff.admin, 'bad'), payment(staff.admin, fields)))
    }

    await assertSucceeds(getDoc(paymentDoc(seller, 'm1')))
    await assertFails(getDoc(paymentDoc(seller, 'm2')))
    await assertFails(getDoc(doc(as(seller, false), 'sellerPayments', 'm1')))
    await assertSucceeds(getDocs(query(collection(as(seller), 'sellerPayments'), where('sellerEmail', '==', seller.email))))
    await assertFails(getDocs(collection(as(seller), 'sellerPayments')))
    await assertFails(getDocs(collection(as(staff.manager), 'sellerPayments')))
    await assertSucceeds(getDocs(collection(as(staff.admin), 'sellerPayments')))

    await assertFails(updateDoc(paymentDoc(staff.admin, 'm1'), { amount: 800 }))
    await assertFails(deleteDoc(paymentDoc(seller, 'm1')))
    await assertSucceeds(deleteDoc(paymentDoc(staff.admin, 'm1')))
  })

  test('the shared total is for sellers and admins; release markers for nobody', async () => {
    await assertSucceeds(getDoc(doc(as(seller), 'sellerStats', 'summary')))
    await assertSucceeds(getDoc(doc(as(staff.admin), 'sellerStats', 'summary')))
    await assertFails(getDoc(doc(as(other), 'sellerStats', 'summary')))
    await assertFails(getDoc(doc(as(staff.manager), 'sellerStats', 'summary')))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'sellerStats', 'summary'), { total: 750 }))
    await assertFails(getDoc(doc(as(staff.superAdmin), 'sellerReleases', 'r1')))
  })
})

describe('清除所有訂單 (salesArchives, orderPurges, systemLogs)', () => {
  const paths = [
    ['salesArchives', '2026'],
    ['salesArchives', '2026', 'archivedOrders', ORDER_ID],
    ['salesArchives', '2026', 'rows', '000'],
    ['orderPurges', 'purge-1'],
    ['systemLogs', 'purge_purge-1']
  ]

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'salesArchives', '2026'), { year: 2026, orderCount: 1, revenue: 700 })
      await setDoc(doc(db, 'salesArchives', '2026', 'archivedOrders', ORDER_ID), { ...ORDER, archive: { purgeId: 'purge-1' } })
      await setDoc(doc(db, 'salesArchives', '2026', 'rows', '000'), { rows: [{ t: 1, v: 700, p: false, d: false, s: '建國中學', g: 0, i: [] }] })
      await setDoc(doc(db, 'orderPurges', 'purge-1'), { stage: 'done', total: 1 })
      await setDoc(doc(db, 'systemLogs', 'purge_purge-1'), { type: 'orders.purge', actorUid: staff.superAdmin.uid })
    })
  })

  test('only super admins read the archives, purge progress and log', async () => {
    for (const path of paths) {
      await assertSucceeds(getDoc(doc(as(staff.superAdmin), ...path)))
      for (const who of [staff.admin, staff.manager, buyer]) {
        await assertFails(getDoc(doc(as(who), ...path)))
      }
      await assertFails(getDoc(doc(anon(), ...path)))
    }
    // the analytics page lists the summaries; the admin page looks for an unfinished purge
    await assertSucceeds(getDocs(collection(as(staff.superAdmin), 'salesArchives')))
    await assertSucceeds(getDocs(query(collection(as(staff.superAdmin), 'orderPurges'), where('stage', 'in', ['archive', 'delete']))))
    await assertFails(getDocs(collection(as(staff.admin), 'salesArchives')))
    await assertFails(getDocs(collection(as(staff.admin), 'systemLogs')))
  })

  test('nobody can write them, not even super admins', async () => {
    for (const path of paths) {
      await assertFails(setDoc(doc(as(staff.superAdmin), ...path), { forged: true }))
      await assertFails(updateDoc(doc(as(staff.superAdmin), ...path), { forged: true }))
      await assertFails(deleteDoc(doc(as(staff.superAdmin), ...path)))
    }
    await assertFails(setDoc(doc(as(staff.superAdmin), 'systemLogs', 'forged'), { type: 'orders.purge' }))
  })
})

describe('公關票 (officers, officerInvites)', () => {
  const officer = { uid: 'officer-uid', email: 'Officer@Example.com' }
  const other = { uid: 'other-uid', email: 'other@example.com' }
  const OFFICER_EMAIL = 'officer@example.com'
  const INVITE_ID = 'AbCdEfGhIjKlMnOpQrStUvWx'
  // what GuestAdminPage.vue saves (addOfficer)
  const entry = (fields = {}) => ({ email: OFFICER_EMAIL, name: '林幹部', quota: 10, used: 0, createdAt: serverTimestamp(), ...fields })
  const officerDoc = (who) => doc(as(who), 'officers', OFFICER_EMAIL)
  const seed = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()))
  const seedOfficer = (fields = {}) => seed((db) => setDoc(doc(db, 'officers', OFFICER_EMAIL), entry({ createdAt: Timestamp.now(), ...fields })))

  test('super admins add officers with a quota and nothing used', async () => {
    for (const who of [staff.manager, staff.admin, officer]) {
      await assertFails(setDoc(officerDoc(who), entry()))
    }
    const bad = [
      { used: 3 },
      { quota: -1 },
      { quota: 501 },
      { quota: 1.5 },
      { quota: '10' },
      { name: 'x'.repeat(51) },
      { name: '  ' },
      { email: 'someone@example.com' },
      { createdAt: Timestamp.fromMillis(0) },
      { note: 'x' }
    ]
    for (const fields of bad) {
      await assertFails(setDoc(officerDoc(staff.superAdmin), entry(fields)))
    }
    await assertFails(setDoc(doc(as(staff.superAdmin), 'officers', 'Officer@Example.com'), entry({ email: 'Officer@Example.com' })))
    await assertSucceeds(setDoc(officerDoc(staff.superAdmin), entry()))
  })

  test('super admins change the name and quota, never below what is used, and never `used`', async () => {
    await seedOfficer({ used: 4 })
    await assertSucceeds(updateDoc(officerDoc(staff.superAdmin), { name: '林大幹部', quota: 4 }))
    await assertFails(updateDoc(officerDoc(staff.superAdmin), { quota: 3 }))
    await assertFails(updateDoc(officerDoc(staff.superAdmin), { used: 0 }))
    await assertFails(updateDoc(officerDoc(staff.superAdmin), { quota: 501 }))
    await assertFails(updateDoc(officerDoc(staff.superAdmin), { name: '' }))
    // setDoc over an existing officer resets used and createdAt: refused
    await assertFails(setDoc(officerDoc(staff.superAdmin), entry()))
    await assertFails(updateDoc(officerDoc(officer), { quota: 100 }))
    await assertFails(updateDoc(officerDoc(staff.admin), { quota: 100 }))
    await assertFails(deleteDoc(officerDoc(staff.admin)))
    await assertFails(deleteDoc(officerDoc(officer)))
    await assertSucceeds(deleteDoc(officerDoc(staff.superAdmin)))
  })

  test('an officer reads only their own entry; super admins list them all', async () => {
    await seedOfficer()
    await assertSucceeds(getDoc(officerDoc(officer)))
    await assertFails(getDoc(doc(as(officer, false), 'officers', OFFICER_EMAIL)))
    await assertFails(getDoc(officerDoc(other)))
    await assertFails(getDocs(collection(as(officer), 'officers')))
    await assertFails(getDocs(collection(as(staff.admin), 'officers')))
    await assertSucceeds(getDocs(collection(as(staff.superAdmin), 'officers')))
  })

  test('an invite link is read by whoever holds it; listing is for its officer and super admins', async () => {
    await seedOfficer()
    await seed(async (db) => {
      await setDoc(doc(db, 'officerInvites', INVITE_ID), { officerEmail: OFFICER_EMAIL, officerName: '林幹部', quantity: 2, status: 'open', createdAt: Timestamp.now() })
      await setDoc(doc(db, 'officerInvites', 'ZyXwVuTsRqPoNmLkJiHgFeDc'), { officerEmail: 'someone@example.com', quantity: 1, status: 'open', createdAt: Timestamp.now() })
    })

    await assertFails(getDoc(doc(anon(), 'officerInvites', INVITE_ID)))
    await assertSucceeds(getDoc(doc(as(other), 'officerInvites', INVITE_ID)))
    await assertFails(getDocs(collection(as(other), 'officerInvites')))

    await assertSucceeds(getDocs(query(collection(as(officer), 'officerInvites'), where('officerEmail', '==', OFFICER_EMAIL))))
    await assertFails(getDocs(collection(as(officer), 'officerInvites')))
    await assertFails(getDocs(query(collection(as(other), 'officerInvites'), where('officerEmail', '==', other.email))))
    await assertFails(getDocs(collection(as(staff.admin), 'officerInvites')))
    await assertSucceeds(getDocs(collection(as(staff.superAdmin), 'officerInvites')))

    // only the functions make, claim and revoke them
    for (const who of [officer, other, staff.superAdmin]) {
      await assertFails(setDoc(doc(as(who), 'officerInvites', 'NewNewNewNewNewNewNewNewN'), { officerEmail: OFFICER_EMAIL, quantity: 1, status: 'open' }))
      await assertFails(updateDoc(doc(as(who), 'officerInvites', INVITE_ID), { status: 'claimed' }))
      await assertFails(deleteDoc(doc(as(who), 'officerInvites', INVITE_ID)))
    }
  })

  test('a link\'s note is for its officer and super admins only', async () => {
    await seedOfficer()
    await seed(async (db) => {
      await setDoc(doc(db, 'officerInviteNotes', INVITE_ID), { note: '給學長', officerEmail: OFFICER_EMAIL, createdAt: Timestamp.now() })
      await setDoc(doc(db, 'officerInviteNotes', 'ZyXwVuTsRqPoNmLkJiHgFeDc'), { note: '校友會', officerEmail: null, createdAt: Timestamp.now() })
    })
    const mine = (who) => doc(as(who), 'officerInviteNotes', INVITE_ID)

    await assertSucceeds(getDoc(mine(officer)))
    await assertSucceeds(getDocs(query(collection(as(officer), 'officerInviteNotes'), where('officerEmail', '==', OFFICER_EMAIL))))
    await assertFails(getDocs(collection(as(officer), 'officerInviteNotes')))
    await assertFails(getDoc(doc(as(officer), 'officerInviteNotes', 'ZyXwVuTsRqPoNmLkJiHgFeDc')))
    // the guest holding the link, and staff below super admin
    for (const who of [other, staff.manager, staff.admin]) {
      await assertFails(getDoc(mine(who)))
    }
    await assertSucceeds(getDocs(collection(as(staff.superAdmin), 'officerInviteNotes')))

    // only createOfficerInvite writes them
    for (const who of [officer, staff.superAdmin]) {
      await assertFails(setDoc(doc(as(who), 'officerInviteNotes', 'NewNewNewNewNewNewNewNewN'), { note: 'x', officerEmail: OFFICER_EMAIL }))
      await assertFails(updateDoc(mine(who), { note: '改' }))
      await assertFails(deleteDoc(mine(who)))
    }

    await seed((db) => deleteDoc(doc(db, 'officers', OFFICER_EMAIL)))
    await assertFails(getDoc(mine(officer)))
  })

  test('officers read the tickets they sent, and no others, while on the list', async () => {
    await seedOfficer()
    await seed(async (db) => {
      await setDoc(doc(db, 'orders', 'PR20261026K7Q2MX'), { complimentary: true, officerEmail: OFFICER_EMAIL, customerEmail: 'guest@example.com', userId: null })
      await setDoc(doc(db, 'orders', 'PR20261026AAAAAA'), { complimentary: true, officerEmail: 'someone@example.com', customerEmail: 'b@example.com', userId: null })
    })
    await assertSucceeds(getDoc(doc(as(officer), 'orders', 'PR20261026K7Q2MX')))
    await assertFails(getDoc(doc(as(officer, false), 'orders', 'PR20261026K7Q2MX')))
    await assertFails(getDoc(doc(as(officer), 'orders', 'PR20261026AAAAAA')))
    await assertFails(getDoc(doc(as(officer), 'orders', ORDER_ID)))
    await assertSucceeds(getDocs(query(collection(as(officer), 'orders'), where('officerEmail', '==', OFFICER_EMAIL))))
    await assertFails(getDocs(query(collection(as(officer), 'orders'), where('complimentary', '==', true))))
    await assertFails(deleteDoc(doc(as(officer), 'orders', 'PR20261026K7Q2MX')))

    // taken off the list: no longer
    await seed((db) => deleteDoc(doc(db, 'officers', OFFICER_EMAIL)))
    await assertFails(getDoc(doc(as(officer), 'orders', 'PR20261026K7Q2MX')))
    await assertFails(getDocs(query(collection(as(officer), 'orders'), where('officerEmail', '==', OFFICER_EMAIL))))
  })

  test('super admins list the 公關票 orders; the functions\' markers are for nobody', async () => {
    await assertSucceeds(getDocs(query(collection(as(staff.superAdmin), 'orders'), where('complimentary', '==', true))))
    for (const name of ['invitationRequests', 'officerReleases']) {
      await assertFails(getDoc(doc(as(staff.superAdmin), name, 'guest-request-00000001')))
      await assertFails(setDoc(doc(as(staff.superAdmin), name, 'guest-request-00000001'), { orderId: ORDER_ID }))
    }
    // the old /guest registrations are gone
    await assertFails(setDoc(doc(as(other), 'guestRegistrations', other.uid), { name: '陳小華', email: other.email }))
    await assertFails(getDocs(collection(as(staff.superAdmin), 'guestRegistrations')))
  })
})

describe('公關票登記連結 (guestSignupLinks and their sign-ups)', () => {
  const guest = { uid: 'guest-uid', email: 'guest@example.com' }
  const other = { uid: 'other-uid', email: 'other@example.com' }
  const LINK_ID = 'AbCdEfGhIjKlMnOpQrStUvWx'
  const linkDoc = (db) => doc(db, 'guestSignupLinks', LINK_ID)
  const signupDoc = (db, uid = guest.uid) => doc(db, 'guestSignupLinks', LINK_ID, 'signups', uid)
  // when the guest last wrote it (submitGuestSignup)
  const UPDATED_AT = Timestamp.fromMillis(1_793_000_000_123)
  // what GuestAdminPage.vue writes for a review (reviewSignups): the
  // updatedAt of the sign-up as its page showed it
  const review = (status, who = staff.superAdmin, seen = UPDATED_AT) =>
    ({ status, reviewedAt: serverTimestamp(), reviewedByUid: who.uid, reviewedUpdatedAt: seen })
  const seedSignup = (fields = {}, uid = guest.uid) =>
    env.withSecurityRulesDisabled((context) => setDoc(signupDoc(context.firestore(), uid), {
      linkId: LINK_ID, uid, name: '陳小華', email: guest.email, note: '', status: 'pending', createdAt: Timestamp.now(), updatedAt: UPDATED_AT, ...fields
    }))

  beforeEach(() => env.withSecurityRulesDisabled((context) =>
    setDoc(linkDoc(context.firestore()), { title: '熱舞社校友', quantity: 1, open: true, createdByUid: staff.superAdmin.uid, createdAt: Timestamp.now() })
  ))

  test('a link is read by whoever holds it, listed by super admins, and only opened or closed by them', async () => {
    await assertFails(getDoc(linkDoc(anon())))
    await assertSucceeds(getDoc(linkDoc(as(guest))))
    await assertFails(getDocs(collection(as(guest), 'guestSignupLinks')))
    await assertFails(getDocs(collection(as(staff.admin), 'guestSignupLinks')))
    await assertSucceeds(getDocs(collection(as(staff.superAdmin), 'guestSignupLinks')))

    await assertSucceeds(updateDoc(linkDoc(as(staff.superAdmin)), { open: false }))
    await assertFails(updateDoc(linkDoc(as(staff.superAdmin)), { open: 'yes' }))
    await assertFails(updateDoc(linkDoc(as(staff.superAdmin)), { quantity: 10 }))
    await assertFails(updateDoc(linkDoc(as(staff.superAdmin)), { title: '改' }))
    for (const who of [guest, staff.admin]) {
      await assertFails(updateDoc(linkDoc(as(who)), { open: true }))
    }
    // only createGuestSignupLink makes them; nobody deletes them
    await assertFails(setDoc(doc(as(staff.superAdmin), 'guestSignupLinks', 'NewNewNewNewNewNewNewNewN'), { title: 'x', quantity: 1, open: true }))
    await assertFails(deleteDoc(linkDoc(as(staff.superAdmin))))
  })

  test('a guest reads their own sign-up, also before signing up; nobody else but super admins', async () => {
    // not signed up yet: the page asks, and learns there is none
    await assertSucceeds(getDoc(signupDoc(as(guest))))
    await seedSignup()
    await assertSucceeds(getDoc(signupDoc(as(guest))))
    await assertFails(getDoc(signupDoc(as(other), guest.uid)))
    await assertFails(getDoc(signupDoc(as(staff.admin), guest.uid)))
    await assertFails(getDoc(signupDoc(anon(), guest.uid)))
    await assertSucceeds(getDoc(signupDoc(as(staff.superAdmin), guest.uid)))

    await assertFails(getDocs(collection(as(guest), 'guestSignupLinks', LINK_ID, 'signups')))
    await assertFails(getDocs(collection(as(staff.admin), 'guestSignupLinks', LINK_ID, 'signups')))
    await assertSucceeds(getDocs(collection(as(staff.superAdmin), 'guestSignupLinks', LINK_ID, 'signups')))
    // whether a closed link still has sign-ups waiting (hasWaitingSignups)
    await assertSucceeds(getDocs(query(
      collection(as(staff.superAdmin), 'guestSignupLinks', LINK_ID, 'signups'), where('status', 'in', ['pending', 'approved']), limit(1)
    )))
    // super admins list one link's at a time: no rule opens every "signups"
    // collection in the database
    for (const who of [guest, staff.admin, staff.superAdmin]) {
      await assertFails(getDocs(collectionGroup(as(who), 'signups')))
    }
  })

  test('only submitGuestSignup makes or changes a sign-up', async () => {
    const fields = { linkId: LINK_ID, uid: guest.uid, name: '陳小華', email: guest.email, note: '', status: 'pending', createdAt: serverTimestamp() }
    await assertFails(setDoc(signupDoc(as(guest)), fields))
    await assertFails(setDoc(signupDoc(as(guest)), { ...fields, status: 'approved' }))
    await assertFails(setDoc(signupDoc(as(staff.superAdmin)), fields))
    await seedSignup()
    await assertFails(updateDoc(signupDoc(as(guest)), { name: '陳大華' }))
    await assertFails(updateDoc(signupDoc(as(guest)), review('approved', guest)))
    await assertFails(deleteDoc(signupDoc(as(guest))))
  })

  test('super admins approve, reject or reopen a sign-up, but never send it or change it once sent', async () => {
    await seedSignup()
    const mine = signupDoc(as(staff.superAdmin))
    await assertSucceeds(updateDoc(mine, review('approved')))
    await assertSucceeds(updateDoc(mine, review('pending')))
    await assertSucceeds(updateDoc(mine, review('rejected')))
    await assertSucceeds(updateDoc(mine, review('approved')))

    // sending makes an order: sendGuestSignupTicket only
    await assertFails(updateDoc(mine, review('sent')))
    await assertFails(updateDoc(mine, { ...review('approved'), orderId: 'PR20261026K7Q2MX' }))
    await assertFails(updateDoc(mine, { ...review('approved'), name: '改名' }))
    await assertFails(updateDoc(mine, { ...review('approved'), reviewedAt: Timestamp.fromMillis(0) }))
    await assertFails(updateDoc(mine, review('approved', staff.admin)))
    await assertFails(updateDoc(signupDoc(as(staff.admin)), review('rejected', staff.admin)))
    await assertFails(deleteDoc(mine))

    await seedSignup({ status: 'sent', orderId: 'PR20261026K7Q2MX' })
    await assertFails(updateDoc(mine, review('rejected')))
    await assertFails(updateDoc(mine, review('pending')))
  })

  test('a review is of the sign-up as the super admin saw it', async () => {
    await seedSignup()
    const mine = signupDoc(as(staff.superAdmin))
    // the guest changed it after the page loaded
    await assertFails(updateDoc(mine, review('approved', staff.superAdmin, Timestamp.fromMillis(UPDATED_AT.toMillis() - 60_000))))
    // nor without saying which
    await assertFails(updateDoc(mine, { status: 'approved', reviewedAt: serverTimestamp(), reviewedByUid: staff.superAdmin.uid }))
    await assertSucceeds(updateDoc(mine, review('approved')))
  })

  test('super admins delete only rejected sign-ups', async () => {
    const mine = signupDoc(as(staff.superAdmin))
    for (const status of ['pending', 'approved']) {
      await seedSignup({ status })
      await assertFails(deleteDoc(mine))
    }
    await seedSignup({ status: 'sent', orderId: 'PR20261026K7Q2MX' })
    await assertFails(deleteDoc(mine))

    await seedSignup({ status: 'rejected' })
    for (const who of [guest, staff.admin]) {
      await assertFails(deleteDoc(signupDoc(as(who))))
    }
    await assertSucceeds(deleteDoc(mine))
  })
})

describe('路宣登記 (settings/streetSale, street sale orders)', () => {
  const seed = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()))
  // what StreetSaleAdminPage.vue saves (saveStreetProgram)
  const program = (who, fields = {}) => ({ enabled: true, ticketTypeId: 'open', updatedAt: serverTimestamp(), updatedByUid: who.uid, ...fields })
  const sale = { streetSale: true, school: '路宣', promoterEmail: staff.admin.email, promoterName: '林管理', customerEmail: '', userId: null, paid: true, delivered: true }

  test('only super admins open it and choose the ticket type, the way the stats page does', async () => {
    const programDoc = (who) => doc(as(who), 'settings', 'streetSale')
    await assertSucceeds(getDoc(doc(anon(), 'settings', 'streetSale')))
    for (const who of [buyer, staff.manager, staff.admin]) {
      await assertFails(setDoc(programDoc(who), program(who)))
    }
    await assertSucceeds(setDoc(programDoc(staff.superAdmin), program(staff.superAdmin)))
    for (const fields of [{ enabled: 'yes' }, { ticketTypeId: 3 }, { ticketTypeId: 'x'.repeat(101) }, { updatedByUid: staff.admin.uid }, { goal: 10 }]) {
      await assertFails(setDoc(programDoc(staff.superAdmin), program(staff.superAdmin, fields)))
    }
    await assertFails(deleteDoc(programDoc(staff.admin)))
    await assertSucceeds(deleteDoc(programDoc(staff.superAdmin)))
  })

  test('admins list the sales they registered and every sale; nobody writes one directly', async () => {
    await seed((db) => setDoc(doc(db, 'orders', 'ST20261106K7Q2MX'), sale))
    await assertSucceeds(getDocs(query(collection(as(staff.admin), 'orders'), where('promoterEmail', '==', staff.admin.email))))
    await assertSucceeds(getDocs(query(collection(as(staff.superAdmin), 'orders'), where('streetSale', '==', true))))
    // door staff open single orders only
    await assertSucceeds(getDoc(doc(as(staff.manager), 'orders', 'ST20261106K7Q2MX')))
    await assertFails(getDocs(query(collection(as(staff.manager), 'orders'), where('streetSale', '==', true))))
    // no account owns a street sale
    await assertFails(getDoc(doc(as(buyer), 'orders', 'ST20261106K7Q2MX')))

    for (const who of [staff.admin, staff.superAdmin]) {
      await assertFails(setDoc(doc(as(who), 'orders', 'ST20261106BBBBBB'), sale))
      await assertFails(updateDoc(doc(as(who), 'orders', 'ST20261106K7Q2MX'), { customerName: '改名' }))
    }
    await assertSucceeds(deleteDoc(doc(as(staff.superAdmin), 'orders', 'ST20261106K7Q2MX')))
  })

  test('the request markers and the old promoter list are for nobody', async () => {
    await assertFails(getDoc(doc(as(staff.superAdmin), 'streetSaleRequests', 'street-request-0001')))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'streetSaleRequests', 'street-request-0001'), { orderId: ORDER_ID }))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'streetPromoters', 'x@example.com'), { email: 'x@example.com' }))
  })
})

describe('報帳 (reimbursements)', () => {
  const seed = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()))
  // what submitReimbursement saves (functions/lib/reimbursements.js)
  const claim = (who, fields = {}) => ({
    name: '林管理',
    amount: 1200,
    note: '場佈材料',
    category: '場佈',
    year: 2026,
    status: 'pending',
    submitterUid: who.uid,
    submitterEmail: who.email,
    invoices: [{ fileId: 'drive-file-1', name: 'IMG_0001.jpg', contentType: 'image/jpeg', size: 1024, url: 'https://drive.google.com/file/d/drive-file-1/view' }],
    createdAt: serverTimestamp(),
    ...fields
  })
  // what ReimbursementAdminPage.vue writes (setReimbursementStatus)
  const review = (who, status, fields = {}) => ({
    status,
    reviewedAt: serverTimestamp(),
    reviewedByUid: who.uid,
    reviewedByName: '總召',
    ...fields
  })
  const stored = (who, status = 'pending') => ({ ...claim(who), status, createdAt: Timestamp.now() })

  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'reimbursements', 'mine'), stored(staff.admin))
      await setDoc(doc(db, 'reimbursements', 'approved'), stored(staff.admin, 'approved'))
      await setDoc(doc(db, 'reimbursements', 'theirs'), stored(staff.superAdmin))
    })
  })

  test('nobody creates a claim directly, so none is saved without its invoices', async () => {
    for (const who of [staff.admin, staff.superAdmin]) {
      await assertFails(setDoc(doc(as(who), 'reimbursements', 'c1'), claim(who)))
      await assertFails(setDoc(doc(as(who), 'reimbursements', 'c2'), { ...claim(who), invoices: [] }))
    }
    await assertFails(setDoc(doc(as(staff.manager), 'reimbursements', 'c3'), claim(staff.manager)))
    await assertFails(setDoc(doc(anon(), 'reimbursements', 'c4'), claim(buyer)))
  })

  test('the Drive folder record is for the functions alone', async () => {
    await seed((db) => setDoc(doc(db, 'reimbursementFolders', '2026'), { folderId: 'drive-folder' }))
    await assertFails(getDoc(doc(as(staff.superAdmin), 'reimbursementFolders', '2026')))
    await assertFails(setDoc(doc(as(staff.superAdmin), 'reimbursementFolders', '2026'), { folderId: 'elsewhere' }))
  })

  test('admins read their own claims, with a submitterUid filter; super admins list them all', async () => {
    const db = as(staff.admin)
    await assertSucceeds(getDoc(doc(db, 'reimbursements', 'mine')))
    await assertFails(getDoc(doc(db, 'reimbursements', 'theirs')))
    await assertSucceeds(getDocs(query(collection(db, 'reimbursements'), where('submitterUid', '==', staff.admin.uid))))
    await assertFails(getDocs(collection(db, 'reimbursements')))
    await assertFails(getDocs(query(collection(db, 'reimbursements'), where('year', '==', 2026))))

    await assertFails(getDoc(doc(as(staff.manager), 'reimbursements', 'mine')))
    await assertSucceeds(getDocs(query(collection(as(staff.superAdmin), 'reimbursements'), where('year', '==', 2026))))
  })

  test('only super admins review a claim, and only its status', async () => {
    const reviewer = as(staff.superAdmin)
    for (const status of ['approved', 'paid', 'rejected', 'pending']) {
      await assertSucceeds(updateDoc(doc(reviewer, 'reimbursements', 'mine'), review(staff.superAdmin, status)))
    }
    // admins cannot review, not even their own claim
    await assertFails(updateDoc(doc(as(staff.admin), 'reimbursements', 'mine'), review(staff.admin, 'approved')))
    await assertFails(updateDoc(doc(as(staff.admin), 'reimbursements', 'mine'), { amount: 9999 }))

    for (const fields of [
      { status: 'done' },
      { reviewedByUid: staff.admin.uid },
      { reviewedAt: Timestamp.fromDate(new Date('2020-01-01')) },
      { reviewedByName: 'x'.repeat(101) },
      { amount: 9999 },
      { name: '改名' },
      { invoices: [] }
    ]) {
      await assertFails(updateDoc(doc(reviewer, 'reimbursements', 'mine'), review(staff.superAdmin, 'approved', fields)))
    }
    await assertFails(updateDoc(doc(reviewer, 'reimbursements', 'mine'), { status: 'approved' }))
  })

  test('super admins correct the 科目 alone; nobody else can', async () => {
    await assertSucceeds(updateDoc(doc(as(staff.superAdmin), 'reimbursements', 'mine'), { category: '餐食' }))
    await assertFails(updateDoc(doc(as(staff.admin), 'reimbursements', 'mine'), { category: '餐食' }))
    for (const category of ['', 'x'.repeat(21), 3]) {
      await assertFails(updateDoc(doc(as(staff.superAdmin), 'reimbursements', 'mine'), { category }))
    }
    // not together with anything else, so it never passes as a review
    await assertFails(updateDoc(doc(as(staff.superAdmin), 'reimbursements', 'mine'), { category: '餐食', amount: 1 }))
    await assertFails(updateDoc(doc(as(staff.superAdmin), 'reimbursements', 'mine'), { category: '餐食', status: 'approved' }))
  })

  test('the submitter withdraws a pending claim; super admins delete any', async () => {
    await assertFails(deleteDoc(doc(as(staff.admin), 'reimbursements', 'approved')))
    await assertFails(deleteDoc(doc(as(staff.admin), 'reimbursements', 'theirs')))
    await assertFails(deleteDoc(doc(as(staff.manager), 'reimbursements', 'mine')))
    await assertSucceeds(deleteDoc(doc(as(staff.admin), 'reimbursements', 'mine')))
    await assertSucceeds(deleteDoc(doc(as(staff.superAdmin), 'reimbursements', 'approved')))
  })
})

describe('scanLinks (手機掃描、電腦處理)', () => {
  const LINK_ID = 'AbCdEfGhIjKlMnOpQrSt'
  // the computer at the desk, and a phone signed in as someone else
  const desk = staff.manager
  const phoneUser = staff.admin
  const linkDoc = (who, id = LINK_ID) => doc(as(who), 'scanLinks', id)
  const freshId = (n) => `NewLink${String(n).padStart(13, '0')}`

  const newLink = (who, fields = {}) => ({
    ownerUid: who.uid,
    ownerName: '門口電腦',
    createdAt: serverTimestamp(),
    ...fields
  })
  const phone = (who, fields = {}) => ({ uid: who.uid, name: '王小明', at: serverTimestamp(), ...fields })
  const scan = (who, fields = {}) => ({
    id: 'scan-1',
    orderId: ORDER_ID,
    ticketCode: 'secret-code',
    at: serverTimestamp(),
    byUid: who.uid,
    ...fields
  })
  const seed = (createdAt = Timestamp.now()) =>
    env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), 'scanLinks', LINK_ID), { ownerUid: desk.uid, ownerName: '門口電腦', createdAt })
    )
  const hoursAgo = (hours) => Timestamp.fromDate(new Date(Date.now() - hours * 60 * 60 * 1000))

  test('staff make a link for themselves, the way createScanLink does', async () => {
    await assertSucceeds(setDoc(linkDoc(desk, freshId(1)), newLink(desk)))
    await assertFails(setDoc(doc(as(buyer), 'scanLinks', freshId(2)), newLink(buyer)))
    await assertFails(setDoc(doc(anon(), 'scanLinks', freshId(3)), newLink({ uid: 'anon' })))
  })

  test('a link made for someone else, with a chosen time, or malformed is rejected', async () => {
    let n = 10
    for (const fields of [
      { ownerUid: phoneUser.uid },
      { createdAt: Timestamp.now() },
      { ownerName: 'x'.repeat(201) },
      { ownerName: 3 },
      { phone: phone(desk) },
      { scan: scan(desk) },
      { note: 'x' }
    ]) {
      await assertFails(setDoc(linkDoc(desk, freshId(n++)), newLink(desk, fields)))
    }
    for (const key of ['ownerUid', 'ownerName', 'createdAt']) {
      const data = newLink(desk)
      delete data[key]
      await assertFails(setDoc(linkDoc(desk, freshId(n++)), data))
    }
  })

  test('staff read a link by its id; nobody lists them', async () => {
    await seed()
    await assertSucceeds(getDoc(linkDoc(phoneUser)))
    await assertSucceeds(getDoc(linkDoc(phoneUser, freshId(1)))) // not there: the phone is told so
    await assertFails(getDoc(doc(as(buyer), 'scanLinks', LINK_ID)))
    await assertFails(getDoc(doc(anon(), 'scanLinks', LINK_ID)))
    for (const who of [staff.manager, staff.superAdmin]) {
      await assertFails(getDocs(collection(as(who), 'scanLinks')))
    }
  })

  test('a phone pairs and sends scans, the way joinScanLink and sendScan do', async () => {
    await seed()
    await assertSucceeds(updateDoc(linkDoc(phoneUser), { phone: phone(phoneUser) }))
    await assertSucceeds(updateDoc(linkDoc(phoneUser), { phone: phone(phoneUser), scan: scan(phoneUser) }))
    // typed in by hand: no ticket code
    await assertSucceeds(updateDoc(linkDoc(phoneUser), {
      phone: phone(phoneUser),
      scan: scan(phoneUser, { id: 'scan-2', orderId: 'CKS20261027ABCDEF', ticketCode: '' })
    }))
    await assertFails(updateDoc(doc(as(buyer), 'scanLinks', LINK_ID), { phone: phone(buyer), scan: scan(buyer) }))
    await assertFails(updateDoc(doc(anon(), 'scanLinks', LINK_ID), { phone: phone({ uid: 'anon' }) }))
  })

  test('a scan must say which phone sent it, as itself, at the server time', async () => {
    await seed()
    for (const data of [
      { scan: scan(phoneUser) }, // no phone
      { phone: phone(desk) },
      { phone: phone(phoneUser, { at: Timestamp.now() }) },
      { phone: phone(phoneUser, { name: 'x'.repeat(201) }) },
      { phone: phone(phoneUser, { extra: 1 }) },
      { phone: { uid: phoneUser.uid, at: serverTimestamp() } },
      { phone: 'me' }
    ]) {
      await assertFails(updateDoc(linkDoc(phoneUser), data))
    }
  })

  test('a malformed scan is rejected', async () => {
    await seed()
    const incomplete = (key) => {
      const data = scan(phoneUser)
      delete data[key]
      return data
    }
    for (const value of [
      scan(phoneUser, { byUid: desk.uid }),
      scan(phoneUser, { at: Timestamp.now() }),
      scan(phoneUser, { orderId: 'cks202611050001' }),
      scan(phoneUser, { orderId: '../users/x' }),
      scan(phoneUser, { orderId: `${ORDER_ID}0` }),
      scan(phoneUser, { orderId: '' }),
      scan(phoneUser, { ticketCode: 'x'.repeat(201) }),
      scan(phoneUser, { id: '' }),
      scan(phoneUser, { id: 'x'.repeat(65) }),
      scan(phoneUser, { extra: 1 }),
      ...['id', 'orderId', 'ticketCode', 'at', 'byUid'].map(incomplete)
    ]) {
      await assertFails(updateDoc(linkDoc(phoneUser), { phone: phone(phoneUser), scan: value }))
    }
  })

  test('nobody changes who owns a link, when it was made, or adds fields', async () => {
    await seed()
    for (const fields of [
      { ownerUid: phoneUser.uid },
      { ownerName: '別人的電腦' },
      { createdAt: serverTimestamp() },
      { note: 'x' }
    ]) {
      await assertFails(updateDoc(linkDoc(phoneUser), { phone: phone(phoneUser), ...fields }))
      await assertFails(updateDoc(linkDoc(desk), { phone: phone(desk), ...fields }))
    }
  })

  test('a link takes scans for 12 hours', async () => {
    await seed(hoursAgo(11.5))
    await assertSucceeds(updateDoc(linkDoc(phoneUser), { phone: phone(phoneUser), scan: scan(phoneUser) }))

    await seed(hoursAgo(12.5))
    await assertFails(updateDoc(linkDoc(phoneUser), { phone: phone(phoneUser) }))
    await assertFails(updateDoc(linkDoc(phoneUser), { phone: phone(phoneUser), scan: scan(phoneUser) }))
    // the computer still sees it, to say it has expired
    await assertSucceeds(getDoc(linkDoc(desk)))
  })

  test('the computer ends its own link; super admins delete any', async () => {
    await seed()
    await assertFails(deleteDoc(linkDoc(phoneUser)))
    await assertFails(deleteDoc(doc(as(buyer), 'scanLinks', LINK_ID)))
    await assertSucceeds(deleteDoc(linkDoc(desk)))

    await seed()
    await assertSucceeds(deleteDoc(linkDoc(staff.superAdmin)))
  })
})
