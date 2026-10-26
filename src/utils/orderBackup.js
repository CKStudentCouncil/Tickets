// The Excel backup downloaded before 清除所有訂單 (useOrderPurge): every
// order with all its fields, so nothing is lost even if the Firestore
// archive were. Pure, so tests/orderBackup.test.js runs it with node.
import { formatDateTime } from './datetime.js'

export const EMAIL_STATUS = {
  sent: '郵件服務已接受',
  accepted: '郵件服務已接受',
  retry: '等待重試',
  queued: '已排入寄送佇列',
  sending: '寄送中',
  uncertain: '寄送結果待查',
  failed: '寄送失敗',
  pending: '尚未寄出',
  skipped: '無 Email'
}

const quantityOf = (item) => Number(item?.quantity) || 0
const itemsOf = (order) => (Array.isArray(order.items) ? order.items.filter(Boolean) : [])

// Firestore values as JSON: timestamps become ISO strings
export function toPlain(value) {
  if (value === null || value === undefined) return value ?? null
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toPlain)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlain(item)]))
  return value
}

export function backupTotals(orders) {
  return orders.reduce((totals, order) => {
    const revenue = Number(order.finalTotal) || 0
    totals.orders += 1
    totals.tickets += itemsOf(order).reduce((sum, item) => sum + quantityOf(item), 0)
    totals.revenue += revenue
    if (order.paid) totals.paidRevenue += revenue
    if (order.delivered) totals.deliveredOrders += 1
    return totals
  }, { orders: 0, tickets: 0, revenue: 0, paidRevenue: 0, deliveredOrders: 0 })
}

// [{ name, columns: [{ header, key, width }], rows }], one per worksheet
export function buildOrderBackup(orders, { exportedAt = new Date(), exportedBy = '' } = {}) {
  const totals = backupTotals(orders)

  const summary = {
    name: '摘要',
    columns: [{ header: '項目', key: 'label', width: 22 }, { header: '內容', key: 'value', width: 48 }],
    rows: [
      { label: '備份時間', value: formatDateTime(exportedAt) },
      { label: '備份者', value: exportedBy },
      { label: '訂單數', value: totals.orders },
      { label: '票券張數', value: totals.tickets },
      { label: '訂單應收金額', value: totals.revenue },
      { label: '已收款金額', value: totals.paidRevenue },
      { label: '已領票訂單數', value: totals.deliveredOrders },
      { label: '說明', value: '清除所有訂單前的完整備份；「原始資料」工作表保留每筆訂單的全部欄位（JSON）' }
    ]
  }

  const orderSheet = {
    name: '訂單',
    columns: [
      { header: '訂單ID', key: 'id', width: 22 },
      { header: '建立時間', key: 'createdAt', width: 22 },
      { header: '購買者身分（學校）', key: 'school', width: 18 },
      { header: '姓名', key: 'customerName', width: 14 },
      { header: '電話', key: 'customerPhone', width: 16 },
      { header: 'Email', key: 'customerEmail', width: 30 },
      { header: '班級', key: 'class', width: 8 },
      { header: '座號', key: 'number', width: 8 },
      { header: '辦公室', key: 'office', width: 12 },
      { header: '票券明細', key: 'items', width: 36 },
      { header: '票券張數', key: 'tickets', width: 10 },
      { header: '訂單金額', key: 'finalTotal', width: 12 },
      { header: '付款狀態', key: 'paid', width: 10 },
      { header: '付款更新時間', key: 'paymentUpdatedAt', width: 22 },
      { header: '付款更新者', key: 'paymentUpdatedByName', width: 14 },
      { header: '領票狀態', key: 'delivered', width: 10 },
      { header: '領票更新時間', key: 'deliveryUpdatedAt', width: 22 },
      { header: '領票更新者', key: 'deliveryUpdatedByName', width: 14 },
      { header: '確認信', key: 'emailStatus', width: 16 },
      { header: '購買帳號 UID', key: 'userId', width: 30 }
    ],
    rows: orders.map((order) => ({
      id: order.id,
      createdAt: formatDateTime(order.createdAt),
      school: order.school || '',
      customerName: order.customerName || '',
      customerPhone: order.customerPhone || '',
      customerEmail: order.customerEmail || '',
      class: order.class || '',
      number: order.number || '',
      office: order.office || '',
      items: itemsOf(order).map((item) => `${item.name || item.ticketTypeId || item.id} ×${quantityOf(item)}（NT$ ${Number(item.price) || 0}）`).join('、'),
      tickets: itemsOf(order).reduce((sum, item) => sum + quantityOf(item), 0),
      finalTotal: Number(order.finalTotal) || 0,
      paid: order.paid ? '已付款' : '未付款',
      paymentUpdatedAt: formatDateTime(order.paymentUpdatedAt),
      paymentUpdatedByName: order.paymentUpdatedByName || '',
      delivered: order.delivered ? '已領票' : '未領票',
      deliveryUpdatedAt: formatDateTime(order.deliveryUpdatedAt),
      deliveryUpdatedByName: order.deliveryUpdatedByName || '',
      emailStatus: EMAIL_STATUS[order.emailStatus] || order.emailStatus || '',
      userId: order.userId || ''
    }))
  }

  const itemSheet = {
    name: '票券明細',
    columns: [
      { header: '訂單ID', key: 'id', width: 22 },
      { header: '建立時間', key: 'createdAt', width: 22 },
      { header: '購買者身分（學校）', key: 'school', width: 18 },
      { header: '票種ID', key: 'ticketTypeId', width: 18 },
      { header: '票種名稱', key: 'name', width: 18 },
      { header: '單價', key: 'price', width: 10 },
      { header: '數量', key: 'quantity', width: 8 },
      { header: '小計', key: 'subtotal', width: 12 },
      { header: '付款狀態', key: 'paid', width: 10 }
    ],
    rows: orders.flatMap((order) => itemsOf(order).map((item) => ({
      id: order.id,
      createdAt: formatDateTime(order.createdAt),
      school: order.school || '',
      ticketTypeId: item.ticketTypeId || item.id || '',
      name: item.name || '',
      price: Number(item.price) || 0,
      quantity: quantityOf(item),
      subtotal: (Number(item.price) || 0) * quantityOf(item),
      paid: order.paid ? '已付款' : '未付款'
    })))
  }

  const rawSheet = {
    name: '原始資料',
    columns: [{ header: '訂單ID', key: 'id', width: 22 }, { header: 'JSON', key: 'json', width: 120 }],
    rows: orders.map(({ id, ...data }) => ({ id, json: JSON.stringify(toPlain(data)) }))
  }

  return [summary, orderSheet, itemSheet, rawSheet]
}

export function backupFileName(count, exportedAt = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(exportedAt)
  return `訂單完整備份_${date}_${count}筆.xlsx`
}
