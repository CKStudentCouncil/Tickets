<template>
  <div class="scan-page">
    <main class="scan-content">
      <header class="page-heading">
        <p class="eyebrow">領票</p>
        <h1>掃描票券</h1>
        <p class="lead">將購票人的票券 QR Code 對準框內，讀到後會自動開啟訂單。</p>
      </header>

      <div class="viewfinder">
        <video
          ref="video"
          muted
          playsinline
          autoplay
          aria-label="相機畫面"
        />
        <div v-if="state === 'scanning'" class="frame" aria-hidden="true" />
        <p v-if="state === 'starting'" class="overlay">正在開啟相機…</p>
        <div v-else-if="state === 'error'" class="overlay">
          <p role="alert">{{ errorMessage }}</p>
          <button type="button" class="primary-button" @click="start">重新開啟相機</button>
        </div>
      </div>

      <p class="scan-notice" role="status" aria-live="polite">{{ notice }}</p>

      <form class="manual" @submit.prevent="openManual">
        <label for="manual-order-id">無法掃描時，輸入訂單編號</label>
        <div class="manual-row">
          <input
            id="manual-order-id"
            v-model="manualId"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            placeholder="例如 CKS20261027ABCDEF"
            :aria-invalid="!!manualError"
            aria-describedby="manual-help"
          >
          <button type="submit" class="secondary-button">開啟訂單</button>
        </div>
        <p v-if="manualError" class="manual-error" role="alert">{{ manualError }}</p>
        <p id="manual-help" class="manual-help">手動開啟的訂單沒有 QR 驗證碼，需由管理員核對身分後才能領票。</p>
      </form>
    </main>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { SITE_URL } from 'src/config/app'
import { cameraErrorMessage, startQrScanner } from 'src/utils/qrScanner'
import { ORDER_ID_PATTERN, parseTicketQr } from 'src/utils/ticketQr'

const router = useRouter()

// Ticket QR codes point at the production site; also accept this origin so
// QR codes made by a development frontend work there
const origins = [...new Set([new URL(SITE_URL).origin, window.location.origin])]

const video = ref(null)
// starting | scanning | paused (page hidden) | error
const state = ref('starting')
const errorMessage = ref('')
const notice = ref('')
const manualId = ref('')
const manualError = ref('')

let stopScanner = null
let startSequence = 0
let lastInvalid = ''
let noticeTimer = 0

async function start() {
  const sequence = ++startSequence
  stopScanner?.()
  stopScanner = null
  state.value = 'starting'

  try {
    const stop = await startQrScanner(video.value, handleCode)
    if (sequence !== startSequence) {
      stop()
      return
    }
    stopScanner = stop
    state.value = 'scanning'
  } catch (error) {
    if (sequence !== startSequence) return
    console.error('Camera failed to start', error)
    errorMessage.value = cameraErrorMessage(error)
    state.value = 'error'
  }
}

function stop() {
  startSequence++
  stopScanner?.()
  stopScanner = null
}

function showNotice(text) {
  notice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    notice.value = ''
    lastInvalid = ''
  }, 3000)
}

function openOrder(orderId, ticketCode = '') {
  stop()
  router.push({
    name: 'admin-order-detail',
    params: { id: orderId },
    query: ticketCode ? { c: ticketCode } : {}
  })
}

function handleCode(text) {
  const ticket = parseTicketQr(text, origins)
  if (!ticket) {
    // the same wrong code stays in view for many frames; say it once
    if (text !== lastInvalid) {
      lastInvalid = text
      showNotice('這不是本系統的票券 QR Code')
    }
    return
  }
  navigator.vibrate?.(60)
  openOrder(ticket.orderId, ticket.ticketCode)
}

function openManual() {
  const orderId = manualId.value.normalize('NFKC').trim().toUpperCase()
  if (!ORDER_ID_PATTERN.test(orderId)) {
    manualError.value = '訂單編號格式不正確'
    return
  }
  manualError.value = ''
  openOrder(orderId)
}

// Phones stop the camera in the background; restart it on return
function onVisibilityChange() {
  if (document.hidden) {
    if (state.value === 'starting' || state.value === 'scanning') {
      stop()
      state.value = 'paused'
    }
  } else if (state.value === 'paused') {
    start()
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  start()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  clearTimeout(noticeTimer)
  stop()
})
</script>

<style scoped>
.scan-page {
  --void: #050608;
  --surface-soft: #11151b;
  --lunar: #9aa3ac;
  --off-white: #f2f0e9;
  --ember: #e4a468;
  --line: rgba(242, 240, 233, .14);
  --line-soft: rgba(242, 240, 233, .08);
  --danger: #c97878;

  min-height: 100vh;
  padding: 120px 16px 100px;
  background:
    radial-gradient(
      ellipse 60% 40% at 90% 0%,
      rgba(228, 164, 104, .07),
      transparent 65%
    ),
    var(--void);
  color: var(--off-white);
  font-family: 'Manrope', 'Noto Sans TC', sans-serif;
  -webkit-font-smoothing: antialiased;
}

.scan-content {
  width: min(100%, 520px);
  margin: 0 auto;
}

.page-heading {
  margin-bottom: 28px;
}

.eyebrow {
  margin: 0 0 12px;
  color: var(--ember);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: .28em;
}

.page-heading h1 {
  margin: 0;
  font-family: 'Noto Sans TC', 'Manrope', sans-serif;
  font-size: clamp(2rem, 8vw, 2.6rem);
  font-weight: 800;
  line-height: 1.3;
}

.lead {
  margin: 10px 0 0;
  color: var(--lunar);
  font-size: 14px;
  line-height: 1.7;
}

.viewfinder {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid var(--line);
  background: #000;
}

.viewfinder video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.frame {
  position: absolute;
  inset: 16%;
  border: 2px solid var(--ember);
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .35);
  pointer-events: none;
}

.overlay {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: rgba(5, 6, 8, .85);
  color: var(--lunar);
  font-size: 14px;
  line-height: 1.7;
  text-align: center;
}

.overlay p {
  margin: 0;
}

.scan-notice {
  min-height: 1.6em;
  margin: 12px 0 0;
  color: var(--danger);
  font-size: 14px;
}

.manual {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--line-soft);
}

.manual label {
  display: block;
  margin-bottom: 10px;
  color: rgba(242, 240, 233, .55);
  font-size: 13px;
}

.manual-row {
  display: flex;
  gap: 10px;
}

.manual-row input {
  flex: 1;
  min-width: 0;
  height: 42px;
  padding: 0 13px;
  border: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  color: var(--off-white);
  font-family: inherit;
  font-size: 16px;
  letter-spacing: .04em;
  outline: none;
}

.manual-row input:focus {
  border-color: rgba(242, 240, 233, .35);
}

.manual-error {
  margin: 8px 0 0;
  color: var(--danger);
  font-size: 13px;
}

.manual-help {
  margin: 8px 0 0;
  color: var(--lunar);
  font-size: 12.5px;
  line-height: 1.6;
}

.secondary-button,
.primary-button {
  flex: none;
  min-height: 42px;
  padding: 0 20px;
  border: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  color: var(--off-white);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
}

.secondary-button:hover {
  border-color: rgba(242, 240, 233, .35);
  background: var(--surface-soft);
}

.primary-button {
  border-color: var(--ember);
  background: var(--ember);
  color: #111;
  font-weight: 700;
}
</style>
