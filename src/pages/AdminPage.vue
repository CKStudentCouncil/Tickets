<template>
  <div
    v-if="auth.loading || checkingAdmin"
    class="state-screen"
  >
    <p>{{ auth.loading ? '載入中...' : '驗證權限中...' }}</p>
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
    v-else-if="loading"
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
      <h1>{{ canManageOrders ? '訂單統計' : '發送通知' }}</h1>
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
        @input="debouncedCustomerSearch"
      >
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
        已交貨 (<span class="num">{{ deliveredTabCount }}</span>)
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
              領貨
            </button>
            <button
              type="button"
              class="type-option"
              :class="{ active: notifyForm.type === 'both' }"
              @click="notifyForm.type = 'both'"
            >
              繳費暨領貨
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
            placeholder="例如：關於校慶紀念品的重要通知"
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
          <span>領貨時間</span>
          <input
            v-model="notifyForm.pickupTime"
            type="text"
            placeholder="例如：8/20（三）12:00–13:00"
          >
        </label>

        <label v-if="notifyForm.type !== 'custom'" class="field">
          <span>{{ notifyForm.type === 'both' ? '地點（繳費與領貨共用）' : '地點' }}</span>
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
            :placeholder="notifyForm.type === 'custom' ? '請輸入要寄送給訂購者的訊息內容' : '例如：請出示 QR Code 給工作人員，以完成繳費或領貨。'"
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
            <p v-if="notifyForm.type !== 'payment'">領貨時間：<strong>{{ notifyForm.pickupTime || '（尚未填寫）' }}</strong></p>
            <p>地點：<strong>{{ notifyForm.location || '（尚未填寫）' }}</strong></p>
            <p v-if="notifyForm.message">補充說明：{{ notifyForm.message }}</p>
          </template>
          <p class="preview-count">將發送給{{ notifyTargetSchoolLabel }} <span class="num">{{ notifyRecipientCount }}</span> 位訂購者</p>
        </div>

        <div class="notify-actions">
          <button
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
        <h2>{{ activeTab === 'delivered' ? '已交貨統計與匯出' : '匯出與總覽' }}</h2>
        <div class="stats-row">
          <div class="stat">
            <div>{{ activeTab === 'delivered' ? '已交貨數' : '訂單數' }}</div>
            <div class="num">{{ currentOrders.length }}</div>
          </div>
          <div class="stat">
            <div>{{ activeTab === 'delivered' ? '已交貨營收' : '總營收' }}</div>
            <div class="num">NT$ {{ currentStats.totalRevenue }}</div>
          </div>
          <div class="stat">
            <div>折扣總額</div>
            <div class="num">NT$ {{ currentStats.totalDiscount }}</div>
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

    <div v-if="canManageOrders" class="panel export-panel">
      <div>
        <h2>班代領取收據</h2>
        <p class="panel-copy">依目前的學校篩選，產生所有班級的領取收據；每個班級會有獨立頁面。</p>
      </div>
      <button
        type="button"
        class="btn"
        :disabled="generatingClassReceipts"
        @click="downloadAllClassReceipts"
      >
        {{ generatingClassReceipts ? '開啟中...' : '產生所有班級收據' }}
      </button>
    </div>

    <div
      v-if="canManageOrders && activeTab === 'delivered' && Object.keys(deliveryStats).length > 0"
      class="panel"
    >
      <h2>交貨人員統計</h2>
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
      <h2>{{ activeTab === 'delivered' ? '已交貨商品統計' : '商品總數量' }}</h2>
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
      <h2>{{ activeTab === 'delivered' ? '已交貨訂單' : '所有訂單' }}</h2>
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
          <span>交貨狀態：{{ order.delivered ? '已交貨' : '未交貨' }}</span>
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
              標記已交貨
            </button>
            <button
              type="button"
              class="btn-sm muted"
              :disabled="!order.delivered"
              @click="updateDeliveryStatus(order.id, false)"
            >
              標記未交貨
            </button>
          </div>          
        </div>
        <div
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
        </div>
        <p><strong>訂單ID：</strong><span class="mono">{{ order.id }}</span></p>
        <p><strong>折扣後金額：</strong><span class="num">NT$ {{ order.finalTotal }}</span></p>
        <p><strong>購買時間：</strong><span class="num">{{ formatDate(order.createdAt) }}</span></p>
        <p><strong>最後付款更新者：</strong>{{ order.paymentUpdatedByName || '—' }}</p>
        <p><strong>最後付款更新時間：</strong>{{ order.paymentUpdatedAt ? formatDate(order.paymentUpdatedAt) : '—' }}</p>
        <p><strong>最後交貨更新者：</strong>{{ order.deliveryUpdatedByName || '—' }}</p>
        <p><strong>最後交貨更新時間：</strong>{{ order.deliveryUpdatedAt ? formatDate(order.deliveryUpdatedAt) : '—' }}</p>
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
          </ul>
        </div>
        <div class="items-box">
          <strong>購買商品：</strong>
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
import { doc, getDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { db } from 'src/boot/firebase'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { useAdminOrders } from 'src/composables/useAdminOrders'
import { USE_MOCK_ORDERS, MOCK_ALLOW_ADMIN_WITHOUT_AUTH } from 'src/config/app'

const router = useRouter()
const auth = useAuthStore()
const canAccessAdmin = computed(
  () => auth.isManager || (USE_MOCK_ORDERS && MOCK_ALLOW_ADMIN_WITHOUT_AUTH)
)
const canManageOrders = computed(
  () => auth.isAdmin || (USE_MOCK_ORDERS && MOCK_ALLOW_ADMIN_WITHOUT_AUTH)
)
const toast = useToastStore()
const displayName = ref('管理員')
const checkingAdmin = ref(true)
const showNotifyModal = ref(false)
const sendingNotify = ref(false)
const generatingClassReceipts = ref(false)
const notifyForm = ref({
  type: 'payment',
  school: 'all',
  subject: '',
  paymentTime: '',
  pickupTime: '',
  location: '',
  message: '請出示 QR Code 給工作人員，以完成繳費或領貨。'
})

const {
  schools,
  orders,
  loading,
  activeTab,
  selectedSchool,
  customerSearchInput,
  debouncedCustomerSearch,
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
} = useAdminOrders({
  showToast: toast.show,
  displayName
})

const deliveryStats = computed(() => calculateDeliveryStats(currentOrders.value))

const notifyRecipientOrders = computed(() => {
  if (notifyForm.value.school === 'all') return orders.value
  return orders.value.filter((order) => order.school === notifyForm.value.school)
})

const notifyRecipientCount = computed(() => {
  const emails = new Set()
  notifyRecipientOrders.value.forEach((order) => {
    if (order.customerEmail) emails.add(order.customerEmail)
  })
  return emails.size
})

const notifyTargetSchoolLabel = computed(() =>
  notifyForm.value.school === 'all' ? '全部學校' : notifyForm.value.school
)

async function loadAdminProfile() {
  if (auth.user) {
    try {
      const userDoc = await getDoc(doc(db, 'users', auth.user.uid))
      displayName.value = userDoc.exists()
        ? userDoc.data().name || auth.user.displayName || auth.user.email
        : auth.user.displayName || auth.user.email
    } catch {
      displayName.value = auth.user.displayName || auth.user.email || '管理員'
    }
  }
}

onMounted(async () => {
  await loadAdminProfile()
  checkingAdmin.value = false
  if (canAccessAdmin.value) fetchOrders()
})

onActivated(() => {
  if (canAccessAdmin.value) fetchOrders()
})

function viewOrderDetail(orderId) {
  router.push({ name: 'admin-order-detail', params: { id: orderId } })
}

function downloadAllClassReceipts() {
  if (loading.value) {
    toast.show('訂單資料載入中，請稍後再試')
    return
  }

  const classOrders = orders.value.filter(
    (order) =>
      getClassName(order) &&
      (selectedSchool.value === 'all' || order.school === selectedSchool.value)
  )
  if (!classOrders.length) {
    toast.show('目前篩選條件下沒有可產生收據的班級訂單')
    return
  }

  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    toast.show('無法開啟列印視窗，請允許此網站開啟彈出式視窗後再試一次')
    return
  }

  generatingClassReceipts.value = true
  try {
    printWindow.document.write(buildAllClassReceiptsHtml(classOrders))
    printWindow.document.close()
    printWindow.focus()
    window.setTimeout(() => printWindow.print(), 300)
  } catch (error) {
    console.error('All class receipts generation failed:', error)
    printWindow.close()
    toast.show('班級收據產生失敗，請再試一次')
  } finally {
    generatingClassReceipts.value = false
  }
}

function getClassName(order) {
  return order.class || order.classNumber || ''
}

function escapeHtml(value) {
  return String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function buildAllClassReceiptsHtml(classOrders) {
  const groupedOrders = classOrders.reduce((groups, order) => {
    const key = `${order.school}\u0000${getClassName(order)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(order)
    return groups
  }, new Map())

  const receipts = [...groupedOrders.entries()]
    .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey, 'zh-Hant'))
    .map(([, grouped]) => buildClassReceiptSection(grouped))
    .join('')

  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>所有班級代表領取收據</title>
    <style>
      @page { size: A4 portrait; margin: 12mm; } * { box-sizing: border-box; }
      body { margin: 0; color: #111; font-family: 'Noto Sans TC', 'Microsoft JhengHei', Arial, sans-serif; }
      .class-sheet { height: 273mm; break-after: page; page-break-after: always; } .class-sheet:last-child { break-after: auto; page-break-after: auto; }
      .receipt { height: 134mm; padding: 3mm 4mm; border: 1px solid #222; overflow: hidden; } .receipt + .receipt { margin-top: 5mm; border-top: 1px dashed #555; }
      header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 2mm; border-bottom: 1px solid #222; }
      header p { margin: 0 0 1px; font-size: 8pt; font-weight: 600; } h1 { margin: 0; font-size: 14pt; letter-spacing: .06em; } header strong { font-size: 8pt; }
      .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1mm 6mm; margin: 2mm 0; font-size: 8pt; }
      .notice { margin: 2mm 0; padding: 1.5mm; border: 1px solid #555; background: #f5f5f5; font-size: 7pt; }
      table { width: 100%; border-collapse: collapse; font-size: 7.5pt; } th, td { padding: 1mm 1.5mm; border: 1px solid #555; vertical-align: top; } th { background: #f0f0f0; } th:nth-child(1), td:nth-child(1), th:nth-child(4), td:nth-child(4) { text-align: right; white-space: nowrap; }
      .summary { display: flex; justify-content: flex-end; gap: 6mm; margin: 2mm 0; font-size: 8pt; } .summary strong { font-size: 10pt; }
      footer { display: flex; justify-content: space-between; gap: 6mm; margin-top: 5mm; font-size: 8pt; } footer p { margin: 0; } footer span { display: inline-block; width: 48mm; border-bottom: 1px solid #111; }
    </style></head><body>${receipts}<script>window.onafterprint = () => window.close()<\/script></body></html>`
}

function buildClassReceiptSection(groupedOrders) {
  const firstOrder = groupedOrders[0]
  const sortedOrders = [...groupedOrders].sort((a, b) =>
    String(a.number || '').localeCompare(String(b.number || ''), 'zh-Hant', { numeric: true })
  )
  const totalAmount = sortedOrders.reduce((sum, order) => sum + Number(order.finalTotal || 0), 0)
  const totalItems = sortedOrders.reduce(
    (sum, order) => sum + (order.items || []).reduce(
      (itemSum, item) => itemSum + Number(item.quantity || 0),
      0
    ),
    0
  )
  const studentRows = sortedOrders
    .map((order) => {
      const products = (order.items || [])
        .map((item) => `${escapeHtml(item.name)} ×${escapeHtml(item.quantity)}`)
        .join('<br>')
      return `<tr><td>${escapeHtml(order.number)}</td><td>${escapeHtml(order.customerName)}</td><td>${products}</td><td>NT$ ${escapeHtml(order.finalTotal)}</td></tr>`
    })
    .join('')

  const makeCopy = (copyLabel) => `<section class="receipt">
    <header><div><p>建國中學班聯會</p><h1>班級代表領取收據</h1></div><strong>${copyLabel}</strong></header>
    <div class="meta"><span>學校：${escapeHtml(firstOrder.school)}</span><span>班級：${escapeHtml(getClassName(firstOrder))}</span><span>訂單數量：${sortedOrders.length} 份</span><span>產生日期：${escapeHtml(formatDate(new Date()))}</span></div>
    <p class="notice">班級代表確認已代為領取下列同班同學的紀念品，並應將商品轉交給各訂購人。</p>
    <table><thead><tr><th>座號</th><th>學生姓名</th><th>訂購品項</th><th>訂單金額</th></tr></thead><tbody>${studentRows}</tbody></table>
    <div class="summary"><span>商品總件數：<b>${totalItems}</b></span><span>訂單總額：<strong>NT$ ${totalAmount}</strong></span></div>
    <footer><p>班級代表簽名：<span></span></p><p>班聯會工作人員簽名：<span></span></p></footer>
  </section>`

  return `<section class="class-sheet">${makeCopy('班聯會留存聯')}${makeCopy('班級代表收執聯')}</section>`
}

function confirmDelete(orderId) {
  if (!window.confirm(`確定要刪除此訂單嗎？\nID: ${orderId}`)) return
  deleteOrder(orderId).catch(() => toast.show('刪除失敗'))
}

const notifyTypeLabel = computed(() => {
  if (notifyForm.value.type === 'payment') return '繳費通知'
  if (notifyForm.value.type === 'pickup') return '領貨通知'
  if (notifyForm.value.type === 'custom') return '自訂通知'
  return '繳費暨領貨通知'
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

async function confirmSendNotify() {
  if (!canSendNotify.value) {
    toast.show(notifyForm.value.type === 'custom' ? '請填寫訊息內容' : '請填寫必要的時間與地點')
    return
  }
  if (
    !window.confirm(
      `確定要寄送${notifyTypeLabel.value}給${notifyTargetSchoolLabel.value} ${notifyRecipientCount.value} 位訂購者嗎？此動作無法復原。`
    )
  ) {
    return
  }

  sendingNotify.value = true
  try {
    const functionsInstance = getFunctions(undefined, 'asia-east1')
    const sendOrderNotification = httpsCallable(functionsInstance, 'sendOrderNotification')
    const result = await sendOrderNotification({
      type: notifyForm.value.type,
      school: notifyForm.value.school,
      subject: notifyForm.value.subject.trim(),
      paymentTime: notifyForm.value.paymentTime.trim(),
      pickupTime: notifyForm.value.pickupTime.trim(),
      location: notifyForm.value.location.trim(),
      message: notifyForm.value.message.trim()
    })
    toast.show(`已成功寄送給 ${result.data.sentCount} 位訂購者`)
    showNotifyModal.value = false
    notifyForm.value = {
      type: 'payment',
      school: selectedSchool.value,
      subject: '',
      paymentTime: '',
      pickupTime: '',
      location: '',
      message: ''
    }
  } catch (error) {
    console.error('Send notification error:', error)
    toast.show('發送失敗，請稍後再試')
  } finally {
    sendingNotify.value = false
  }
}
</script>

<style scoped>
@import 'src/css/app.scss';
@import 'src/css/adminpage.scss';
</style>
