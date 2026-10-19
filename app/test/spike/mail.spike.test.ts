// the package's browser build (picked by Vite) has no toBuffer; the server build runs on nodejs_compat
import QRCode from 'qrcode/lib/server.js'
import { AwsClient } from 'aws4fetch'
import { createMimeMessage } from 'mimetext'
import hero from './assets/hero-terrain.png?inline'
import { expect, it } from 'vitest'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

async function ticketQr() {
  // same options as functions/lib/mailQueue.js
  return QRCode.toBuffer('https://tickets.cksc.tw/admin/orders/CKS20261105K7Q2MX?c=abc', {
    width: 300, margin: 2, color: { dark: '#1d1d1f', light: '#ffffff' }, errorCorrectionLevel: 'H', type: 'png'
  })
}

it('renders the ticket QR as a PNG inside workerd', async () => {
  const png = await ticketQr()
  expect([...png.subarray(0, 4)]).toEqual(PNG_MAGIC)
  expect(png.length).toBeGreaterThan(1000)
})

it('bundles the email hero image', () => {
  expect(hero.startsWith('data:image/png;base64,')).toBe(true)
  expect([...fromBase64(hero.split(',')[1]).subarray(0, 4)]).toEqual(PNG_MAGIC)
})

it('builds a raw MIME message and signs an SES v2 SendEmail request', async () => {
  const msg = createMimeMessage()
  msg.setSender({ name: '建國中學班聯會', addr: 'no-reply@tickets.cksc.tw' })
  msg.setRecipient('buyer@example.com')
  msg.setSubject('建中舞會購票系統購票成功 - 票券編號：CKS20261105K7Q2MX')
  msg.addMessage({ contentType: 'text/html', data: '<img src="cid:qrcode"><img src="cid:hero-terrain">' })
  msg.addAttachment({ inline: true, filename: 'ticket-qrcode.png', contentType: 'image/png',
    data: toBase64(await ticketQr()), headers: { 'Content-ID': '<qrcode>' } })
  msg.addAttachment({ inline: true, filename: 'cosmos-horizon.png', contentType: 'image/png',
    data: hero.split(',')[1], headers: { 'Content-ID': '<hero-terrain>' } })
  const raw = msg.asRaw()

  expect(raw).toMatch(/Content-ID: <qrcode>/)
  expect(raw).toMatch(/Content-ID: <hero-terrain>/)
  expect(raw).toMatch(/Content-Disposition: inline/)
  expect(raw).toMatch(/Subject: =\?utf-8\?B\?/i)

  const aws = new AwsClient({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', region: 'us-east-1', service: 'ses', retries: 0 })
  const rawBytes = new TextEncoder().encode(raw)
  const request = await aws.sign('https://email.us-east-1.amazonaws.com/v2/email/outbound-emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ Content: { Raw: { Data: toBase64Chunked(rawBytes) } } })
  })

  expect(request.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/ses\/aws4_request/)
  const body = (await request.json()) as { Content: { Raw: { Data: string } } }
  expect(new TextDecoder().decode(fromBase64(body.Content.Raw.Data))).toBe(raw)
})

// btoa over a spread argument list overflows the stack for large messages
function toBase64Chunked(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
