import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
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
  return setDoc(ticketTypesRef(), { types, updatedAt: serverTimestamp(), updatedByUid })
}

// { [ticketTypeId]: stock } of the types createOrder found sold out at that
// stock (functions/lib/orders.js); an entry for another stock is out of date
export async function fetchSoldOut() {
  const snapshot = await getDoc(doc(db, 'settings', 'ticketSoldOut'))
  return snapshot.data() || {}
}

// The home page's ticket types and sold-out list. The router asks for them
// while it waits for the sign-in state and the opening time
// (src/router/index.js), so the page doesn't start asking only after those.
// A prefetch is used once, and only while fresh.
const PREFETCH_TTL_MS = 30000
let prefetched = null

const fetchStorefront = () => Promise.all([fetchTicketTypes(), fetchSoldOut()])

export function prefetchStorefront() {
  if (prefetched && Date.now() - prefetched.at <= PREFETCH_TTL_MS) return
  const promise = fetchStorefront()
  promise.catch(() => {}) // reported by loadStorefront, if the page asks
  prefetched = { at: Date.now(), promise }
}

// [ticketTypes, soldOut]
export function loadStorefront() {
  const fresh = prefetched && Date.now() - prefetched.at <= PREFETCH_TTL_MS
  const promise = fresh ? prefetched.promise : fetchStorefront()
  prefetched = null
  return promise
}

// soldOut is what fetchSoldOut returned
export function getTicketStatus(ticketType, now = new Date(), soldOut = {}) {
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

  const stock = getStockLimit(ticketType)
  if (stock !== null && soldOut[ticketType.id] === stock) {
    return { state: 'soldOut', label: '售罄', className: 'ended' }
  }

  return { state: 'selling', label: '販售中', className: 'selling' }
}

// Hidden from the storefront until sales open, so the opening date isn't
// out before the announcement, unless the admin unticked 開賣前隱藏
// (hideUntilSale: false). A missing flag counts as hidden. Once sales have
// opened the type stays listed, also after they end; it just can't be bought.
export function isTicketTypeListed(ticketType, now = new Date()) {
  const { state } = getTicketStatus(ticketType, now)

  if (state !== 'upcoming' && state !== 'unavailable') return true

  return ticketType.hideUntilSale === false
}

// same as functions/lib/orderValidation.js: null when unlimited
export function getStockLimit(ticketType) {
  if (ticketType.unlimitedStock === true) return null
  const total = Number(ticketType.totalTicketQuantity)
  return Number.isInteger(total) && total > 0 ? total : 0
}

export function getPurchaseLimit(ticketType) {
  return ticketType.unlimited ? null : Number(ticketType.purchaseLimitPerPerson) || null
}
