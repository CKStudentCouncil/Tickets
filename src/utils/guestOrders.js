const ORDER_IDS_KEY = 'cksc_guest_order_ids'

export function getGuestOrderIds() {
  try {
    const raw = localStorage.getItem(ORDER_IDS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function addGuestOrderId(orderId) {
  const ids = getGuestOrderIds()
  if (!ids.includes(orderId)) {
    localStorage.setItem(ORDER_IDS_KEY, JSON.stringify([orderId, ...ids]))
  }
}

export function removeGuestOrderId(orderId) {
  const ids = getGuestOrderIds().filter((id) => id !== orderId)
  localStorage.setItem(ORDER_IDS_KEY, JSON.stringify(ids))
}
