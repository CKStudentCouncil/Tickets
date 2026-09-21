<template>
  <div v-if="loading" class="state">
    載入中...
  </div>

  <div v-else-if="!order" class="state not-found">
    <p class="eyebrow">訂單詳情</p>
    <h2>找不到這筆訂單</h2>
    <p class="state-copy">可能是訂單編號有誤，或訂單已被移除</p>
    <button type="button" class="btn-primary" @click="goBack">返回</button>
  </div>

  <div v-else class="detail-page">
    <button type="button" class="back-link" @click="goBack">
      ← 返回{{ isAdminRoute ? '訂單列表' : '我的訂單' }}
    </button>

    <section v-if="isAdminView" class="admin-toolbar">
      <div class="toggle-group">
        <span class="toggle-label">交貨狀態</span>
        <div class="toggle-switch">
          <button
            type="button"
            :class="{ active: !order.delivered }"
            @click="setDelivered(false)"
          >未交貨</button>
          <button
            type="button"
            :class="{ active: order.delivered }"
            @click="setDelivered(true)"
          >已交貨</button>
        </div>
      </div>
      <div class="toggle-group">
        <span class="toggle-label">付款狀態</span>
        <div class="toggle-switch">
          <button
            type="button"
            :class="{ active: !order.paid }"
            @click="setPaid(false)"
          >未付款</button>
          <button
            type="button"
            :class="{ active: order.paid }"
            @click="setPaid(true)"
          >已付款</button>
        </div>
      </div>
    </section>

    <div v-if="isAdminView" class="receipt-actions">
      <div>
        <p class="receipt-actions__title">交貨收據</p>
        <p class="receipt-actions__hint">開啟列印視窗後，選擇「另存為 PDF」即可保存兩聯收據。</p>
      </div>
      <button
        type="button"
        class="btn-primary"
        :disabled="generatingReceipt"
        @click="downloadReceipt"
      >
        {{ generatingReceipt ? '開啟中...' : '列印／另存 PDF' }}
      </button>
    </div>

    <article class="receipt">
      <header class="receipt-head">
        <p class="eyebrow">訂單詳情</p>
        <h1 class="mono">#{{ order.id }}</h1>
        <p class="receipt-date">{{ formatDate(order.createdAt) }}</p>
        <div class="status-pills">
          <span class="status-pill" :class="{ on: order.delivered }">
            <i />{{ order.delivered ? '已交貨' : '未交貨' }}
          </span>
          <span class="status-pill" :class="{ on: order.paid }">
            <i />{{ order.paid ? '已付款' : '未付款' }}
          </span>
        </div>
      </header>

      <div class="receipt-divider" />

      <section v-if="order.customerName" class="receipt-section">
        <p class="section-label">訂購人</p>
        <dl class="detail-list">
          <div>
            <dt>姓名</dt>
            <dd>{{ order.customerName }}</dd>
          </div>
          <div>
            <dt>電話</dt>
            <dd class="mono">{{ order.customerPhone }}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd class="mono">{{ order.customerEmail }}</dd>
          </div>
          <div>
            <dt>學校</dt>
            <dd>{{ order.school }}</dd>
          </div>
          <div>
            <dt>班級座號</dt>
            <dd>{{ order.classNumber || '—' }}</dd>
          </div>
        </dl>
      </section>

      <div class="receipt-divider" />

      <section class="receipt-section">
        <p class="section-label">訂購項目 <span class="num">{{ totalItemCount }}</span> 件</p>
        <ul class="receipt-items">
          <li v-for="item in order.items" :key="item.id + item.name">
            <span class="item-name">{{ item.name }} <span class="qty num">×{{ item.quantity }}</span></span>
            <span class="item-leader" aria-hidden="true" />
            <span class="item-price num">NT$ {{ item.price }}</span>
          </li>
        </ul>
      </section>

      <div class="receipt-divider receipt-divider--dashed" />

      <footer class="receipt-total">
        <span>應付總額</span>
        <strong class="num">NT$ {{ order.finalTotal }}</strong>
      </footer>
    </article>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { MOCK_ALLOW_ADMIN_WITHOUT_AUTH, USE_MOCK_ORDERS } from 'src/config/app'
import {
  fetchOrderById,
  fetchAllOrders,
  canViewOrder,
  updateOrderDelivery,
  updateOrderPayment,
  formatOrderDate
} from 'src/services/orderService'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

const order = ref(null)
const loading = ref(true)
const generatingReceipt = ref(false)
const classReceiptGenerating = ref(false)

const isAdminRoute = computed(
  () => route.name === 'admin-order-detail' || route.meta.isAdminSection === true
)

const isAdminView = computed(
  () =>
    isAdminRoute.value &&
    (
      auth.isManager ||
      (USE_MOCK_ORDERS && MOCK_ALLOW_ADMIN_WITHOUT_AUTH)
    )
)

const totalItemCount = computed(
  () => order.value?.items?.reduce((total, item) => total + item.quantity, 0) || 0
)

onMounted(async () => {
  const id = route.params.id
  const allowed = isAdminRoute.value || canViewOrder(id) || isOrderSaved(id)

  if (!allowed) {
    loading.value = false
    toast.show('無權查看此訂單')
    return
  }

  try {
    order.value = await fetchOrderById(id)
  } catch (error) {
    console.error('Firestore fetch failed, falling back to local copy', error)
  }

  if (!order.value) {
    order.value = getLocalOrder(id)
  }

  if (!order.value) {
    toast.show('載入失敗')
  }

  loading.value = false
})

function formatDate(ts) {
  return formatOrderDate(ts)
}

async function downloadReceipt() {
  if (!order.value || generatingReceipt.value) return

  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    toast.show('無法開啟列印視窗，請允許此網站開啟彈出式視窗後再試一次')
    return
  }

  generatingReceipt.value = true
  try {
    printWindow.document.write(buildReceiptHtml(order.value))
    printWindow.document.close()
    printWindow.focus()
    window.setTimeout(() => printWindow.print(), 300)
  } catch (error) {
    console.error('Receipt generation failed:', error)
    printWindow.close()
    toast.show('收據產生失敗，請再試一次')
  } finally {
    generatingReceipt.value = false
  }
}

function escapeHtml(value) {
  return String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function buildReceiptHtml(receiptOrder) {
  const customerRows = [
    ['姓名', receiptOrder.customerName],
    ['電話', receiptOrder.customerPhone],
    ['Email', receiptOrder.customerEmail],
    ['學校', receiptOrder.school],
    ['班級', receiptOrder.class || receiptOrder.classNumber],
    ['座號', receiptOrder.number]
  ]
    .map(([label, value]) => `<p><b>${label}：</b>${escapeHtml(value)}</p>`)
    .join('')

  const itemRows = (receiptOrder.items || [])
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td>NT$ ${escapeHtml(item.price)}</td>
        <td>${escapeHtml(item.quantity)}</td>
        <td>NT$ ${escapeHtml(Number(item.price) * Number(item.quantity))}</td>
      </tr>`)
    .join('')

  const makeCopy = (copyLabel) => `
    <section class="receipt-copy">
      <header>
        <div><p>建國中學班聯會</p><h1>紀念品領取收據</h1></div>
        <strong>${copyLabel}</strong>
      </header>
      <div class="meta"><span>訂單編號：${escapeHtml(receiptOrder.id)}</span><span>訂購日期：${escapeHtml(formatDate(receiptOrder.createdAt))}</span></div>
      <h2>顧客資料</h2><div class="customer">${customerRows}</div>
      <h2>購買明細</h2>
      <table><thead><tr><th>品項</th><th>單價</th><th>數量</th><th>小計</th></tr></thead><tbody>${itemRows}</tbody></table>
      <p class="total">應收總額：<b>NT$ ${escapeHtml(receiptOrder.finalTotal)}</b></p>
      <footer><p>顧客簽名：<span></span></p><p>班聯會工作人員簽名：<span></span></p></footer>
    </section>`

  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>紀念品領取收據-${escapeHtml(receiptOrder.id)}</title>
    <style>
      @page { size: A4 portrait; margin: 10mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #111; font-family: 'Noto Sans TC', 'Microsoft JhengHei', Arial, sans-serif; }
      .receipt-copy { min-height: 132mm; padding: 6mm 7mm; border: 1.5px solid #222; break-inside: avoid; }
      .receipt-copy + .receipt-copy { margin-top: 5mm; border-top: 1px dashed #777; }
      header, .meta, footer { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
      header p { margin: 0 0 2px; font-size: 10pt; font-weight: 600; }
      h1 { margin: 0; font-size: 18pt; letter-spacing: .08em; } header strong { padding: 4px 8px; border: 1px solid #222; font-size: 10pt; }
      .meta { margin: 4mm 0; padding: 2.5mm 0; border-top: 1px solid #222; border-bottom: 1px solid #222; font-size: 9pt; }
      h2 { margin: 3mm 0 2mm; font-size: 10pt; } .customer { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5mm 4mm; font-size: 9pt; }
      .customer p { margin: 0; } table { width: 100%; border-collapse: collapse; font-size: 9pt; } th, td { padding: 1.5mm 2mm; border: 1px solid #555; } th { background: #f0f0f0; } th:not(:first-child), td:not(:first-child) { text-align: right; }
      .total { margin: 2mm 0 0; text-align: right; font-size: 11pt; } footer { margin-top: 6mm; font-size: 10pt; } footer p { margin: 0; } footer span { display: inline-block; width: 48mm; border-bottom: 1px solid #111; }
    </style></head><body>${makeCopy('班聯會留存聯')}${makeCopy('顧客收執聯')}<script>window.onafterprint = () => window.close()<\/script></body></html>`
}

async function downloadClassReceipt() {
  const school = order.value?.school
  const className = getOrderClass(order.value)

  if (!school || !className) {
    toast.show('此訂單沒有完整的學校與班級資料，無法產生班代領取收據')
    return
  }

  const printWindow = window.open('', '_blank')
  if (!printWindow) {
    toast.show('無法開啟列印視窗，請允許此網站開啟彈出式視窗後再試一次')
    return
  }

  classReceiptGenerating.value = true
  try {
    const allOrders = await fetchAllOrders()
    const classOrders = allOrders.filter(
      (candidate) => candidate.school === school && getOrderClass(candidate) === className
    )

    if (!classOrders.length) {
      printWindow.close()
      toast.show('找不到此班級的訂單')
      return
    }

    printWindow.document.write(buildClassReceiptHtml(classOrders, school, className))
    printWindow.document.close()
    printWindow.focus()
    window.setTimeout(() => printWindow.print(), 300)
  } catch (error) {
    console.error('Class receipt generation failed:', error)
    printWindow.close()
    toast.show('班代領取收據產生失敗，請再試一次')
  } finally {
    classReceiptGenerating.value = false
  }
}

function getOrderClass(orderData) {
  return orderData?.class || orderData?.classNumber || ''
}

function buildClassReceiptHtml(classOrders, school, className) {
  const sortedOrders = [...classOrders].sort((a, b) =>
    String(a.number || '').localeCompare(String(b.number || ''), 'zh-Hant', { numeric: true })
  )
  const totalAmount = sortedOrders.reduce(
    (sum, classOrder) => sum + Number(classOrder.finalTotal || 0),
    0
  )
  const totalItems = sortedOrders.reduce(
    (sum, classOrder) => sum + (classOrder.items || []).reduce(
      (itemSum, item) => itemSum + Number(item.quantity || 0),
      0
    ),
    0
  )
  const studentRows = sortedOrders
    .map((classOrder) => {
      const products = (classOrder.items || [])
        .map((item) => `${escapeHtml(item.name)} ×${escapeHtml(item.quantity)}`)
        .join('<br>')
      return `<tr><td>${escapeHtml(classOrder.number)}</td><td>${escapeHtml(classOrder.customerName)}</td><td>${products}</td><td>NT$ ${escapeHtml(classOrder.finalTotal)}</td></tr>`
    })
    .join('')

  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>班代領取收據-${escapeHtml(school)}-${escapeHtml(className)}</title>
    <style>
      @page { size: A4 portrait; margin: 12mm; } * { box-sizing: border-box; }
      body { margin: 0; color: #111; font-family: 'Noto Sans TC', 'Microsoft JhengHei', Arial, sans-serif; }
      header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 4mm; border-bottom: 1.5px solid #222; }
      header p { margin: 0 0 2px; font-size: 10pt; font-weight: 600; } h1 { margin: 0; font-size: 19pt; letter-spacing: .06em; }
      .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2mm 8mm; margin: 5mm 0; font-size: 10pt; }
      .notice { margin: 4mm 0; padding: 3mm; border: 1px solid #555; background: #f5f5f5; font-size: 9pt; }
      table { width: 100%; border-collapse: collapse; font-size: 9pt; } th, td { padding: 2mm; border: 1px solid #555; vertical-align: top; } th { background: #f0f0f0; } th:nth-child(1), td:nth-child(1), th:nth-child(4), td:nth-child(4) { text-align: right; white-space: nowrap; }
      .summary { display: flex; justify-content: flex-end; gap: 8mm; margin: 4mm 0; font-size: 10pt; } .summary strong { font-size: 12pt; }
      footer { display: flex; justify-content: space-between; gap: 8mm; margin-top: 12mm; font-size: 10pt; } footer p { margin: 0; } footer span { display: inline-block; width: 58mm; border-bottom: 1px solid #111; }
    </style></head><body>
      <header><div><p>建國中學班聯會</p><h1>班級代表領取收據</h1></div><strong>班聯會留存聯</strong></header>
      <div class="meta"><span>學校：${escapeHtml(school)}</span><span>班級：${escapeHtml(className)}</span><span>學生人數：${sortedOrders.length} 人</span><span>產生日期：${escapeHtml(formatDate(new Date()))}</span></div>
      <p class="notice">班級代表確認已代為領取下列同班同學的紀念品，並應將商品轉交給各訂購人。</p>
      <table><thead><tr><th>座號</th><th>學生姓名</th><th>訂購品項</th><th>訂單金額</th></tr></thead><tbody>${studentRows}</tbody></table>
      <div class="summary"><span>商品總件數：<b>${totalItems}</b></span><span>訂單總額：<strong>NT$ ${totalAmount}</strong></span></div>
      <footer><p>班級代表簽名：<span></span></p><p>班聯會工作人員簽名：<span></span></p></footer>
      <script>window.onafterprint = () => window.close()<\/script>
    </body></html>`
}

function goBack() {
  router.push(isAdminRoute.value ? '/admin' : '/orders')
}

async function setDelivered(delivered) {
  if (!isAdminView.value || !order.value || order.value.delivered === delivered) return
  try {
    const patch = await updateOrderDelivery(order.value.id, delivered, {
      deliveryUpdatedByName: auth.user?.name || '管理員',
    })
    order.value = { ...order.value, ...patch, delivered }
    toast.show(delivered ? '已標記為已交貨' : '已標記為未交貨')
  } catch {
    toast.show('更新失敗')
  }
}

async function setPaid(paid) {
  if (!isAdminView.value || !order.value || order.value.paid === paid) return
  try {
    const patch = await updateOrderPayment(order.value.id, paid, {
      paymentUpdatedByName: auth.user?.name || '管理員',
    })
    order.value = { ...order.value, ...patch, paid }
    toast.show(paid ? '已標記為已付款' : '已標記為未付款')
  } catch {
    toast.show('更新失敗')
  }
}
</script>

<style scoped>
@import 'src/css/app.scss';
@import 'src/css/orderdetailpage.scss';
</style>
