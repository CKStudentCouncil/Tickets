import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateProfit, groupByReimburser, summarizeReimbursements } from '../src/utils/reimbursements.js'

const claims = [
  { name: '林小明', amount: 1200, status: 'pending' },
  { name: '林小明', amount: 800, status: 'approved' },
  { name: '陳大華', amount: 3000, status: 'paid' },
  { name: '陳大華', amount: 500, status: 'rejected' },
  { name: ' 王同學 ', amount: 450, status: 'approved' }
]

test('totals each status; approved and paid are spent, approved is still owed', () => {
  const { amounts, counts, spent, owed } = summarizeReimbursements(claims)
  assert.deepEqual(amounts, { pending: 1200, approved: 1250, paid: 3000, rejected: 500 })
  assert.deepEqual(counts, { pending: 1, approved: 2, paid: 1, rejected: 1 })
  assert.equal(spent, 4250)
  assert.equal(owed, 1250)
})

test('ignores unknown statuses and bad amounts', () => {
  const { amounts, spent } = summarizeReimbursements([
    { amount: 999, status: 'deleted' },
    { amount: 'abc', status: 'approved' },
    null
  ])
  assert.deepEqual(amounts, { pending: 0, approved: 0, paid: 0, rejected: 0 })
  assert.equal(spent, 0)
})

test('profit now counts money collected and claims approved; projected everything but rejected', () => {
  const result = calculateProfit({
    orderSummary: { bookedAmount: 100000, paidAmount: 70000 },
    registrations: [
      { price: 500, quantity: 10, paid: true },
      { price: 500, quantity: 4, paid: false }
    ],
    claims
  })

  assert.deepEqual(result.orders, { realized: 70000, projected: 100000 })
  assert.deepEqual(result.sellers, { realized: 5000, projected: 7000 })
  assert.deepEqual(result.income, { realized: 75000, projected: 107000 })
  assert.deepEqual(result.expenses, { realized: 4250, projected: 5450 })
  assert.deepEqual(result.profit, { realized: 70750, projected: 101550 })
})

test('a loss is a negative profit, and missing data counts as nothing', () => {
  const result = calculateProfit({ claims: [{ name: 'A', amount: 2000, status: 'paid' }] })
  assert.deepEqual(result.income, { realized: 0, projected: 0 })
  assert.deepEqual(result.profit, { realized: -2000, projected: -2000 })
  assert.deepEqual(calculateProfit().profit, { realized: 0, projected: 0 })
})

test('groups by the name typed on the claim, most claimed first', () => {
  assert.deepEqual(groupByReimburser(claims), [
    { name: '陳大華', claims: 2, pending: 0, owed: 0, paid: 3000 },
    { name: '林小明', claims: 2, pending: 1200, owed: 800, paid: 0 },
    { name: '王同學', claims: 1, pending: 0, owed: 450, paid: 0 }
  ])
})
