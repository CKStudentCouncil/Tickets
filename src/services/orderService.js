import { USE_MOCK_ORDERS } from 'src/config/app'

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore'

import {
  getFunctions,
  httpsCallable
} from 'firebase/functions'

import {
  db,
  app
} from 'src/boot/firebase'

import {
  addGuestOrderId,
  getGuestOrderIds,
  removeGuestOrderId
} from 'src/utils/guestOrders'

const MOCK_ORDERS_KEY =
  'cksc_mock_orders'

const SCHOOL_IDENTITIES = {
  建國中學: 'CKS',
  北一女中: 'TFG',
  中山女高: 'ZS',
  景美女中: 'JM',
  成功高中: 'CG',
  師大附中: 'HSNU',
  建中家長會: 'CKP',
  建中老師: 'CKT',
  其他學校或社會人士: 'O'
}

const functions =
  getFunctions(
    app,
    'asia-east1'
  )

const createOrder =
  httpsCallable(
    functions,
    'createOrder'
  )

function loadMockOrders() {
  try {
    const raw =
      localStorage.getItem(
        MOCK_ORDERS_KEY
      )

    return raw
      ? JSON.parse(raw)
      : []
  } catch {
    return []
  }
}

function saveMockOrders(orders) {
  localStorage.setItem(
    MOCK_ORDERS_KEY,
    JSON.stringify(orders)
  )
}

function getTaiwanDateString(
  date = new Date()
) {
  const parts =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }
    ).formatToParts(date)

  const values =
    Object.fromEntries(
      parts
        .filter(
          (part) =>
            part.type !== 'literal'
        )
        .map(
          (part) => [
            part.type,
            part.value
          ]
        )
    )

  return (
    `${values.year}` +
    `${values.month}` +
    `${values.day}`
  )
}

function getSchoolIdentity(school) {
  return (
    SCHOOL_IDENTITIES[school] ||
    'O'
  )
}

async function generateOrderId(
  school
) {
  const identity =
    getSchoolIdentity(school)

  const date =
    getTaiwanDateString()

  const counterRef =
    doc(
      db,
      'orderCounters',
      date
    )

  const serialNumber =
    await runTransaction(
      db,
      async (transaction) => {
        const counterSnap =
          await transaction.get(
            counterRef
          )

        const currentSerial =
          counterSnap.exists()
            ? Number(
                counterSnap.data()
                  .serialNumber || 0
              )
            : 0

        const nextSerial =
          currentSerial + 1

        transaction.set(
          counterRef,
          {
            date,
            serialNumber:
              nextSerial,
            updatedAt:
              serverTimestamp()
          },
          {
            merge: true
          }
        )

        return nextSerial
      }
    )

  return (
    `${identity}` +
    `${date}` +
    `${String(
      serialNumber
    ).padStart(4, '0')}`
  )
}

export function parseOrderDate(
  value
) {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    return value
  }

  if (typeof value === 'string') {
    const date =
      new Date(value)

    return Number.isNaN(
      date.getTime()
    )
      ? null
      : date
  }

  if (
    typeof value?.toDate ===
    'function'
  ) {
    return value.toDate()
  }

  return null
}

export function formatOrderDate(
  value
) {
  const date =
    parseOrderDate(value)

  return date
    ? date.toLocaleString(
        'zh-TW',
        {
          timeZone:
            'Asia/Taipei'
        }
      )
    : ''
}

function normalizeOrderPayload(
  payload
) {
  return {
    ...payload
  }
}

export async function submitOrder(
  orderPayload
) {
  const normalizedPayload =
    normalizeOrderPayload(
      orderPayload
    )

  if (!USE_MOCK_ORDERS) {
    const result =
      await createOrder({
        orderPayload:
          normalizedPayload
      })

    const data =
      result.data

    addGuestOrderId(
      data.id
    )

    return {
      status:
        data.status,
      id:
        data.id
    }
  }

  const orders =
    loadMockOrders()

  const date =
    getTaiwanDateString()

  const todayOrders =
    orders.filter(
      (order) => {
        if (!order.id) {
          return false
        }

        return new RegExp(
          `^[A-Z]+${date}\\d{4}$`
        ).test(
          order.id
        )
      }
    )

  let maxSerial = 0

  for (
    const order of todayOrders
  ) {
    const match =
      order.id.match(
        new RegExp(
          `^[A-Z]+${date}(\\d{4})$`
        )
      )

    if (match) {
      maxSerial =
        Math.max(
          maxSerial,
          Number(match[1])
        )
    }
  }

  const serialNumber =
    maxSerial + 1

  const identity =
    getSchoolIdentity(
      normalizedPayload.school
    )

  const id =
    `${identity}` +
    `${date}` +
    `${String(
      serialNumber
    ).padStart(4, '0')}`

  const createdAt =
    new Date().toISOString()

  const order = {
    ...normalizedPayload,
    id,
    createdAt,
    delivered: false,
    deliveryUpdatedAt:
      null,
    deliveryUpdatedBy:
      null,
    deliveryUpdatedByName:
      null,
    paid: false,
    paymentUpdatedAt:
      null,
    paymentUpdatedBy:
      null,
    paymentUpdatedByName:
      null
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
    const q =
      query(
        collection(
          db,
          'orders'
        ),
        orderBy(
          'createdAt',
          'desc'
        )
      )

    const snapshot =
      await getDocs(q)

    const orders =
      snapshot.docs.map(
        (item) => ({
          id: item.id,
          ...item.data()
        })
      )

    return Promise.all(
      orders.map(
        async (order) => {
          const needEnrich =
            !order.customerName ||
            !order.customerPhone ||
            !order.customerEmail

          if (
            !needEnrich ||
            !order.userId
          ) {
            return order
          }

          try {
            const userSnap =
              await getDoc(
                doc(
                  db,
                  'users',
                  order.userId
                )
              )

            if (
              !userSnap.exists()
            ) {
              return order
            }

            const user =
              userSnap.data()

            return {
              ...order,

              customerName:
                order.customerName ||
                user.name ||
                '',

              customerPhone:
                order.customerPhone ||
                user.phone ||
                '',

              customerEmail:
                order.customerEmail ||
                user.email ||
                '',

              school:
                order.school ||
                user.school ||
                '',

              class:
                order.class ||
                user.class ||
                '',

              number:
                order.number ||
                user.number ||
                ''
            }
          } catch {
            return order
          }
        }
      )
    )
  }

  return loadMockOrders()
    .sort(
      (a, b) =>
        new Date(
          b.createdAt
        ).getTime() -
        new Date(
          a.createdAt
        ).getTime()
    )
}

export async function fetchOrderById(
  orderId
) {
  if (!orderId) {
    return null
  }

  if (!USE_MOCK_ORDERS) {
    const snap =
      await getDoc(
        doc(
          db,
          'orders',
          orderId
        )
      )

    if (!snap.exists()) {
      return null
    }

    return {
      id: snap.id,
      ...snap.data()
    }
  }

  return (
    loadMockOrders().find(
      (order) =>
        order.id === orderId
    ) || null
  )
}

export async function fetchBuyerOrders() {
  const ids =
    getGuestOrderIds()

  if (!USE_MOCK_ORDERS) {
    const loaded = []

    for (
      const id of ids
    ) {
      try {
        const order =
          await fetchOrderById(id)

        if (order) {
          loaded.push(order)
        }
      } catch (error) {
        console.error(
          `載入訂單 ${id} 失敗`,
          error
        )
      }
    }

    return loaded.sort(
      (a, b) => {
        const dateA =
          parseOrderDate(
            a.createdAt
          )

        const dateB =
          parseOrderDate(
            b.createdAt
          )

        return (
          (dateB?.getTime() || 0) -
          (dateA?.getTime() || 0)
        )
      }
    )
  }

  const byId =
    new Map(
      loadMockOrders().map(
        (order) => [
          order.id,
          order
        ]
      )
    )

  return ids
    .map(
      (id) =>
        byId.get(id)
    )
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(
          b.createdAt
        ).getTime() -
        new Date(
          a.createdAt
        ).getTime()
    )
}

export function canViewOrder(
  orderId
) {
  if (!orderId) {
    return false
  }

  if (!USE_MOCK_ORDERS) {
    return getGuestOrderIds().includes(
      orderId
    )
  }

  return (
    getGuestOrderIds().includes(
      orderId
    ) ||
    loadMockOrders().some(
      (order) =>
        order.id === orderId
    )
  )
}

export async function updateOrderDelivery(
  orderId,
  delivered,
  meta = {}
) {
  if (!USE_MOCK_ORDERS) {
    const orderRef =
      doc(
        db,
        'orders',
        orderId
      )

    const updateData = {
      delivered,
      deliveryUpdatedAt:
        serverTimestamp(),
      ...meta
    }

    await updateDoc(
      orderRef,
      updateData
    )

    return updateData
  }

  const orders =
    loadMockOrders()

  const index =
    orders.findIndex(
      (order) =>
        order.id === orderId
    )

  if (index === -1) {
    throw new Error(
      '訂單不存在'
    )
  }

  const patch = {
    delivered,
    deliveryUpdatedAt:
      new Date().toISOString(),
    deliveryUpdatedBy:
      meta.deliveryUpdatedBy ||
      null,
    deliveryUpdatedByName:
      meta.deliveryUpdatedByName ||
      null
  }

  orders[index] = {
    ...orders[index],
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
    const orderRef =
      doc(
        db,
        'orders',
        orderId
      )

    const updateData = {
      paid,
      paymentUpdatedAt:
        serverTimestamp(),
      ...meta
    }

    await updateDoc(
      orderRef,
      updateData
    )

    return updateData
  }

  const orders =
    loadMockOrders()

  const index =
    orders.findIndex(
      (order) =>
        order.id === orderId
    )

  if (index === -1) {
    throw new Error(
      '訂單不存在'
    )
  }

  const patch = {
    paid,
    paymentUpdatedAt:
      new Date().toISOString(),
    paymentUpdatedBy:
      meta.paymentUpdatedBy ||
      null,
    paymentUpdatedByName:
      meta.paymentUpdatedByName ||
      null
  }

  orders[index] = {
    ...orders[index],
    ...patch
  }

  saveMockOrders(orders)

  return patch
}

export async function deleteOrderById(
  orderId
) {
  if (!orderId) {
    return
  }

  if (!USE_MOCK_ORDERS) {
    removeGuestOrderId(orderId)
    return
  }

  saveMockOrders(
    loadMockOrders().filter(
      (order) =>
        order.id !== orderId
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

export function setLastSubmittedOrderId(
  id
) {
  try {
    sessionStorage.setItem(
      'cksc_last_order_id',
      id
    )
  } catch {
    return
  }
}