<template>
  <div class="orders-page">
    <!-- The COSMOS lettering on every ticket is cut out of the poster, the
         same way as on the home page; one filter serves all tickets. -->
    <svg class="svg-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="orders-cosmos-lettering" color-interpolation-filters="sRGB">
          <feColorMatrix type="matrix" values="
            1 0 0 0 0
            0 1 0 0 0
            0 0 1 0 0
            .2126 .7152 .0722 0 0
          " />
          <feComponentTransfer>
            <feFuncA type="linear" slope="8" intercept="-5.6" />
          </feComponentTransfer>
        </filter>
        <!-- just the letters: the poster's own orbit line is too faint to survive the filter -->
        <clipPath id="orders-cosmos-letters">
          <rect x="124" y="1232" width="818" height="76" />
        </clipPath>
        <!-- so it is redrawn, fading out at both ends like on the poster -->
        <linearGradient id="orders-cosmos-orbit" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#f2eee5" stop-opacity="0" />
          <stop offset="0.5" stop-color="#f2eee5" stop-opacity="0.85" />
          <stop offset="1" stop-color="#f2eee5" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>

    <header class="page-header">
      <div class="header-copy">
        <p class="eyebrow"><span /> CK PARTY NIGHT / MY TICKETS</p>
        <h1>購票紀錄</h1>
      </div>

      <div class="header-side">
        <p v-if="orders.length > 0" class="header-count">
          <strong class="num">{{ ticketTotal }}</strong> 張票
          <span class="header-count-sep" aria-hidden="true">/</span>
          <span class="num">{{ orders.length }}</span> 筆訂單
        </p>
        <div class="account-chip">
          <span class="account-dot" aria-hidden="true" />
          <span>{{ auth.email }}</span>
        </div>
      </div>
    </header>

    <div v-if="loadError" class="state-panel" role="alert">
      <p class="state-label"><span /> CONNECTION LOST</p>
      <h2>目前無法載入訂單</h2>
      <p>連線可能暫時中斷，請重試。已載入的票券會保留在下方</p>
      <button type="button" class="outline-button" :disabled="loading" @click="loadOrders">
        <span>{{ loading ? '重試中…' : '重新載入' }}</span>
        <ArrowRight :size="16" :stroke-width="1.75" aria-hidden="true" />
      </button>
    </div>

    <div
      v-if="loading && orders.length === 0"
      class="order-list"
      role="status"
      aria-label="正在尋找你的訂單"
    >
      <div v-for="n in 2" :key="n" class="ticket is-skeleton" aria-hidden="true">
        <div class="ticket-main">
          <div class="ticket-art" />
          <div class="ticket-body">
            <span class="skeleton-bar wide" />
            <span class="skeleton-bar" />
            <span class="skeleton-bar short" />
          </div>
        </div>
        <span class="perforation" />
        <div class="ticket-stub">
          <span class="skeleton-qr" />
        </div>
      </div>
      <p class="loading-copy"><span class="loading-dot" />正在尋找你的訂單…</p>
    </div>

    <div
      v-else-if="!loadError && orders.length === 0"
      class="no-tickets"
    >
      <div class="no-tickets-copy">
        <p class="state-label"><span /> NO TICKETS FOUND</p>
        <h2>還沒有購票紀錄</h2>
        <p>這個帳號還沒有訂單。如果是用其他 Google 帳號購票，請登出後改用該帳號登入</p>

        <router-link to="/" class="primary-button">
          <span>探索舞會門票</span>
          <ArrowRight :size="16" :stroke-width="1.75" aria-hidden="true" />
        </router-link>
      </div>

      <!-- an empty ticket, waiting to be filled in -->
      <div class="ghost-ticket" aria-hidden="true">
        <div class="ghost-art">
          <span>CK PARTY NIGHT</span>
          <span class="ghost-serial">No. 000000</span>
        </div>
        <div class="ghost-body">
          <span class="ghost-bar" />
          <span class="ghost-bar short" />
          <span class="ghost-total">TOTAL &nbsp;NT$ —</span>
        </div>
        <span class="ghost-perforation" />
        <div class="ghost-stub">
          <span class="ghost-qr">?</span>
        </div>
      </div>
    </div>

    <div v-if="orders.length > 0" class="order-list" :aria-busy="loading">
      <article
        v-for="(order, index) in orders"
        :key="order.id"
        class="ticket"
        :class="`is-${statusOf(order).key}`"
        :style="{ '--i': index }"
        :aria-labelledby="`ticket-${order.id}`"
      >
        <div class="ticket-main">
          <div class="ticket-art" aria-hidden="true">
            <div class="art-top">
              <span>CK PARTY NIGHT · 2026</span>
              <span class="art-serial">No. {{ serialOf(order) }}</span>
            </div>
            <svg class="ticket-wordmark" viewBox="124 1232 818 108" focusable="false">
              <image
                href="/poster.jpg"
                width="1076"
                height="1522"
                filter="url(#orders-cosmos-lettering)"
                clip-path="url(#orders-cosmos-letters)"
              />
              <path
                class="wordmark-orbit"
                d="M 318 1300 Q 540 1362 762 1300"
                stroke="url(#orders-cosmos-orbit)"
              />
            </svg>
          </div>

          <div class="ticket-body">
            <h2 :id="`ticket-${order.id}`" class="sr-only">訂單 {{ order.id }}</h2>

            <div class="ticket-heading">
              <span class="status-chip" :class="`status-${statusOf(order).key}`">
                <span class="status-dot" aria-hidden="true" />
                {{ statusOf(order).label }}
              </span>
              <span class="ticket-count"><span class="num">{{ ticketCount(order) }}</span> 張票</span>
            </div>

            <ul class="ticket-items">
              <li v-for="(item, itemIndex) in itemsOf(order)" :key="item.id || itemIndex">
                <span class="item-name">{{ item.name }}</span>
                <span class="item-qty"><span aria-hidden="true">×</span><span class="sr-only">數量</span> {{ item.quantity }}</span>
              </li>
              <li v-if="itemsOf(order).length === 0" class="item-empty">尚無票券資料</li>
            </ul>

            <!-- the poster's | LABEL | value lines -->
            <dl class="ticket-facts">
              <div class="fact-row is-event">
                <div class="fact">
                  <dt>DATE</dt>
                  <dd><time :datetime="eventIsoDate">{{ eventDate }}</time></dd>
                </div>
                <div class="fact">
                  <dt>LOCATION</dt>
                  <dd>{{ EVENT_VENUE }}</dd>
                </div>
              </div>
              <div class="fact-row is-order">
                <div class="fact">
                  <dt>訂單編號</dt>
                  <dd class="order-id">{{ order.id }}</dd>
                </div>
                <div class="fact">
                  <dt>訂購時間</dt>
                  <dd class="num">{{ formatOrderTime(order.createdAt) }}</dd>
                </div>
              </div>
            </dl>

            <ol class="ticket-steps" aria-label="訂單進度">
              <li
                v-for="step in stepsOf(order)"
                :key="step.label"
                :class="{ done: step.done, current: step.current, 'track-done': step.trackDone }"
              >
                <span class="step-dot" aria-hidden="true" />
                <span class="step-label">{{ step.label }}</span>
                <span class="sr-only">{{ step.done ? '（已完成）' : '（尚未完成）' }}</span>
              </li>
            </ol>

            <p class="ticket-hint">{{ statusOf(order).hint }}</p>

            <div class="ticket-footer">
              <p class="ticket-total">
                <span class="total-label">TOTAL</span>
                <span class="currency">NT$</span>
                <strong class="num">{{ Number(order.finalTotal || 0).toLocaleString() }}</strong>
              </p>

              <router-link :to="`/orders/${order.id}`" class="detail-link">
                <span>訂單明細</span>
                <ArrowUpRight :size="16" :stroke-width="1.75" aria-hidden="true" />
              </router-link>
            </div>
          </div>
        </div>

        <span class="perforation" aria-hidden="true" />

        <button
          type="button"
          class="ticket-stub"
          :aria-label="`放大訂單 ${order.id} 的 QR Code`"
          @click="openQr(order)"
        >
          <span class="qr-frame">
            <canvas
              :ref="(el) => setQrRef(order.id, el)"
              class="qr-thumb"
              :width="QR_THUMB"
              :height="QR_THUMB"
              aria-hidden="true"
            />
            <span v-if="order.delivered" class="stub-stamp" aria-hidden="true">
              已領票
              <small>COLLECTED</small>
            </span>
          </span>
          <span class="stub-copy">
            <span class="stub-label">SCAN TO COLLECT</span>
            <span class="stub-hint">
              <Maximize2 :size="13" :stroke-width="1.75" aria-hidden="true" />
              點擊放大 QR Code
            </span>
          </span>
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
          <X :size="18" :stroke-width="1.75" aria-hidden="true" />
        </button>

        <p class="qr-eyebrow">PICK-UP PASS · 領票憑證</p>

        <h3 class="qr-title">{{ activeOrder ? itemSummary(activeOrder) : '' }}</h3>

        <p class="qr-order">
          ORDER <span>{{ activeOrder?.id || '' }}</span>
        </p>

        <div class="qr-frame is-large">
          <canvas
            ref="modalQrCanvas"
            class="qr-modal-canvas"
            :width="QR_MODAL"
            :height="QR_MODAL"
            role="img"
            :aria-label="`訂單 ${activeOrder?.id || ''} 的領票 QR Code`"
          />
        </div>

        <p v-if="qrError" class="qr-error" role="alert">{{ qrError }}</p>
        <button v-if="qrError" type="button" class="outline-button" @click="openQr(activeOrder)">
          <span>重新產生 QR Code</span>
          <ArrowRight :size="16" :stroke-width="1.75" aria-hidden="true" />
        </button>

        <ul v-if="activeOrder" class="qr-status">
          <li :class="{ done: activeOrder.paid }">
            <span class="status-dot" aria-hidden="true" />
            {{ activeOrder.paid ? '已付款' : '未付款' }}
          </li>
          <li :class="{ done: activeOrder.delivered }">
            <span class="status-dot" aria-hidden="true" />
            {{ activeOrder.delivered ? '已領票' : '未領票' }}
          </li>
        </ul>

        <p class="qr-hint">付款、領票時請出示此 QR Code 給工作人員掃描</p>
        <p class="qr-tip">
          <Sun :size="14" :stroke-width="1.75" aria-hidden="true" />
          掃描前請將螢幕亮度調高
        </p>
      </div>
    </q-dialog>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { ArrowRight, ArrowUpRight, Maximize2, Sun, X } from 'lucide-vue-next'
import { EVENT_DATE, EVENT_VENUE } from 'src/config/app'
import { fetchMyOrders } from 'src/services/orderService'
import { useAuthStore } from 'src/stores/auth'
import { parseDate } from 'src/utils/datetime'
import { renderOrderQr } from 'src/utils/qrcode'

// CSS sizes of the stub and dialog codes; both are drawn at 3x so they stay
// sharp on phone screens (scanners read the dialog one)
const QR_THUMB = 116
const QR_MODAL = 248
const QR_SCALE = 3

const eventDate = EVENT_DATE.replaceAll('/', '.')
const eventIsoDate = EVENT_DATE.replaceAll('/', '-')

// What the buyer still has to do: pay on site, then collect the paper ticket
const STATUS = {
  pending: {
    key: 'pending',
    label: '待付款',
    hint: '請依公告的時間地點現場付款，付款與領票時出示 QR Code'
  },
  paid: {
    key: 'paid',
    label: '待領票',
    hint: '已完成付款，領取紙本票券時請出示 QR Code'
  },
  collected: {
    key: 'collected',
    label: '已領票',
    hint: '紙本票券已領取，入場時請攜帶紙本票券'
  }
}

const ORDER_TIME = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})

const auth = useAuthStore()

const orders = ref([])
const loading = ref(true)
const loadError = ref(false)
const qrError = ref('')

const qrRefs = new Map()

const showQr = ref(false)
const activeOrder = ref(null)
const modalQrCanvas = ref(null)

const ticketTotal = computed(() =>
  orders.value.reduce((total, order) => total + ticketCount(order), 0)
)

// The library also sizes the element to the bitmap; the stylesheet decides
// how big the code is shown
async function drawQr(canvas, order, size) {
  await renderOrderQr(canvas, order, size * QR_SCALE)
  canvas.style.removeProperty('width')
  canvas.style.removeProperty('height')
}

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
      await drawQr(canvas, order, QR_THUMB)
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
    await drawQr(modalQrCanvas.value, order, QR_MODAL)
  } catch (error) {
    console.error('QR Code 產生失敗', error)
    qrError.value = '目前無法產生 QR Code，請重新產生或開啟訂單明細'
  }
}

function itemsOf(order) {
  return Array.isArray(order?.items) ? order.items : []
}

function ticketCount(order) {
  return itemsOf(order).reduce((total, item) => total + Number(item.quantity || 0), 0)
}

function statusOf(order) {
  if (order.delivered) return STATUS.collected
  if (order.paid) return STATUS.paid
  return STATUS.pending
}

function stepsOf(order) {
  const steps = [
    { label: '訂單成立', done: true },
    { label: '現場付款', done: !!order.paid },
    { label: '領取紙本票券', done: !!order.delivered }
  ]
  const current = steps.findIndex((step) => !step.done)

  return steps.map((step, index) => ({
    ...step,
    current: index === current,
    // the line to the next dot lights up once both ends are done
    trackDone: step.done && !!steps[index + 1]?.done
  }))
}

// last characters of the order id, printed like a ticket serial
function serialOf(order) {
  return String(order.id || '').slice(-6).toUpperCase()
}

function formatOrderTime(value) {
  const date = parseDate(value)
  if (!date) return '—'

  const parts = Object.fromEntries(ORDER_TIME.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`
}

function itemSummary(order) {
  const items = itemsOf(order)
  if (items.length === 0) return '0 張票'

  const names = items
    .map((item) => item.name)
    .filter(Boolean)
    .slice(0, 2)
    .join('、')

  return `${ticketCount(order)} 張票 · ${names}${items.length > 2 ? '…' : ''}`
}
</script>

<style scoped>
@import 'src/css/orderspage.scss';
</style>
