import QRCode from 'qrcode'
import { SITE_URL } from 'src/config/app'

// Same target as the QR code in the confirmation email: staff scan it at the
// door and land on the admin order view. `ticketCode` is the order's secret
// code, checked there so a QR made from a guessed order id is flagged.
export function getOrderQrUrl(orderId, ticketCode = '') {
  const url = `${SITE_URL}/admin/orders/${encodeURIComponent(orderId)}`
  return ticketCode ? `${url}?c=${encodeURIComponent(ticketCode)}` : url
}

export function renderOrderQr(canvas, order, size = 220) {
  return QRCode.toCanvas(canvas, getOrderQrUrl(order.id, order.ticketCode), {
    width: size,
    margin: size < 120 ? 1 : 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#050608', light: '#ffffff' }
  })
}
