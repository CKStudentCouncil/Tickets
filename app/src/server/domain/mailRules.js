// Pure rules of the mail queue, ported from functions/lib/mailQueueCore.js.

export const MAIL_MAX_ATTEMPTS = 5
export const MAIL_LEASE_MS = 180_000
export const MAIL_SEND_TIMEOUT_MS = 20_000
// The site's one shared inbox gets every notification; buyers are in BCC
export const NOTIFY_TO = 'ckhssc@gl.ck.tp.edu.tw'
export const MAX_BCC_PER_BATCH = 49

export function batchDelayMs(recipientCount, recipientsPerSecond) {
  return Math.ceil((recipientCount / Math.max(1, recipientsPerSecond)) * 1000)
}

// Wait before retrying an explicit rejection: 1, 2, 4, 8 minutes
export function retryDelayMs(attempts) {
  return 60_000 * 2 ** (attempts - 1)
}

// Only an explicit provider rejection is safe to retry. A socket timeout,
// aborted request, lost response, or unknown error may follow acceptance.
// A generic server error or request timeout does not establish whether SES
// accepted before failing. Explicit client-side rejects/throttles do.
export function isExplicitMailRejection(error) {
  const status = Number(error?.status)
  return status >= 400 && status < 500 && status !== 408
}

export function notificationProgress(jobId, total, batches) {
  const count = (status) => batches.filter((batch) => batch.status === status)
    .reduce((sum, batch) => sum + batch.buyerCount, 0)
  const acceptedCount = count('accepted')
  const failedCount = count('failed') + count('skipped')
  const uncertainCount = count('uncertain')
  const pendingCount = Math.max(0, total - acceptedCount - failedCount - uncertainCount)
  const pendingEnqueueCount = Math.max(0, total - batches.reduce((sum, batch) => sum + batch.buyerCount, 0))
  const status = uncertainCount ? 'uncertain'
    : pendingCount ? (acceptedCount ? 'partial' : batches.some((b) => b.status === 'sending') ? 'sending' : 'queued')
      : failedCount ? 'failed' : 'done'
  return { jobId, status, sentCount: acceptedCount, acceptedCount, total, failedCount, uncertainCount, pendingCount, pendingEnqueueCount }
}

const NOTIFY_SUBJECTS = {
  payment: '【建中舞會購票系統】繳費通知', pickup: '【建中舞會購票系統】取票通知',
  both: '【建中舞會購票系統】繳費暨取票通知', custom: '【建中舞會購票系統】通知'
}
export const NOTIFY_TYPES = Object.keys(NOTIFY_SUBJECTS)

export function resolveSubject(type, subject) {
  return type === 'custom' && subject ? subject : NOTIFY_SUBJECTS[type]
}
