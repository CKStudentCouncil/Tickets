const KEY_PREFIX = 'cksc_pending_checkout_'
const DEFINITE_REJECTIONS = new Set([
  'functions/invalid-argument', 'functions/permission-denied',
  'functions/unauthenticated', 'functions/failed-precondition',
  'functions/resource-exhausted', 'functions/not-found', 'functions/out-of-range'
])

function recoveryError(code, message) {
  return Object.assign(new Error(message), { code })
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonical(value[key])]))
  }
  return value
}

export function createCheckoutRecovery({ storage, createId, now = () => new Date().toISOString() }) {
  const keyFor = (uid) => {
    if (!uid) throw recoveryError('checkout/account-required', '請先登入後再送出訂單。')
    return `${KEY_PREFIX}${uid}`
  }

  function get(uid) {
    const key = keyFor(uid)
    try {
      const raw = storage.getItem(key)
      if (!raw) return null
      const pending = JSON.parse(raw)
      if (!pending?.requestId || !pending?.payload || typeof pending.payload !== 'object') {
        throw new Error('Invalid pending checkout')
      }
      return pending
    } catch {
      throw recoveryError('checkout/storage-unavailable', '無法讀取待確認的訂單，請允許網站儲存資料後再試。')
    }
  }

  function save(uid, pending) {
    try {
      storage.setItem(keyFor(uid), JSON.stringify(pending))
    } catch {
      throw recoveryError('checkout/storage-unavailable', '無法保存訂單確認資訊，請允許網站儲存資料後再試。')
    }
    return pending
  }

  function begin(uid, payload) {
    const normalized = canonical(payload)
    const previous = get(uid)
    if (previous) {
      if (JSON.stringify(canonical(previous.payload)) !== JSON.stringify(normalized)) {
        throw recoveryError('checkout/pending-unresolved', '上一筆訂單尚未確認，請先重試原訂單，再修改訂購資訊。')
      }
      return previous
    }
    return save(uid, { requestId: createId(), payload: normalized, createdAt: now(), uncertain: false })
  }

  function complete(uid, requestId) {
    if (get(uid)?.requestId === requestId) storage.removeItem(keyFor(uid))
  }

  function failed(uid, requestId, error) {
    const pending = get(uid)
    if (!pending || pending.requestId !== requestId) return
    // A rejection of a later attempt cannot prove that an earlier attempt
    // failed to commit. Keep its key until the server returns the order.
    if (error?.details?.checkoutRejected === true || (!pending.uncertain && DEFINITE_REJECTIONS.has(error?.code))) {
      complete(uid, requestId)
    } else {
      save(uid, { ...pending, uncertain: true })
    }
  }

  return { get, begin, complete, failed }
}

export async function submitRecoveredCheckout({ recovery, uid, payload, invoke, retryable, wait, attempts = 3 }) {
  const pending = recovery.begin(uid, payload)
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await invoke(pending.payload, pending.requestId)
      // A browser storage failure after a successful server response should
      // not hide that success; the retained key remains safe to replay.
      try { recovery.complete(uid, pending.requestId) } catch { /* safe replay */ }
      return result
    } catch (error) {
      recovery.failed(uid, pending.requestId, error)
      if (attempt >= attempts || !retryable.includes(error?.code)) throw error
      await wait(attempt)
    }
  }
}
