// Load test for createOrder against the Firestore emulator (PARTY-28):
// `yarn test:load` (needs Java). Many buyers check out at the same moment;
// prints successes, latency and error codes per scenario. Not run in CI.
// The emulator locks more conservatively than production, so compare runs
// with each other rather than reading the numbers as production capacity.
import functionsTest from 'firebase-functions-test'

const PROJECT_ID = 'demo-cksc-ticket'
process.env.GCLOUD_PROJECT = PROJECT_ID
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.appspot.com`
})

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('run through `yarn test:load`')
  process.exit(1)
}

const fft = functionsTest({ projectId: PROJECT_ID })
const { createOrder } = await import('../../index.js')
const { db } = await import('../../lib/common.js')
const callCreate = fft.wrap(createOrder)

const HOUR = 60 * 60 * 1000
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString()

const SCENARIOS = [
  { label: '300 buyers, plenty of stock', buyers: 300, stock: 10000 },
  { label: '300 buyers, 100 tickets', buyers: 300, stock: 100 },
  { label: '1000 buyers, plenty of stock', buyers: 1000, stock: 10000 }
]

async function clearFirestore() {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  )
}

async function soldOf(ticketTypeId) {
  const shards = await db.collection(`ticketSales/${ticketTypeId}/shards`).get()
  return shards.docs.reduce((sum, d) => sum + (d.data().sold || 0), 0)
}

const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]

async function run({ label, buyers, stock }) {
  await clearFirestore()
  await db.doc('settings/shop').set({ openAt: new Date(Date.now() - HOUR) })
  await db.doc('settings/ticketTypes').set({
    types: [{
      id: 'load', name: '壓測票', price: 900, eligibleBuyerIdentity: 'all_users',
      salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: stock, purchaseLimitPerPerson: 4
    }]
  })

  const latencies = []
  const startedAt = Date.now()
  const results = await Promise.allSettled(
    Array.from({ length: buyers }, async (_, i) => {
      const t0 = Date.now()
      try {
        return await callCreate(
          {
            orderPayload: {
              customerName: '壓測', customerPhone: '0900000000', school: '北一女中', class: '101', number: '1',
              items: [{ id: 'load', quantity: 1 }]
            },
            requestId: `load-${i}-0123456789abcdef`
          },
          { auth: { uid: `load-${i}`, token: { email: `load${i}@example.com`, email_verified: true } } }
        )
      } finally {
        latencies.push(Date.now() - t0)
      }
    })
  )

  const errors = {}
  results
    .filter((r) => r.status === 'rejected')
    .forEach((r) => { errors[r.reason?.code] = (errors[r.reason?.code] || 0) + 1 })

  latencies.sort((a, b) => a - b)
  console.log({
    scenario: label,
    succeeded: results.filter((r) => r.status === 'fulfilled').length,
    sold: await soldOf('load'),
    totalMs: Date.now() - startedAt,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    errors
  })
}

for (const scenario of SCENARIOS) await run(scenario)

fft.cleanup()
process.exit(0)
