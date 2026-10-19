// Errors keep the codes the Firebase callables used, so the client's retry
// and checkout recovery rules (src/client/utils/checkoutRecovery.js) carry over.
export type ErrorCode =
  | 'invalid-argument'
  | 'failed-precondition'
  | 'permission-denied'
  | 'resource-exhausted'
  | 'unauthenticated'
  | 'not-found'
  | 'already-exists'
  | 'aborted'
  | 'unavailable'
  | 'internal'

const STATUS: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503> = {
  'invalid-argument': 400,
  'failed-precondition': 400,
  'permission-denied': 403,
  'resource-exhausted': 429,
  unauthenticated: 401,
  'not-found': 404,
  'already-exists': 409,
  aborted: 409,
  unavailable: 503,
  internal: 500
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
  }

  get status() {
    return STATUS[this.code]
  }

  toJSON() {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) }
  }
}
