import nodemailer from 'nodemailer'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

// Must match the IAM policy condition: ses:FromAddress = *@tickets.cksc.tw
export const SENDER_EMAIL = 'no-reply@tickets.cksc.tw'
export const SENDER = `"建國中學班聯會" <${SENDER_EMAIL}>`

export const MAIL_SECRETS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION'
]

const DEFAULT_SES_REGION = 'us-east-1'

function createSesClient() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY

  return new SESv2Client({
    region: process.env.AWS_REGION || DEFAULT_SES_REGION,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {})
  })
}

// nodemailer >= 7 only accepts the SESv2 SDK: { sesClient, SendEmailCommand }.
// `sesClient` can be injected for tests.
export function createTransporter({ sesClient = createSesClient() } = {}) {
  return nodemailer.createTransport({
    SES: { sesClient, SendEmailCommand }
  })
}
