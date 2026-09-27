// Firestore security rules tests. Run with `npm run test:rules` (needs Java
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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  updateDoc,
  writeBatch
} from 'firebase/firestore'
import * as SURVEY from '../src/data/surveyQuestions.js'

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

describe('settings and public content', () => {
  test('everyone can read; only super admins can write', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'settings', 'ticketTypes')))
    await assertFails(setDoc(doc(as(staff.admin), 'settings', 'ticketTypes'), { types: [] }))
    await assertFails(setDoc(doc(as(staff.admin), 'partyStories', 's1'), { title: 't' }))
    await assertSucceeds(setDoc(doc(as(staff.superAdmin), 'settings', 'ticketTypes'), { types: [] }))
    await assertSucceeds(setDoc(doc(as(staff.superAdmin), 'partyLineup', 'l1'), { name: 'n' }))
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

  test('anyone can submit a well-formed response', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'surveyResponses', 'r1'), response()))
  })

  test('every option offered by the survey page is accepted by the rules', async () => {
    let i = 0
    for (const identity of SURVEY.IDENTITY_OPTIONS) {
      await assertSucceeds(setDoc(doc(anon(), 'surveyResponses', `i${i++}`), response({ identity })))
    }
    for (const device of SURVEY.DEVICE_OPTIONS) {
      await assertSucceeds(setDoc(doc(anon(), 'surveyResponses', `i${i++}`), response({ device })))
    }
    for (const issueCount of SURVEY.ISSUE_COUNT_OPTIONS) {
      await assertSucceeds(setDoc(doc(anon(), 'surveyResponses', `i${i++}`), response({ issueCount })))
    }
    await assertSucceeds(setDoc(doc(anon(), 'surveyResponses', `i${i++}`), response({
      channels: SURVEY.CHANNEL_OPTIONS,
      issueTypes: SURVEY.ISSUE_TYPE_OPTIONS
    })))
    for (const value of [1, 2, 3, 4, 5]) {
      await assertSucceeds(setDoc(doc(anon(), 'surveyResponses', `i${i++}`), response({ scores: allScores(value) })))
    }
  })

  test('out-of-range, non-integer or missing scores are rejected', async () => {
    const bad = (scores) => setDoc(doc(anon(), 'surveyResponses', 'bad'), response({ scores }))
    await assertFails(bad({ ...allScores(), q4: 1000000 }))
    await assertFails(bad({ ...allScores(), q4: '5' }))
    await assertFails(bad({ ...allScores(), q4: 0 }))
    await assertFails(bad({ ...allScores(), q4: 4.5 }))
    await assertFails(bad({ ...allScores(), q99: 5 }))
    const missing = allScores()
    delete missing.q25
    await assertFails(bad(missing))
  })

  test('unknown options and malformed fields are rejected', async () => {
    const bad = (extra) => setDoc(doc(anon(), 'surveyResponses', 'bad'), response(extra))
    await assertFails(bad({ identity: 'hacker' }))
    await assertFails(bad({ channels: ['<script>'] }))
    await assertFails(bad({ channels: [] }))
    await assertFails(bad({ issueTypes: ['whatever'] }))
    await assertFails(bad({ admin: true }))
    await assertFails(bad({ createdAt: 'yesterday' }))
    await assertFails(bad({ suggestion: 'x'.repeat(2001) }))
  })

  test('only staff can read responses', async () => {
    await assertFails(getDocs(collection(anon(), 'surveyResponses')))
    await assertSucceeds(getDocs(collection(as(staff.manager), 'surveyResponses')))
  })
})
