import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { parseDate } from 'src/utils/datetime'

// Single source of ticket configuration; also read by functions/lib/orders.js
const ticketTypesRef = () => doc(db, 'settings', 'ticketTypes')

export { ELIGIBLE_IDENTITIES } from 'src/data/ticketTypes'

export async function fetchTicketTypes() {
  const snapshot = await getDoc(ticketTypesRef())
  const types = snapshot.exists() ? snapshot.data().types : null

  return Array.isArray(types) ? types.filter((type) => type?.id && type?.name) : []
}

// The document is public, so only the editor's uid is stored, never a
// name or email (PARTY-26). setDoc replaces the old `updatedBy` field.
export function saveTicketTypes(types, updatedByUid) {
  return setDoc(ticketTypesRef(), { types, updatedAt: new Date(), updatedByUid })
}

export function getTicketStatus(ticketType, now = new Date()) {
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

export function getPurchaseLimit(ticketType) {
  return ticketType.unlimited ? null : Number(ticketType.purchaseLimitPerPerson) || null
}
