// Shared by the emulator tests and the load test: points the functions at
// the Firestore emulator. The emulator project is a demo- project, so
// nothing ever reaches production. The load test can instead run against a
// real test project's Firestore with LOADTEST_PROJECT=<project id>; the
// functions still run on this machine, and the production project (the
// default in .firebaserc) is refused.
import { readFileSync } from 'node:fs'
import functionsTest from 'firebase-functions-test'

const PRODUCTION_PROJECT = JSON.parse(readFileSync(new URL('../../../.firebaserc', import.meta.url))).projects.default
const target = process.env.LOADTEST_PROJECT

if (target === PRODUCTION_PROJECT) {
  throw new Error(`LOADTEST_PROJECT must not be the production project ${PRODUCTION_PROJECT}`)
}
if (target ? process.env.FIRESTORE_EMULATOR_HOST : !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('run through `yarn test:emulator` or `yarn test:load`, or set LOADTEST_PROJECT without the emulator')
}

export const PROJECT_ID = target || 'demo-cksc-ticket'
export const isEmulator = !target
process.env.GCLOUD_PROJECT = PROJECT_ID
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.appspot.com`
})

export const fft = functionsTest({ projectId: PROJECT_ID })
export const functions = await import('../../index.js')
export const { db } = await import('../../lib/common.js')

export const HOUR = 60 * 60 * 1000
export const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString()

// tickets counted against a type's stock: the shards plus the legacy counter
export async function soldOf(ticketTypeId) {
  const [legacy, shards] = await Promise.all([
    db.doc(`ticketSales/${ticketTypeId}`).get(),
    db.collection(`ticketSales/${ticketTypeId}/shards`).get()
  ])
  return shards.docs.reduce((sum, d) => sum + (d.data().sold || 0), legacy.data()?.sold || 0)
}
