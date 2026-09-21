import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { USE_MOCK_ORDERS } from 'src/config/app'
import { DEFAULT_TICKET_TYPES } from 'src/data/ticketTypes'

const MOCK_TICKET_TYPES_KEY = 'cksc_mock_ticket_types'

function normalizeTicketType(ticketType) {
  return {
    ...ticketType,
    salesStartTime: ticketType.salesStartTime || null,
    salesEndTime: ticketType.salesEndTime || null,
    totalTicketQuantity: Number(ticketType.totalTicketQuantity || 0),
    purchaseLimitPerPerson:
      ticketType.purchaseLimitPerPerson === null || ticketType.purchaseLimitPerPerson === undefined
        ? null
        : Number(ticketType.purchaseLimitPerPerson)
  }
}

function loadMockTicketTypes() {
  try {
    const raw = localStorage.getItem(MOCK_TICKET_TYPES_KEY)
    if (!raw) return DEFAULT_TICKET_TYPES.map(normalizeTicketType)
    const parsed = JSON.parse(raw)
    return parsed.map(normalizeTicketType)
  } catch {
    return DEFAULT_TICKET_TYPES.map(normalizeTicketType)
  }
}

function saveMockTicketTypes(ticketTypes) {
  localStorage.setItem(MOCK_TICKET_TYPES_KEY, JSON.stringify(ticketTypes))
}

export async function fetchTicketTypes() {
  if (USE_MOCK_ORDERS) {
    return loadMockTicketTypes()
  }

  const snapshot = await getDocs(collection(db, 'ticketTypes'))
  if (snapshot.empty) return DEFAULT_TICKET_TYPES.map(normalizeTicketType)

  const map = new Map(snapshot.docs.map((ticketDoc) => [ticketDoc.id, normalizeTicketType({ id: ticketDoc.id, ...ticketDoc.data() })]))

  return DEFAULT_TICKET_TYPES.map((ticketType) =>
    map.get(ticketType.id) || normalizeTicketType(ticketType)
  )
}

export async function updateTicketTypes(ticketTypes) {
  const normalized = ticketTypes.map(normalizeTicketType)

  if (USE_MOCK_ORDERS) {
    saveMockTicketTypes(normalized)
    return normalized
  }

  await Promise.all(
    normalized.map((ticketType) =>
      setDoc(
        doc(db, 'ticketTypes', ticketType.id),
        ticketType,
        { merge: true }
      )
    )
  )

  return normalized
}
