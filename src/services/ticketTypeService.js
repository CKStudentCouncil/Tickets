import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { parseDate } from 'src/utils/datetime'

// Single source of ticket configuration; also read by functions/lib/orders.js
const ticketTypesRef = () => doc(db, 'settings', 'ticketTypes')

export const ELIGIBLE_IDENTITIES = {
  CAMPUS_STUDENTS: 'campus_students',
  ALL_USERS: 'all_users'
}

export async function fetchTicketTypes() {
  const snapshot = await getDoc(ticketTypesRef())
  const types = snapshot.exists() ? snapshot.data().types : null

  return Array.isArray(types) ? types.filter((type) => type?.id && type?.name) : []
}

export function saveTicketTypes(types, updatedBy) {
  return setDoc(ticketTypesRef(), { types, updatedAt: new Date(), updatedBy })
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
