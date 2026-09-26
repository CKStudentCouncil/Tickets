// Buyers check out without an account. The order id plus the access token
// returned by createOrder are kept in this browser and act as the proof of
// ownership when reading the order back through the getOrders function.
const ORDERS_KEY = 'cksc_guest_orders'

export function getGuestOrders() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.id && entry?.token) : []
  } catch {
    return []
  }
}

function saveGuestOrders(entries) {
  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(entries))
  } catch {
    // storage unavailable (private mode); the order still exists server-side
  }
}

export function addGuestOrder(id, token) {
  saveGuestOrders([{ id, token }, ...getGuestOrders().filter((entry) => entry.id !== id)])
}

export function removeGuestOrder(id) {
  saveGuestOrders(getGuestOrders().filter((entry) => entry.id !== id))
}

export function hasGuestOrder(id) {
  return getGuestOrders().some((entry) => entry.id === id)
}
