// 取消訂單與退款 (functions/lib/orderCancel.js keeps the same values; a
// consistency test fails if they drift apart).
//
// A cancelled order leaves `orders` for `cancelledOrders/{orderId}`, so it no
// longer counts in any total, notice or report; deleting it from `orders`
// gives its tickets back to the stock and to the buyer's allowance.

// cancelReason -> label. 逾期未繳費 / 逾期未領票 follow 銷售條款 第三條、第四條.
export const CANCEL_REASONS = {
  unpaid: '逾期未繳費',
  uncollected: '逾期未領票',
  buyer_request: '購票人申請取消',
  violation: '違反銷售條款',
  other: '其他'
}

// reasons that need a note saying what happened
export const NOTE_REQUIRED_REASONS = ['violation', 'other']

// 第三條：通知限期補正，逾期仍未付款者得取消
export const PAYMENT_NOTICES_TO_CANCEL = 1
// 第四條：經通知三次仍未領票者，視同放棄
export const PICKUP_NOTICES_TO_CANCEL = 3

// orders per cancelOrders call
export const MAX_CANCEL_ORDERS = 100
export const MAX_CANCEL_NOTE = 200

// refundStatus: 'none' (nothing to give back), 'pending', 'done'
export const REFUND_STATUS_LABELS = {
  none: '不退款',
  pending: '待退款',
  done: '已退款'
}

// The notices an order was sent are recorded on it as notices.{jobId} =
// { type, at } once SES accepts their mail (recordOrderNotices). A 繳費暨取票
// notice counts for both.
export const NOTICE_TYPES_COUNTED = {
  payment: ['payment', 'both'],
  pickup: ['pickup', 'both']
}

// cancelEmailStatus of a cancelled order: the 訂單取消通知 (mail queue states)
export const CANCEL_EMAIL_LABELS = {
  skipped: '未寄送',
  queued: '待寄送',
  pending: '待寄送',
  retry: '重試中',
  sending: '寄送中',
  accepted: '已寄出',
  failed: '寄送失敗',
  uncertain: '寄送結果待查'
}
