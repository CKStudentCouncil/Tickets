<template>
  <div class="scan-page">
    <main class="scan-content">
      <header class="page-heading">
        <div class="heading-topline">
          <p class="eyebrow">領票服務 <span>／ CHECK-IN</span></p>
          <span class="live-badge"><i />現場模式</span>
        </div>
        <div class="title-row">
          <div>
            <h1>掃描票券</h1>
            <p class="lead">對準購票人的 QR Code，快速完成核票與領票。</p>
          </div>
          <button
            type="button"
            class="help-button"
            aria-label="使用教學"
            title="使用教學"
            @click="openGuide"
          >
            <CircleQuestionMark :size="22" :stroke-width="1.75" aria-hidden="true" />
            <span>教學</span>
          </button>
        </div>
      </header>

      <div class="scanner-card">
        <div class="scanner-card-head">
          <span>掃描視窗</span>
          <span class="scanner-status"><i />{{ state === 'scanning' ? '相機已就緒' : '準備中' }}</span>
        </div>
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
          <button type="button" class="primary-button" @click="start()">重新開啟相機</button>
        </div>
        </div>
        <p class="scanner-caption"><span>01</span> 將 QR Code 放入框線內，系統會自動辨識</p>
      </div>

      <p class="scan-notice" role="status" aria-live="polite">{{ notice }}</p>

      <div v-if="state === 'scanning'" class="camera-row">
        <p class="camera-hint">畫面模糊時，把手機拿遠一點（約 20–30 公分）讓鏡頭對焦。</p>
        <button v-if="cameras.length > 1" type="button" class="secondary-button" @click="switchCamera">
          切換鏡頭
        </button>
      </div>
      <p v-if="state === 'scanning' && cameraInfo" class="camera-info">{{ cameraInfo }}</p>

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
import { CircleQuestionMark } from 'lucide-vue-next'
import GuideDialog from 'src/components/GuideDialog.vue'
import { SITE_URL } from 'src/config/app'
import { isGuideSeen, markGuideSeen } from 'src/utils/guideSeen'
import { cameraErrorMessage, listCameras, startQrScanner } from 'src/utils/qrScanner'
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
      '將 QR Code 放進畫面中的框內，讀到後會自動開啟訂單。',
      '手機鏡頭太近會對不到焦：畫面模糊時，把手機拿遠一點（約 20–30 公分）。',
      '還是讀不到時，請購票人調高螢幕亮度，或按「切換鏡頭」換一顆鏡頭試試。'
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
// The camera picked with 切換鏡頭, reused on this device's next visits
const CAMERA_KEY = 'cksc.scanCamera'

function savedCamera() {
  try {
    return localStorage.getItem(CAMERA_KEY) || ''
  } catch {
    return ''
  }
}

function saveCamera(deviceId) {
  try {
    localStorage.setItem(CAMERA_KEY, deviceId)
  } catch {
    // ignore
  }
}

// Ticket QR codes point at the production site; also accept this origin so
// QR codes made by a development frontend work there
const origins = [...new Set([new URL(SITE_URL).origin, window.location.origin])]

const video = ref(null)
// guide (first visit, camera waits) | starting | scanning | paused (page hidden) | error
const state = ref('starting')
const guideOpen = ref(false)
const errorMessage = ref('')
const notice = ref('')
const manualId = ref('')
const manualError = ref('')
const cameras = ref([])
const cameraInfo = ref('')

let stopScanner = null
let currentCamera = ''
let infoTimer = 0
let startSequence = 0
let lastInvalid = ''
let noticeTimer = 0

async function start(deviceId = savedCamera()) {
  const sequence = ++startSequence
  stopScanner?.()
  stopScanner = null
  clearInterval(infoTimer)
  state.value = 'starting'

  try {
    let scanner
    try {
      scanner = await startQrScanner(video.value, handleCode, { deviceId })
    } catch (error) {
      // the saved camera is gone (other phone, unplugged): use the default
      if (!deviceId || sequence !== startSequence) throw error
      saveCamera('')
      scanner = await startQrScanner(video.value, handleCode)
    }
    if (sequence !== startSequence) {
      scanner.stop()
      return
    }
    stopScanner = scanner.stop
    currentCamera = scanner.deviceId
    state.value = 'scanning'
    cameraInfo.value = scanner.info()
    // the size is known once frames arrive, and the decoder can change
    infoTimer = setInterval(() => { cameraInfo.value = scanner.info() }, 1000)
    listCameras().then((list) => {
      if (sequence === startSequence) cameras.value = list
    }).catch(() => {})
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
  clearInterval(infoTimer)
}

function switchCamera() {
  const list = cameras.value
  const index = list.findIndex((camera) => camera.deviceId === currentCamera)
  const next = list[(index + 1) % list.length]
  if (!next) return
  saveCamera(next.deviceId)
  start(next.deviceId)
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
    start(currentCamera)
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
  --ink: #080a0d;

  min-height: 100vh;
  padding: 104px 16px 100px;
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
  margin-bottom: 24px;
  padding: 22px 0 25px;
  border-top: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
}

.heading-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.eyebrow {
  margin: 0;
  color: var(--ember);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: .28em;
}

.eyebrow span {
  color: rgba(242, 240, 233, .4);
  font-size: 10px;
  letter-spacing: .12em;
}

.live-badge,
.scanner-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--lunar);
  font-size: 11px;
  letter-spacing: .04em;
}

.live-badge i,
.scanner-status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #77bf8b;
  box-shadow: 0 0 0 4px rgba(119, 191, 139, .12);
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
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}

.help-button {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, .025);
  color: var(--lunar);
  font-size: 12px;
  cursor: pointer;
}

.help-button:hover {
  color: var(--ember);
}

.lead {
  margin: 11px 0 0;
  color: var(--lunar);
  font-size: 14px;
  line-height: 1.7;
}

.scanner-card {
  padding: 12px;
  border: 1px solid var(--line);
  background: linear-gradient(145deg, rgba(255, 255, 255, .055), rgba(255, 255, 255, .018));
  box-shadow: 0 22px 55px rgba(0, 0, 0, .22);
}

.scanner-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 4px 13px;
  color: var(--off-white);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .06em;
}

.viewfinder {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border: 0;
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
  inset: 15%;
  border: 0;
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .42);
  pointer-events: none;
}

.frame::before,
.frame::after {
  position: absolute;
  inset: 0;
  border: 2px solid transparent;
  content: '';
}

.frame::before {
  border-top-color: var(--ember);
  border-left-color: var(--ember);
}

.frame::after {
  border-right-color: var(--ember);
  border-bottom-color: var(--ember);
}

.scanner-caption {
  margin: 13px 4px 2px;
  color: var(--lunar);
  font-size: 11px;
  letter-spacing: .02em;
}

.scanner-caption span {
  margin-right: 8px;
  color: var(--ember);
  font-family: monospace;
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

.camera-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.camera-hint {
  flex: 1;
  margin: 0;
  color: var(--lunar);
  font-size: 13px;
  line-height: 1.6;
}

.camera-info {
  margin: 8px 0 0;
  color: rgba(242, 240, 233, .35);
  font-size: 11px;
  word-break: break-word;
}

.manual {
  margin-top: 28px;
  padding: 20px;
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, .02);
}

.manual label {
  display: block;
  margin-bottom: 10px;
  color: var(--off-white);
  font-weight: 600;
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

@media (max-width: 420px) {
  .heading-topline,
  .title-row {
    align-items: flex-start;
  }

  .heading-topline {
    flex-direction: column;
    gap: 10px;
  }

  .title-row {
    flex-direction: column;
  }

  .help-button {
    align-self: flex-start;
  }

  .manual-row {
    flex-direction: column;
  }

  .manual-row button {
    width: 100%;
  }
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
