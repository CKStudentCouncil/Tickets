import { client, unwrap } from 'src/api'
import { parseDate } from 'src/utils/datetime'

// Single source of ticket configuration; also read by the checkout
export { ELIGIBLE_IDENTITIES } from 'src/data/ticketTypes'

export async function fetchTicketTypes() {
  const { types } = await unwrap(client.public['ticket-types'].$get())
  return Array.isArray(types) ? types.filter((type: any) => type?.id && type?.name) : []
}

// The list is public, so only the editor's uid is stored (PARTY-26)
export async function saveTicketTypes(types: Record<string, unknown>[], _updatedByUid?: string) {
  return unwrap(client.admin['ticket-types'].$put({ json: { types } }))
}

export function getTicketStatus(ticketType: any, now = new Date()) {
  const start = parseDate(ticketType.salesStartTime)
  const end = parseDate(ticketType.salesEndTime)

  if (!start || !end) {
    return { state: 'unavailable', label: '尚未開放', className: 'upcoming' }
  }

  if (now < start) {
    return { state: 'upcoming', label: '尚未開賣', className: 'upcoming' }
  }

  if (now > end) {
    return { state: 'ended', label: '已結束', className: 'ended' }
  }

  return { state: 'selling', label: '販售中', className: 'selling' }
}

export function getPurchaseLimit(ticketType: any) {
  return ticketType.unlimited ? null : Number(ticketType.purchaseLimitPerPerson) || null
}
