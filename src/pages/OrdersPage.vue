<template>
  <div class="orders-page">
    <header class="page-header">
      <p class="eyebrow">{{ auth.email }}</p>
      <h1>購票紀錄</h1>
      <button type="button" class="primary-button" :disabled="loading" @click="loadOrders">
        {{ loading ? '更新中…' : '重新整理訂單' }}
      </button>
    </header>

    <div v-if="loadError" class="empty-state" role="alert">
      <h2>目前無法載入訂單</h2>
      <p>連線可能暫時中斷，請重試。已載入的票券會保留在下方。</p>
      <button type="button" class="primary-button" :disabled="loading" @click="loadOrders">
        {{ loading ? '重試中…' : '重新載入' }}
      </button>
    </div>

    <div v-if="loading && orders.length === 0" class="empty-state" role="status">
      正在尋找你的訂單
    </div>

    <div
      v-else-if="!loadError && orders.length === 0"
      class="empty-state"
    >
      <h2>No Tickets Found</h2>
      <p>這個帳號還沒有訂單。如果是用其他 Google 帳號購票，請登出後改用該帳號登入。</p>
      <br />

      <router-link
        to="/"
        class="primary-button"
      >
        探索舞會門票
      </router-link>
    </div>

    <div v-if="orders.length > 0" class="order-list" :aria-busy="loading">
      <article
        v-for="(order, index) in orders"
        :key="order.id"
        class="ticket"
        :style="{ '--i': index }"
      >
        <div class="ticket-main">
          <div
            class="ticket-progress"
            :class="{ done: order.delivered }"
          >
            <span
              class="step"
              aria-hidden="true"
            />

            <span
              class="track"
              aria-hidden="true"
            />

            <span
              class="step"
              aria-hidden="true"
            />

            <p class="ticket-status">
              {{
                order.delivered
                  ? '已完成交付'
                  : '準備中'
              }}
            </p>
          </div>

          <p class="ticket-date">
            <span class="num">
              {{ formatDate(order.createdAt) }}
            </span>
          </p>

          <h2 class="ticket-id">
            訂單
            <span class="num">
              #{{ shortId(order.id) }}
            </span>
          </h2>

          <p class="item-summary">
            {{ itemSummary(order.items) }}
          </p>

          <div class="ticket-footer">
            <strong class="price">
              <span class="currency">NT$</span>
              <span class="num">
                {{ Number(order.finalTotal || 0).toLocaleString() }}
              </span>
            </strong>

            <div class="ticket-actions">
              <router-link
                :to="`/orders/${order.id}`"
              >
                查看明細
              </router-link>
            </div>
          </div>
        </div>

        <div
          class="perforation"
          aria-hidden="true"
        />

        <button
          type="button"
          class="ticket-stub"
          :aria-label="`開啟訂單 ${order.id} 的領票 QR Code`"
          @click="openQr(order)"
        >
          <canvas
            :ref="(el) => setQrRef(order.id, el)"
            class="qr-thumb"
            width="88"
            height="88"
            aria-hidden="true"
          />
        </button>
      </article>
    </div>

    <q-dialog
      v-model="showQr"
      transition-show="scale"
      transition-hide="scale"
    >
      <div class="qr-modal">
        <button
          type="button"
          class="qr-modal-close"
          aria-label="關閉"
          @click="showQr = false"
        >
          <q-icon
            name="close"
            size="18px"
          />
        </button>

        <p class="eyebrow">兌換憑證</p>

        <h3>
          訂單
          <span class="num">
            {{
              activeOrder
                ? shortId(activeOrder.id)
                : ''
            }}
          </span>
        </h3>

        <canvas
          ref="modalQrCanvas"
          class="qr-modal-canvas"
          width="220"
          height="220"
          role="img"
          :aria-label="`訂單 ${activeOrder?.id || ''} 的領票 QR Code`"
        />

        <p v-if="qrError" role="alert">{{ qrError }}</p>
        <button v-if="qrError" type="button" class="primary-button" @click="openQr(activeOrder)">
          重新產生 QR Code
        </button>

        <p class="qr-modal-hint">
          入場或領票時請出示此 QR Code
        </p>
      </div>
    </q-dialog>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { fetchMyOrders } from 'src/services/orderService'
import { useAuthStore } from 'src/stores/auth'
import { formatDateTime as formatDate } from 'src/utils/datetime'
import { renderOrderQr } from 'src/utils/qrcode'

const auth = useAuthStore()

const orders = ref([])
const loading = ref(true)
const loadError = ref(false)
const qrError = ref('')

const qrRefs = new Map()

const showQr = ref(false)
const activeOrder = ref(null)
const modalQrCanvas = ref(null)

function setQrRef(id, el) {
  if (el) qrRefs.set(id, el)
  else qrRefs.delete(id)
}

async function renderQrs() {
  await nextTick()

  for (const order of orders.value) {
    const canvas = qrRefs.get(order.id)
    if (!canvas) continue

    try {
      await renderOrderQr(canvas, order, 88)
    } catch (error) {
      console.error(`QR Code 產生失敗：${order.id}`, error)
    }
  }
}

async function loadOrders() {
  if (loading.value && orders.value.length > 0) return
  loading.value = true
  loadError.value = false

  try {
    orders.value = await fetchMyOrders(auth.user.uid)
  } catch (error) {
    console.error(error)
    loadError.value = true
  } finally {
    loading.value = false
  }

  await renderQrs()
}

onMounted(loadOrders)

async function openQr(order) {
  if (!order) return
  qrError.value = ''
  activeOrder.value = order
  showQr.value = true

  await nextTick()
  if (!modalQrCanvas.value) return

  try {
    await renderOrderQr(modalQrCanvas.value, order)
  } catch (error) {
    console.error('QR Code 產生失敗', error)
    qrError.value = '目前無法產生 QR Code，請重新產生或開啟訂單明細。'
  }
}

function shortId(id) {
  return String(id || '').toUpperCase()
}

function itemSummary(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return '0 張票'
  }

  const count = items.reduce((total, item) => total + Number(item.quantity || 0), 0)
  const names = items
    .map((item) => item.name)
    .filter(Boolean)
    .slice(0, 2)
    .join('、')

  return `${count} 張票 · ${names}${items.length > 2 ? '…' : ''}`
}
</script>

<style scoped>
@import 'src/css/orderspage.scss';
</style>
