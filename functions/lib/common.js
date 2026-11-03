import * as functions from 'firebase-functions/v1'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

import { ROLE_RANK } from './constants.js'

initializeApp()

export const db = getFirestore()

// Resolved lazily so modules that never touch Storage load without a bucket
export const getBucket = () => getStorage().bucket()

export const HttpsError = functions.https.HttpsError

// Staff role rank of an account: manager 1, admin 2, super_admin 3, else 0
export async function getRoleRank(uid) {
  const userDoc = await db.collection('users').doc(uid).get()
  const role = userDoc.exists ? userDoc.data()?.role : null

  return Object.hasOwn(ROLE_RANK, role) ? ROLE_RANK[role] : 0
}

// Throws unless the caller is signed in with at least `minRole`.
export async function assertRole(context, minRole) {
  if (!context.auth) {
    throw new HttpsError('unauthenticated', '請先登入')
  }

  if ((await getRoleRank(context.auth.uid)) < ROLE_RANK[minRole]) {
    throw new HttpsError('permission-denied', '權限不足')
  }
}
