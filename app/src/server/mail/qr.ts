// The ticket QR attached to confirmation emails. The qrcode package's browser
// build (which bundlers pick) has no toBuffer; the server build runs on
// nodejs_compat.
import QRCode from 'qrcode/lib/server.js'
import { getAdminOrderUrl } from '../domain/constants.js'

export async function ticketQrPng(orderId: string, ticketCode: string): Promise<Uint8Array> {
  return QRCode.toBuffer(getAdminOrderUrl(orderId, ticketCode), {
    width: 300, margin: 2, color: { dark: '#1d1d1f', light: '#ffffff' },
    errorCorrectionLevel: 'H', type: 'png'
  })
}
