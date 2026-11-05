import {
  NOTICE_TYPES_COUNTED,
  PAYMENT_NOTICES_TO_CANCEL,
  PICKUP_NOTICES_TO_CANCEL
} from '../data/cancellations.js'
import { parseDate } from './datetime.js'

const noticesOf = (order) =>
  order?.notices && typeof order.notices === 'object' ? Object.values(order.notices).filter((notice) => notice && typeof notice === 'object') : []

// { payment, pickup }: how many payment / pickup notices reached the order
// (functions/lib/orderCancel.js counts alike)
export function noticeCountsOf(order) {
  const notices = noticesOf(order)
  const count = (types) => notices.filter((notice) => types.includes(notice.type)).length
  return { payment: count(NOTICE_TYPES_COUNTED.payment), pickup: count(NOTICE_TYPES_COUNTED.pickup) }
}

// When the latest notice of a kind ('payment' | 'pickup') reached the order
export function lastNoticeAt(order, kind) {
  const times = noticesOf(order)
    .filter((notice) => NOTICE_TYPES_COUNTED[kind].includes(notice.type))
    .map((notice) => parseDate(notice.at)?.getTime() || 0)
  const latest = Math.max(0, ...times)
  return latest ? new Date(latest) : null
}

// Why cancelOrders would refuse to cancel this order at all, or ''
export function cancelBlockOf(order) {
  if (!order) return '找不到訂單'
  if (order.complimentary === true) return '公關票請直接刪除，張數會退回發出的幹部'
  if (order.streetSale === true) return '路宣紙本票已當場交付，不能取消'
  if (order.delivered === true) return '已領票的訂單不能取消；若購票人退回紙本票，請先標記未領票並填寫原因'
  return ''
}

// Why this reason does not apply to the order, or '' when it does
export function reasonBlockOf(order, reason) {
  const counts = noticeCountsOf(order)
  if (reason === 'unpaid') {
    if (order?.paid === true) return '此訂單已付款'
    if (counts.payment < PAYMENT_NOTICES_TO_CANCEL) return '此訂單還沒有收到繳費通知'
  }
  if (reason === 'uncollected' && counts.pickup < PICKUP_NOTICES_TO_CANCEL) {
    return `此訂單收到 ${counts.pickup} 次領票通知，需滿 ${PICKUP_NOTICES_TO_CANCEL} 次`
  }
  return ''
}

// The orders 逾期處理 offers for a kind: 'unpaid' (unpaid after a payment
// notice) or 'uncollected' (not collected after three pickup notices), oldest
// notice first
export function overdueOrders(orders, kind) {
  return orders
    .filter((order) => !cancelBlockOf(order) && !reasonBlockOf(order, kind))
    .map((order) => ({ order, at: lastNoticeAt(order, kind === 'unpaid' ? 'payment' : 'pickup')?.getTime() || 0 }))
    .sort((a, b) => a.at - b.at || a.order.id.localeCompare(b.order.id))
    .map(({ order }) => order)
}

// What the council keeps of a cancelled order: what was paid less the refund
export const retainedOf = (order) =>
  order?.paid === true ? Math.max(0, (Number(order.finalTotal) || 0) - (Number(order.refundAmount) || 0)) : 0

// Totals of cancelled orders: { count, pending, refunded, retained }
export function summarizeCancellations(orders = []) {
  return orders.reduce((summary, order) => {
    const refund = Number(order?.refundAmount) || 0
    summary.count += 1
    if (order?.refundStatus === 'pending') summary.pending += refund
    if (order?.refundStatus === 'done') summary.refunded += refund
    summary.retained += retainedOf(order)
    return summary
  }, { count: 0, pending: 0, refunded: 0, retained: 0 })
}
