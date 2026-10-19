// Sending through Amazon SES v2 (SendEmail with raw MIME content), signed with
// SigV4 by aws4fetch. Replaces nodemailer + the AWS SDK, which need Node.
import { AwsClient } from 'aws4fetch'
import { createMimeMessage } from 'mimetext'
import type { Env } from '../env'

// Must match the IAM policy condition: ses:FromAddress = *@tickets.cksc.tw
export const SENDER_EMAIL = 'no-reply@tickets.cksc.tw'
export const SENDER_NAME = '建國中學班聯會'
const DEFAULT_SES_REGION = 'us-east-1'

export interface Attachment {
  filename: string
  contentType: string
  base64: string
  cid: string
}

export interface MailMessage {
  to: string
  bcc?: string[]
  subject: string
  html: string
  attachments: Attachment[]
}

// An HTTP failure from SES; `status` decides whether a retry is safe
export class SesError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function buildMime(message: MailMessage) {
  const mime = createMimeMessage()
  mime.setSender({ name: SENDER_NAME, addr: SENDER_EMAIL })
  mime.setRecipient(message.to)
  mime.setSubject(message.subject)
  mime.addMessage({ contentType: 'text/html', data: message.html })
  for (const attachment of message.attachments) {
    mime.addAttachment({
      inline: true,
      filename: attachment.filename,
      contentType: attachment.contentType,
      data: attachment.base64,
      headers: { 'Content-ID': `<${attachment.cid}>` }
    })
  }
  return mime.asRaw()
}

export type Send = (message: MailMessage) => Promise<{ providerMessageId: string }>

// BCC recipients go only in the request's Destination, never in the raw
// message headers, so no buyer sees the others' addresses.
export function sesSender(env: Env, fetchImpl: typeof fetch = fetch): Send {
  return async (message) => {
    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      throw new SesError(400, 'SES credentials are not configured (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)')
    }
    const region = env.AWS_REGION || DEFAULT_SES_REGION
    // Retrying a request whose response was lost can send the same message
    // twice; the queue decides on retries, never the client.
    const aws = new AwsClient({ accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, region, service: 'ses', retries: 0 })
    const raw = new TextEncoder().encode(buildMime(message))
    const request = await aws.sign(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        FromEmailAddress: `${SENDER_NAME} <${SENDER_EMAIL}>`,
        Destination: { ToAddresses: [message.to], ...(message.bcc?.length ? { BccAddresses: message.bcc } : {}) },
        Content: { Raw: { Data: toBase64(raw) } }
      })
    })
    const response = await fetchImpl(request)
    const text = await response.text()
    if (!response.ok) throw new SesError(response.status, `SES ${response.status}: ${text.slice(0, 300)}`)
    let body: { MessageId?: string } = {}
    try { body = JSON.parse(text) } catch { /* no id: uncertain */ }
    return { providerMessageId: String(body.MessageId || '') }
  }
}
