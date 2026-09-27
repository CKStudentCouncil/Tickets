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
    v-else-if="canManageOrders && loading"
    class="state-screen"
  >
    <p>載入中...</p>
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
      <label>篩選學校：</label>
      <select v-model="selectedSchool">
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
      <label>搜尋訂購者：</label>
      <input
        v-model="customerSearchInput"
        type="text"
        placeholder="輸入姓名、Email 或電話號碼"
      >
    </div>

    <div
      v-if="canManageOrders"
      class="filter-block"
    >
      <label>確認信：</label>
      <select v-model="emailFilter">
        <option value="all">全部</option>
        <option value="failed">寄送失敗</option>
        <option value="pending">尚未寄出</option>
      </select>
    </div>

    <div
      v-if="canManageOrders"
      class="tabs"
    >
      <button
        type="button"
        :class="{ active: activeTab === 'all' }"
        @click="setActiveTab('all')"
      >
        全部訂單 (<span class="num">{{ currentOrders.length }}</span>)
      </button>
      <button
        type="button"
        :class="{ active: activeTab === 'delivered' }"
        @click="setActiveTab('delivered')"
      >
        已領票 (<span class="num">{{ deliveredTabCount }}</span>)
      </button>
    </div>

    <div class="panel notify-panel">
      <div class="notify-header">
        <h2>自動寄送通知</h2>
        <button type="button" class="btn" @click="openNotifyModal">
          編輯並發送
        </button>
      </div>
    </div>

    <div
      v-if="showNotifyModal"
      class="modal-overlay"
      @click.self="closeNotifyModal"
    >
      <div class="modal notify-modal">
        <h2>編輯{{ notifyTypeLabel }}</h2>

        <div class="type-select">
          <span class="field-label">通知類型</span>
          <div class="type-options">
            <button
              type="button"
              class="type-option"
              :class="{ active: notifyForm.type === 'payment' }"
              @click="notifyForm.type = 'payment'"
            >
              繳費
            </button>
            <button
              type="button"
              class="type-option"
              :class="{ active: notifyForm.type === 'pickup' }"
              @click="notifyForm.type = 'pickup'"
            >
              領票
            </button>
            <button
              type="button"
              class="type-option"
              :class="{ active: notifyForm.type === 'both' }"
              @click="notifyForm.type = 'both'"
            >
              繳費暨領票
            </button>
            <button
              type="button"
              class="type-option"
              :class="{ active: notifyForm.type === 'custom' }"
              @click="notifyForm.type = 'custom'"
            >
              自訂訊息
            </button>
          </div>
        </div>

        <div class="filter-block">
          <span class="field-label">通知對象</span>
          <select v-model="notifyForm.school">
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
          <p v-if="canManageOrders" class="preview-count">將發送給{{ notifyTargetSchoolLabel }} <span class="num">{{ notifyRecipientCount }}</span> 位訂購者</p>
          <p v-else class="preview-count">將發送給{{ notifyTargetSchoolLabel }}的訂購者（按下確認發送後會顯示人數）</p>
        </div>

        <div class="notify-actions">
          <p v-if="pendingJob" class="preview-count">
            {{ sendingNotify ? '' : '上次的通知尚未寄完：' }}已寄出 <span class="num">{{ pendingJob.sentCount }}</span> / <span class="num">{{ pendingJob.total }}</span> 位
          </p>
          <button
            v-if="pendingJob"
            type="button"
            class="btn"
            :disabled="sendingNotify"
            @click="runNotificationJob(pendingJob)"
          >
            {{ sendingNotify ? '發送中...' : '繼續寄送' }}
          </button>
          <button
            v-if="pendingJob && !sendingNotify"
            type="button"
            class="btn-outline"
            @click="discardPendingJob"
          >
            放棄這次寄送
          </button>
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
    </div>

    <div
      v-if="canManageOrders"
      class="panel export-panel"
    >
      <div>
        <h2>{{ activeTab === 'delivered' ? '已領票統計與匯出' : '匯出與總覽' }}</h2>
        <div class="stats-row">
          <div class="stat">
            <div>{{ activeTab === 'delivered' ? '已領票數' : '訂單數' }}</div>
            <div class="num">{{ currentOrders.length }}</div>
          </div>
          <div class="stat">
            <div>{{ activeTab === 'delivered' ? '已領票營收' : '總營收' }}</div>
            <div class="num">NT$ {{ currentStats.totalRevenue }}</div>
          </div>
        </div>
      </div>
      <button
        type="button"
        class="btn"
        @click="exportToExcel(activeTab === 'delivered')"
      >
        匯出 Excel
      </button>
    </div>

    <div
      v-if="canManageOrders && activeTab === 'delivered' && Object.keys(deliveryStats).length > 0"
      class="panel"
    >
      <h2>領票人員統計</h2>
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
      <h2>{{ activeTab === 'delivered' ? '已領票統計' : '票券總數量' }}</h2>
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
          <div
            v-if="activeTab === 'all'"
            class="delivery-actions"
          >
            <button
              type="button"
              class="btn-sm"
              :disabled="order.delivered"
              @click="updateDeliveryStatus(order.id, true)"
            >
              標記已領票
            </button>
            <button
              type="button"
              class="btn-sm muted"
              :disabled="!order.delivered"
              @click="updateDeliveryStatus(order.id, false)"
            >
              標記未領票
            </button>
          </div>
        </div>
        <!--<div
          class="delivery-bar"
          :class="order.paid ? 'paid' : 'pending'"
        >
          <span class="status-dot" />
          <span>付款狀態：{{ order.paid ? '已付款' : '未付款' }}</span>
          <div
            v-if="activeTab === 'all'"
            class="delivery-actions"
          >
            <button
              type="button"
              class="btn-sm"
              :disabled="order.paid"
              @click="updatePaymentStatus(order.id, true)"
            >
              標記已付款
            </button>
            <button
              type="button"
              class="btn-sm muted"
              :disabled="!order.paid"
              @click="updatePaymentStatus(order.id, false)"
            >
              標記未付款
            </button>
          </div>
        </div>-->
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
          <span v-if="order.emailStatus === 'failed' && order.emailError" class="mono">（{{ order.emailError }}）</span>
        </p>
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
            :disabled="resendingId === order.id"
            @click="resendEmail(order)"
          >
            {{ resendingId === order.id ? '寄送中...' : '補寄確認信' }}
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
      <p v-if="currentOrders.length === 0" class="empty">尚無符合條件的訂單</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onActivated } from 'vue'
import { useRouter } from 'vue-router'
import { httpsCallable } from 'firebase/functions'
import { functions } from 'src/boot/firebase'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { useAdminOrders } from 'src/composables/useAdminOrders'
import { resendOrderEmail } from 'src/services/orderService'

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
const resendingId = ref('')
const notifyForm = ref(createNotifyForm())

const {
  schools,
  orders,
  loading,
  activeTab,
  selectedSchool,
  customerSearchInput,
  emailFilter,
  patchOrder,
  currentOrders,
  deliveredTabCount,
  currentStats,
  setActiveTab,
  fetchOrders,
  updateDeliveryStatus,
  updatePaymentStatus,
  deleteOrder,
  exportToExcel,
  calculateDeliveryStats,
  formatDate
} = useAdminOrders({ showToast: toast.show })

const deliveryStats = computed(() => calculateDeliveryStats(currentOrders.value))

// Admins only (managers can't list orders); mirrors collectRecipients in
// functions/lib/notifications.js, which gives the count everyone confirms
const notifyRecipientCount = computed(() => {
  const emails = new Set()

  orders.value.forEach((order) => {
    if (notifyForm.value.school !== 'all' && order.school !== notifyForm.value.school) return
    const email = String(order.customerEmail || '').trim().toLowerCase()
    if (email && !email.startsWith('no-reply@') && !email.startsWith('noreply@')) emails.add(email)
  })

  return emails.size
})

const notifyTargetSchoolLabel = computed(() =>
  notifyForm.value.school === 'all' ? '全部學校' : notifyForm.value.school
)

// Only admins may list every order (firestore.rules); managers get the
// notification tools only
onMounted(() => {
  if (canManageOrders.value) fetchOrders()
})

onActivated(() => {
  if (canManageOrders.value) fetchOrders()
})

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
// one call keeps sending for up to 8 minutes
const sendOrderNotification = httpsCallable(functions, 'sendOrderNotification', {
  timeout: 560 * 1000
})

// The notice being sent, { jobId, sentCount, total }. Kept in this browser
// until it is done, so after an error, a dropped connection or a reload it
// is resumed rather than sent again from the start (PARTY-17).
const PENDING_JOB_KEY = 'cksc_notification_job'

function loadPendingJob() {
  try {
    const job = JSON.parse(localStorage.getItem(PENDING_JOB_KEY) || 'null')
    return job?.jobId ? job : null
  } catch {
    return null
  }
}

const pendingJob = ref(loadPendingJob())

function setPendingJob(job) {
  pendingJob.value = job ? { jobId: job.jobId, sentCount: job.sentCount, total: job.total } : null

  try {
    if (job) localStorage.setItem(PENDING_JOB_KEY, JSON.stringify(pendingJob.value))
    else localStorage.removeItem(PENDING_JOB_KEY)
  } catch {
    // storage unavailable (private mode); the job still resumes this session
  }
}

function discardPendingJob() {
  if (!window.confirm('確定要放棄這次寄送嗎？尚未寄出的訂購者將不會收到這則通知。')) return
  setPendingJob(null)
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

// Sends in rate-limited batches: 'partial' means the call ran out of time
// and must be called again. The job is remembered before the first email.
async function runNotificationJob(job) {
  setPendingJob(job)
  sendingNotify.value = true

  try {
    let result
    do {
      result = (await sendOrderNotification({ jobId: job.jobId })).data
      setPendingJob(result)
    } while (result.status === 'partial')

    setPendingJob(null)
    toast.show(`已成功寄送給 ${result.sentCount} 位訂購者`)
    showNotifyModal.value = false
    notifyForm.value = createNotifyForm(selectedSchool.value)
  } catch (error) {
    console.error('Send notification error:', error)
    if (error?.details?.jobId) setPendingJob(error.details)
    toast.show(error?.message ? `發送失敗：${error.message}` : '發送失敗，請稍後再按「繼續寄送」')
  } finally {
    sendingNotify.value = false
  }
}

const EMAIL_STATUS_LABELS = {
  sent: '已寄出',
  failed: '寄送失敗',
  pending: '尚未寄出',
  skipped: '無 Email'
}

function emailStatusLabel(order) {
  return EMAIL_STATUS_LABELS[order.emailStatus] || '—'
}

async function resendEmail(order) {
  if (!window.confirm(`確定要重新寄送確認信給 ${order.customerEmail} 嗎？`)) return

  resendingId.value = order.id
  try {
    await resendOrderEmail(order.id)
    patchOrder(order.id, { emailStatus: 'sent', emailError: '' })
    toast.show('確認信已寄出')
  } catch (error) {
    patchOrder(order.id, { emailStatus: 'failed', emailError: error?.message || '' })
    toast.show(error?.message || '寄送失敗')
  } finally {
    resendingId.value = ''
  }
}
</script>

<style scoped>
@import 'src/css/adminpage.scss';
</style>