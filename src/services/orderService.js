import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  orderBy,
  documentId,
  onSnapshot,
  limit,
  startAfter,
  getAggregateFromServer,
  count,
  sum,
  query,
  where
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { auth, db, functions } from 'src/boot/firebase'
import { createCheckoutRecovery, submitRecoveredCheckout } from 'src/utils/checkoutRecovery'
import { parseDate } from 'src/utils/datetime'

const createOrderCallable = httpsCallable(functions, 'createOrder')
const resendOrderEmailCallable = httpsCallable(functions, 'resendOrderEmail')
const deliveryCallable = httpsCallable(functions, 'updateOrderDelivery')
const paymentCallable = httpsCallable(functions, 'updateOrderPayment')

// Errors where the order may or may not have been saved, or the server was
// just too busy; retrying with the same requestId is safe (the server returns
// the order that was already created instead of creating a second one).
const RETRYABLE = ['functions/aborted', 'functions/unavailable', 'functions/deadline-exceeded', 'functions/internal']

function createRequestId() {
  return crypto.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function byCreatedAtDesc(a, b) {
  return (parseDate(b.createdAt)?.getTime() || 0) - (parseDate(a.createdAt)?.getTime() || 0)
}

/* ---------- buyers (signed in; the rules allow only their own orders) ---------- */

function checkoutRecovery() {
  let storage
  try { storage = window.localStorage } catch {
    throw Object.assign(new Error('無法保存訂單確認資訊，請允許網站儲存資料後再試。'), { code: 'checkout/storage-unavailable' })
  }
  return createCheckoutRecovery({ storage, createId: createRequestId })
}

export function getPendingCheckout(uid = auth.currentUser?.uid) {
  return uid ? checkoutRecovery().get(uid) : null
}

// The server takes the email and uid from auth. Persist before sending so a
// lost response can be retried after another click, navigation or reload.
export function submitOrder(orderPayload, { uid = auth.currentUser?.uid } = {}) {
  return submitRecoveredCheckout({
    recovery: checkoutRecovery(), uid, payload: orderPayload, retryable: RETRYABLE,
    invoke: async (payload, requestId) => {
      if (auth.currentUser?.uid !== uid) {
        throw Object.assign(new Error('登入帳號已變更，請改回原訂購帳號確認訂單。'), { code: 'checkout/account-changed' })
      }
      const { data } = await createOrderCallable({ orderPayload: payload, requestId })
      return data
    },
    wait: (attempt) => wait(500 * attempt + Math.random() * 1000)
  })
}

// Must filter on userId: the rules reject queries that could return other
// buyers' orders
export async function fetchMyOrders(uid) {
  const snapshot = await getDocs(query(collection(db, 'orders'), where('userId', '==', uid)))
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort(byCreatedAtDesc)
}

// One order: buyers get only their own, staff any. A missing order and
// someone else's order both come back as null (the rules deny both).
export async function fetchOrder(orderId) {
  if (!orderId) return null

  try {
    const snap = await getDoc(doc(db, 'orders', orderId))
    return snap.exists() ? { id: snap.id, ...snap.data() } : null
  } catch (error) {
    if (error?.code === 'permission-denied') return null
    throw error
  }
}

/* ---------- staff (Firestore rules require manager or above) ---------- */

export const ORDER_PAGE_SIZE = 50

function orderFilters({ school = 'all', emailStatus = 'all', delivered, paid } = {}) {
  const constraints = []
  if (school !== 'all') constraints.push(where('school', '==', school))
  if (emailStatus === 'pending') constraints.push(where('emailStatus', 'in', ['pending', 'queued', 'sending', 'retry']))
  else if (emailStatus === 'accepted') constraints.push(where('emailStatus', 'in', ['accepted', 'sent']))
  else if (emailStatus !== 'all') constraints.push(where('emailStatus', '==', emailStatus))
  if (typeof delivered === 'boolean') constraints.push(where('delivered', '==', delivered))
  if (typeof paid === 'boolean') constraints.push(where('paid', '==', paid))
  return constraints
}

function pagedOrderQuery(filters, cursor, size) {
  return query(collection(db, 'orders'), ...orderFilters(filters),
    orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'),
    ...(cursor ? [startAfter(cursor)] : []), limit(size))
}

// Exactly one bounded, live page. Cursors are immutable snapshots so updates
// do not silently turn a next-page query into an unbounded collection read.
export function subscribeOrderPage({ filters, cursor, onData, onError }) {
  return onSnapshot(pagedOrderQuery(filters, cursor, ORDER_PAGE_SIZE + 1),
    { includeMetadataChanges: true }, (snapshot) => {
      const docs = snapshot.docs.slice(0, ORDER_PAGE_SIZE)
      onData({
        orders: docs.map((item) => ({ id: item.id, ...item.data() })),
        cursor: docs.at(-1) || null,
        hasNext: snapshot.docs.length > ORDER_PAGE_SIZE,
        fromCache: snapshot.metadata.fromCache
      })
    }, onError)
}

// Whole-dataset reads are reserved for a deliberate export and remain bounded
// per request. The dashboard uses server aggregates instead of these reads.
export async function fetchAllOrders(filters = {}) {
  const orders = []
  let cursor = null
  for (;;) {
    const snapshot = await getDocsFromServer(pagedOrderQuery(filters, cursor, 250))
    orders.push(...snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    if (snapshot.docs.length < 250) return orders
    cursor = snapshot.docs.at(-1)
  }
}

export async function fetchOrderSummary(filters = {}) {
  const aggregate = async (extra = {}) => {
    const snapshot = await getAggregateFromServer(
      query(collection(db, 'orders'), ...orderFilters({ ...filters, ...extra })),
      { orderCount: count(), amount: sum('finalTotal') }
    )
    return snapshot.data()
  }
  const [booked, collected, delivered] = await Promise.all([
    aggregate(), aggregate({ paid: true }), aggregate({ delivered: true })
  ])
  return {
    orderCount: booked.orderCount, bookedAmount: booked.amount,
    paidAmount: collected.amount, deliveredOrderCount: delivered.orderCount
  }
}

function normalizeMetadata(data) {
  const result = { ...data }
  for (const key of ['deliveryUpdatedAt', 'paymentUpdatedAt']) {
    if (typeof result[key] === 'string') result[key] = new Date(result[key])
  }
  return result
}

async function statusCall(callable, payload) {
  try {
    const { data } = await callable(payload)
    return normalizeMetadata(data)
  } catch (error) {
    if (error?.details && typeof error.details === 'object') {
      error.details = normalizeMetadata(error.details)
    }
    throw error
  }
}

export function updateOrderDelivery(orderId, delivered, { ticketCode = '', expectedDelivered, overrideReason = '' } = {}) {
  return statusCall(deliveryCallable, { orderId, delivered, ticketCode, expectedDelivered, overrideReason })
}

export function updateOrderPayment(orderId, paid, expectedPaid) {
  return statusCall(paymentCallable, { orderId, paid, expectedPaid })
}

export async function resendOrderEmail(orderId, requestId = createRequestId()) {
  const { data } = await resendOrderEmailCallable({ orderId, requestId })
  return data
}

export function deleteOrder(orderId) {
  return deleteDoc(doc(db, 'orders', orderId))
}
