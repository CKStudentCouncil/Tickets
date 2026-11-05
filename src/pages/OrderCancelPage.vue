<template>
  <div class="admin-page cancel-page">
    <div class="page-heading">
      <p class="eyebrow">後台管理</p>
      <h1>取消與退款</h1>
      <p class="panel-copy heading-copy">
        取消的訂單會移到這裡，留下取消原因、經手人與退款；票券與每人購買額度退回，訂單不再列入後台總覽、銷售報表與通知
      </p>
      <router-link :to="{ name: 'admin' }" class="btn-outline back-link">回後台管理</router-link>
    </div>

    <!-- ---------- 逾期處理 ---------- -->
    <section class="panel first-panel" aria-labelledby="overdue-title">
      <h2 id="overdue-title">逾期處理</h2>
      <p class="panel-copy">
        依銷售條款，寄過繳費通知仍未付款（第三條）、或寄過 {{ PICKUP_NOTICES_TO_CANCEL }} 次領票通知仍未領票（第四條）的訂單可以取消；通知次數只計郵件服務已接受的繳費、領票與繳費暨取票通知
      </p>

      <div class="tabs" role="tablist" aria-label="逾期類型">
        <button
          v-for="(label, key) in OVERDUE_KINDS"
          :key="key"
          type="button"
          role="tab"
          :class="{ active: kind === key }"
          :aria-selected="kind === key"
          @click="setKind(key)"
        >
          {{ label }}<span v-if="allOrders" class="num tab-count">{{ overdueOf(key).length }}</span>
        </button>
      </div>

      <div class="toolbar">
        <button type="button" class="btn-outline" :disabled="loadingOrders" @click="loadOrders">
          {{ loadingOrders ? '載入中…' : allOrders ? '重新整理' : '載入訂單' }}
        </button>
        <button v-if="overdue.length" type="button" class="btn-outline" @click="toggleAllOverdue">
          {{ allOverdueSelected ? '全部不選' : `全選（${overdue.length}）` }}
        </button>
        <span v-if="ordersLoadedAt" class="toolbar-meta">
          {{ formatDateTime(ordersLoadedAt) }} 載入・共 <span class="num">{{ allOrders.length }}</span> 筆訂單
        </span>
      </div>

      <p v-if="ordersError" class="error-line" role="alert">{{ ordersError }}</p>
      <p v-else-if="!allOrders && !loadingOrders" class="empty">按「載入訂單」找出{{ OVERDUE_KINDS[kind] }}的訂單（會讀取全部訂單一次）</p>
      <p v-else-if="allOrders && !overdue.length" class="empty">目前沒有{{ OVERDUE_KINDS[kind] }}的訂單</p>

      <ul v-if="overdue.length" class="row-list">
        <li
          v-for="order in overdue"
          :key="order.id"
          class="row selectable"
          :class="{ selected: selectedIds.has(order.id) }"
          @click="rowClick($event, order.id)"
        >
          <label class="row-check">
            <input type="checkbox" :checked="selectedIds.has(order.id)" @change="toggleSelected(order.id)">
            <span class="sr-only">選取 {{ order.id }}</span>
          </label>
          <div class="row-main">
            <p class="row-title">
              <router-link class="mono" :to="{ name: 'admin-order-detail', params: { id: order.id } }">{{ order.id }}</router-link>
              <span>{{ order.customerName || '—' }}</span>
            </p>
            <p class="row-meta">{{ buyerLine(order) }}</p>
          </div>
          <div class="row-side">
            <p class="num">NT$ {{ Number(order.finalTotal || 0).toLocaleString() }}・{{ order.paid ? '已付款' : '未付款' }}</p>
            <p class="row-meta">
              繳費通知 {{ noticeCountsOf(order).payment }} 次・領票通知 {{ noticeCountsOf(order).pickup }} 次
            </p>
            <p v-if="lastNotice(order)" class="row-meta">最後通知 {{ formatDateTime(lastNotice(order)) }}</p>
          </div>
        </li>
      </ul>

      <div v-if="selectedOverdue.length" class="selection-bar" role="region" aria-label="已選取的訂單">
        <span>
          已選 <strong class="num">{{ selectedOverdue.length }}</strong> 筆・NT$ <span class="num">{{ sumOf(selectedOverdue).toLocaleString() }}</span>
          <template v-if="selectedPaid.length">・已付款 <span class="num">{{ selectedPaid.length }}</span> 筆</template>
        </span>
        <button type="button" class="btn-outline danger" @click="openCancel(selectedOverdue)">取消所選訂單</button>
        <button type="button" class="btn-outline" @click="selectedIds = new Set()">清除選取</button>
      </div>
    </section>

    <!-- ---------- 已取消訂單與退款 ---------- -->
    <section class="panel" aria-labelledby="cancelled-title">
      <div class="panel-head">
        <h2 id="cancelled-title">{{ PARTY_YEAR }} 已取消訂單</h2>
        <button type="button" class="btn-outline" :disabled="loadingCancelled" @click="loadCancelled">
          {{ loadingCancelled ? '載入中…' : '重新整理' }}
        </button>
      </div>

      <div class="stats-row">
        <div class="stat">取消訂單<span class="num">{{ summary.count }} 筆</span></div>
        <div class="stat">待退款<span class="num">NT$ {{ summary.pending.toLocaleString() }}</span></div>
        <div class="stat">已退款<span class="num">NT$ {{ summary.refunded.toLocaleString() }}</span></div>
        <div class="stat">未退還款項<span class="num">NT$ {{ summary.retained.toLocaleString() }}</span></div>
      </div>
      <p class="panel-copy">未退還款項是已付款、取消時決定不退或部分退的金額，列入報帳管理的收支表</p>

      <div class="filter-block">
        <label for="refund-filter">退款狀態：</label>
        <select id="refund-filter" v-model="refundFilter">
          <option value="all">全部</option>
          <option v-for="(label, key) in REFUND_STATUS_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
      <div class="filter-block">
        <label for="cancelled-search">搜尋：</label>
        <input id="cancelled-search" v-model="search" type="search" placeholder="訂單編號、姓名、Email、電話" autocomplete="off">
      </div>

      <p v-if="cancelledError" class="error-line" role="alert">
        {{ cancelledError }} <button type="button" class="btn-outline row-action" @click="loadCancelled">重試</button>
      </p>
      <p v-else-if="loadingCancelled && !cancelled.length" class="empty" role="status">載入中…</p>
      <p v-else-if="!visibleCancelled.length" class="empty">{{ cancelled.length ? '沒有符合條件的訂單' : '還沒有取消的訂單' }}</p>

      <ul v-if="visibleCancelled.length" class="row-list">
        <li v-for="order in visibleCancelled" :key="order.id" class="row">
          <div class="row-main">
            <p class="row-title">
              <router-link class="mono" :to="{ name: 'admin-order-detail', params: { id: order.id } }">{{ order.id }}</router-link>
              <span>{{ order.customerName || '—' }}</span>
            </p>
            <p class="row-reason">
              {{ CANCEL_REASONS[order.cancelReason] || '—' }}<template v-if="order.cancelNote">：{{ order.cancelNote }}</template>
            </p>
            <p class="row-meta">
              {{ formatDateTime(order.cancelledAt) }}・{{ order.cancelledByName || '—' }} 取消
              <template v-if="order.cancelEmailStatus">・取消通知{{ CANCEL_EMAIL_LABELS[order.cancelEmailStatus] || order.cancelEmailStatus }}</template>
            </p>
            <p class="row-meta">{{ buyerLine(order) }}</p>
          </div>
          <div class="row-side">
            <p class="num">NT$ {{ Number(order.finalTotal || 0).toLocaleString() }}・{{ order.paid ? '已付款' : '未付款' }}</p>
            <p v-if="order.paid">
              <span class="refund-tag" :class="order.refundStatus">
                {{ REFUND_STATUS_LABELS[order.refundStatus] || '—' }}<template v-if="order.refundAmount"> NT$ {{ Number(order.refundAmount).toLocaleString() }}</template>
              </span>
            </p>
            <p v-if="order.refundStatus === 'done'" class="row-meta">
              {{ order.refundedByName || '—' }}・{{ formatDateTime(order.refundedAt) }}
            </p>
            <button
              v-if="order.refundStatus === 'pending'"
              type="button"
              class="btn-outline row-action"
              :disabled="refundBusy.has(order.id)"
              @click="setRefunded(order, true)"
            >
              標記已退款
            </button>
            <button
              v-if="order.refundStatus === 'done'"
              type="button"
              class="btn-outline row-action"
              :disabled="refundBusy.has(order.id)"
              @click="setRefunded(order, false)"
            >
              改回待退款
            </button>
          </div>
        </li>
      </ul>
    </section>

    <CancelOrderDialog v-model="cancelOpen" :orders="cancelTargets" :default-reason="kind" @cancelled="onCancelled" />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import CancelOrderDialog from 'src/components/CancelOrderDialog.vue'
import { CANCEL_EMAIL_LABELS, CANCEL_REASONS, PICKUP_NOTICES_TO_CANCEL, REFUND_STATUS_LABELS } from 'src/data/cancellations'
import { PARTY_YEAR } from 'src/services/partySurveyService'
import { fetchAllOrders, fetchCancelledOrders, updateRefundStatus } from 'src/services/orderService'
import { useToastStore } from 'src/stores/toast'
import { lastNoticeAt, noticeCountsOf, overdueOrders, summarizeCancellations } from 'src/utils/cancellations'
import { formatDateTime } from 'src/utils/datetime'

const toast = useToastStore()

const OVERDUE_KINDS = { unpaid: '逾期未繳費', uncollected: '逾期未領票' }

const sumOf = (list) => list.reduce((total, order) => total + (Number(order.finalTotal) || 0), 0)

function buyerLine(order) {
  const school = [order.school, order.class, order.number && `${order.number} 號`].filter(Boolean).join(' ')
  return [school, order.customerPhone, order.customerEmail].filter(Boolean).join('・') || '—'
}

/* ---------- 逾期處理: every order, read once on request ---------- */

const kind = ref('uncollected')
const allOrders = ref(null)
const loadingOrders = ref(false)
const ordersError = ref('')
const ordersLoadedAt = ref(null)
const selectedIds = ref(new Set())

const overdueOf = (key) => (allOrders.value ? overdueOrders(allOrders.value, key) : [])
const overdue = computed(() => overdueOf(kind.value))
const selectedOverdue = computed(() => overdue.value.filter((order) => selectedIds.value.has(order.id)))
const selectedPaid = computed(() => selectedOverdue.value.filter((order) => order.paid === true))
const allOverdueSelected = computed(() => overdue.value.length > 0 && selectedOverdue.value.length === overdue.value.length)
const lastNotice = (order) => lastNoticeAt(order, kind.value === 'unpaid' ? 'payment' : 'pickup')

function setKind(key) {
  kind.value = key
  selectedIds.value = new Set()
}

function toggleSelected(orderId) {
  const next = new Set(selectedIds.value)
  if (next.has(orderId)) next.delete(orderId)
  else next.add(orderId)
  selectedIds.value = next
}

// a tap anywhere on the row but its link or checkbox picks the order
function rowClick(event, orderId) {
  if (event.target.closest('a, button, input, label')) return
  toggleSelected(orderId)
}

function toggleAllOverdue() {
  selectedIds.value = allOverdueSelected.value ? new Set() : new Set(overdue.value.map((order) => order.id))
}

async function loadOrders() {
  if (loadingOrders.value) return
  loadingOrders.value = true
  ordersError.value = ''
  try {
    allOrders.value = await fetchAllOrders()
    ordersLoadedAt.value = new Date()
    const ids = new Set(allOrders.value.map((order) => order.id))
    selectedIds.value = new Set([...selectedIds.value].filter((id) => ids.has(id)))
  } catch (error) {
    console.error(error)
    ordersError.value = '訂單載入失敗，請重試'
  } finally {
    loadingOrders.value = false
  }
}

/* ---------- 取消 ---------- */

const cancelOpen = ref(false)
const cancelTargets = ref([])

function openCancel(orders) {
  cancelTargets.value = [...orders]
  cancelOpen.value = true
}

function onCancelled({ orderIds, refundAmount }) {
  const gone = new Set(orderIds)
  if (allOrders.value) allOrders.value = allOrders.value.filter((order) => !gone.has(order.id))
  selectedIds.value = new Set([...selectedIds.value].filter((id) => !gone.has(id)))
  const what = orderIds.length > 1 ? `已取消 ${orderIds.length} 筆訂單` : '已取消訂單'
  toast.show(refundAmount ? `${what}，待退款 NT$ ${refundAmount.toLocaleString()}` : what)
  loadCancelled()
}

/* ---------- 已取消訂單與退款 ---------- */

const cancelled = ref([])
const loadingCancelled = ref(false)
const cancelledError = ref('')
const refundFilter = ref('all')
const search = ref('')
const refundBusy = reactive(new Set())

const summary = computed(() => summarizeCancellations(cancelled.value))

const visibleCancelled = computed(() => {
  const q = search.value.normalize('NFKC').trim().toLowerCase()
  return cancelled.value.filter((order) =>
    (refundFilter.value === 'all' || (order.refundStatus || 'none') === refundFilter.value) &&
    (!q || [order.id, order.customerName, order.customerEmail, order.customerPhone]
      .some((value) => String(value || '').toLowerCase().includes(q)))
  )
})

let cancelledSequence = 0
async function loadCancelled() {
  const sequence = ++cancelledSequence
  loadingCancelled.value = true
  cancelledError.value = ''
  try {
    const list = await fetchCancelledOrders(PARTY_YEAR)
    if (sequence === cancelledSequence) cancelled.value = list
  } catch (error) {
    console.error(error)
    if (sequence === cancelledSequence) cancelledError.value = '已取消訂單載入失敗'
  } finally {
    if (sequence === cancelledSequence) loadingCancelled.value = false
  }
}

// No confirmation: the change is recorded with who made it, and the button
// that undoes it (改回待退款 / 標記已退款) takes its place at once
async function setRefunded(order, refunded) {
  if (refundBusy.has(order.id)) return
  refundBusy.add(order.id)
  try {
    const patch = await updateRefundStatus(order.id, refunded, order.refundStatus === 'done')
    Object.assign(order, patch)
    toast.show(refunded
      ? `${order.customerName || order.id} 已標記為已退款；按「改回待退款」可復原`
      : `${order.customerName || order.id} 已改回待退款`)
  } catch (error) {
    console.error(error)
    if (error?.details?.refundStatus) Object.assign(order, error.details)
    toast.show(error?.message || '退款狀態更新失敗，請重試')
  } finally {
    refundBusy.delete(order.id)
  }
}

onMounted(loadCancelled)
</script>

<style scoped>
@import 'src/css/adminpage.scss';
@import 'src/css/ordercancelpage.scss';
</style>
