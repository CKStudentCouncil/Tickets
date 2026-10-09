import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrderMatcher, scanOrderSearchPage } from '../src/utils/orderSearch.js'

const order = {
  id: 'CKS202611050123', customerName: '王小明', customerEmail: 'Buyer@Example.com',
  customerPhone: '+886 (912) 345-678', school: '建國中學', class: '高一三班',
  number: 12, office: '教務處', deliveryUpdatedByName: '取票人員',
  paymentUpdatedByName: '收款人員', items: [{ name: '學生票' }]
}

test('searches order identifiers, customer details, school details and ticket names', () => {
  for (const search of [
    'cks202611', '小明', 'BUYER@example', '建國', '一三班', '12', '教務', '學生', '取票', '收款'
  ]) assert.equal(createOrderMatcher(search)(order), true, search)
  assert.equal(createOrderMatcher('其他學校')(order), false)
})

test('normalizes fullwidth text, case and phones containing punctuation or spaces', () => {
  for (const search of [
    '+886 (912) 345-678', '886912345678', '912345', '９１２３４５６７８',
    '912 345 678', '912.345.678', ' ＢＵＹＥＲ＠ＥＸＡＭＰＬＥ．ＣＯＭ '
  ]) assert.equal(createOrderMatcher(search)(order), true, search)
  assert.equal(createOrderMatcher('0912 345 678')({ customerPhone: '0912-345-678' }), true)
  assert.equal(createOrderMatcher('0912345678')({ customerPhone: '０９１２　３４５　６７８' }), true)
})

test('requires every term while allowing terms to match distinct order fields', () => {
  assert.equal(createOrderMatcher('王小明 建國 學生票')(order), true)
  assert.equal(createOrderMatcher('王小明 912-345 教務')(order), true)
  assert.equal(createOrderMatcher('王小明 其他學校')(order), false)
  assert.equal(createOrderMatcher('abcdef')({ customerName: 'abc', school: 'def' }), false)
})

test('phone-only terms require contiguous digits in their original order', () => {
  const phoneOrder = { customerPhone: '0912-345-678' }
  for (const search of ['912 345', '345 678', '912.345.678', '０９１２　３４５　６７８']) {
    assert.equal(createOrderMatcher(search)(phoneOrder), true, search)
  }
  for (const search of ['345 912', '912 678', '345 678 912', '0912 678']) {
    assert.equal(createOrderMatcher(search)(phoneOrder), false, search)
  }
})

test('numeric terms can match class and seat without matching separate phone segments', () => {
  const classOrder = { customerPhone: '0912-345-678', class: '305', number: 12 }
  assert.equal(createOrderMatcher('305 12')(classOrder), true)
  assert.equal(createOrderMatcher('12 305')(classOrder), true)
  assert.equal(createOrderMatcher('305 345')(classOrder), false)
  assert.equal(createOrderMatcher('12 678')(classOrder), false)
  assert.equal(createOrderMatcher('345 912')({ office: '345 912', customerPhone: '0912345678' }), true)
  assert.equal(createOrderMatcher('王小明 912-345')(order), true)
})

test('handles missing legacy fields and numeric values; blank search matches all', () => {
  assert.equal(createOrderMatcher('missing')({}), false)
  assert.equal(createOrderMatcher('missing')({ items: [null, {}] }), false)
  assert.equal(createOrderMatcher('12')({ number: 12 }), true)
  assert.equal(createOrderMatcher('123456')({ customerPhone: 123456 }), true)
  assert.equal(createOrderMatcher(' \t　 ')(null), true)
})

function dataset(size, matching = () => true) {
  const entries = Array.from({ length: size }, (_, index) => ({
    order: { id: `order-${index}`, customerName: matching(index) ? 'match' : 'other' },
    cursor: index
  }))
  const calls = []
  return {
    entries, calls,
    fetchBatch: async (cursor, batchSize) => {
      calls.push({ cursor, batchSize })
      const start = cursor === null ? 0 : cursor + 1
      return entries.slice(start, start + batchSize)
    }
  }
}

test('finds sparse results beyond the first 250 documents using bounded batches', async () => {
  const data = dataset(620, (index) => index >= 510 && index % 20 === 0)
  const result = await scanOrderSearchPage({ searchText: 'match', fetchBatch: data.fetchBatch })
  assert.deepEqual(result.orders.map((item) => item.id), [
    'order-520', 'order-540', 'order-560', 'order-580', 'order-600'
  ])
  assert.equal(result.cursor, 600)
  assert.equal(result.hasNext, false)
  assert.deepEqual(data.calls, [
    { cursor: null, batchSize: 250 }, { cursor: 249, batchSize: 250 }, { cursor: 499, batchSize: 250 }
  ])
})

test('stops at a matching lookahead and pages without skipped or duplicated results', async () => {
  const data = dataset(920, (index) => index % 3 === 0)
  const first = await scanOrderSearchPage({ searchText: 'match', fetchBatch: data.fetchBatch })
  assert.equal(first.orders.length, 50)
  assert.equal(first.hasNext, true)
  assert.equal(first.cursor, 147)
  assert.equal(data.calls.length, 1)

  const found = [...first.orders]
  let previous = first
  while (previous.hasNext) {
    previous = await scanOrderSearchPage({
      searchText: 'match', fetchBatch: data.fetchBatch, cursor: previous.cursor
    })
    found.push(...previous.orders)
  }
  assert.deepEqual(found.map((item) => item.id), data.entries
    .filter((entry) => entry.order.customerName === 'match').map((entry) => entry.order.id))
  assert.equal(new Set(found.map((item) => item.id)).size, found.length)
  assert.equal(previous.hasNext, false)
  assert.ok(data.calls.every((call) => call.batchSize === 250))
})

test('exactly one full matching page has no next page after all documents are scanned', async () => {
  const data = dataset(600, (index) => index < 50)
  const result = await scanOrderSearchPage({ searchText: 'match', fetchBatch: data.fetchBatch })
  assert.equal(result.orders.length, 50)
  assert.equal(result.cursor, 49)
  assert.equal(result.hasNext, false)
  assert.equal(data.calls.length, 3)
})

test('exhausts empty results and a full final batch without inventing a next page', async () => {
  const data = dataset(500, () => false)
  const result = await scanOrderSearchPage({ searchText: 'match', fetchBatch: data.fetchBatch })
  assert.deepEqual(result, { orders: [], cursor: null, hasNext: false })
  assert.equal(data.calls.length, 3)

  const empty = dataset(0)
  assert.deepEqual(await scanOrderSearchPage({ searchText: 'match', fetchBatch: empty.fetchBatch }), result)
})

test('blank searches match all with configurable page and batch sizes and a zero cursor', async () => {
  const data = dataset(3)
  const first = await scanOrderSearchPage({
    searchText: ' ', fetchBatch: data.fetchBatch, pageSize: 1, batchSize: 2
  })
  assert.equal(first.cursor, 0)
  assert.equal(first.hasNext, true)
  const next = await scanOrderSearchPage({
    searchText: '', fetchBatch: data.fetchBatch, cursor: first.cursor, pageSize: 2, batchSize: 2
  })
  assert.deepEqual(next.orders.map((item) => item.id), ['order-1', 'order-2'])
  assert.equal(next.hasNext, false)
})

test('a cancelled search performs no reads and stops after an in-flight batch', async () => {
  const before = new AbortController()
  before.abort()
  let calls = 0
  await assert.rejects(scanOrderSearchPage({
    searchText: 'match', signal: before.signal,
    fetchBatch: async () => { calls += 1; return [] }
  }), { name: 'AbortError' })
  assert.equal(calls, 0)

  const during = new AbortController()
  await assert.rejects(scanOrderSearchPage({
    searchText: 'match', signal: during.signal, batchSize: 1,
    fetchBatch: async () => {
      calls += 1
      during.abort()
      return [{ order: { id: 'match' }, cursor: 0 }]
    }
  }), { name: 'AbortError' })
  assert.equal(calls, 1)
})

test('propagates failed reads without returning partial results', async () => {
  const failure = new Error('offline')
  let calls = 0
  await assert.rejects(scanOrderSearchPage({
    searchText: 'match', batchSize: 1,
    fetchBatch: async () => {
      if (++calls === 2) throw failure
      return [{ order: { id: 'match' }, cursor: 0 }]
    }
  }), (error) => error === failure)
  assert.equal(calls, 2)
})

test('rejects invalid sizes before reading', async () => {
  for (const sizes of [{ pageSize: 0 }, { batchSize: -1 }, { pageSize: 1.5 }]) {
    await assert.rejects(scanOrderSearchPage({
      ...sizes, fetchBatch: async () => { assert.fail('must not read') }
    }), RangeError)
  }
})
