// One structured log line per createOrder call, for watching a sale opening
// live: how each checkout ended, how long it took and where the time went.
// Cloud Logging stores it as jsonPayload; the log-based metrics and the
// dashboard in /monitoring count and chart these lines (see
// monitoring/README.md). Writing it is one stdout write: no Firestore, Redis
// or HTTP call is added to the checkout.
//
//   outcome        created | replayed | sold_out | busy | rejected | error
//   code           the HttpsError code sent to the buyer, or 'ok'
//   gate           off | admitted | turned_away | no_answer (on, but Redis
//                  gave no answer in time or is not set up)
//   totalMs        the whole call
//   checksMs       Turnstile, shop open and rate limit (alongside the gate)
//   gateMs         the stock gate's Redis call
//   lookMs         unlocked looks at the stock shards, all of them added up
//   txMs           order transactions, all attempts added up
//   backoffMs      random waits between lost races
//   txAttempts     order transactions tried
//   coldStart      the first checkout this instance served
//   inflight       checkouts this instance was serving when this one started
//
// No email, uid or order details: only the requestId, which the buyer's
// browser also has, ties a line to a checkout.
import { performance } from 'node:perf_hooks'
import * as logger from 'firebase-functions/logger'

export const CHECKOUT_LOG_MESSAGE = 'checkout'

let warm = false
let inflight = 0

// How the stock gate answered (admitToStock's result; null = no answer)
export function gateOutcome(answer, enabled) {
  if (!answer) return enabled ? 'no_answer' : 'off'
  return answer.admitted ? 'admitted' : 'turned_away'
}

// The outcome of a call that threw. `cause` is the error that ended the
// checkout, before a rejected request's marker or toHttpsError replaced it.
export function errorOutcome(error, cause = error) {
  if (cause?.soldOut || error?.soldOut) return 'sold_out'
  if (error?.code === 'aborted') return 'busy'
  if (!error?.code || error.code === 'internal' || error.code === 'unknown') return 'error'
  return 'rejected'
}

export function startCheckoutLog({ write = (fields) => logger.info(CHECKOUT_LOG_MESSAGE, fields), now = () => performance.now() } = {}) {
  const t0 = now()
  const fields = { coldStart: !warm, inflight: inflight++, gate: 'off', txAttempts: 0 }
  warm = true
  let cause = null
  let finished = false

  const add = (key, ms) => { fields[key] = (fields[key] || 0) + Math.max(0, Math.round(ms)) }

  return {
    set(more) { Object.assign(fields, more) },
    count(key) { fields[key] = (fields[key] || 0) + 1 },
    // Runs fn and adds the time it took to fields[key], whether it throws or not
    async time(key, fn) {
      const start = now()
      try {
        return await fn()
      } finally {
        add(key, now() - start)
      }
    },
    // Remembers the first error that ended the checkout (see errorOutcome)
    fail(error) { cause ??= error },
    finish(result, error) {
      if (finished) return
      finished = true
      inflight = Math.max(0, inflight - 1)
      const outcome = error ? errorOutcome(error, cause ?? error) : result?.status === 201 ? 'created' : 'replayed'
      try {
        write({
          metric: CHECKOUT_LOG_MESSAGE,
          outcome,
          code: error ? String(error.code || 'internal') : 'ok',
          totalMs: Math.max(0, Math.round(now() - t0)),
          ...fields
        })
      } catch {
        // never let the log line fail a checkout
      }
    }
  }
}

// Wraps a callable handler (request, log) => result so that every call,
// returned or thrown, writes its line.
export function withCheckoutLog(handler, options) {
  return async (request) => {
    const log = startCheckoutLog(options)
    try {
      const result = await handler(request, log)
      log.finish(result)
      return result
    } catch (error) {
      log.finish(null, error)
      throw error
    }
  }
}

// for tests
export function resetCheckoutLogState() {
  warm = false
  inflight = 0
}
