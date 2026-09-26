<template>
  <div class="orders-page">
    <header class="page-header">
      <p class="eyebrow">你的購票紀錄</p>
      <h1>購票紀錄</h1>
    </header>

    <div v-if="loading" class="empty-state">
      正在尋找你的訂單
    </div>

    <div
      v-else-if="orders.length === 0"
      class="empty-state"
    >
      <h2>No Tickets Found</h2>
      <br />

      <router-link
        to="/"
        class="primary-button"
      >
        探索舞會門票
      </router-link>
    </div>

    <div v-else class="order-list">
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

              <p>&ensp;</p>

              <button
                type="button"
                class="delete-button"
                aria-label="從我的購票紀錄移除"
                title="從我的購票紀錄移除"
                @click="confirmDelete(order.id)"
              >
                從紀錄移除
              </button>
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
          @click="openQr(order)"
        >
          <canvas
            :ref="(el) => setQrRef(order.id, el)"
            class="qr-thumb"
            width="88"
            height="88"
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
        />

        <p class="qr-modal-hint">
          入場或領票時請出示此 QR Code
        </p>
      </div>
    </q-dialog>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { useToastStore } from 'src/stores/toast'
import { fetchBuyerOrders, forgetBuyerOrder } from 'src/services/orderService'
import { formatDateTime as formatDate } from 'src/utils/datetime'
import { renderOrderQr } from 'src/utils/qrcode'

const toast = useToastStore()

const orders = ref([])
const loading = ref(true)

const qrRefs = new Map()

const showQr = ref(false)
const activeOrder = ref(null)
const modalQrCanvas = ref(null)

function setQrRef(id, el) {
  if (el) qrRefs.set(id, el)
}

async function renderQrs() {
  await nextTick()

  for (const order of orders.value) {
    const canvas = qrRefs.get(order.id)
    if (!canvas) continue

    try {
      await renderOrderQr(canvas, order.id, 88)
    } catch (error) {
      console.error(`QR Code 產生失敗：${order.id}`, error)
    }
  }
}

async function loadOrders() {
  loading.value = true

  try {
    orders.value = await fetchBuyerOrders()
  } catch (error) {
    console.error(error)
    orders.value = []
    toast.show('目前無法載入訂單，請稍後再試。')
  } finally {
    loading.value = false
  }

  await renderQrs()
}

onMounted(loadOrders)

async function openQr(order) {
  activeOrder.value = order
  showQr.value = true

  await nextTick()
  if (!modalQrCanvas.value) return

  try {
    await renderOrderQr(modalQrCanvas.value, order.id)
  } catch (error) {
    console.error('QR Code 產生失敗', error)
    toast.show('QR Code 產生失敗')
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

function confirmDelete(orderId) {
  if (
    !window.confirm(
      '確定要從這台裝置的購票紀錄移除這筆訂單嗎？\n訂單本身不會被取消，但移除後將無法在此裝置查看。'
    )
  ) {
    return
  }

  forgetBuyerOrder(orderId)
  orders.value = orders.value.filter((order) => order.id !== orderId)
  qrRefs.delete(orderId)
  toast.show('已從你的購票紀錄移除。')
}
</script>

<style scoped>
@import 'src/css/orderspage.scss';
</style>