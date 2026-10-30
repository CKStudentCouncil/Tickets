import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createRecipientFilters,
  describeRecipients,
  recipientFilterError,
  recipientFilterPayload
} from '../src/utils/notificationFilters.js'

test('the school chosen on the order list starts the filters', () => {
  assert.deepEqual(createRecipientFilters('all').schools, [])
  assert.deepEqual(createRecipientFilters('北一女中').schools, ['北一女中'])
})

test('settings hidden for a notice type are sent at their defaults', () => {
  const filters = { ...createRecipientFilters(), paid: 'paid', delivered: 'delivered', complimentary: 'only', schools: ['北一女中'] }
  assert.deepEqual(recipientFilterPayload(filters, 'payment'), {
    ...createRecipientFilters(), schools: ['北一女中']
  })
  const pickup = recipientFilterPayload(filters, 'pickup')
  assert.equal(pickup.paid, 'any')
  assert.equal(pickup.complimentary, 'only')
  assert.deepEqual(pickup.schools, [])
  const custom = recipientFilterPayload(filters, 'custom')
  assert.equal(custom.paid, 'paid')
  assert.equal(custom.delivered, 'delivered')
})

test('the summary names every filter that narrows the list', () => {
  assert.equal(describeRecipients(createRecipientFilters(), 'custom'), '全部學校')
  assert.equal(describeRecipients(createRecipientFilters(), 'payment'), '全部學校，尚未繳費')
  const filters = {
    ...createRecipientFilters(), schools: ['北一女中', '中山女高'], ticketTypeIds: ['early', 'gone'],
    paid: 'unpaid', complimentary: 'exclude', createdFrom: '2026-10-01', createdTo: '2026-10-20'
  }
  assert.equal(
    describeRecipients(filters, 'custom', { early: '早鳥票' }),
    '北一女中、中山女高，票種：早鳥票、gone，尚未繳費，不含公關票，2026-10-01 至 2026-10-20 訂購'
  )
  assert.equal(describeRecipients({ ...createRecipientFilters(), complimentary: 'only' }, 'pickup'), '公關票來賓，尚未領票')
  assert.equal(describeRecipients({ ...createRecipientFilters(), createdTo: '2026-10-20' }, 'custom'), '全部學校，2026-10-20（含）前訂購')
})

test('a date range that ends before it starts is refused', () => {
  assert.equal(recipientFilterError({ createdFrom: '2026-10-02', createdTo: '2026-10-01' }), '訂購日期的開始日不能晚於結束日')
  assert.equal(recipientFilterError({ createdFrom: '2026-10-01', createdTo: '2026-10-01' }), '')
})
