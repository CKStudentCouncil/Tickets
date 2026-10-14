const ACTIVE_STATUSES = new Set(['queued', 'sending', 'partial'])

export function shouldPollNotification(job) {
  // An uncertain/failed batch does not stop the worker's remaining batches.
  return !!job && (Number(job.pendingCount) > 0 || ACTIVE_STATUSES.has(job.status))
}

export function needsNotificationEnqueue(job) {
  if (!job) return false
  if (typeof job.pendingEnqueueCount === 'number') return job.pendingEnqueueCount > 0
  // Older saved progress may lack the server counter. An interrupted enqueue
  // can be safely resumed with the same immutable campaign ID.
  return job.status === 'ready' || job.enqueueUnconfirmed === true
}

export function canClearNotification(job) {
  return !!job && ['done', 'failed', 'uncertain'].includes(job.status)
    && !shouldPollNotification(job) && !needsNotificationEnqueue(job)
}
