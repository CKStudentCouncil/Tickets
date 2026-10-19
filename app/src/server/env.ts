// Bindings and settings of the Worker (wrangler.jsonc). Secrets are set with
// `wrangler secret put`; see DEPLOY.md.
export interface Env {
  DB: D1Database
  MEDIA: R2Bucket
  MAIL_QUEUE: Queue<MailMessage>
  ASSETS: Fetcher
  ORDER_LIMITER?: RateLimit

  SITE_URL: string
  // Comma-separated hostnames whose Turnstile tokens checkout accepts
  TURNSTILE_HOSTNAMES: string
  ENFORCE_TURNSTILE: string
  SES_RECIPIENTS_PER_SECOND: string
  AWS_REGION?: string

  BETTER_AUTH_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  AWS_ACCESS_KEY_ID?: string
  AWS_SECRET_ACCESS_KEY?: string
  TURNSTILE_SECRET?: string
}

// One mail job to send; the job itself lives in the mail_jobs table
export interface MailMessage {
  jobId: string
}

export const flag = (value: string | undefined) => value === 'true'
