import nodemailer from 'nodemailer'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

export { SENDER_EMAIL, SENDER, MAIL_SECRETS } from './mailSender.js'

const DEFAULT_SES_REGION = 'us-east-1'

function createSesClient() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY

  return new SESv2Client({
    region: process.env.AWS_REGION || DEFAULT_SES_REGION,
    // Retrying a request whose response was lost can send the same message
    // twice. The durable queue retries only explicit provider rejections.
    maxAttempts: 1,
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
