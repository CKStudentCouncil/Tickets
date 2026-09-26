<template>
  <div class="success-page">
    <div class="success-card">
      <div class="success-icon">
        <q-icon name="check" />
      </div>

      <p class="eyebrow">訂單已成立</p>

      <h1 class="text-bold">
        Thank you
      </h1>

      <p class="lead">
        我們已收到你的訂單，接下來會依照以下資訊為你準備
        <br />
        目前僅提供現場付款，還請注意建中班聯或友校班聯會、代聯會或學生會相關公告
      </p>

      <div
        v-if="orderId"
        class="order-id"
      >
        訂單編號
        <strong class="mono">
          #{{ orderId }}
        </strong>
      </div>

      <div
        v-if="order"
        class="order-summary"
      >
        <div class="summary-row">
          <span class="summary-label">
            姓名
          </span>

          <span>
            {{ order.customerName }}
          </span>
        </div>

        <div class="summary-row">
          <span class="summary-label">
            Email
          </span>

          <span class="mono">
            {{ order.customerEmail }}
          </span>
        </div>

        <div class="summary-row">
          <span class="summary-label">
            應付金額
          </span>

          <strong class="num">
            NT$ {{ order.finalTotal }}
          </strong>
        </div>
      </div>

      <div
        v-if="order"
        class="qr-section text-center align-center"
      >
        <p class="qr-title">
          訂單 QR Code
        </p>

        <div class="qr-wrapper">
          <canvas
            ref="qrCanvas"
            class="order-qr"
            width="220"
            height="220"
          />
        </div>

        <p class="qr-note">
          領票時請出示此 QR Code 給工作人員掃描 
        </p>
      </div>

      <p
        v-if="order"
        class="email-note"
      >
        訂單確認信將寄送到上方信箱，幾分鐘內沒收到的話，記得檢查一下垃圾郵件匣
      </p>

      <router-link
        to="/orders"
        class="primary-button"
      >
        查看我的訂單
      </router-link>

      <router-link
        to="/survey"
        class="feedback-button"
      >
        填寫意見反饋
      </router-link>

      <router-link
        to="/"
        class="secondary-link"
      >
        繼續探索
      </router-link>
    </div>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { trackEvent } from 'src/utils/analytics'
import { renderOrderQr } from 'src/utils/qrcode'
import { fetchBuyerOrder } from 'src/services/orderService'

const route = useRoute()

const orderId = ref(String(route.query.id || ''))
const order = ref(null)
const qrCanvas = ref(null)

function trackGA4Purchase(orderData) {
  const transactionId = String(orderData.id || '')
  const storageKey = `ga4_purchased_${transactionId}`

  // reloading the success page must not report the purchase twice
  if (sessionStorage.getItem(storageKey)) return

  trackEvent('purchase', {
    transaction_id: transactionId,
    value: Number(orderData.finalTotal || 0),
    currency: 'TWD',
    items: (orderData.items || []).map((item) => ({
      item_id: String(item.id || ''),
      item_name: String(item.name || ''),
      price: Number(item.price || 0),
      quantity: Number(item.quantity || 1)
    }))
  })

  sessionStorage.setItem(storageKey, 'true')
}

async function loadOrder() {
  if (!orderId.value) return

  try {
    order.value = await fetchBuyerOrder(orderId.value)
    if (!order.value) return

    trackGA4Purchase(order.value)

    await nextTick()
    if (qrCanvas.value) await renderOrderQr(qrCanvas.value, order.value.id)
  } catch (error) {
    console.error('訂單載入失敗：', error)
  }
}

onMounted(loadOrder)
</script>

<style scoped>
@import 'src/css/ordersuccesspage.scss';
</style>