import * as functions from 'firebase-functions'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'

import { ROLE_RANK } from './constants.js'

initializeApp()

export const db = getFirestore()

// Resolved lazily so modules that never touch Storage load without a bucket
export const getBucket = () => getStorage().bucket()

export const HttpsError = functions.https.HttpsError

// Throws unless the caller is signed in with at least `minRole`.
export async function assertRole(context, minRole) {
  if (!context.auth) {
    throw new HttpsError('unauthenticated', '請先登入')
  }

  const userDoc = await db.collection('users').doc(context.auth.uid).get()
  const role = userDoc.exists ? userDoc.data()?.role : null

  if ((ROLE_RANK[role] || 0) < ROLE_RANK[minRole]) {
    throw new HttpsError('permission-denied', '權限不足')
  }

  return role
}
