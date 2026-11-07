<template>
  <div class="desk-page">
    <main class="desk-content">
      <header class="page-heading">
        <div class="heading-topline">
          <p class="eyebrow">領票服務 <span>／ CHECK-IN DESK</span></p>
          <span class="live-badge" :class="{ off: !connected }"><i />{{ connected ? (phone ? '手機已連線' : '等待手機配對') : '未連線' }}</span>
        </div>
        <h1>電腦領票</h1>
        <p class="lead">手機只負責掃，這台電腦核對與領票：手機掃到的 QR Code 和學生證會打勾在下面的清單，全部打勾後按一下領票（或按 Enter）</p>
      </header>

      <div class="desk-grid">
        <section class="desk-station" aria-label="領票">
          <PickupStation
            ref="station"
            :camera="cameraOn"
            keyboard
            idle-hint="用手機掃購票人的 QR Code 或建中學生證，訂單會出現在這裡；先掃哪一個都可以"
            @need="desk.setNeed"
          />
          <label class="camera-toggle">
            <input v-model="cameraOn" type="checkbox">
            也用這台電腦的相機掃描
          </label>
        </section>

        <aside class="card">
          <div class="card-head">
            <span>{{ phone && connected ? '手機已連線' : '配對手機' }}</span>
            <span v-if="expiresAt && !isExpired" class="card-tag">有效至 {{ formatTime(expiresAt) }}</span>
          </div>

          <div class="status-main" :class="{ on: !!phone && connected }" role="status" aria-live="polite">
            <p class="status-title">{{ statusTitle }}</p>
            <p class="status-meta">{{ statusMeta }}</p>
          </div>

          <details class="pair-details" :open="!phone || !connected">
            <summary>{{ phone && connected ? '再配對一支手機' : '配對 QR Code' }}</summary>
            <div class="qr-box">
              <canvas v-show="showQr" ref="qrCanvas" role="img" aria-label="配對 QR Code" />
              <div v-if="ended" class="qr-overlay">
                <p>已結束連線</p>
                <button type="button" class="primary-button" @click="restart">重新開始</button>
              </div>
              <div v-else-if="desk.status === 'error'" class="qr-overlay">
                <p role="alert">{{ desk.linkId ? '與伺服器的連線中斷' : '無法產生配對 QR Code' }}；請檢查網路後重試</p>
                <button type="button" class="primary-button" @click="desk.retry()">重試</button>
              </div>
              <div v-else-if="isExpired" class="qr-overlay">
                <p>配對已過期，手機已無法傳送</p>
                <button type="button" class="primary-button" @click="renew">重新產生 QR Code</button>
              </div>
              <p v-else-if="!showQr" class="qr-overlay">正在產生配對 QR Code…</p>
            </div>
            <ol class="steps">
              <li>手機登入後台，開啟「掃描票券」，對準這個 QR Code</li>
              <li>手機顯示「已連線到電腦」後，掃購票人的 QR Code 和學生證；手機不用按任何按鈕</li>
              <li>在這台電腦核對，按一下領票；手機上會顯示電腦還在等什麼</li>
            </ol>
          </details>

          <template v-if="desk.recent.length">
            <h2 class="recent-title">手機傳來的</h2>
            <ul class="recent-list">
              <li v-for="item in desk.recent" :key="item.id">
                <button type="button" @click="station?.receive({ orderId: item.orderId })">
                  <span class="mono">{{ item.orderId }}</span>
                  <span class="recent-meta">
                    {{ formatTime(item.at) }}{{ item.byName ? ` · ${item.byName}` : '' }}{{ item.ticketCode ? ' · QR Code' : item.studentId ? ` · 學生證 ${item.studentId}` : ' · 手動輸入' }}
                  </span>
                </button>
              </li>
            </ul>
          </template>

          <div class="desk-actions">
            <button type="button" class="secondary-button" :disabled="busy" @click="renew">重新產生 QR Code</button>
            <button type="button" class="secondary-button danger" :disabled="busy || !desk.linkId" @click="endLink">結束連線</button>
          </div>
          <p class="desk-hint">重新產生 QR Code 或結束連線後，已配對的手機會改回自己領票</p>
        </aside>
      </div>

      <router-link :to="{ name: 'admin-scan' }" class="desk-link">改用這台裝置的相機領票 →</router-link>
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QRCode from 'qrcode'
import PickupStation from 'src/components/PickupStation.vue'
import { useNow } from 'src/composables/useNow'
import { useScanDeskStore } from 'src/stores/scanDesk'
import { SCAN_LINK_HOURS, getScanLinkUrl } from 'src/utils/scanLink'
import { ORDER_ID_PATTERN } from 'src/utils/ticketQr'

const router = useRouter()
const route = useRoute()
const desk = useScanDeskStore()
// for the expiry, which is hours away
const now = useNow(30000)

const station = ref(null)
const qrCanvas = ref(null)
const qrReady = ref(false)
// 結束連線 pressed on this page; a new pairing waits for 重新開始
const ended = ref(false)
const busy = ref(false)
const CAMERA_KEY = 'cksc.deskCamera'
const cameraOn = ref(readCameraPref())

function readCameraPref() {
  try {
    return localStorage.getItem(CAMERA_KEY) === '1'
  } catch {
    return false
  }
}
watch(cameraOn, (on) => {
  try {
    localStorage.setItem(CAMERA_KEY, on ? '1' : '0')
  } catch {
    // ignore
  }
})

const phone = computed(() => desk.link?.phone || null)
const createdAt = computed(() => desk.link?.createdAt?.toDate?.() || null)
const expiresAt = computed(() =>
  createdAt.value ? new Date(createdAt.value.getTime() + SCAN_LINK_HOURS * 60 * 60 * 1000) : null
)
const isExpired = computed(() => desk.expired(now.value))
const connected = computed(() => desk.status === 'ready' && !isExpired.value && !ended.value)
const showQr = computed(() => qrReady.value && !!desk.linkId && desk.status !== 'error' && !isExpired.value && !ended.value)

const statusTitle = computed(() => {
  if (ended.value) return '已結束連線'
  if (desk.status === 'error') return '連線中斷'
  if (isExpired.value) return '配對已過期'
  if (!connected.value) return '準備中'
  return phone.value ? (phone.value.name || '手機') : '等待手機配對'
})

const statusMeta = computed(() => {
  if (!connected.value) return ''
  if (!phone.value) return '用手機掃描下面的配對 QR Code'
  const at = phone.value.at?.toDate?.()
  return at ? `最後活動 ${formatTime(at)}` : ''
})

function formatTime(date) {
  return date
    ? date.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })
    : ''
}

async function renderQr(linkId) {
  qrReady.value = false
  if (!linkId) return
  await nextTick()
  if (!qrCanvas.value || linkId !== desk.linkId) return
  try {
    await QRCode.toCanvas(qrCanvas.value, getScanLinkUrl(linkId, window.location.origin), {
      width: 232,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#050608', light: '#ffffff' }
    })
    if (linkId === desk.linkId) qrReady.value = true
  } catch (error) {
    console.error('Failed to render pairing QR code', error)
  }
}

watch(() => desk.linkId, renderQr)

// the phone's scans, handed over by the store
function takeScans() {
  if (!station.value) return
  for (const entry of desk.takeIncoming()) {
    station.value.receive({ orderId: entry.orderId, ticketCode: entry.ticketCode, studentId: entry.studentId })
  }
}
watch(() => desk.incoming.length, (length) => { if (length) takeScans() })

async function run(action) {
  if (busy.value) return
  busy.value = true
  try {
    await action()
  } finally {
    busy.value = false
  }
}

const renew = () => run(async () => {
  ended.value = false
  await desk.renew()
})

const endLink = () => run(async () => {
  await desk.end()
  ended.value = true
})

const restart = () => run(async () => {
  ended.value = false
  await desk.start(router)
})

// from an order page's 去領票 (?order=…&c=…): that order, on this station
function openFromQuery() {
  const orderId = String(route.query.order || '')
  if (!ORDER_ID_PATTERN.test(orderId)) return
  const code = route.query.c ? String(route.query.c).slice(0, 200) : ''
  station.value?.load(orderId, code ? { code } : {})
  window.history.replaceState(window.history.state, '', router.resolve({ name: route.name }).href)
}

onMounted(() => {
  renderQr(desk.linkId)
  desk.start(router)
  takeScans()
  openFromQuery()
})

onBeforeUnmount(() => {
  desk.setNeed(null)
})
</script>

<style scoped>
.desk-page {
  --void: #050608;
  --surface-soft: #11151b;
  --lunar: #9aa3ac;
  --off-white: #f2f0e9;
  --ember: #e4a468;
  --ok: #77bf8b;
  --line: rgba(242, 240, 233, .14);
  --line-soft: rgba(242, 240, 233, .08);
  --danger: #c97878;

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

.desk-content {
  width: min(100%, 1180px);
  margin: 0 auto;
}

.page-heading {
  margin-bottom: 18px;
  padding: 14px 0 16px;
  border-top: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
}

.heading-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
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

.live-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--lunar);
  font-size: 11px;
  letter-spacing: .04em;
}

.live-badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 4px rgba(119, 191, 139, .12);
}

.live-badge.off i {
  background: var(--lunar);
  box-shadow: 0 0 0 4px rgba(154, 163, 172, .12);
}

.page-heading h1 {
  margin: 0;
  font-family: 'Noto Sans TC', 'Manrope', sans-serif;
  font-size: 2.2rem;
  font-weight: 800;
  line-height: 1.3;
}

.lead {
  margin: 11px 0 0;
  color: var(--lunar);
  font-size: 14px;
  line-height: 1.7;
}

.desk-grid {
  display: grid;
  gap: 16px;
}

@media (min-width: 960px) {
  .desk-grid {
    grid-template-columns: minmax(0, 1fr) 320px;
    align-items: start;
  }

  .desk-grid .card {
    position: sticky;
    top: 88px;
  }
}

.desk-station {
  min-width: 0;
}

.camera-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  color: var(--lunar);
  font-size: 13px;
  cursor: pointer;
}

.camera-toggle input {
  accent-color: var(--ember);
}

.pair-details {
  margin-top: 14px;
}

.pair-details summary {
  padding: 4px;
  color: var(--ember);
  font-size: 13px;
  cursor: pointer;
}

.pair-details[open] summary {
  margin-bottom: 10px;
}

.card {
  padding: 12px 12px 18px;
  border: 1px solid var(--line);
  background: linear-gradient(145deg, rgba(255, 255, 255, .055), rgba(255, 255, 255, .018));
  box-shadow: 0 22px 55px rgba(0, 0, 0, .22);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 4px 13px;
  color: var(--off-white);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .06em;
}

.card-tag {
  color: var(--lunar);
  font-weight: 400;
  letter-spacing: .02em;
}

.qr-box {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  background: #fff;
}

.qr-box canvas {
  display: block;
  max-width: 100%;
  height: auto !important;
}

.qr-overlay {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: rgba(5, 6, 8, .92);
  color: var(--lunar);
  font-size: 14px;
  line-height: 1.7;
  text-align: center;
}

.qr-overlay p {
  margin: 0;
}

.steps {
  margin: 16px 4px 0;
  padding-left: 1.3em;
  color: var(--lunar);
  font-size: 13px;
  line-height: 1.8;
}

.status-main {
  padding: 18px 16px;
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, .02);
}

.status-main.on {
  border-color: rgba(119, 191, 139, .35);
  background: rgba(119, 191, 139, .07);
}

.status-main p {
  margin: 0;
}

.status-title {
  font-size: 18px;
  font-weight: 700;
}

.status-meta {
  min-height: 1.6em;
  margin-top: 4px !important;
  color: var(--lunar);
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.recent-title {
  margin: 22px 4px 8px;
  color: var(--off-white);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .06em;
}

.recent-empty {
  margin: 0 4px;
  color: rgba(242, 240, 233, .35);
  font-size: 13px;
}

.recent-list {
  max-height: 260px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  border-top: 1px solid var(--line-soft);
}

.recent-list li {
  border-bottom: 1px solid var(--line-soft);
}

.recent-list button {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 12px;
  width: 100%;
  padding: 10px 4px;
  border: 0;
  background: transparent;
  color: var(--off-white);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.recent-list button:hover {
  background: var(--surface-soft);
}

.mono {
  font-family: monospace;
  font-size: 13.5px;
  letter-spacing: .03em;
}

.recent-meta {
  color: var(--lunar);
  font-size: 12px;
}

.desk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.desk-hint {
  margin: 12px 4px 0;
  color: var(--lunar);
  font-size: 12px;
  line-height: 1.7;
}

.desk-link {
  display: inline-block;
  margin-top: 12px;
  color: var(--ember);
  font-size: 13px;
  text-decoration: none;
}

.desk-link:hover {
  text-decoration: underline;
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

.secondary-button:hover:not(:disabled) {
  border-color: rgba(242, 240, 233, .35);
  background: var(--surface-soft);
}

.secondary-button.danger {
  color: var(--danger);
}

.secondary-button:disabled {
  opacity: .45;
  cursor: default;
}

.primary-button {
  border-color: var(--ember);
  background: var(--ember);
  color: #111;
  font-weight: 700;
}

@media (max-width: 420px) {
  .heading-topline {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .desk-actions button {
    flex: 1 1 100%;
  }
}

@media (max-width: 959px) {
  .page-heading h1 {
    font-size: 1.9rem;
  }
}
</style>
