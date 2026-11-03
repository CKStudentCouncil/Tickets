// Sender settings, apart from mailer.js so that the functions which only
// queue mail (createOrder among them) do not load nodemailer and the AWS SDK.

// Must match the IAM policy condition: ses:FromAddress = *@tickets.cksc.tw
export const SENDER_EMAIL = 'no-reply@tickets.cksc.tw'
export const SENDER = `"建國中學班聯會" <${SENDER_EMAIL}>`

export const MAIL_SECRETS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION'
]
