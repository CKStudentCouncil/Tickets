<template>
  <div class="detail-page">
    <div v-if="loading && !order" class="state-screen" role="status">
      <p>載入訂單中...</p>
    </div>

    <div v-else-if="loadError && !order" class="state-screen" role="alert">
      <h1>目前無法載入訂單</h1>
      <p>請檢查連線後重試</p>
      <button type="button" class="btn" @click="loadOrder">重新載入</button>
    </div>

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
        <p class="eyebrow">
          CK PARTY NIGHT · {{ isAdminView ? 'STAFF VIEW' : 'CUSTOMER VIEW' }}
        </p>
        <h1>訂單詳情</h1>
        <p class="heading-meta" style="margin-bottom: 2ch;">
          ORDER <span class="mono">{{ order.id }}</span>
        </p>
        <div class="heading-actions">
          <button type="button" class="btn-outline" @click="goBack">返回</button>
          <button
            v-if="isAdminView"
            type="button"
            class="btn"
            @click="router.push({ name: 'admin-scan' })"
          >
            掃描下一張
          </button>
        </div>
      </header>

      <!-- ---------- status / check-in ---------- -->
      <section class="panel" style="border-top: none; margin-top: 0; padding-top: 0;">
        <div class="panel-head">
          <h2>{{ isAdminView ? '領票作業' : '訂單狀態' }}</h2>
          <span v-if="isAdminView" class="panel-tag">CHECK-IN DESK</span>
        </div>

        <template v-if="isAdminView">
          <p v-if="qrCheck === 'ok'" class="qr-check ok">✓ QR 驗證碼相符</p>
          <p v-else-if="qrCheck === 'mismatch'" class="qr-check danger">
            ⚠ QR 驗證碼不符，可能是偽造的 QR Code。請核對購票人姓名與證件後再處理
          </p>
          <p v-else-if="qrCheck === 'none'" class="qr-check warn">
            請掃描購票人的票券 QR Code 後領票。管理員可核對身分並填寫原因後手動處理
          </p>

          <label v-if="auth.isAdmin" class="manual-reason">
            手動領票或重設的原因
            <input v-model="overrideReason" maxlength="500" placeholder="核對身分的方式或重設原因">
          </label>

          <p v-if="statusError" class="qr-check danger" role="alert">{{ statusError }}</p>
        </template>

        <div class="status-block">
          <div class="delivery-bar" :class="order.delivered ? 'delivered' : 'pending'">
            <span class="status-dot" />
            <span>領票狀態：{{ order.delivered ? '已領票' : '未領票' }}</span>
            <div v-if="isAdminView" class="delivery-actions">
              <button
                type="button"
                class="btn-sm muted"
                :disabled="changingStatus || !order.delivered || !auth.isAdmin || !overrideReason.trim() || loading || loadError"
                @click="setDelivered(false)"
              >
                標記未領票
              </button>
              <button
                type="button"
                class="btn-sm"
                :disabled="changingStatus || order.delivered || !canCollect || loading || loadError"
                @click="setDelivered(true)"
              >
                標記已領票
              </button>
            </div>
          </div>

          <div class="delivery-bar" :class="order.paid ? 'paid' : 'pending'">
            <span class="status-dot" />
            <span>付款狀態：{{ order.paid ? '已付款' : '未付款' }}</span>
            <div v-if="isAdminView && auth.isAdmin" class="delivery-actions">
              <button
                type="button"
                class="btn-sm muted"
                :disabled="changingStatus || !order.paid || loading || loadError"
                @click="setPaid(false)"
              >
                標記未付款
              </button>
              <button
                type="button"
                class="btn-sm"
                :disabled="changingStatus || order.paid || loading || loadError"
                @click="setPaid(true)"
              >
                標記已付款
              </button>
            </div>
          </div>
        </div>

        <p v-if="changingStatus" class="check-meta" role="status">正在確認並更新訂單…</p>
        <p v-if="isAdminView && order.deliveryUpdatedByName" class="check-meta">
          最後領票更新：{{ order.deliveryUpdatedByName }} · {{ formatDateTime(order.deliveryUpdatedAt) }}
        </p>
      </section>

      <!-- ---------- QR ---------- -->
      <section class="panel">
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
      </section>

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
          <div v-if="order.school">
            <dt>學校</dt>
            <dd>{{ order.school }}</dd>
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

        <div class="stats-row">
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
      <section class="panel">
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
import { fetchOrder, updateOrderDelivery, updateOrderPayment } from 'src/services/orderService'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { formatDateTime } from 'src/utils/datetime'
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

const loading = ref(true)
const order = ref(null)
const qrCanvas = ref(null)
const loadError = ref(false)
const qrError = ref('')
const changingStatus = ref(false)
const downloadingReceipt = ref(false)
const statusError = ref('')
const overrideReason = ref('')
let loadSequence = 0

const orderId = computed(() => String(route.params.id || ''))

// /admin/orders/:id is only reachable by managers (router guard)
const isAdminView = computed(() => route.name === 'admin-order-detail' && auth.isManager)

// Code from the scanned ticket QR (?c=...), compared with the order's secret
// ticketCode so a QR generated from a guessed order id is flagged (PARTY-19)
const scannedCode = computed(() => String(route.query.c || ''))

const qrCheck = computed(() => {
  if (!isAdminView.value || !order.value?.ticketCode) return null
  if (!scannedCode.value) return 'none'
  return scannedCode.value === order.value.ticketCode ? 'ok' : 'mismatch'
})
const canCollect = computed(() => qrCheck.value === 'ok' || (auth.isAdmin && !!overrideReason.value.trim()))

async function loadOrder() {
  const sequence = ++loadSequence
  const id = orderId.value
  loading.value = true
  loadError.value = false

  try {
    // staff can read any order, a buyer only their own (the API checks this)
    const result = await fetchOrder(id)
    if (sequence !== loadSequence) return

    order.value = result ? { ...result, delivered: Boolean(result.delivered) } : null
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

async function setDelivered(delivered) {
  if (!isAdminView.value || !order.value || changingStatus.value || loading.value || loadError.value || order.value.delivered === delivered) {
    return
  }

  if (delivered ? !canCollect.value : (!auth.isAdmin || !overrideReason.value.trim())) return

  changingStatus.value = true
  statusError.value = ''
  const id = order.value.id
  try {
    const patch = await updateOrderDelivery(id, delivered, {
      ticketCode: scannedCode.value,
      expectedDelivered: order.value.delivered,
      overrideReason: auth.isAdmin ? overrideReason.value.trim() : ''
    })
    if (orderId.value !== id) return
    order.value = { ...order.value, ...patch }
    overrideReason.value = ''
    toast.show(delivered ? '已標記為已領票' : '已標記為未領票')
  } catch (error) {
    console.error(error)
    if (orderId.value !== id) return
    statusError.value = error.message || '更新失敗，請重新確認訂單狀態。'
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
  statusError.value = ''
  overrideReason.value = ''
  changingStatus.value = false
  loadOrder()
}, { immediate: true })
</script>

<style scoped>
@import 'src/css/orderdetailpage.scss';
</style>