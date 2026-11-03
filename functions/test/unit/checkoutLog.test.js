import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'

import {
  errorOutcome, gateOutcome, resetCheckoutLogState, startCheckoutLog, withCheckoutLog
} from '../../lib/checkoutLog.js'

// a clock moved by hand, and the lines written
function harness() {
  let clock = 1000
  const lines = []
  return {
    lines,
    tick: (ms) => { clock += ms },
    options: { now: () => clock, write: (fields) => lines.push(fields) }
  }
}

const httpsError = (code, extra = {}) => Object.assign(new Error(code), { code }, extra)

beforeEach(() => resetCheckoutLogState())

test('gateOutcome tells off, no answer, admitted and turned away apart', () => {
  assert.equal(gateOutcome(null, false), 'off')
  assert.equal(gateOutcome(null, true), 'no_answer')
  assert.equal(gateOutcome({ admitted: true, holdId: 'h', missing: [] }, true), 'admitted')
  assert.equal(gateOutcome({ admitted: false, ticketTypeId: 't' }, true), 'turned_away')
})

test('errorOutcome sorts errors by what the buyer was told', () => {
  assert.equal(errorOutcome(httpsError('resource-exhausted', { soldOut: true })), 'sold_out')
  assert.equal(errorOutcome(httpsError('resource-exhausted')), 'rejected') // rate limit
  assert.equal(errorOutcome(httpsError('aborted')), 'busy')
  assert.equal(errorOutcome(httpsError('internal')), 'error')
  assert.equal(errorOutcome(new Error('boom')), 'error')
  assert.equal(errorOutcome(httpsError('failed-precondition')), 'rejected')
  // a sold-out checkout whose rejected request marker answered instead
  assert.equal(errorOutcome(httpsError('resource-exhausted'), httpsError('resource-exhausted', { soldOut: true })), 'sold_out')
})

test('a created order writes one line with its outcome, phases and total', async () => {
  const h = harness()
  const handler = withCheckoutLog(async (request, log) => {
    log.set({ gate: 'admitted' })
    await log.time('gateMs', async () => h.tick(30))
    log.count('txAttempts')
    await log.time('txMs', async () => h.tick(100))
    log.count('txAttempts')
    await log.time('txMs', async () => h.tick(50))
    h.tick(5)
    return { status: 201, id: 'CKS1' }
  }, h.options)

  assert.deepEqual(await handler({ data: {} }), { status: 201, id: 'CKS1' })
  assert.equal(h.lines.length, 1)
  assert.deepEqual(h.lines[0], {
    metric: 'checkout',
    outcome: 'created',
    code: 'ok',
    totalMs: 185,
    coldStart: true,
    inflight: 0,
    gate: 'admitted',
    txAttempts: 2,
    gateMs: 30,
    txMs: 150
  })
})

test('a returned earlier order is a replay, and later calls are warm', async () => {
  const h = harness()
  const handler = withCheckoutLog(async () => ({ status: 200, id: 'CKS1' }), h.options)
  await handler({})
  await handler({})
  assert.equal(h.lines[0].outcome, 'replayed')
  assert.equal(h.lines[0].coldStart, true)
  assert.equal(h.lines[1].coldStart, false)
})

test('a thrown error is logged with its code, then thrown on unchanged', async () => {
  const h = harness()
  const soldOut = httpsError('resource-exhausted', { soldOut: true })
  const handler = withCheckoutLog(async (request, log) => {
    await log.time('lookMs', async () => {
      h.tick(20)
      throw soldOut
    }).catch((error) => {
      log.fail(error)
      throw httpsError('resource-exhausted') // as the request marker answers
    })
  }, h.options)

  await assert.rejects(handler({}), (error) => error.code === 'resource-exhausted' && !error.soldOut)
  assert.equal(h.lines[0].outcome, 'sold_out')
  assert.equal(h.lines[0].code, 'resource-exhausted')
  assert.equal(h.lines[0].lookMs, 20)
})

test('inflight counts the checkouts the instance is serving', async () => {
  const h = harness()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const slow = withCheckoutLog(async () => { await gate; return { status: 201 } }, h.options)
  const fast = withCheckoutLog(async () => ({ status: 201 }), h.options)

  const first = slow({})
  await fast({})
  release()
  await first
  await fast({})
  assert.deepEqual(h.lines.map((line) => line.inflight), [1, 0, 0])
})

test('a failing log write never fails the checkout', async () => {
  const handler = withCheckoutLog(async () => ({ status: 201 }), { write: () => { throw new Error('stdout') } })
  assert.deepEqual(await handler({}), { status: 201 })
})

test('finish writes once', () => {
  const h = harness()
  const log = startCheckoutLog(h.options)
  log.finish({ status: 201 })
  log.finish(null, httpsError('internal'))
  assert.equal(h.lines.length, 1)
})
