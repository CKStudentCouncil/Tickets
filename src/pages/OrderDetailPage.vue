<template>
  <div class="detail-page">
    <div v-if="loading && !order && !cancelledOrder" class="state-screen" role="status">
      <p>載入訂單中...</p>
    </div>

    <div v-else-if="loadError && !order && !cancelledOrder" class="state-screen" role="alert">
      <h1>目前無法載入訂單</h1>
      <p>請檢查連線後重試</p>
      <button type="button" class="btn" @click="loadOrder">重新載入</button>
    </div>

    <!-- ---------- cancelled (functions/lib/orderCancel.js) ---------- -->
    <main v-else-if="!order && cancelledOrder" class="detail-content">
      <header class="page-heading">
        <p class="eyebrow">
          CK PARTY NIGHT · {{ isAdminView ? 'STAFF VIEW' : 'CUSTOMER VIEW' }}
        </p>
        <h1>訂單已取消</h1>
        <p class="heading-meta" style="margin-bottom: 2ch;">
          ORDER <span class="mono">{{ cancelledOrder.id }}</span>
        </p>
        <div class="heading-actions">
          <button type="button" class="btn-outline" @click="goBack">返回</button>
          <button
            v-if="isAdminView"
            type="button"
            class="btn"
            @click="router.push({ name: scanDesk.active ? 'admin-scan-desk' : 'admin-scan' })"
          >
            {{ scanDesk.active ? '回到電腦領票' : '回到領票' }}
          </button>
        </div>
      </header>

      <p v-if="isAdminView" class="qr-check danger cancelled-alert" role="alert">
        ⚠ 此訂單已取消，QR Code 已失效，不得領票
      </p>

      <section class="panel" :style="isAdminView ? '' : 'border-top: none; margin-top: 0; padding-top: 0;'">
        <h2>取消資訊</h2>
        <dl class="info-list">
          <div>
            <dt>取消原因</dt>
            <dd>{{ CANCEL_REASONS[cancelledOrder.cancelReason] || '—' }}</dd>
          </div>
          <div v-if="isAdminView && cancelledOrder.cancelNote">
            <dt>說明</dt>
            <dd>{{ cancelledOrder.cancelNote }}</dd>
          </div>
          <div>
            <dt>取消時間</dt>
            <dd class="num">{{ formatDateTime(cancelledOrder.cancelledAt) }}</dd>
          </div>
          <div v-if="isAdminView && cancelledOrder.cancelledByName">
            <dt>取消人員</dt>
            <dd>{{ cancelledOrder.cancelledByName }}</dd>
          </div>
          <div v-if="isAdminView && cancelledOrder.cancelEmailStatus">
            <dt>取消通知信</dt>
            <dd>
              {{ CANCEL_EMAIL_LABELS[cancelledOrder.cancelEmailStatus] || cancelledOrder.cancelEmailStatus }}
              <span v-if="cancelledOrder.cancelEmailError" class="mono">（{{ cancelledOrder.cancelEmailError }}）</span>
            </dd>
          </div>
          <div>
            <dt>訂單金額</dt>
            <dd class="num">NT$ {{ Number(cancelledOrder.finalTotal ?? 0).toLocaleString() }}・{{ cancelledOrder.paid ? '已付款' : '未付款' }}</dd>
          </div>
          <div v-if="cancelledOrder.paid">
            <dt>退款</dt>
            <dd>
              {{ REFUND_STATUS_LABELS[cancelledOrder.refundStatus] || '—' }}
              <span v-if="cancelledOrder.refundAmount" class="num">NT$ {{ Number(cancelledOrder.refundAmount).toLocaleString() }}</span>
              <span v-if="cancelledOrder.refundStatus === 'done' && cancelledOrder.refundedAt" class="num">・{{ formatDateTime(cancelledOrder.refundedAt) }}</span>
            </dd>
          </div>
        </dl>
        <p v-if="!isAdminView && cancelledOrder.refundStatus === 'pending'" class="panel-copy">
          退款將依主辦單位公告之時間、地點及方式辦理；如有疑問請聯繫建國中學班聯會
        </p>
      </section>

      <section class="panel">
        <h2>票券明細</h2>
        <ul v-if="(cancelledOrder.items || []).length" class="product-stats">
          <li v-for="(item, index) in cancelledOrder.items || []" :key="item.id || index">
            <span>{{ item.name }}</span>
            <span class="item-meta">
              <span class="num">× {{ item.quantity }}</span>
              <strong class="num">
                NT$ {{ (Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString() }}
              </strong>
            </span>
          </li>
        </ul>
        <dl v-if="isAdminView" class="info-list">
          <div v-if="cancelledOrder.customerName">
            <dt>購票人</dt>
            <dd>{{ cancelledOrder.customerName }}</dd>
          </div>
          <div v-if="cancelledOrder.customerEmail">
            <dt>Email</dt>
            <dd class="mono">{{ cancelledOrder.customerEmail }}</dd>
          </div>
          <div v-if="cancelledOrder.customerPhone">
            <dt>聯絡電話</dt>
            <dd class="mono">{{ cancelledOrder.customerPhone }}</dd>
          </div>
        </dl>
      </section>
    </main>

    <div v-else-if="!order" class="state-screen">
      <p class="eyebrow">CK PARTY NIGHT</p>
      <h1>找不到訂單</h1>
      <p v-if="isAdminView">此訂單不存在</p>
      <p v-else>此訂單不存在，或不是以目前登入的帳號（{{ auth.email }}）訂購</p>

      <button type="button" class="btn" @click="goBack">返回</button>
    </div>

    <main v-else class="detail-content" :aria-busy="loading">
      <div v-if="loadError" class="qr-check danger" role="alert">
        <span>無法更新訂單，目前顯示上次載入的資料。</span>
        <button type="button" :disabled="loading" @click="loadOrder">重新載入</button>
      </div>

      <!-- ---------- heading ---------- -->
      <header class="page-heading">
        <p v-if="!isAdminView" class="eyebrow">CK PARTY NIGHT</p>
        <h1>訂單詳情</h1>
        <p class="heading-meta" style="margin-bottom: 2ch;">
          ORDER <span class="mono">{{ order.id }}</span>
        </p>
        <div class="heading-actions">
          <button type="button" class="btn-outline" @click="goBack">返回</button>
        </div>
      </header>

      <!-- ---------- staff: who, what, and where it stands ---------- -->
      <template v-if="isAdminView">
        <section class="summary-card" aria-label="訂單摘要">
          <p class="summary-name">{{ order.customerName || '（未填姓名）' }}</p>
          <p v-if="buyerLine" class="summary-meta">{{ buyerLine }}</p>
          <p class="summary-items">{{ itemsText || '尚無票券資料' }}・<span class="num">NT$ {{ Number(order.finalTotal ?? 0).toLocaleString() }}</span></p>
          <div class="status-chips">
            <span class="status-chip" :class="order.paid ? 'good' : 'pending'">{{ order.paid ? '已付款' : '未付款' }}</span>
            <span class="status-chip" :class="order.delivered ? 'good' : 'quiet'">{{ order.delivered ? '已領票' : '未領票' }}</span>
          </div>
        </section>

        <p v-if="statusError" class="qr-check danger" role="alert">{{ statusError }}</p>
        <p v-if="changingStatus" class="check-meta" role="status">正在確認並更新訂單…</p>

        <!-- 領票 happens on the scan page; here: where it stands -->
        <section class="status-row" aria-labelledby="pickup-title">
          <div class="status-row-text">
            <h2 id="pickup-title">領票</h2>
            <p v-if="order.delivered">
              已領票<template v-if="order.deliveryUpdatedByName">・{{ order.deliveryUpdatedByName }}</template>
              <template v-if="order.deliveryUpdatedAt">・{{ formatDateTime(order.deliveryUpdatedAt) }}</template>
            </p>
            <p v-else-if="!order.paid">還沒付款，要先收款才能領票</p>
            <p v-else>還沒領票</p>
            <p v-if="!order.delivered && order.deliveryUpdatedByName" class="status-row-note">
              上次變更：{{ order.deliveryUpdatedByName }}・{{ formatDateTime(order.deliveryUpdatedAt) }}
            </p>
          </div>
          <div class="status-row-actions">
            <button v-if="!order.delivered" type="button" class="btn" @click="goPickup">去領票</button>
            <button v-if="order.delivered && auth.isAdmin" type="button" class="btn-sm" :disabled="changingStatus || loading || loadError" @click="resetOpen = true">
              重設為未領票…
            </button>
          </div>
        </section>

        <section class="status-row" aria-labelledby="payment-title">
          <div class="status-row-text">
            <h2 id="payment-title">付款</h2>
            <p>{{ order.paid ? '已付款' : '未付款' }}</p>
            <p v-if="order.paymentUpdatedByName" class="status-row-note">
              上次變更：{{ order.paymentUpdatedByName }}<template v-if="order.paymentUpdatedAt">・{{ formatDateTime(order.paymentUpdatedAt) }}</template>
            </p>
            <p v-if="order.notices" class="status-row-note">已寄通知：繳費 {{ noticeCounts.payment }} 次・領票 {{ noticeCounts.pickup }} 次</p>
          </div>
          <div v-if="auth.isAdmin" class="status-row-actions">
            <button v-if="!order.paid" type="button" class="btn-sm" :disabled="changingStatus || loading || loadError" @click="setPaid(true)">
              標記已付款
            </button>
            <button v-else type="button" class="btn-sm muted" :disabled="changingStatus || loading || loadError" @click="setPaid(false)">
              改為未付款
            </button>
          </div>
        </section>

        <q-dialog v-model="resetOpen" aria-labelledby="reset-title">
          <form class="pickup-dialog" @submit.prevent="resetDelivered">
            <h2 id="reset-title">重設為未領票？</h2>
            <p class="dialog-lead">這筆訂單會變回「未領票」，可以再領一次。只在誤按領票、或要重新領票時使用。</p>
            <label class="dialog-field">
              原因（必填，會記錄在訂單）
              <input v-model="overrideReason" maxlength="500" placeholder="例如：誤按領票" required>
            </label>
            <div class="dialog-actions">
              <button type="button" class="dialog-cancel" @click="resetOpen = false">取消</button>
              <button type="submit" class="dialog-confirm danger" :disabled="changingStatus || !overrideReason.trim() || loading || loadError">
                重設為未領票
              </button>
            </div>
          </form>
        </q-dialog>
      </template>

      <!-- ---------- buyer: the QR code first, then where it stands ---------- -->
      <template v-else>
        <section class="panel" style="border-top: none; margin-top: 0; padding-top: 0;">
          <h2>訂單 QR Code</h2>
          <p class="panel-copy">領票時請出示此 QR Code 給工作人員掃描</p>

          <div class="order-qr-card">
            <div class="qr-canvas-wrapper">
              <canvas
                ref="qrCanvas"
                class="order-qr"
                width="220"
                height="220"
                role="img"
                :aria-label="`訂單 ${order.id} 的領票 QR Code`"
              />
            </div>

            <p v-if="qrError" role="alert">{{ qrError }}</p>
            <button v-if="qrError" type="button" class="btn" @click="renderQr">
              重新產生 QR Code
            </button>
          </div>

          <div class="status-chips">
            <span class="status-chip" :class="order.paid ? 'good' : 'pending'">{{ order.paid ? '已付款' : '未付款' }}</span>
            <span class="status-chip" :class="order.delivered ? 'good' : 'quiet'">{{ order.delivered ? '已領票' : '未領票' }}</span>
          </div>
        </section>
      </template>

      <!-- ---------- buyer info ---------- -->
      <section class="panel">
        <h2>購票資訊</h2>

        <dl class="info-list">
          <div>
            <dt>訂單編號</dt>
            <dd class="mono">{{ order.id }}</dd>
          </div>
          <div>
            <dt>建立時間</dt>
            <dd class="num">{{ formatDateTime(order.createdAt) }}</dd>
          </div>
          <div v-if="order.customerName">
            <dt>購票人</dt>
            <dd>{{ order.customerName }}</dd>
          </div>
          <div v-if="order.customerEmail">
            <dt>Email</dt>
            <dd class="mono">{{ order.customerEmail }}</dd>
          </div>
          <div v-if="order.customerPhone">
            <dt>聯絡電話</dt>
            <dd class="mono">{{ order.customerPhone }}</dd>
          </div>
          <div v-if="order.complimentary">
            <dt>公關票</dt>
            <dd>{{ guestSourceText(order) }}</dd>
          </div>
          <div v-else-if="order.school">
            <dt>學校</dt>
            <dd>{{ order.school }}</dd>
          </div>
          <div v-if="order.streetSale">
            <dt>路宣登記人</dt>
            <dd>{{ order.promoterName || order.promoterEmail }}</dd>
          </div>
          <div v-if="order.class">
            <dt>班級</dt>
            <dd>{{ order.class }}</dd>
          </div>
          <div v-if="order.number">
            <dt>座號</dt>
            <dd>{{ order.number }}</dd>
          </div>
          <div v-if="order.office">
            <dt>辦公室</dt>
            <dd>{{ order.office }}</dd>
          </div>
        </dl>
      </section>

      <!-- ---------- tickets ---------- -->
      <section class="panel">
        <h2>票券明細</h2>

        <ul v-if="(order.items || []).length" class="product-stats">
          <li v-for="(item, index) in order.items || []" :key="item.id || index">
            <span>{{ item.name }}</span>
            <span class="item-meta">
              <span class="num">× {{ item.quantity }}</span>
              <strong class="num">
                NT$ {{ (Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString() }}
              </strong>
            </span>
          </li>
        </ul>
        <p v-else class="panel-copy">尚無票券資料</p>

        <div v-if="!isAdminView" class="stats-row">
          <div class="stat">
            <div>應付總額</div>
            <div class="num accent">NT$ {{ Number(order.finalTotal ?? 0).toLocaleString() }}</div>
          </div>
          <div class="stat">
            <div>付款狀態</div>
            <div class="num">{{ order.paid ? '已付款' : '未付款' }}</div>
          </div>
          <div class="stat">
            <div>領票狀態</div>
            <div class="num">{{ order.delivered ? '已領票' : '未領票' }}</div>
          </div>
        </div>
      </section>

      <!-- ---------- event ---------- -->
      <section v-if="!isAdminView" class="panel">
        <h2>活動資訊</h2>

        <dl class="info-list">
          <div>
            <dt>活動</dt>
            <dd>CK PARTY NIGHT</dd>
          </div>
          <div>
            <dt>日期</dt>
            <dd>{{ EVENT_DATE_LONG }}</dd>
          </div>
          <div>
            <dt>地點</dt>
            <dd>{{ EVENT_VENUE }}</dd>
          </div>
        </dl>

        <p class="panel-copy">
          請依主辦單位公告之方式及時間辦理領票。入場須使用紙本票券方可入場。
        </p>
      </section>

      <div class="order-actions">
        <button
          type="button"
          class="btn-outline"
          :disabled="downloadingReceipt"
          @click="downloadReceipt"
        >
          {{ downloadingReceipt ? '產生中...' : '下載收據' }}
        </button>

        <button type="button" class="btn" @click="printReceipt">
          列印收據
        </button>
      </div>

      <CancelOrderDialog v-if="isAdminView && auth.isSuperAdmin" v-model="cancelOpen" :orders="[order]" @cancelled="onCancelled" />
      <section v-if="isAdminView && auth.isSuperAdmin && !cancelBlockOf(order)" class="danger-zone">
        <div>
          <h2>取消訂單</h2>
          <p>取消後 QR Code 會失效，已付款的會列入待退款。</p>
        </div>
        <button type="button" class="btn-outline cancel-action" :disabled="changingStatus || loading" @click="cancelOpen = true">
          取消訂單…
        </button>
      </section>

      <footer class="page-footer">
        <span>臺北市立建國高級中學班聯會</span>
        <span>CK PARTY NIGHT 2026 · COSMOS</span>
      </footer>
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { EVENT_DATE_LONG, EVENT_VENUE } from 'src/config/app'
import { guestSourceText } from 'src/data/guests'
import { fetchCancelledOrder, fetchOrder, updateOrderDelivery, updateOrderPayment } from 'src/services/orderService'
import { CANCEL_EMAIL_LABELS, CANCEL_REASONS, REFUND_STATUS_LABELS } from 'src/data/cancellations'
import { cancelBlockOf, noticeCountsOf } from 'src/utils/cancellations'
import CancelOrderDialog from 'src/components/CancelOrderDialog.vue'
import { useAuthStore } from 'src/stores/auth'
import { useScanDeskStore } from 'src/stores/scanDesk'
import { useToastStore } from 'src/stores/toast'
import { formatDateTime } from 'src/utils/datetime'
import { withTimeout } from 'src/utils/withTimeout'
import { getBuyerTypeLabel } from 'src/utils/buyerIdentity'
import { escapeHtml } from 'src/utils/text'
import { downloadElementAsPdf } from 'src/utils/pdf'
import { renderOrderQr } from 'src/utils/qrcode'

// Styles for the plain receipt used by both the print window and the PDF,
// all scoped to .receipt-doc
const RECEIPT_STYLES = `
  .receipt-doc,
  .receipt-doc * {
    box-sizing: border-box;
  }

  .receipt-doc {
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    background: #fff;
    color: #111;
    font-family:
      Arial,
      "Noto Sans TC",
      sans-serif;
    line-height: 1.4;
  }

  /* the PDF copy sits on the site page, so undo Quasar's heading type */
  .receipt-doc h1,
  .receipt-doc h2 {
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: normal;
  }

  .receipt-doc .head {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 24px;
    border-bottom: 2px solid #111;
  }

  .receipt-doc .eyebrow {
    margin-bottom: 8px;
    font-size: 11px;
    letter-spacing: .16em;
    text-transform: uppercase;
  }

  .receipt-doc h1 {
    margin: 0;
    font-size: 28px;
  }

  .receipt-doc .order-id {
    text-align: right;
    font-size: 12px;
    color: #555;
  }

  .receipt-doc .section {
    padding: 24px 0;
    border-bottom: 1px solid #ccc;
  }

  .receipt-doc .section h2 {
    margin: 0 0 16px;
    font-size: 15px;
  }

  .receipt-doc .info {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 8px 16px;
    font-size: 13px;
  }

  .receipt-doc .info .label {
    color: #666;
  }

  .receipt-doc table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .receipt-doc th,
  .receipt-doc td {
    padding: 10px 0;
    border-bottom: 1px solid #ddd;
    text-align: left;
  }

  .receipt-doc th {
    font-size: 11px;
    color: #666;
  }

  .receipt-doc .center {
    text-align: center;
  }

  .receipt-doc .right {
    text-align: right;
  }

  .receipt-doc .sub {
    margin-top: 4px;
    color: #666;
    font-size: 11px;
  }

  .receipt-doc .total {
    display: flex;
    justify-content: space-between;
    padding-top: 18px;
    font-size: 18px;
    font-weight: 700;
  }

  .receipt-doc .note {
    margin-top: 24px;
    padding: 16px;
    background: #f5f5f5;
    font-size: 11px;
    line-height: 1.7;
  }

  .receipt-doc .footer {
    display: flex;
    justify-content: space-between;
    margin-top: 32px;
    padding-top: 14px;
    border-top: 1px solid #111;
    font-size: 10px;
    color: #666;
  }
`

const route = useRoute()
const router = useRouter()

const auth = useAuthStore()
const toast = useToastStore()
// receiving a phone's scans (/admin/scan/desk): 掃描下一張 goes back there
const scanDesk = useScanDeskStore()

const loading = ref(true)
const order = ref(null)
// the order when it is no longer in `orders` but in cancelledOrders
const cancelledOrder = ref(null)
const cancelOpen = ref(false)
const qrCanvas = ref(null)
const loadError = ref(false)
const qrError = ref('')
const changingStatus = ref(false)
const downloadingReceipt = ref(false)
const statusError = ref('')
const overrideReason = ref('')
let loadSequence = 0
// past this, the page offers 重新載入 instead of 載入訂單中… for good
const LOAD_TIMEOUT_MS = 15000

const orderId = computed(() => String(route.params.id || ''))

// /admin/orders/:id is only reachable by managers (router guard)
const isAdminView = computed(() => route.name === 'admin-order-detail' && auth.isManager)

// the ticket code read off the QR code when a phone's own camera app opened
// this page (?c=), passed on to the scan page so the QR code counts there
const scannedCode = String(route.query.c || '')
const resetOpen = ref(false)

const itemsText = computed(() => (order.value?.items || []).map((item) => `${item.name} × ${item.quantity}`).join('、'))
// 學生・建國中學 205 班 12 號
const buyerLine = computed(() => {
  const current = order.value
  if (!current) return ''
  const seat = [current.class && `${current.class} 班`, current.number && `${current.number} 號`].filter(Boolean).join(' ')
  return [getBuyerTypeLabel(current), current.complimentary ? guestSourceText(current) : current.school, seat, current.office]
    .filter(Boolean)
    .join('・')
})

// 領票 happens on the scan page (or the computer paired with phones)
function goPickup() {
  const query = { order: order.value.id, ...(scannedCode ? { c: scannedCode } : {}) }
  router.push({ name: scanDesk.active ? 'admin-scan-desk' : 'admin-scan', query })
}

const noticeCounts = computed(() => noticeCountsOf(order.value))

function onCancelled({ refundAmount }) {
  toast.show(refundAmount ? `已取消訂單，待退款 NT$ ${refundAmount.toLocaleString()}` : '已取消訂單')
  order.value = null
  loadOrder()
}

async function loadOrder() {
  const sequence = ++loadSequence
  const id = orderId.value
  loading.value = true
  loadError.value = false

  try {
    // staff can read any order, a buyer only their own (firestore.rules);
    // a cancelled one moved to cancelledOrders, where the same holds
    const result = await withTimeout(fetchOrder(id), LOAD_TIMEOUT_MS)
    const cancelled = result ? null : await withTimeout(fetchCancelledOrder(id), LOAD_TIMEOUT_MS)
    if (sequence !== loadSequence) return

    order.value = result ? { ...result, delivered: Boolean(result.delivered) } : null
    cancelledOrder.value = cancelled
  } catch (error) {
    console.error('Failed to load order:', error)
    if (sequence !== loadSequence) return
    loadError.value = true
  } finally {
    if (sequence === loadSequence) loading.value = false
  }

  if (sequence === loadSequence && order.value) await renderQr()
}

async function renderQr() {
  qrError.value = ''
  if (!order.value) return
  await nextTick()

  try {
    if (qrCanvas.value) await renderOrderQr(qrCanvas.value, order.value)
  } catch (error) {
    console.error(`QR Code 產生失敗：${order.value.id}`, error)
    qrError.value = '目前無法產生 QR Code，請重新產生。'
  }
}

// an admin's 重設為未領票 (collecting goes through the station)
async function resetDelivered() {
  if (!isAdminView.value || !auth.isAdmin || !order.value?.delivered || changingStatus.value || loading.value || loadError.value) return
  const reason = overrideReason.value.trim()
  if (!reason) return
  changingStatus.value = true
  statusError.value = ''
  const id = order.value.id
  try {
    const patch = await updateOrderDelivery(id, false, { expectedDelivered: true, overrideReason: reason })
    if (orderId.value !== id) return
    order.value = { ...order.value, ...patch, delivered: false }
    overrideReason.value = ''
    resetOpen.value = false
    toast.show('已標記為未領票')
  } catch (error) {
    console.error(error)
    if (orderId.value !== id) return
    statusError.value = error.message || '更新失敗，請重新確認訂單狀態。'
    resetOpen.value = false
    await loadOrder()
  } finally {
    if (orderId.value === id) changingStatus.value = false
  }
}

async function setPaid(paid) {
  if (!auth.isAdmin || !order.value || changingStatus.value || loading.value || loadError.value || Boolean(order.value.paid) === paid) return
  changingStatus.value = true
  statusError.value = ''
  const id = order.value.id
  try {
    const patch = await updateOrderPayment(id, paid, Boolean(order.value.paid))
    if (orderId.value !== id) return
    order.value = { ...order.value, ...patch }
    toast.show(paid ? '已確認付款' : '已重設為未付款')
  } catch (error) {
    if (orderId.value !== id) return
    statusError.value = error.message || '更新失敗，請重新確認付款狀態。'
    await loadOrder()
  } finally {
    if (orderId.value === id) changingStatus.value = false
  }
}

function buildReceiptMarkup() {
  if (!order.value) {
    return ''
  }

  const currentOrder = order.value

  const items = (
    currentOrder.items || []
  )
    .map((item) => {
      const quantity =
        Number(item.quantity || 0)

      const price =
        Number(item.price || 0)

      const subtotal =
        quantity * price

      return `
        <tr>
          <td>
            ${escapeHtml(item.name)}
          </td>

          <td class="center">
            ${quantity}
          </td>

          <td class="right">
            NT$ ${subtotal.toLocaleString()}
          </td>
        </tr>
      `
    })
    .join('')

  const total = Number(currentOrder.finalTotal || 0)
  const buyerName = currentOrder.customerName || '—'
  const email = currentOrder.customerEmail || '—'
  const phone = currentOrder.customerPhone || '—'

  return `
  <div class="receipt-doc">
    <div class="head">
      <div>
        <div class="eyebrow">
          CK PARTY NIGHT
        </div>

        <h1>購票收據</h1>
      </div>

      <div class="order-id">
        <div>訂單編號</div>

        <strong>
          ${escapeHtml(
            currentOrder.id
          )}
        </strong>
      </div>
    </div>

    <div class="section">
      <h2>購票資訊</h2>

      <div class="info">
        <div class="label">購票人</div>
        <div>
          ${escapeHtml(buyerName)}
        </div>

        <div class="label">Email</div>
        <div>
          ${escapeHtml(email)}
        </div>

        <div class="label">聯絡電話</div>
        <div>
          ${escapeHtml(phone)}
        </div>

        <div class="label">學校</div>
        <div>
          ${escapeHtml(currentOrder.school || '—')}
        </div>
${
  currentOrder.class
    ? `
        <div class="label">班級 / 座號</div>
        <div>
          ${escapeHtml(currentOrder.class)} / ${escapeHtml(currentOrder.number || '—')}
        </div>
`
    : ''
}${
  currentOrder.office
    ? `
        <div class="label">辦公室</div>
        <div>
          ${escapeHtml(currentOrder.office)}
        </div>
`
    : ''
}
        <div class="label">建立時間</div>
        <div>
          ${escapeHtml(
            formatDateTime(
              currentOrder.createdAt
            )
          )}
        </div>

        <div class="label">領票狀態</div>
        <div>
          ${
            currentOrder.delivered
              ? '已領票'
              : '未領票'
          }
        </div>
      </div>
    </div>

    <div class="section">
      <h2>票券明細</h2>

      <table>
        <thead>
          <tr>
            <th>票券</th>
            <th class="center">
              數量
            </th>
            <th class="right">
              小計
            </th>
          </tr>
        </thead>

        <tbody>
          ${items}
        </tbody>
      </table>

      <div class="total">
        <span>應付總額</span>

        <span>
          NT$ ${total.toLocaleString()}
        </span>
      </div>
    </div>

    <div class="section">
      <h2>活動資訊</h2>

      <div class="info">
        <div class="label">活動</div>
        <div>CK PARTY NIGHT</div>

        <div class="label">日期</div>
        <div>${EVENT_DATE_LONG}</div>

        <div class="label">地點</div>
        <div>${EVENT_VENUE}</div>
      </div>
    </div>

    <div class="note">
      請依主辦單位公告之方式及時間辦理領票。
      入場時請依現場工作人員指示出示相關購票資訊。
    </div>

    <div class="footer">
      <span>
        臺北市立建國高級中學班聯會
      </span>

      <span>
        CK PARTY NIGHT 2026
      </span>
    </div>
  </div>
`
}

function buildReceiptHtml() {
  return `
<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>CK PARTY NIGHT 購票收據</title>

<style>
  body {
    margin: 0;
    padding: 40px;
    background: #fff;
  }

  @media print {
    body {
      padding: 0;
    }
  }

${RECEIPT_STYLES}</style>
</head>

<body>
${buildReceiptMarkup()}</body>
</html>
  `
}

async function downloadReceipt() {
  if (!order.value || downloadingReceipt.value) {
    return
  }

  downloadingReceipt.value = true

  // html2pdf renders a copy of this off-page element; every rule in
  // RECEIPT_STYLES is scoped to .receipt-doc so nothing leaks onto the page
  const element = document.createElement('div')
  element.innerHTML = `<style>${RECEIPT_STYLES}</style>${buildReceiptMarkup()}`

  try {
    await downloadElementAsPdf(element, `CK-PARTY-NIGHT-${order.value.id}.pdf`)
  } catch (error) {
    console.error('PDF generation failed:', error)
    toast.show('收據 PDF 產生失敗，請稍後再試')
  } finally {
    downloadingReceipt.value = false
  }
}

function printReceipt() {
  if (!order.value) {
    return
  }

  const html = buildReceiptHtml()

  const printWindow =
    window.open(
      '',
      '_blank',
      'width=900,height=900'
    )

  if (!printWindow) {
    toast.show(
      '無法開啟列印視窗，請確認瀏覽器未封鎖彈出視窗'
    )

    return
  }

  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()

  printWindow.focus()

  setTimeout(() => {
    printWindow.print()
  }, 300)
}

function goBack() {
  if (window.history.length > 1) {
    router.back()
    return
  }

  // opened straight from a QR scan: go to the admin area, not the shop
  router.push(isAdminView.value ? { name: 'admin' } : '/')
}

watch(orderId, () => {
  order.value = null
  cancelledOrder.value = null
  statusError.value = ''
  overrideReason.value = ''
  changingStatus.value = false
  loadOrder()
}, { immediate: true })
</script>

<style scoped>
@import 'src/css/orderdetailpage.scss';
</style>

<!-- the 重設為未領票 dialog -->
<style lang="scss">
@import 'src/css/pickupdialog.scss';
</style>
