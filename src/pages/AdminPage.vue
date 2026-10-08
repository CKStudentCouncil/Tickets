<template>
  <div
    v-if="auth.loading"
    class="state-screen"
  >
    <p>載入中...</p>
  </div>

  <div
    v-else-if="!canAccessAdmin"
    class="state-screen"
  >
    <h2>權限不足</h2>
    <button
      type="button"
      class="btn"
      @click="$router.push('/')"
    >
      回到首頁
    </button>
  </div>

  <div
    v-else
    class="admin-page"
  >

    <div class="page-heading">
      <p class="eyebrow">後台管理</p>
      <h1>{{ canManageOrders ? '後台管理' : '通知管理' }}</h1>
    </div>

    <div
      v-if="canManageOrders"
      class="filter-block"
    >
      <label for="admin-school">篩選學校：</label>
      <select id="admin-school" v-model="selectedSchool">
        <option value="all">全部</option>
        <option
          v-for="school in schools"
          :key="school"
          :value="school"
        >
          {{ school }}
        </option>
      </select>
    </div>

    <div
      v-if="canManageOrders"
      class="filter-block"
    >
      <label for="admin-search">搜尋本頁訂購者：</label>
      <input
        id="admin-search"
        v-model="customerSearchInput"
        type="text"
        placeholder="僅搜尋目前這 50 筆：姓名、Email 或電話"
      >
    </div>

    <div
      v-if="canManageOrders"
      class="filter-block"
    >
      <label for="admin-email-filter">確認信：</label>
      <select id="admin-email-filter" v-model="emailFilter">
        <option value="all">全部</option>
        <option value="failed">寄送失敗</option>
        <option value="pending">待寄送／重試中</option>
        <option value="uncertain">寄送結果待查</option>
        <option value="accepted">郵件服務已接受</option>
      </select>
    </div>

    <div
      v-if="canManageOrders"
      class="tabs"
    >
      <button
        type="button"
        :class="{ active: activeTab === 'all' }"
        :aria-pressed="activeTab === 'all'"
        @click="setActiveTab('all')"
      >
        全部訂單
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'delivered' }"
        :aria-pressed="activeTab === 'delivered'"
        @click="setActiveTab('delivered')"
      >
        已領票
      </button>
    </div>

    <form v-if="canManageOrders" class="filter-block" @submit.prevent="lookupExactOrder">
      <label for="admin-order-id">查找完整訂單編號（所有訂單）：</label>
      <input id="admin-order-id" v-model="exactOrderId" placeholder="輸入完整訂單編號" required>
      <button class="btn" type="submit" :disabled="lookingUpOrder">{{ lookingUpOrder ? '查找中…' : '開啟訂單' }}</button>
      <p v-if="lookupError" role="alert">{{ lookupError }}</p>
    </form>

    <div class="panel notify-panel">
      <div class="notify-header">
        <h2>自動寄送通知</h2>
        <button type="button" class="btn" @click="openNotifyModal">
          編輯並發送
        </button>
      </div>
      <p v-if="pendingJob" role="status">{{ notificationProgress }}</p>
      <p v-if="notificationError" role="alert">{{ notificationError }}</p>
    </div>

    <q-dialog v-model="showNotifyModal" :persistent="sendingNotify" aria-labelledby="notify-title">
      <div class="modal notify-modal">
        <h2 id="notify-title">編輯{{ notifyTypeLabel }}</h2>

        <div class="type-select">
          <span class="field-label">通知類型</span>
          <div class="type-options">
            <button
              type="button"
              class="type-option"
              :class="{ active: notifyForm.type === 'payment' }"
              :aria-pressed="notifyForm.type === 'payment'"
              @click="notifyForm.type = 'payment'"
            >
              繳費
            </button>
            <button
              type="button"
              class="type-option"
              :class="{ active: notifyForm.type === 'pickup' }"
              :aria-pressed="notifyForm.type === 'pickup'"
              @click="notifyForm.type = 'pickup'"
            >
              領票
            </button>
            <button
              type="button"
              class="type-option"
              :class="{ active: notifyForm.type === 'both' }"
              :aria-pressed="notifyForm.type === 'both'"
              @click="notifyForm.type = 'both'"
            >
              繳費暨領票
            </button>
            <button
              type="button"
              class="type-option"
              :class="{ active: notifyForm.type === 'custom' }"
              :aria-pressed="notifyForm.type === 'custom'"
              @click="notifyForm.type = 'custom'"
            >
              自訂訊息
            </button>
          </div>
        </div>

        <div class="filter-block">
          <label for="notify-school" class="field-label">通知對象</label>
          <select id="notify-school" v-model="notifyForm.school">
            <option value="all">全部學校</option>
            <option
              v-for="school in schools"
              :key="school"
              :value="school"
            >
              {{ school }}
            </option>
          </select>
        </div>

        <label v-if="notifyForm.type === 'custom'" class="field">
          <span>主旨</span>
          <input
            v-model="notifyForm.subject"
            type="text"
            placeholder="例如：關於建中舞會的重要通知"
          >
        </label>

        <label v-if="notifyForm.type !== 'pickup' && notifyForm.type !== 'custom'" class="field">
          <span>繳費時間</span>
          <input
            v-model="notifyForm.paymentTime"
            type="text"
            placeholder="例如：8/15（五）12:00–13:00"
          >
        </label>

        <label v-if="notifyForm.type !== 'payment' && notifyForm.type !== 'custom'" class="field">
          <span>領票時間</span>
          <input
            v-model="notifyForm.pickupTime"
            type="text"
            placeholder="例如：8/20（三）12:00–13:00"
          >
        </label>

        <label v-if="notifyForm.type !== 'custom'" class="field">
          <span>{{ notifyForm.type === 'both' ? '地點（繳費與領票共用）' : '地點' }}</span>
          <input
            v-model="notifyForm.location"
            type="text"
            placeholder="例如：建中夢紅樓一樓"
          >
        </label>

        <label class="field">
          <span>{{ notifyForm.type === 'custom' ? '訊息內容' : '補充說明（選填）' }}</span>
          <textarea
            v-model="notifyForm.message"
            rows="4"
            :placeholder="notifyForm.type === 'custom' ? '請輸入要寄送給訂購者的訊息內容' : '例如：請出示 QR Code 給工作人員，以完成繳費或領票。'"
          />
        </label>

        <div class="notify-preview">
          <p class="preview-label">預覽內容</p>
          <template v-if="notifyForm.type === 'custom'">
            <p>主旨：<strong>{{ notifyForm.subject || '（尚未填寫）' }}</strong></p>
            <p>內容：{{ notifyForm.message || '（尚未填寫）' }}</p>
          </template>
          <template v-else>
            <p v-if="notifyForm.type !== 'pickup'">繳費時間：<strong>{{ notifyForm.paymentTime || '（尚未填寫）' }}</strong></p>
            <p v-if="notifyForm.type !== 'payment'">領票時間：<strong>{{ notifyForm.pickupTime || '（尚未填寫）' }}</strong></p>
            <p>地點：<strong>{{ notifyForm.location || '（尚未填寫）' }}</strong></p>
            <p v-if="notifyForm.message">補充說明：{{ notifyForm.message }}</p>
          </template>
          <p class="preview-count">將發送給{{ notifyTargetSchoolLabel }}的訂購者（確認前會顯示完整人數）</p>
        </div>

        <div class="notify-actions">
          <p v-if="pendingJob" class="preview-count" role="status">{{ notificationProgress }}</p>
          <p v-if="notificationError" role="alert">{{ notificationError }}</p>
          <button
            v-if="pendingJob"
            type="button"
            class="btn"
            :disabled="sendingNotify"
            @click="pollNotificationStatus"
          >
            {{ sendingNotify ? '處理中…' : '檢查寄送進度' }}
          </button>
          <button v-if="needsNotificationEnqueue(pendingJob)" type="button" class="btn" :disabled="sendingNotify" @click="runNotificationJob(pendingJob)">繼續加入寄送佇列</button>
          <button v-if="canClearNotification(pendingJob)" type="button" class="btn-outline" @click="setPendingJob(null)">清除本機紀錄</button>
          <button
            v-if="!pendingJob"
            type="button"
            class="btn"
            :disabled="!canSendNotify || sendingNotify"
            @click="confirmSendNotify"
          >
            {{ sendingNotify ? '發送中...' : '確認發送' }}
          </button>
          <button
            type="button"
            class="btn-outline"
            :disabled="sendingNotify"
            @click="closeNotifyModal"
          >
            取消
          </button>
        </div>
      </div>
    </q-dialog>

    <div
      v-if="canManageOrders"
      class="panel export-panel"
    >
      <div>
        <h2>所選篩選條件的完整總覽</h2>
        <p>依學校、確認信與領票分頁統計；不包含本頁姓名搜尋。</p>
        <p v-if="summaryUpdatedAt">總覽更新於 {{ formatDate(summaryUpdatedAt) }}</p>
        <button type="button" class="btn-outline" :disabled="summaryLoading" @click="refreshSummary">更新總覽</button>
        <p v-if="summaryLoading" role="status">更新總覽中…</p>
        <p v-if="summaryError" role="alert">{{ summaryError }} <button type="button" class="btn-outline" @click="refreshSummary">重試</button></p>
        <div v-if="summary" class="stats-row">
          <div class="stat"><div>訂單數</div><div class="num">{{ summary.orderCount }}</div></div>
          <div class="stat"><div>訂單應收金額</div><div class="num">NT$ {{ summary.bookedAmount.toLocaleString() }}</div></div>
          <div class="stat"><div>已收款金額</div><div class="num">NT$ {{ summary.paidAmount.toLocaleString() }}</div></div>
          <div class="stat"><div>已領票訂單數</div><div class="num">{{ summary.deliveredOrderCount }}</div></div>
        </div>
      </div>
      <button type="button" class="btn" :disabled="exporting" @click="exportToExcel">
        {{ exporting ? '匯出中…' : '匯出完整篩選結果 Excel' }}
      </button>
    </div>

    <div
      v-if="canManageOrders && activeTab === 'delivered' && Object.keys(deliveryStats).length > 0"
      class="panel"
    >
      <h2>本頁領票人員統計</h2>
      <div class="personnel-grid">
        <div
          v-for="(stats, personnel) in deliveryStats"
          :key="personnel"
          class="personnel-card"
        >
          <p class="personnel-name">{{ personnel }}</p>
          <p class="personnel-stat">訂單數：<span class="num">{{ stats.count }}</span></p>
          <p class="personnel-stat total">金額：<span class="num">NT$ {{ stats.totalAmount }}</span></p>
        </div>
      </div>
    </div>

    <div
      v-if="canManageOrders"
      class="panel"
    >
      <h2>本頁票券數量（{{ currentStats.ticketCount }} 張）</h2>
      <ul
        v-if="Object.keys(currentStats.productCounts).length"
        class="product-stats"
      >
        <li
          v-for="(total, name) in currentStats.productCounts"
          :key="name"
        >
          <span>{{ name }}</span>
          <span class="num">總數量：{{ total }}</span>
        </li>
      </ul>
      <p v-else class="empty">尚無統計資料</p>
    </div>

    <div
      v-if="canManageOrders"
      class="orders-section"
    >
      <h2>{{ activeTab === 'delivered' ? '已領票訂單' : '所有訂單' }}</h2>
      <p v-if="loading" role="status">載入第 {{ pageNumber }} 頁中…</p>
      <p v-if="loadError" role="alert">{{ loadError }} <button type="button" class="btn" @click="fetchOrders()">重試</button></p>
      <p v-else-if="fromCache" role="status">目前顯示快取資料，連線恢復後會更新。</p>
      <div class="order-page-actions">
        <button type="button" class="btn-outline" :disabled="loading || pageNumber === 1" @click="previousPage">上一頁</button>
        <span>第 {{ pageNumber }} 頁・每頁最多 50 筆</span>
        <button type="button" class="btn-outline" :disabled="loading || !hasNext" @click="nextPage">下一頁</button>
      </div>
      <div
        v-for="order in currentOrders"
        :key="order.id"
        class="order-card"
      >
        <div
          class="delivery-bar"
          :class="order.delivered ? 'delivered' : 'pending'"
        >
          <span class="status-dot" />
          <span>領票狀態：{{ order.delivered ? '已領票' : '未領票' }}</span>
          <div class="delivery-actions">
            <button type="button" class="btn-sm" @click="viewOrderDetail(order.id)">開啟領票驗證</button>
          </div>
        </div>
        <div class="delivery-bar" :class="order.paid ? 'paid' : 'pending'">
          <span>付款狀態：{{ order.paid ? '已付款' : '未付款' }}</span>
          <div class="delivery-actions">
            <button type="button" class="btn-sm" :disabled="order.paid || pendingPaymentIds.has(order.id)" @click="updatePaymentStatus(order.id, true)">標記已付款</button>
            <button type="button" class="btn-sm muted" :disabled="!order.paid || pendingPaymentIds.has(order.id)" @click="updatePaymentStatus(order.id, false)">標記未付款</button>
          </div>
        </div>
        <p><strong>訂單ID：</strong><span class="mono">{{ order.id }}</span></p>
        <p><strong>折扣後金額：</strong><span class="num">NT$ {{ order.finalTotal }}</span></p>
        <p><strong>購買時間：</strong><span class="num">{{ formatDate(order.createdAt) }}</span></p>
        <p><strong>最後領票更新者：</strong>{{ order.deliveryUpdatedByName || '—' }}</p>
        <p><strong>最後領票更新時間：</strong>{{ order.deliveryUpdatedAt ? formatDate(order.deliveryUpdatedAt) : '—' }}</p>
        <div
          v-if="order.customerName || order.customerEmail"
          class="customer-box"
        >
          <strong>客戶資料：</strong>
          <ul>
            <li v-if="order.customerName">姓名：{{ order.customerName }}</li>
            <li v-if="order.customerPhone">電話：<span class="mono">{{ order.customerPhone }}</span></li>
            <li v-if="order.customerEmail">Email：<span class="mono">{{ order.customerEmail }}</span></li>
            <li v-if="order.school">學校：{{ order.school }}</li>
            <li v-if="order.class">班級：{{ order.class }}</li>
            <li v-if="order.number">座號：{{ order.number }}</li>
            <li v-if="order.office">辦公室：{{ order.office }}</li>
          </ul>
        </div>
        <p>
          <strong>確認信：</strong>{{ emailStatusLabel(order) }}
          <span v-if="['failed', 'uncertain'].includes(order.emailStatus) && order.emailError" class="mono">（{{ order.emailError }}）</span>
        </p>
        <p v-if="order.emailStatus === 'uncertain'">郵件服務可能已接受這封信，請先查核寄送紀錄，再決定是否補寄。</p>
        <p v-if="order.providerMessageId || order.emailProviderMessageId"><strong>郵件服務訊息編號：</strong><span class="mono">{{ order.providerMessageId || order.emailProviderMessageId }}</span></p>
        <p v-if="order.emailJobId"><strong>寄送工作編號：</strong><span class="mono">{{ order.emailJobId }}</span></p>
        <div class="items-box">
          <strong>購買票券：</strong>
          <ul>
            <li
              v-for="item in order.items"
              :key="item.id + item.name"
            >
              {{ item.name }} <span class="num">x {{ item.quantity }}</span> (<span class="num">NT$ {{ item.price }}</span>)
            </li>
          </ul>
        </div>
        <div class="order-actions">
          <button
            v-if="order.customerEmail"
            type="button"
            class="btn-outline"
            :disabled="resendingIds.has(order.id)"
            @click="resendEmail(order)"
          >
            {{ resendingIds.has(order.id) ? '寄送中...' : '補寄確認信' }}
          </button>
          <button
            type="button"
            class="btn"
            @click="viewOrderDetail(order.id)"
          >
            查看詳細
          </button>
          <button
            type="button"
            class="btn-outline danger"
            @click="confirmDelete(order.id)"
          >
            刪除訂單
          </button>
        </div>
      </div>
      <p v-if="!loading && !loadError && !fromCache && currentOrders.length === 0" class="empty">尚無符合條件的訂單</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { httpsCallable } from 'firebase/functions'
import { functions } from 'src/boot/firebase'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { useAdminOrders } from 'src/composables/useAdminOrders'
import { fetchOrder, resendOrderEmail } from 'src/services/orderService'
import { shouldPollNotification, needsNotificationEnqueue, canClearNotification } from 'src/utils/notificationProgress'

const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

// Managers only get the notification tools; admins also manage orders
const canAccessAdmin = computed(() => auth.isManager)
const canManageOrders = computed(() => auth.isAdmin)

const DEFAULT_NOTIFY_MESSAGE = '請出示 QR Code 給工作人員，以完成繳費或領票。'

function createNotifyForm(school = 'all') {
  return {
    type: 'payment',
    school,
    subject: '',
    paymentTime: '',
    pickupTime: '',
    location: '',
    message: DEFAULT_NOTIFY_MESSAGE
  }
}

const showNotifyModal = ref(false)
const sendingNotify = ref(false)
const resendingIds = ref(new Set())
const notifyForm = ref(createNotifyForm())

const {
  schools,
  loading, loadError, fromCache, summary, summaryError, summaryLoading, summaryUpdatedAt,
  pageNumber, hasNext, nextPage, previousPage, refreshSummary,
  pendingPaymentIds, exporting,
  activeTab,
  selectedSchool,
  customerSearchInput,
  emailFilter,
  patchOrder,
  currentOrders,
  currentStats,
  setActiveTab,
  fetchOrders,
  updatePaymentStatus,
  deleteOrder,
  exportToExcel,
  calculateDeliveryStats,
  formatDate
} = useAdminOrders({ showToast: toast.show })

const deliveryStats = computed(() => calculateDeliveryStats(currentOrders.value))

const notifyTargetSchoolLabel = computed(() =>
  notifyForm.value.school === 'all' ? '全部學校' : notifyForm.value.school
)

// Only admins may list every order (firestore.rules); managers get the
// notification tools only
onMounted(() => {
  if (canManageOrders.value) fetchOrders()
})

const exactOrderId = ref('')
const lookingUpOrder = ref(false)
const lookupError = ref('')

async function lookupExactOrder() {
  const id = exactOrderId.value.trim().toUpperCase()
  if (!id || lookingUpOrder.value) return
  lookingUpOrder.value = true
  lookupError.value = ''
  try {
    const order = await fetchOrder(id)
    if (order) viewOrderDetail(order.id)
    else lookupError.value = '找不到這個訂單編號。'
  } catch {
    lookupError.value = '訂單查找失敗，請重試。'
  } finally {
    lookingUpOrder.value = false
  }
}

function viewOrderDetail(orderId) {
  router.push({ name: 'admin-order-detail', params: { id: orderId } })
}

function confirmDelete(orderId) {
  if (!window.confirm(`確定要刪除此訂單嗎？\nID: ${orderId}`)) return
  deleteOrder(orderId).catch(() => toast.show('刪除失敗'))
}

const notifyTypeLabel = computed(() => {
  if (notifyForm.value.type === 'payment') return '繳費通知'
  if (notifyForm.value.type === 'pickup') return '領票通知'
  if (notifyForm.value.type === 'custom') return '自訂通知'
  return '繳費暨領票通知'
})

const canSendNotify = computed(() => {
  const f = notifyForm.value
  if (f.type === 'custom') return !!f.message.trim()
  if (!f.location.trim()) return false
  if (f.type === 'payment') return !!f.paymentTime.trim()
  if (f.type === 'pickup') return !!f.pickupTime.trim()
  return !!f.paymentTime.trim() && !!f.pickupTime.trim()
})

function openNotifyModal() {
  notifyForm.value.school = selectedSchool.value
  showNotifyModal.value = true
}

function closeNotifyModal() {
  if (sendingNotify.value) return
  showNotifyModal.value = false
}

const prepareOrderNotification = httpsCallable(functions, 'prepareOrderNotification')
const sendOrderNotification = httpsCallable(functions, 'sendOrderNotification')
const getOrderNotificationStatus = httpsCallable(functions, 'getOrderNotificationStatus')

// Progress is remembered per staff account. Delivery continues on the server
// after this page closes, and reopening only polls the existing job.
const PENDING_JOB_KEY = `cksc_notification_job_${auth.user?.uid || 'anonymous'}`

function loadPendingJob() {
  try {
    const job = JSON.parse(localStorage.getItem(PENDING_JOB_KEY) || 'null')
    return job?.jobId ? job : null
  } catch {
    return null
  }
}

const pendingJob = ref(loadPendingJob())
const notificationError = ref('')
let notificationPollTimer
let notificationDisposed = false
let pollingNotification = false
// SES acceptance does not establish inbox delivery.
const notificationProgress = computed(() => {
  const job = pendingJob.value
  if (!job) return ''
  const labels = {
    ready: '尚未加入寄送佇列', queued: '已排入佇列', sending: '寄送中',
    partial: '寄送中', done: '處理完成', failed: '部分寄送失敗', uncertain: '部分寄送結果待查'
  }
  let text = `${labels[job.status] || '等待確認'}：郵件服務已接受 ${job.acceptedCount ?? job.sentCount ?? 0} / ${job.total || 0} 封`
  if (job.pendingCount) text += `，待處理 ${job.pendingCount} 封`
  if (job.pendingEnqueueCount) text += `，尚有 ${job.pendingEnqueueCount} 位收件者未加入佇列，請按「繼續加入寄送佇列」`
  if (job.failedCount) text += `，失敗 ${job.failedCount} 封`
  if (job.uncertainCount) text += `，結果待查 ${job.uncertainCount} 封，請先查核寄送紀錄再決定是否補寄`
  return text
})

function scheduleNotificationPoll() {
  clearTimeout(notificationPollTimer)
  if (!notificationDisposed && shouldPollNotification(pendingJob.value)) {
    notificationPollTimer = setTimeout(pollNotificationStatus, 5000)
  }
}

async function pollNotificationStatus() {
  const jobId = pendingJob.value?.jobId
  if (!jobId || pollingNotification || notificationDisposed) return
  pollingNotification = true
  notificationError.value = ''
  try {
    const result = (await getOrderNotificationStatus({ jobId })).data
    if (!notificationDisposed && pendingJob.value?.jobId === jobId) setPendingJob(result)
  } catch (error) {
    if (!notificationDisposed) notificationError.value = error?.message || '寄送進度載入失敗，請重試。'
  } finally {
    pollingNotification = false
    scheduleNotificationPoll()
  }
}

onMounted(() => { if (pendingJob.value) pollNotificationStatus() })
onBeforeUnmount(() => {
  notificationDisposed = true
  clearTimeout(notificationPollTimer)
})

function setPendingJob(job) {
  const previous = pendingJob.value?.jobId === job?.jobId ? pendingJob.value : null
  pendingJob.value = job ? {
    jobId: job.jobId, status: job.status, sentCount: job.sentCount,
    acceptedCount: job.acceptedCount, total: job.total, failedCount: job.failedCount,
    uncertainCount: job.uncertainCount, pendingCount: job.pendingCount,
    pendingEnqueueCount: job.pendingEnqueueCount,
    enqueueUnconfirmed: job.enqueueUnconfirmed ?? previous?.enqueueUnconfirmed ?? false
  } : null
  if (!job) clearTimeout(notificationPollTimer)

  try {
    if (job) localStorage.setItem(PENDING_JOB_KEY, JSON.stringify(pendingJob.value))
    else localStorage.removeItem(PENDING_JOB_KEY)
  } catch {
    // storage unavailable (private mode); the job still resumes this session
  }
}

async function confirmSendNotify() {
  if (!canSendNotify.value) {
    toast.show(notifyForm.value.type === 'custom' ? '請填寫訊息內容' : '請填寫必要的時間與地點')
    return
  }

  // The server saves the recipient list as a job; nothing is sent yet
  let job
  sendingNotify.value = true
  try {
    job = (await prepareOrderNotification({
      type: notifyForm.value.type,
      school: notifyForm.value.school,
      // the subject input only exists for custom notices (PARTY-22)
      subject: notifyForm.value.type === 'custom' ? notifyForm.value.subject.trim() : '',
      paymentTime: notifyForm.value.paymentTime.trim(),
      pickupTime: notifyForm.value.pickupTime.trim(),
      location: notifyForm.value.location.trim(),
      message: notifyForm.value.message.trim()
    })).data
  } catch (error) {
    console.error('Prepare notification error:', error)
    toast.show(error?.message ? `發送失敗：${error.message}` : '發送失敗，請稍後再試')
    return
  } finally {
    sendingNotify.value = false
  }

  if (!job.total) {
    toast.show(`${notifyTargetSchoolLabel.value}目前沒有可寄送的訂購者`)
    return
  }

  if (
    !window.confirm(
      `確定要寄送${notifyTypeLabel.value}給${notifyTargetSchoolLabel.value} ${job.total} 位訂購者嗎？此動作無法復原。`
    )
  ) {
    return
  }

  await runNotificationJob(job)
}

// One short, idempotent call enqueues the saved recipient job. Progress is
// polled separately and delivery continues when this page is closed.
async function runNotificationJob(job) {
  if (sendingNotify.value) return
  setPendingJob({ ...job, enqueueUnconfirmed: true })
  sendingNotify.value = true
  notificationError.value = ''
  try {
    const result = (await sendOrderNotification({ jobId: job.jobId })).data
    setPendingJob({ ...result, enqueueUnconfirmed: false })
    toast.show('通知已加入寄送佇列，可稍後查看進度。')
    scheduleNotificationPoll()
  } catch (error) {
    console.error('Queue notification error:', error)
    notificationError.value = error?.message || '佇列狀態尚未確認，請檢查進度後再試。'
    // A lost acknowledgement must not start a second recipient job.
    await pollNotificationStatus()
  } finally {
    sendingNotify.value = false
  }
}

const EMAIL_STATUS_LABELS = {
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

function emailStatusLabel(order) {
  return EMAIL_STATUS_LABELS[order.emailStatus] || '—'
}

const resendRequestIds = new Map()

async function resendEmail(order) {
  if (resendingIds.value.has(order.id)) return
  const question = order.emailStatus === 'uncertain'
    ? `上一封確認信可能已被郵件服務接受。確定已查核寄送紀錄，仍要補寄給 ${order.customerEmail} 嗎？`
    : `確定要重新寄送確認信給 ${order.customerEmail} 嗎？`
  if (!window.confirm(question)) return

  resendingIds.value = new Set([...resendingIds.value, order.id])
  try {
    if (!resendRequestIds.has(order.id)) resendRequestIds.set(order.id, crypto.randomUUID())
    await resendOrderEmail(order.id, resendRequestIds.get(order.id))
    resendRequestIds.delete(order.id)
    patchOrder(order.id, { emailStatus: 'queued', emailError: '' })
    toast.show('確認信已加入寄送佇列')
  } catch (error) {
    toast.show(error?.message || '確認信佇列狀態尚未確認，請重試。')
  } finally {
    resendingIds.value = new Set([...resendingIds.value].filter((id) => id !== order.id))
  }
}
</script>

<style scoped>
@import 'src/css/adminpage.scss';
</style>