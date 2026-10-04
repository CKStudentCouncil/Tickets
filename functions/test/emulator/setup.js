// Shared by the emulator tests and the load test: points the functions at
// the Firestore emulator. The emulator project is a demo- project, so
// nothing ever reaches production.
import functionsTest from 'firebase-functions-test'

export const PROJECT_ID = 'demo-cksc-ticket'
process.env.GCLOUD_PROJECT = PROJECT_ID
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.appspot.com`
})

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('run through `yarn test:emulator` or `yarn test:load`')
}

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
