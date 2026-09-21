import { USE_MOCK_ORDERS } from 'src/config/app'
import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  deleteDoc,
  updateDoc,
  runTransaction,
  setDoc
} from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { addGuestOrderId, getGuestOrderIds, removeGuestOrderId } from 'src/utils/guestOrders'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { app } from 'src/boot/firebase'


const MOCK_ORDERS_KEY = 'cksc_mock_orders'

const SCHOOL_IDENTITIES = {
  '建國中學': 'CKS',
  '北一女中': 'TFG',
  '中山女高': 'ZS',
  '景美女中': 'JM',
  '成功高中': 'CG',
  '師大附中': 'HSNU',
  '建中家長會': 'CKP',
  '建中老師': 'CKT',
  '其他學校或社會人士': 'O'
}

const functions = getFunctions(app, 'asia-east1')
const createOrder = httpsCallable(functions, 'createOrder')

function loadMockOrders() {
  try {
    const raw = localStorage.getItem(MOCK_ORDERS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveMockOrders(orders) {
  localStorage.setItem(MOCK_ORDERS_KEY, JSON.stringify(orders))
}

/**
 * Get YYYYMMDD in Taiwan time.
 */
function getTaiwanDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )

  return `${values.year}${values.month}${values.day}`
}

/**
 * Get the identity prefix for a school.
 */
function getSchoolIdentity(school) {
  return SCHOOL_IDENTITIES[school] || 'O'
}

/**
 * Generate a new order ID.
 *
 * Format:
 * IDENTITY + YYYYMMDD + 4-digit serial number
 *
 * Example:
 * CKS202608140001
 */
async function generateOrderId(school) {
  const identity = getSchoolIdentity(school)
  const date = getTaiwanDateString()

  const counterRef = doc(db, 'orderCounters', date)

  const serialNumber = await runTransaction(db, async (transaction) => {
    const counterSnap = await transaction.get(counterRef)

    const currentSerial = counterSnap.exists()
      ? Number(counterSnap.data().serialNumber || 0)
      : 0

    const nextSerial = currentSerial + 1

    transaction.set(
      counterRef,
      {
        date,
        serialNumber: nextSerial,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    )

    return nextSerial
  })

  return `${identity}${date}${String(serialNumber).padStart(4, '0')}`
}

export function parseOrderDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') return new Date(value)
  if (value.toDate) return value.toDate()
  return null
}

export function formatOrderDate(value) {
  const d = parseOrderDate(value)
  return d ? d.toLocaleString() : ''
}

function normalizeOrderPayload(payload) {
  const { ...rest } = payload

  return rest
}

export async function submitOrder(orderPayload) {
  const normalizedPayload = normalizeOrderPayload(orderPayload)

  if (!USE_MOCK_ORDERS) {
    const result = await createOrder({
      orderPayload: normalizedPayload
    })

    const data = result.data

    addGuestOrderId(data.id)

    return {
      status: data.status,
      id: data.id
    }
  }

  await Promise.resolve()

  const orders = loadMockOrders()
  const date = getTaiwanDateString()

  const todayOrders = orders.filter((order) => {
    if (!order.id) return false

    return new RegExp(
      `^[A-Z]+${date}\\d{4}$`
    ).test(order.id)
  })

  let maxSerial = 0

  for (const order of todayOrders) {
    const match = order.id.match(
      new RegExp(`^[A-Z]+${date}(\\d{4})$`)
    )

    if (match) {
      maxSerial = Math.max(
        maxSerial,
        Number(match[1])
      )
    }
  }

  const serialNumber = maxSerial + 1
  const identity = getSchoolIdentity(
    normalizedPayload.school
  )

  const id =
    `${identity}${date}${String(serialNumber).padStart(4, '0')}`

  const createdAt = new Date().toISOString()

  const order = {
    ...normalizedPayload,
    id,
    createdAt,
    delivered: false,
    deliveryUpdatedAt: null,
    deliveryUpdatedByName: null,
    paid: false,
    paymentUpdatedAt: null,
    paymentUpdatedByName: null
  }

  orders.unshift(order)
  saveMockOrders(orders)
  addGuestOrderId(id)

  return {
    status: 201,
    id,
    order
  }
}

export async function fetchAllOrders() {
  if (!USE_MOCK_ORDERS) {
    const q = query(
      collection(db, 'orders'),
      orderBy('createdAt', 'desc')
    )

    const snapshot = await getDocs(q)

    const allOrdersRaw = snapshot.docs.map((d) => ({
      id: d.id,
      ...d.data()
    }))

    return Promise.all(
      allOrdersRaw.map(async (o) => {
        const needEnrich =
          !o.customerName ||
          !o.customerPhone ||
          !o.customerEmail

        if (!needEnrich || !o.userId) return o

        try {
          const userSnap = await getDoc(
            doc(db, 'users', o.userId)
          )

          if (!userSnap.exists()) return o

          const u = userSnap.data()

          return {
            ...o,
            customerName: o.customerName || u.name || '',
            customerPhone: o.customerPhone || u.phone || '',
            customerEmail: o.customerEmail || u.email || '',
            school: o.school || u.school || '',
            class: o.class || u.class || '',
            number: o.number || u.number || ''
          }
        } catch {
          return o
        }
      })
    )
  }

  return loadMockOrders().sort(
    (a, b) =>
      new Date(b.createdAt).getTime() -
      new Date(a.createdAt).getTime()
  )
}

export async function fetchOrderById(orderId) {
  if (!USE_MOCK_ORDERS) {
    const snap = await getDoc(
      doc(db, 'orders', orderId)
    )

    if (!snap.exists()) return null

    return {
      id: snap.id,
      ...snap.data()
    }
  }

  return (
    loadMockOrders().find((o) => o.id === orderId) ||
    null
  )
}

export async function fetchBuyerOrders() {
  const ids = getGuestOrderIds()

  if (!USE_MOCK_ORDERS) {
    const loaded = []

    for (const id of ids) {
      const order = await fetchOrderById(id)

      if (order) loaded.push(order)
    }

    return loaded.sort(
      (a, b) =>
        new Date(parseOrderDate(b.createdAt)).getTime() -
        new Date(parseOrderDate(a.createdAt)).getTime()
    )
  }

  const byId = new Map(
    loadMockOrders().map((o) => [o.id, o])
  )

  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() -
        new Date(a.createdAt).getTime()
    )
}

export function canViewOrder(orderId) {
  if (!USE_MOCK_ORDERS) {
    return getGuestOrderIds().includes(orderId)
  }

  return (
    getGuestOrderIds().includes(orderId) ||
    loadMockOrders().some((o) => o.id === orderId)
  )
}

export async function updateOrderDelivery(
  orderId,
  delivered,
  meta = {}
) {
  if (!USE_MOCK_ORDERS) {
    const orderRef = doc(db, 'orders', orderId)

    const updateData = {
      delivered,
      deliveryUpdatedAt: serverTimestamp(),
      ...meta
    }

    await updateDoc(orderRef, updateData)

    return updateData
  }

  const orders = loadMockOrders()

  const idx = orders.findIndex(
    (o) => o.id === orderId
  )

  if (idx === -1) {
    throw new Error('訂單不存在')
  }

  const patch = {
    delivered,
    deliveryUpdatedAt: new Date().toISOString(),
    deliveryUpdatedBy: meta.deliveryUpdatedBy,
    deliveryUpdatedByName: meta.deliveryUpdatedByName
  }

  orders[idx] = {
    ...orders[idx],
    ...patch
  }

  saveMockOrders(orders)

  return patch
}

export async function updateOrderPayment(
  orderId,
  paid,
  meta = {}
) {
  if (!USE_MOCK_ORDERS) {
    const orderRef = doc(db, 'orders', orderId)

    const updateData = {
      paid,
      paymentUpdatedAt: serverTimestamp(),
      ...meta
    }

    await updateDoc(orderRef, updateData)

    return updateData
  }

  const orders = loadMockOrders()

  const idx = orders.findIndex(
    (o) => o.id === orderId
  )

  if (idx === -1) {
    throw new Error('訂單不存在')
  }

  const patch = {
    paid,
    paymentUpdatedAt: new Date().toISOString(),
    paymentUpdatedBy: meta.paymentUpdatedBy,
    paymentUpdatedByName: meta.paymentUpdatedByName
  }

  orders[idx] = {
    ...orders[idx],
    ...patch
  }

  saveMockOrders(orders)

  return patch
}

export async function deleteOrderById(orderId) {
  if (!USE_MOCK_ORDERS) {
    await deleteDoc(doc(db, 'orders', orderId))
    removeGuestOrderId(orderId)
    return
  }

  saveMockOrders(
    loadMockOrders().filter(
      (o) => o.id !== orderId
    )
  )

  removeGuestOrderId(orderId)
}

export function getLastSubmittedOrderId() {
  try {
    return sessionStorage.getItem(
      'cksc_last_order_id'
    )
  } catch {
    return null
  }
}

export function setLastSubmittedOrderId(id) {
  try {
    sessionStorage.setItem(
      'cksc_last_order_id',
      id
    )
  } catch {
    /* ignore */
  }
}