// Recipient filters for bulk notices; the server checks the same rules in
// readRecipientFilters / matchesRecipientFilters (functions/lib/notifications.js).

// mirrors needsNotice in functions/lib/notifications.js
export const NOTIFY_AUDIENCE = { payment: '尚未繳費', pickup: '尚未領票', both: '尚未繳費或領票', custom: '' }

export const PAID_OPTIONS = [
  { value: 'any', label: '不限' },
  { value: 'unpaid', label: '尚未繳費' },
  { value: 'paid', label: '已繳費' }
]
export const DELIVERED_OPTIONS = [
  { value: 'any', label: '不限' },
  { value: 'undelivered', label: '尚未領票' },
  { value: 'delivered', label: '已領票' }
]
export const COMPLIMENTARY_OPTIONS = [
  { value: 'include', label: '包含公關票' },
  { value: 'exclude', label: '排除公關票' },
  { value: 'only', label: '只寄公關票' }
]

// Only custom notices choose payment / pickup status; the others pick it
// themselves (NOTIFY_AUDIENCE)
export const choosesStatus = (type) => type === 'custom'
// payment notices never go to 公關票 guests, who have nothing to pay
export const choosesComplimentary = (type) => type === 'pickup' || type === 'custom'

export function createRecipientFilters(school = 'all') {
  return {
    schools: school && school !== 'all' ? [school] : [],
    ticketTypeIds: [],
    paid: 'any',
    delivered: 'any',
    complimentary: 'include',
    createdFrom: '',
    createdTo: ''
  }
}

// What prepareOrderNotification receives: settings hidden for this type are
// left at their defaults, so a value from another type never narrows the list
export function recipientFilterPayload(filters, type) {
  const status = choosesStatus(type)
  const complimentary = choosesComplimentary(type) ? filters.complimentary : 'include'
  return {
    schools: complimentary === 'only' ? [] : [...filters.schools],
    ticketTypeIds: [...filters.ticketTypeIds],
    paid: status ? filters.paid : 'any',
    delivered: status ? filters.delivered : 'any',
    complimentary,
    createdFrom: filters.createdFrom,
    createdTo: filters.createdTo
  }
}

export function recipientFilterError(filters) {
  if (filters.createdFrom && filters.createdTo && filters.createdFrom > filters.createdTo) {
    return '訂購日期的開始日不能晚於結束日'
  }
  return ''
}

const labelOf = (options, value) => options.find((option) => option.value === value)?.label || ''

// One line naming who a notice goes to, e.g.
// "北一女中、中山女高，票種：早鳥票，尚未繳費，2026-10-01 至 2026-10-20 訂購"
export function describeRecipients(filters, type, ticketTypeNames = {}) {
  const payload = recipientFilterPayload(filters, type)
  const parts = []
  if (payload.complimentary === 'only') parts.push('公關票來賓')
  else parts.push(payload.schools.length ? payload.schools.join('、') : '全部學校')
  if (payload.ticketTypeIds.length) {
    parts.push(`票種：${payload.ticketTypeIds.map((id) => ticketTypeNames[id] || id).join('、')}`)
  }
  if (NOTIFY_AUDIENCE[type]) parts.push(NOTIFY_AUDIENCE[type])
  if (payload.paid !== 'any') parts.push(labelOf(PAID_OPTIONS, payload.paid))
  if (payload.delivered !== 'any') parts.push(labelOf(DELIVERED_OPTIONS, payload.delivered))
  if (payload.complimentary === 'exclude') parts.push('不含公關票')
  if (payload.createdFrom && payload.createdTo) parts.push(`${payload.createdFrom} 至 ${payload.createdTo} 訂購`)
  else if (payload.createdFrom) parts.push(`${payload.createdFrom} 起訂購`)
  else if (payload.createdTo) parts.push(`${payload.createdTo}（含）前訂購`)
  return parts.join('，')
}
