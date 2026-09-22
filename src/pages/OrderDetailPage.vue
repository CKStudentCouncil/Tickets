<template>
  <div class="detail-page">
    <div v-if="loading" class="state-screen">
      <span class="eyebrow">CK PARTY NIGHT</span>
      <p>載入訂單中...</p>
    </div>

    <div v-else-if="!order" class="state-screen">
      <span class="eyebrow">CK PARTY NIGHT</span>
      <h1>找不到訂單</h1>
      <p>此訂單不存在，或您目前沒有查看此訂單的權限。</p>
      <button type="button" class="primary-button" @click="goBack">
        返回
      </button>
    </div>

    <main v-else class="detail-content">
      <header class="page-header">
        <div>
          <span class="eyebrow">CK PARTY NIGHT</span>
          <h1>訂單詳情</h1>
          <p class="lead">建中舞會購票系統</p>
        </div>

        <button type="button" class="back-button" @click="goBack">
          返回
        </button>
      </header>

      <section v-if="isAdminView" class="admin-toolbar">
        <div class="toggle-group">
          <span class="toggle-label">領票狀態</span>

          <div class="toggle-switch">
            <button
              type="button"
              :class="{ active: !order.delivered }"
              @click="setDelivered(false)"
            >
              未領票
            </button>

            <button
              type="button"
              :class="{ active: order.delivered }"
              @click="setDelivered(true)"
            >
              已領票
            </button>
          </div>
        </div>
      </section>

      <article class="receipt">
        <div class="receipt-head">
          <div>
            <span class="receipt-kicker">CK PARTY NIGHT</span>
            <h2>購票收據</h2>
          </div>

          <div class="receipt-meta">
            <span>訂單編號</span>
            <strong>{{ order.id }}</strong>
          </div>
        </div>

        <div class="status-pills">
          <span class="status-pill" :class="{ on: order.delivered }">
            <i />
            {{ order.delivered ? '已領票' : '未領票' }}
          </span>
        </div>

        <section class="receipt-section">
          <div class="section-heading">
            <span class="section-index">01</span>
            <h3>購票資訊</h3>
          </div>

          <dl class="detail-list">
            <div>
              <dt>訂單編號</dt>
              <dd>{{ order.id }}</dd>
            </div>

            <div>
              <dt>建立時間</dt>
              <dd>{{ formatOrderDate(order.createdAt) }}</dd>
            </div>

            <div v-if="order.buyerName">
              <dt>購票人</dt>
              <dd>{{ order.buyerName }}</dd>
            </div>

            <div v-if="order.email">
              <dt>Email</dt>
              <dd>{{ order.email }}</dd>
            </div>

            <div v-if="order.phone">
              <dt>聯絡電話</dt>
              <dd>{{ order.phone }}</dd>
            </div>

            <div v-if="order.school">
              <dt>學校</dt>
              <dd>{{ order.school }}</dd>
            </div>

            <div v-if="order.className">
              <dt>班級</dt>
              <dd>{{ order.className }}</dd>
            </div>
          </dl>
        </section>

        <section class="receipt-section">
          <div class="section-heading">
            <span class="section-index">02</span>
            <h3>票券明細</h3>
          </div>

          <div class="receipt-items">
            <div
              v-for="(item, index) in order.items || []"
              :key="item.id || item.ticketTypeId || index"
              class="receipt-item"
            >
              <div class="item-main">
                <strong>{{ item.name }}</strong>

                <span v-if="item.variant">
                  {{ item.variant }}
                </span>

                <span v-if="item.eligibleBuyerIdentity">
                  {{ item.eligibleBuyerIdentity }}
                </span>
              </div>

              <div class="item-meta">
                <span>× {{ item.quantity }}</span>
                <strong>
                  NT$ {{ Number(item.price || 0) * Number(item.quantity || 0) }}
                </strong>
              </div>
            </div>
          </div>

          <div class="receipt-total">
            <span>應付總額</span>
            <strong>NT$ {{ Number(order.total || 0).toLocaleString() }}</strong>
          </div>
        </section>

        <section class="receipt-section">
          <div class="section-heading">
            <span class="section-index">03</span>
            <h3>活動資訊</h3>
          </div>

          <dl class="detail-list">
            <div>
              <dt>活動</dt>
              <dd>CK PARTY NIGHT</dd>
            </div>

            <div>
              <dt>日期</dt>
              <dd>2026 年 12 月 13 日</dd>
            </div>

            <div>
              <dt>地點</dt>
              <dd>建中明道樓後停車場</dd>
            </div>

            <div>
              <dt>領票狀態</dt>
              <dd>{{ order.delivered ? '已領票' : '未領票' }}</dd>
            </div>
          </dl>
        </section>

        <div class="receipt-note">
          <span>NOTE</span>
          <p>
            請依主辦單位公告之方式及時間辦理領票。
            入場時請依現場工作人員指示出示相關購票資訊。
          </p>
        </div>

        <footer class="receipt-footer">
          <span>臺北市立建國高級中學班聯會</span>
          <span>CK PARTY NIGHT 2026</span>
        </footer>
      </article>

      <div class="receipt-actions">
        <button type="button" class="secondary-button" @click="downloadReceipt">
          下載收據
        </button>

        <button type="button" class="primary-button" @click="printReceipt">
          列印收據
        </button>
      </div>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  fetchOrderById,
  canViewOrder,
  updateOrderDelivery,
  formatOrderDate
} from 'src/services/orders'

import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import {
  USE_MOCK_ORDERS,
  MOCK_ALLOW_ADMIN_WITHOUT_AUTH
} from 'src/config/app'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

const loading = ref(true)
const order = ref(null)

const orderId = computed(() => String(route.params.id || ''))

const canAccessAdmin = computed(
  () =>
    auth.isManager ||
    (USE_MOCK_ORDERS && MOCK_ALLOW_ADMIN_WITHOUT_AUTH)
)

const isAdminView = computed(() => {
  return route.path.startsWith('/admin') && canAccessAdmin.value
})

onMounted(async () => {
  await loadOrder()
})

async function loadOrder() {
  loading.value = true

  try {
    if (!orderId.value) {
      order.value = null
      return
    }

    const result = await fetchOrderById(orderId.value)

    if (!result) {
      order.value = null
      return
    }

    const allowed = await canViewOrder(result)

    if (!allowed && !isAdminView.value) {
      order.value = null
      return
    }

    order.value = {
      ...result,
      delivered: Boolean(result.delivered)
    }
  } catch {
    toast.show('載入訂單失敗')
    order.value = null
  } finally {
    loading.value = false
  }
}

async function setDelivered(delivered) {
  if (
    !isAdminView.value ||
    !order.value ||
    order.value.delivered === delivered
  ) {
    return
  }

  try {
    const patch = await updateOrderDelivery(
      order.value.id,
      delivered,
      {
        deliveryUpdatedByName: auth.user?.name || '管理員'
      }
    )

    order.value = {
      ...order.value,
      ...patch,
      delivered
    }

    toast.show(
      delivered
        ? '已標記為已領票'
        : '已標記為未領票'
    )
  } catch {
    toast.show('更新領票狀態失敗')
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function buildReceiptHtml() {
  if (!order.value) return ''

  const currentOrder = order.value

  const items = (currentOrder.items || [])
    .map((item) => {
      const quantity = Number(item.quantity || 0)
      const price = Number(item.price || 0)
      const subtotal = quantity * price

      return `
        <tr>
          <td>
            ${escapeHtml(item.name)}
            ${
              item.variant
                ? `<div class="sub">${escapeHtml(item.variant)}</div>`
                : ''
            }
          </td>
          <td class="center">${quantity}</td>
          <td class="right">NT$ ${subtotal.toLocaleString()}</td>
        </tr>
      `
    })
    .join('')

  return `
<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>CK PARTY NIGHT 購票收據</title>
<style>
  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    padding: 40px;
    background: #fff;
    color: #111;
    font-family: Arial, "Noto Sans TC", sans-serif;
  }

  .receipt {
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
  }

  .head {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 24px;
    border-bottom: 2px solid #111;
  }

  .eyebrow {
    margin-bottom: 8px;
    font-size: 11px;
    letter-spacing: .16em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 28px;
  }

  .order-id {
    text-align: right;
    font-size: 12px;
    color: #555;
  }

  .section {
    padding: 24px 0;
    border-bottom: 1px solid #ccc;
  }

  .section h2 {
    margin: 0 0 16px;
    font-size: 15px;
  }

  .info {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 8px 16px;
    font-size: 13px;
  }

  .info .label {
    color: #666;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  th,
  td {
    padding: 10px 0;
    border-bottom: 1px solid #ddd;
    text-align: left;
  }

  th {
    font-size: 11px;
    color: #666;
  }

  .center {
    text-align: center;
  }

  .right {
    text-align: right;
  }

  .sub {
    margin-top: 4px;
    color: #666;
    font-size: 11px;
  }

  .total {
    display: flex;
    justify-content: space-between;
    padding-top: 18px;
    font-size: 18px;
    font-weight: 700;
  }

  .note {
    margin-top: 24px;
    padding: 16px;
    background: #f5f5f5;
    font-size: 11px;
    line-height: 1.7;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    margin-top: 32px;
    padding-top: 14px;
    border-top: 1px solid #111;
    font-size: 10px;
    color: #666;
  }

  @media print {
    body {
      padding: 0;
    }
  }
</style>
</head>

<body>
  <div class="receipt">
    <div class="head">
      <div>
        <div class="eyebrow">CK PARTY NIGHT</div>
        <h1>購票收據</h1>
      </div>

      <div class="order-id">
        <div>訂單編號</div>
        <strong>${escapeHtml(currentOrder.id)}</strong>
      </div>
    </div>

    <div class="section">
      <h2>購票資訊</h2>

      <div class="info">
        <div class="label">購票人</div>
        <div>${escapeHtml(currentOrder.buyerName || '—')}</div>

        <div class="label">Email</div>
        <div>${escapeHtml(currentOrder.email || '—')}</div>

        <div class="label">聯絡電話</div>
        <div>${escapeHtml(currentOrder.phone || '—')}</div>

        <div class="label">建立時間</div>
        <div>${escapeHtml(formatOrderDate(currentOrder.createdAt))}</div>

        <div class="label">領票狀態</div>
        <div>${currentOrder.delivered ? '已領票' : '未領票'}</div>
      </div>
    </div>

    <div class="section">
      <h2>票券明細</h2>

      <table>
        <thead>
          <tr>
            <th>票券</th>
            <th class="center">數量</th>
            <th class="right">小計</th>
          </tr>
        </thead>

        <tbody>
          ${items}
        </tbody>
      </table>

      <div class="total">
        <span>應付總額</span>
        <span>NT$ ${Number(currentOrder.total || 0).toLocaleString()}</span>
      </div>
    </div>

    <div class="section">
      <h2>活動資訊</h2>

      <div class="info">
        <div class="label">活動</div>
        <div>CK PARTY NIGHT</div>

        <div class="label">日期</div>
        <div>2026 年 12 月 13 日</div>

        <div class="label">地點</div>
        <div>建中明道樓後停車場</div>
      </div>
    </div>

    <div class="note">
      請依主辦單位公告之方式及時間辦理領票。
      入場時請依現場工作人員指示出示相關購票資訊。
    </div>

    <div class="footer">
      <span>臺北市立建國高級中學班聯會</span>
      <span>CK PARTY NIGHT 2026</span>
    </div>
  </div>
</body>
</html>
  `
}

function downloadReceipt() {
  if (!order.value) return

  const html = buildReceiptHtml()
  const blob = new Blob([html], {
    type: 'text/html;charset=utf-8'
  })

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = `CK-PARTY-NIGHT-${order.value.id}.html`

  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  URL.revokeObjectURL(url)
}

function printReceipt() {
  if (!order.value) return

  const html = buildReceiptHtml()
  const printWindow = window.open('', '_blank', 'width=900,height=900')

  if (!printWindow) {
    toast.show('無法開啟列印視窗，請確認瀏覽器未封鎖彈出視窗')
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

  router.push('/')
}
</script>

<style scoped>
@import 'src/css/orderdetailpage.scss';
</style>
