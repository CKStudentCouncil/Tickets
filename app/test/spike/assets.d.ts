declare module '*.png?inline' { const dataUrl: string; export default dataUrl }
declare module 'qrcode/lib/server.js' {
  const QRCode: { toBuffer(text: string, options?: Record<string, unknown>): Promise<Uint8Array & { subarray(start: number, end?: number): Uint8Array }> }
  export default QRCode
}
