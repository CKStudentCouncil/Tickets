// Same shape as ORDER_ID_PATTERN in src/server/domain/orderValidation.js
export const ORDER_ID_PATTERN = /^[A-Z]{1,4}\d{8}(\d{4}|[A-HJ-NP-Z2-9]{6})$/

// Reads a scanned ticket QR (made by getOrderQrUrl / the confirmation email)
// back into the order id and its ticketCode. Only links to one of `origins`
// count, so an unrelated QR code never opens an admin page.
export function parseTicketQr(text, origins) {
  let url
  try {
    url = new URL(String(text || '').trim())
  } catch {
    return null
  }
  if (!origins.includes(url.origin)) return null

  const match = url.pathname.match(/^\/admin\/orders\/([^/]+)\/?$/)
  if (!match) return null

  let orderId
  try {
    orderId = decodeURIComponent(match[1])
  } catch {
    return null
  }
  if (!ORDER_ID_PATTERN.test(orderId)) return null

  return { orderId, ticketCode: url.searchParams.get('c') || '' }
}
