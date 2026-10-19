declare module 'qrcode/lib/server.js' {
  import type { QRCodeToBufferOptions } from 'qrcode'
  const QRCode: { toBuffer(text: string, options?: QRCodeToBufferOptions): Promise<Uint8Array> }
  export default QRCode
}
