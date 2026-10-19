// Orders: the buyer's checkout and orders, and the staff tools (API routes in
// src/server/routes/orders.ts and admin-orders.ts).
import { client, unwrap } from 'src/api'
import { useAuthStore } from 'src/stores/auth'
import { createCheckoutRecovery, submitRecoveredCheckout } from 'src/utils/checkoutRecovery'
import { scanOrderSearchPage } from 'src/utils/orderSearch'

// Errors where the order may or may not have been saved, or the server was
// just too busy; retrying with the same requestId is safe (the server returns
// the order that was already created instead of creating a second one).
const RETRYABLE = ['functions/aborted', 'functions/unavailable', 'functions/deadline-exceeded', 'functions/internal']

function createRequestId() {
  return crypto.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const currentUid = () => (useAuthStore().user as { uid?: string } | null)?.uid

/* ---------- buyers ---------- */

function checkoutRecovery() {
  let storage
  try { storage = window.localStorage } catch {
    throw Object.assign(new Error('無法保存訂單確認資訊，請允許網站儲存資料後再試。'), { code: 'checkout/storage-unavailable' })
  }
  return createCheckoutRecovery({ storage, createId: createRequestId })
}

export function getPendingCheckout(uid = currentUid()) {
  return uid ? checkoutRecovery().get(uid) : null
}

// The server takes the email and uid from the session. Persist before
// sending so a lost response can be retried after another click, navigation
// or reload. The Turnstile token is not persisted: it is single-use, and the
// server remembers per requestId that a checkout already passed.
export function submitOrder(orderPayload: unknown, { uid = currentUid(), turnstileToken = '' } = {}) {
  return submitRecoveredCheckout({
    recovery: checkoutRecovery(), uid, payload: orderPayload, retryable: RETRYABLE,
    invoke: async (payload: unknown, requestId: string) => {
      if (currentUid() !== uid) {
        throw Object.assign(new Error('登入帳號已變更，請改回原訂購帳號確認訂單。'), { code: 'checkout/account-changed' })
      }
      return unwrap(client.orders.$post({ json: { orderPayload: payload, requestId, turnstileToken } }))
    },
    wait: (attempt: number) => wait(500 * attempt + Math.random() * 1000)
  })
}

export async function fetchMyOrders(_uid?: string) {
  return (await unwrap(client.orders.$get())).orders
}

// One order: buyers get only their own, staff any. A missing order and
// someone else's order both come back as null.
export async function fetchOrder(orderId: string) {
  if (!orderId) return null
  try {
    return (await unwrap(client.orders[':id'].$get({ param: { id: orderId } }))).order
  } catch (error: any) {
    if (['functions/not-found', 'functions/permission-denied'].includes(error?.code)) return null
    throw error
  }
}

/* ---------- staff ---------- */

export const ORDER_PAGE_SIZE = 50
// How often the dashboard re-reads the page it shows
const POLL_MS = 10_000

type Filters = { school?: string; emailStatus?: string; delivered?: boolean; paid?: boolean }

function filterQuery({ school = 'all', emailStatus = 'all', delivered, paid }: Filters = {}) {
  return {
    school, emailStatus,
    ...(typeof delivered === 'boolean' ? { delivered: String(delivered) as 'true' | 'false' } : {}),
    ...(typeof paid === 'boolean' ? { paid: String(paid) as 'true' | 'false' } : {})
  }
}

function fetchPage(filters: Filters, cursor: string | null, limit: number) {
  return unwrap(client.admin.orders.$get({
    query: { ...filterQuery(filters), ...(cursor ? { cursor } : {}), limit: String(limit) } as never
  }))
}

// One bounded page, refreshed every few seconds and when the tab comes back
// into view (the Firestore version was a live listener).
export function subscribeOrderPage({ filters, cursor, onData, onError }: {
  filters: Filters
  cursor: string | null
  onData: (page: { orders: unknown[]; cursor: string | null; hasNext: boolean; fromCache: boolean }) => void
  onError: (error: unknown) => void
}) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const load = async () => {
    clearTimeout(timer)
    try {
      const page = await fetchPage(filters, cursor, ORDER_PAGE_SIZE)
      if (!stopped) onData({ ...page, fromCache: false })
    } catch (error) {
      if (!stopped) onError(error)
    } finally {
      if (!stopped) timer = setTimeout(load, POLL_MS)
    }
  }
  const onVisible = () => { if (document.visibilityState === 'visible') load() }
  document.addEventListener('visibilitychange', onVisible)
  load()
  return () => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

// Search every filtered order, scanning bounded batches until a full page of
// matches (plus one lookahead) is found.
export function fetchOrderSearchPage({ filters = {}, searchText, cursor = null, signal }: {
  filters?: Filters; searchText: string; cursor?: string | null; signal?: AbortSignal
}) {
  return scanOrderSearchPage({
    searchText, cursor: cursor as never, signal, pageSize: ORDER_PAGE_SIZE,
    fetchBatch: async (batchCursor: string | null, batchSize: number) => {
      const page = await fetchPage(filters, batchCursor, batchSize)
      return page.orders.map((order: any) => ({ order, cursor: `${Date.parse(order.createdAt)}_${order.id}` }))
    }
  })
}

// Export reads the full filtered list in bounded requests
export async function fetchAllOrders(filters: Filters = {}) {
  const orders: unknown[] = []
  let cursor: string | null = null
  for (;;) {
    const page: { orders: unknown[]; cursor: string | null; hasNext: boolean } = await fetchPage(filters, cursor, 250)
    orders.push(...page.orders)
    if (!page.hasNext) return orders
    cursor = page.cursor
  }
}

export function fetchOrderSummary(filters: Filters = {}) {
  return unwrap(client.admin.orders.summary.$get({ query: filterQuery(filters) as never }))
}

function normalizeMetadata(data: Record<string, any>) {
  const result = { ...data }
  for (const key of ['deliveryUpdatedAt', 'paymentUpdatedAt']) {
    if (typeof result[key] === 'string') result[key] = new Date(result[key])
  }
  return result
}

async function statusCall(request: Promise<any>) {
  try {
    return normalizeMetadata((await unwrap(request)) as Record<string, any>)
  } catch (error: any) {
    if (error?.details && typeof error.details === 'object') {
      Object.defineProperty(error, 'details', { value: normalizeMetadata(error.details) })
    }
    throw error
  }
}

export function updateOrderDelivery(orderId: string, delivered: boolean, { ticketCode = '', expectedDelivered, overrideReason = '' }: { ticketCode?: string; expectedDelivered: boolean; overrideReason?: string }) {
  return statusCall(client.admin.orders[':id'].delivery.$post({
    param: { id: orderId }, json: { delivered, expectedDelivered, ticketCode, overrideReason }
  }))
}

export function updateOrderPayment(orderId: string, paid: boolean, expectedPaid: boolean) {
  return statusCall(client.admin.orders[':id'].payment.$post({ param: { id: orderId }, json: { paid, expectedPaid } }))
}

export function resendOrderEmail(orderId: string, requestId = createRequestId()) {
  return unwrap(client.admin.orders[':id'].resend.$post({ param: { id: orderId }, json: { requestId } }))
}

export function deleteOrder(orderId: string) {
  return unwrap(client.admin.orders[':id'].$delete({ param: { id: orderId } }))
}
