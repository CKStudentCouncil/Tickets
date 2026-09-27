import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from 'src/boot/firebase'
import { parseDate } from 'src/utils/datetime'

const createOrderCallable = httpsCallable(functions, 'createOrder')
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

/* ---------- buyers (signed in; the rules allow only their own orders) ---------- */

// The server takes the buyer's email and userId from the signed-in account
export async function submitOrder(orderPayload) {
  const requestId = createRequestId()

  for (let attempt = 1; ; attempt++) {
    try {
      const { data } = await createOrderCallable({ orderPayload, requestId })
      return data
    } catch (error) {
      if (attempt >= 3 || !RETRYABLE.includes(error?.code)) throw error
      await wait(500 * attempt + Math.random() * 1000) // spread retries out
    }
  }
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

export async function fetchAllOrders() {
  const snapshot = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')))
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
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
