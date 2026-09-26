import QRCode from 'qrcode'
import { SITE_URL } from 'src/config/app'

// Same target as the QR code in the confirmation email: staff scan it at the
// door and land on the admin order view.
export function getOrderQrUrl(orderId) {
  return `${SITE_URL}/admin/orders/${encodeURIComponent(orderId)}`
}

export function renderOrderQr(canvas, orderId, size = 220) {
  return QRCode.toCanvas(canvas, getOrderQrUrl(orderId), {
    width: size,
    margin: size < 120 ? 1 : 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#050608', light: '#ffffff' }
  })
}
