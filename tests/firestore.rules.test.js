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

  test('officers read the tickets they sent, and no others', async () => {
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
