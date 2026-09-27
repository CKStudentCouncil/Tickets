import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/boot/firebase'
import { addGuestOrder, getGuestOrders, removeGuestOrder } from 'src/utils/guestOrders'
import { parseDate } from 'src/utils/datetime'

const LAST_ORDER_KEY = 'cksc_last_order_id'

const createOrderCallable = httpsCallable(functions, 'createOrder')
const getOrdersCallable = httpsCallable(functions, 'getOrders')
const resendOrderEmailCallable = httpsCallable(functions, 'resendOrderEmail')

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

/* ---------- buyers (no account; access via id + token) ---------- */

export async function submitOrder(orderPayload) {
  const requestId = createRequestId()
  let data

  for (let attempt = 1; ; attempt++) {
    try {
      ;({ data } = await createOrderCallable({ orderPayload, requestId }))
      break
    } catch (error) {
      if (attempt >= 3 || !RETRYABLE.includes(error?.code)) throw error
      await wait(500 * attempt + Math.random() * 1000) // spread retries out
    }
  }

  addGuestOrder(data.id, data.token)
  try {
    sessionStorage.setItem(LAST_ORDER_KEY, data.id)
  } catch {
    // ignore storage errors
  }

  return data
}

export async function fetchBuyerOrders() {
  const refs = getGuestOrders()
  if (!refs.length) return []

  const { data } = await getOrdersCallable({ orders: refs })
  return (data.orders || []).sort(byCreatedAtDesc)
}

export async function fetchBuyerOrder(orderId) {
  const ref = getGuestOrders().find((entry) => entry.id === orderId)
  if (!ref) return null

  const { data } = await getOrdersCallable({ orders: [ref] })
  return data.orders?.[0] || null
}

export function forgetBuyerOrder(orderId) {
  removeGuestOrder(orderId)
}

export function getLastSubmittedOrderId() {
  try {
    return sessionStorage.getItem(LAST_ORDER_KEY)
  } catch {
    return null
  }
}

/* ---------- staff (Firestore rules require manager or above) ---------- */

export async function fetchAllOrders() {
  const snapshot = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')))
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}

export async function fetchOrderById(orderId) {
  if (!orderId) return null

  const snap = await getDoc(doc(db, 'orders', orderId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

export async function updateOrderDelivery(orderId, delivered, updatedByName) {
  const patch = {
    delivered,
    deliveryUpdatedAt: serverTimestamp(),
    deliveryUpdatedByName: updatedByName
  }

  await updateDoc(doc(db, 'orders', orderId), patch)
  return { ...patch, deliveryUpdatedAt: new Date() }
}

export async function updateOrderPayment(orderId, paid, updatedByName) {
  const patch = {
    paid,
    paymentUpdatedAt: serverTimestamp(),
    paymentUpdatedByName: updatedByName
  }

  await updateDoc(doc(db, 'orders', orderId), patch)
  return { ...patch, paymentUpdatedAt: new Date() }
}

export async function resendOrderEmail(orderId) {
  const { data } = await resendOrderEmailCallable({ orderId })
  return data
}

export function deleteOrder(orderId) {
  return deleteDoc(doc(db, 'orders', orderId))
}
