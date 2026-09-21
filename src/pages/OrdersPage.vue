<template>
  <div class="orders-page">
    <header class="page-header">
      <p class="eyebrow">你的訂購紀錄</p>
      <h1>我的訂單</h1>
      <p>每一筆訂單的進度，都可以在這裡輕鬆查看</p>
    </header>

    <div v-if="loading" class="empty-state">正在尋找你的訂單</div>

    <div v-else-if="orders.length === 0" class="empty-state">
      <svg class="empty-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <path
          d="M8 24a4 4 0 0 1 4-4h40a4 4 0 0 1 4 4v3a5 5 0 0 0 0 10v3a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4v-3a5 5 0 0 0 0-10v-3Z"
          stroke="#c7c7cc" stroke-width="2" stroke-linejoin="round"
        />
        <path d="M26 20v24" stroke="#c7c7cc" stroke-width="2" stroke-dasharray="3 4" />
      </svg>
      <h2>還沒有訂單</h2>
      <p>準備好了的話，下一件屬於駝客的紀念品正在等你</p>
      <router-link to="/" class="primary-button">探索商品</router-link>
    </div>

    <div v-else class="order-list">
      <article
        v-for="(order, index) in orders"
        :key="order.id"
        class="ticket"
        :style="{ '--i': index }"
      >
        <div class="ticket-main">
          <div class="ticket-progress" :class="{ done: order.delivered }">
            <span class="step" aria-hidden="true"></span>
            <span class="track" aria-hidden="true"></span>
            <span class="step" aria-hidden="true"></span>
            <p class="ticket-status">
              {{ order.delivered ? '已完成交付' : '準備中' }}
            </p>
          </div>

          <p class="ticket-date"><span class="num">{{ formatDate(order.createdAt) }}</span></p>
          <h2 class="ticket-id">訂單 <span class="num">#{{ shortId(order.id) }}</span></h2>
          <p class="item-summary">{{ itemSummary(order.items) }}</p>

          <div class="ticket-footer">
            <strong class="price"><span class="currency">NT$</span><span class="num">{{ order.finalTotal }}</span></strong>
            <div class="ticket-actions">
              <router-link :to="`/orders/${order.id}`">查看明細</router-link>
              <p>&ensp;</p>
              <button
                type="button"
                style="border: none; background-color: transparent; color: #D32F2F;"
                aria-label="刪除訂單"
                title="刪除訂單"
                @click="confirmDelete(order.id)"
              >
                刪除訂單
              </button>
            </div>
          </div>
        </div>

        <div class="perforation" aria-hidden="true"></div>

        <button type="button" class="ticket-stub" @click="openQr(order)">
          <canvas :ref="(el) => setQrRef(order.id, el)" class="qr-thumb" />
        </button>
      </article>
    </div>

    <!--<button type="button" class="feedback-link" @click="openSurvey">分享使用心得</button>-->

    <q-dialog v-model="showQr" transition-show="scale" transition-hide="scale">
      <div class="qr-modal">
        <button type="button" class="qr-modal-close" aria-label="關閉" @click="showQr = false">
          <q-icon name="close" size="18px" />
        </button>
        <p class="eyebrow">兌換憑證</p>
        <h3>訂單 <span class="num">#{{ activeOrder ? shortId(activeOrder.id) : '' }}</span></h3>
        <canvas ref="modalQrCanvas" class="qr-modal-canvas" />
        <p class="qr-modal-hint">出示 QR Code 以領取商品</p>
      </div>
    </q-dialog>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { useToastStore } from 'src/stores/toast'
import { deleteOrderById, fetchBuyerOrders, formatOrderDate } from 'src/services/orderService'


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
  for (const order of orders.value) {
    const canvas = qrRefs.get(order.id)
    if (!canvas) continue
    const url = `${window.location.origin}/orders/${order.id}`
    try {
      await QRCode.toCanvas(canvas, url, {
        width: 88,
        margin: 0,
        color: { dark: '#1d1d1f', light: '#00000000' }
      })
    } catch (error) {
      console.error(error)
    }
  }
}

async function loadOrders() {
  loading.value = true
  try {
    orders.value = await fetchBuyerOrders()
  } catch (error) {
    console.error(error)
    toast.show('目前無法載入訂單，請稍後再試。')
  } finally {
    loading.value = false
  }
  await nextTick()
  renderQrs()
}

onMounted(loadOrders)

async function openQr(order) {
  activeOrder.value = order
  showQr.value = true
  await nextTick()
  if (!modalQrCanvas.value) return
  const url = `${window.location.origin}/orders/${order.id}`
  try {
    await QRCode.toCanvas(modalQrCanvas.value, url, {
      width: 220,
      margin: 0,
      color: { dark: '#1d1d1f', light: '#ffffff' }
    })
  } catch (error) {
    console.error(error)
  }
}

function formatDate(timestamp) { return formatOrderDate(timestamp) }
function shortId(id) { return String(id).toUpperCase() }
function itemSummary(items) {
  const count = items.reduce((total, item) => total + item.quantity, 0)
  const names = items.map((item) => item.name).slice(0, 2).join('、')
  return `${count} 件商品 · ${names}${items.length > 2 ? '…' : ''}`
}
function openSurvey() { window.open('https://souvenir.cksc.tw/survey', '_blank') }

async function confirmDelete(orderId) {
  if (!window.confirm('確定要刪除這筆訂單嗎？刪除後無法復原。')) return
  try {
    await deleteOrderById(orderId)
    orders.value = orders.value.filter((order) => order.id !== orderId)
    toast.show('訂單已刪除。')
  } catch {
    toast.show('目前無法刪除訂單，請稍後再試。')
  }
}
</script>

<style scoped>
@import 'src/css/orderspage.scss';
</style>