<template>
  <div class="scan-page">
    <main class="scan-content">
      <header class="page-heading">
        <p class="eyebrow">領票</p>
        <div class="title-row">
          <h1>掃描票券</h1>
          <button
            type="button"
            class="help-button"
            aria-label="使用教學"
            title="使用教學"
            @click="openGuide"
          >
            ?
          </button>
        </div>
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
        <p v-else-if="state === 'guide'" class="overlay">看完使用教學後會開啟相機</p>
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

    <GuideDialog
      v-model="guideOpen"
      :steps="GUIDE_STEPS"
      finish-label="開始掃描"
      @hide="onGuideHide"
    />
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import GuideDialog from 'src/components/GuideDialog.vue'
import { SITE_URL } from 'src/config/app'
import { isGuideSeen, markGuideSeen } from 'src/utils/guideSeen'
import { cameraErrorMessage, startQrScanner } from 'src/utils/qrScanner'
import { ORDER_ID_PATTERN, parseTicketQr } from 'src/utils/ticketQr'

const router = useRouter()

const GUIDE_STEPS = [
  {
    title: '允許使用相機',
    lines: [
      '關閉教學後，瀏覽器會詢問是否允許使用相機，請按「允許」。',
      '若不小心拒絕了，請到瀏覽器的網站設定開啟相機權限，再按「重新開啟相機」。'
    ]
  },
  {
    title: '對準票券 QR Code',
    lines: [
      '請購票人打開確認信，或網站「已購門票」裡的 QR Code。',
      '將 QR Code 放進畫面中的框內，距離約 15–25 公分，讀到後會自動開啟訂單。',
      '讀不到時，請購票人調高螢幕亮度。'
    ]
  },
  {
    title: '核對並領票',
    lines: [
      '確認畫面顯示「✓ QR 驗證碼相符」，並核對購票人姓名與票種。',
      '按「已領票」後，交付紙本票券。',
      '若顯示驗證碼不符，請勿發票，交由管理員核對身分處理。'
    ]
  },
  {
    title: '繼續下一位',
    lines: [
      '按訂單頁的「掃描下一張」或返回，就會回到掃描畫面。',
      '無法掃描時，可在下方輸入訂單編號手動開啟，但需由管理員核對身分後才能領票。',
      '之後可隨時按標題旁的「?」再看一次教學。'
    ]
  }
]

// Shown automatically on this device's first visit only
const GUIDE_SEEN_KEY = 'cksc.scanGuideSeen'

const video = ref(null)
// guide (first visit, camera waits) | starting | scanning | paused (page hidden) | error
const state = ref('starting')
const guideOpen = ref(false)
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

function openGuide() {
  guideOpen.value = true
}

function onGuideHide() {
  markGuideSeen(GUIDE_SEEN_KEY)
  // first visit: ask for the camera only after the guide explained it
  if (state.value === 'guide') start()
}

function handleCode(text) {
  // don't leave the page while staff are reading the guide
  if (guideOpen.value) return
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
  if (isGuideSeen(GUIDE_SEEN_KEY)) {
    start()
  } else {
    state.value = 'guide'
    guideOpen.value = true
  }
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

.title-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.help-button {
  flex: none;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: transparent;
  color: var(--off-white);
  font-family: inherit;
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}

.help-button:hover {
  border-color: var(--ember);
  color: var(--ember);
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
