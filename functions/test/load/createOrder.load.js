// Load test for createOrder against the Firestore emulator (PARTY-28):
// `yarn test:load` (needs Java). Many buyers check out at the same moment;
// prints successes, latency and error codes for one scenario
// (`node createOrder.load.js <index>`; run.js gives each its own emulator).
// The emulator locks more conservatively than production, so compare runs
// with each other rather than reading the numbers as production capacity.
import { HOUR, fft, functions, db, iso, soldOf } from '../emulator/setup.js'
import { SCENARIOS } from './scenarios.js'

const callCreate = fft.wrap(functions.createOrder)
const callPlan = fft.wrap(functions.planStockShards)

const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]

async function run({ label, buyers, stock }) {
  const typeId = 'load'
  await db.doc('settings/shop').set({ openAt: new Date(Date.now() - HOUR) })
  await db.doc('settings/ticketTypes').set({
    types: [{
      id: typeId, name: '壓測票', price: 900, eligibleBuyerIdentity: 'all_users',
      salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: stock, purchaseLimitPerPerson: 4
    }]
  })
  // as the trigger does in production when the ticket types are saved
  await callPlan(fft.makeChange(null, await db.doc('settings/ticketTypes').get()), {})

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
              items: [{ id: typeId, quantity: 1 }]
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
    sold: await soldOf(typeId),
    totalMs: Date.now() - startedAt,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    errors
  })
}

const scenario = SCENARIOS[Number(process.argv[2])]
if (!scenario) {
  console.error(`usage: node createOrder.load.js <0-${SCENARIOS.length - 1}>`)
  process.exit(1)
}
await run(scenario)

fft.cleanup()
process.exit(0)
