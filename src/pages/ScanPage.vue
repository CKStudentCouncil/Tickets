<template>
  <div class="scan-page" :class="{ paired: !!remoteLink }">
    <main class="scan-content">
      <header class="page-heading">
        <div class="title-row">
          <div>
            <p class="eyebrow">領票服務 <span>／ CHECK-IN</span></p>
            <h1>{{ remoteLink ? '手機掃描' : '掃描 QR Code 或學生證' }}</h1>
          </div>
          <button type="button" class="help-button" aria-label="使用教學" title="使用教學" @click="openGuide">
            <CircleQuestionMark :size="20" :stroke-width="1.75" aria-hidden="true" />
            <span>教學</span>
          </button>
        </div>
      </header>

      <!-- ---------- a phone scanning for a computer ---------- -->
      <template v-if="remoteLink">
        <div class="remote-bar" role="status">
          <div>
            <p class="remote-title"><i />已連線到電腦</p>
            <p class="remote-meta">{{ remoteOwner ? `${remoteOwner}的電腦` : '連線中…' }}・在電腦上核對與領票</p>
          </div>
          <button type="button" class="remote-disconnect" @click="disconnect">中斷連線</button>
        </div>

        <p class="phone-status" :class="{ waiting: !!need }" role="status" aria-live="polite">
          <template v-if="need">電腦正在等：<strong>{{ need.name || need.orderId }}</strong> 的{{ needWhat }}</template>
          <template v-else>電腦待命中：掃下一位的 QR Code 或學生證</template>
        </p>

        <StudentCardScanner
          v-if="!firstGuide"
          :device-id="savedCamera()"
          paired
          qr
          :prefer-order-id="need?.orderId || ''"
          :scanned="need?.done || ''"
          compact
          @open="sendCard"
          @qr="handlePhoneQr"
          @camera="saveCamera"
        />
        <p v-if="notice" class="scan-notice" :class="noticeTone" role="status" aria-live="polite">{{ notice }}</p>

        <details class="manual order-entry" :open="!!manualError || !!manualChoices.length">
          <summary>都掃不到？輸入訂單編號、姓名、Email 或學號</summary>
          <form @submit.prevent="openManual">
            <div class="manual-row">
              <input v-model="manualId" autocomplete="off" spellcheck="false" placeholder="訂單編號、姓名、Email 或學號" aria-label="訂單編號、姓名、Email 或學號" :aria-invalid="!!manualError">
              <button type="submit" class="secondary-button" :disabled="manualBusy">傳送到電腦</button>
            </div>
            <p v-if="manualError" class="manual-error" role="alert">{{ manualError }}</p>
          </form>
          <div v-if="manualChoices.length" class="manual-choices" role="group" aria-label="選擇訂單">
            <p>有 {{ manualChoices.length }} 筆訂單，點要領的那一筆：</p>
            <button v-for="order in manualChoices" :key="order.id" type="button" class="secondary-button" @click="sendChoice(order)">
              {{ order.customerName || order.id }}<span>{{ [order.school, itemsOf(order), order.delivered ? '已領票' : ''].filter(Boolean).join('・') }}</span>
            </button>
          </div>
        </details>
      </template>

      <!-- ---------- the check-in station on this device ---------- -->
      <template v-else>
        <p v-if="notice" class="scan-notice" :class="noticeTone" role="status" aria-live="polite">{{ notice }}</p>
        <PickupStation
          ref="station"
          :camera="!firstGuide"
          :keyboard="!isPhone"
          :initial-order-id="initialOrderId"
          :qr-filter="takePairingCode"
        >
          <template #idle-extra>
            <details class="manual order-entry" :open="!!manualError">
              <summary>都掃不到？輸入訂單編號、姓名、Email 或學號</summary>
              <form @submit.prevent="openManual">
                <div class="manual-row">
                  <input v-model="manualId" autocomplete="off" spellcheck="false" placeholder="訂單編號、姓名、Email 或學號" aria-label="訂單編號、姓名、Email 或學號" :aria-invalid="!!manualError">
                  <button type="submit" class="secondary-button" :disabled="manualBusy">查詢</button>
                </div>
                <p class="manual-hint">姓名和 Email 要和訂單上的完全相同</p>
                <p v-if="manualError" class="manual-error" role="alert">{{ manualError }}</p>
              </form>
            </details>
          </template>
        </PickupStation>
        <p v-if="firstGuide" class="scan-notice info">看完使用教學後會開啟相機</p>

        <section class="desk-entry">
          <h2>手機掃描、電腦領票</h2>
          <p>在電腦上開「電腦領票」，再用這頁的相機掃電腦畫面上的配對 QR Code；之後這支手機只負責掃，在電腦上核對與領票。</p>
          <router-link :to="{ name: 'admin-scan-desk' }" class="desk-entry-link">這台是電腦：開啟電腦領票 →</router-link>
        </section>
      </template>
    </main>

    <GuideDialog v-model="guideOpen" :steps="remoteLink ? PHONE_GUIDE : GUIDE_STEPS" finish-label="開始" @hide="onGuideHide" />
  </div>
</template>

<script setup>
import { computed, markRaw, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Camera, CircleQuestionMark, Laptop, MousePointerClick, ScanLine, TriangleAlert } from 'lucide-vue-next'
import GuideDialog from 'src/components/GuideDialog.vue'
import PickupStation from 'src/components/PickupStation.vue'
import StudentCardScanner from 'src/components/StudentCardScanner.vue'
import { SITE_URL } from 'src/config/app'
import { isScanLinkClosed, useScanRemote } from 'src/composables/useScanRemote'
import { lookupOrders } from 'src/services/orderService'
import { SEARCH_HINT, choices, classifySearch, notFoundText, pickOrder, searchLabel } from 'src/utils/pickupSearch'
import { useAuthStore } from 'src/stores/auth'
import { isGuideSeen, markGuideSeen } from 'src/utils/guideSeen'
import { createRepeatFilter, isScanLinkId, parseScanLinkQr } from 'src/utils/scanLink'
import { ORDER_ID_PATTERN, parseTicketQr } from 'src/utils/ticketQr'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const GUIDE_STEPS = [
  {
    icon: markRaw(ScanLine),
    title: '1. 掃 QR Code 和學生證',
    lines: [
      '把購票人的票券 QR Code 放進相機框內；一售票、早鳥票再放建中學生證。先掃哪個都可以。',
      '相機一直開著：掃完一樣，清單那一列會打勾，然後繼續等下一樣。',
      '第一次使用時瀏覽器會問能不能用相機，請按「允許」。'
    ]
  },
  {
    icon: markRaw(MousePointerClick),
    title: '2. 全部打勾，按一下領票',
    lines: [
      '清單都打勾後，最下面的大按鈕會亮起來，上面寫著要確認的事，例如「已用酷課雲查驗，領票」。',
      '確認後按下（電腦也可以按 Enter），交付紙本票券。畫面會自動回到待命，直接掃下一位。'
    ]
  },
  {
    icon: markRaw(TriangleAlert),
    title: '3. 出狀況時',
    lines: [
      '紅色＝不能領：QR Code 不符、尚未付款、已經領過。黃色＝用例外方式完成。',
      '沒帶學生證：按那一列的「沒帶學生證？」，選酷課雲或其他證件。',
      '沒帶 QR Code：管理員按「沒帶 QR Code？」，可用學生證代替或寫原因。真的都不行，管理員按「管理員強制領票」並寫原因。'
    ]
  }
]

const PHONE_GUIDE = [
  {
    icon: markRaw(Laptop),
    title: '手機只負責掃描',
    lines: [
      '掃到的 QR Code 和學生證會傳到電腦，在電腦上核對與領票。手機不用按任何按鈕。',
      '上方會顯示電腦在等什麼，例如「電腦正在等：王小明 的學生證」。',
      '掃完一個人，直接掃下一位就好。'
    ]
  },
  {
    icon: markRaw(Camera),
    title: '掃描小技巧',
    lines: [
      '畫面模糊時，把手機拿遠一點（約 20–30 公分）讓鏡頭對焦；讀不到 QR Code 就請對方調亮螢幕。',
      '學生證橫放拿穩，別蓋住學號。'
    ]
  }
]

// While paired, a ticket counts again only after it has been out of view
// this long, since the camera stays on between scans
const REPEAT_GAP_MS = 2000
// how long a send may take before the phone says the computer may not have it
const SLOW_SEND_MS = 5000
const GUIDE_SEEN_KEY = 'cksc.scanGuideSeen3'
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

// Ticket QR codes point at the production site; also accept this origin
const origins = [...new Set([new URL(SITE_URL).origin, window.location.origin])]

const station = ref(null)
const guideOpen = ref(false)
// first visit: the camera waits until the guide is closed
const firstGuide = ref(false)
const notice = ref('')
// danger | ok | info
const noticeTone = ref('danger')
const manualId = ref('')
const manualError = ref('')
const manualBusy = ref(false)
// paired: a name or 學號 with several orders
const manualChoices = ref([])
// from an order page's 用相機核對領票 (/admin/scan?order=…)
const initialOrderId = ORDER_ID_PATTERN.test(String(route.query.order || '')) ? String(route.query.order) : ''
const isPhone = window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth < 900

let noticeTimer = 0

// 手機掃描、電腦領票: paired with a computer, what this phone reads is sent there
const remote = useScanRemote({
  getPhone: () => ({ uid: auth.user?.uid, name: auth.displayName }),
  onEnded: (message) => showNotice(message, 'danger', 6000)
})
const { linkId: remoteLink, ownerName: remoteOwner, need } = remote
const needWhat = computed(() => {
  const wanted = need.value
  if (!wanted) return ''
  return wanted.card && wanted.qr ? '票券 QR Code 和學生證' : wanted.card ? '學生證' : '票券 QR Code'
})
const repeats = createRepeatFilter(REPEAT_GAP_MS)
let pairing = false
let sendSequence = 0

// `duration` 0 keeps the notice until the next one
function showNotice(text, tone = 'danger', duration = 3000) {
  notice.value = text
  noticeTone.value = tone
  clearTimeout(noticeTimer)
  if (duration) noticeTimer = setTimeout(() => { notice.value = '' }, duration)
}

// a computer's pairing QR code (/admin/scan/desk); the station leaves it to this page
function takePairingCode(text) {
  const pairingId = parseScanLinkQr(text, origins)
  if (!pairingId) return false
  if (pairingId !== remoteLink.value && repeats.isNew(text)) pair(pairingId)
  return true
}

async function pair(linkId) {
  if (pairing) return
  pairing = true
  showNotice('正在連線到電腦…', 'info', 0)
  const slow = setTimeout(() => showNotice('網路連線不穩，仍在連線到電腦…', 'danger', 0), SLOW_SEND_MS)
  try {
    await remote.pair(linkId)
    navigator.vibrate?.(60)
    showNotice('已連線到電腦；接下來掃到的都會傳到電腦', 'ok', 5000)
  } catch (error) {
    console.error('Pairing failed', error)
    showNotice(isScanLinkClosed(error) ? '這個配對 QR Code 已過期或已結束；請在電腦上重新產生' : '無法連線到電腦，請檢查網路後再掃一次')
  } finally {
    clearTimeout(slow)
    pairing = false
  }
}

// ---------- paired: send what was read ----------
function handlePhoneQr(text) {
  if (guideOpen.value || takePairingCode(text)) return
  const ticket = parseTicketQr(text, origins)
  if (!ticket) {
    if (repeats.isNew(`bad:${text}`)) showNotice('這不是本系統的票券 QR Code')
    return
  }
  if (!repeats.isNew(text)) return
  sendToDesk(ticket, 'QR Code')
}

function sendCard({ orderId, studentId }) {
  sendToDesk({ orderId, ticketCode: '', studentId }, `學生證 ${studentId}`)
}

async function sendToDesk(ticket, what) {
  const sequence = ++sendSequence
  const linkId = remoteLink.value
  navigator.vibrate?.(60)
  showNotice(`傳送${what}到電腦…`, 'info', 0)
  // offline, the write waits for the network instead of failing
  const slow = setTimeout(() => {
    if (sequence === sendSequence) showNotice('網路連線不穩，電腦可能還沒收到；請看電腦畫面確認', 'danger', 0)
  }, SLOW_SEND_MS)
  try {
    await remote.send(ticket)
    if (sequence === sendSequence) showNotice(`✓ 已傳送${what}`, 'ok', 2500)
  } catch (error) {
    console.error('Failed to send scan', error)
    if (isScanLinkClosed(error) && remoteLink.value === linkId) {
      remote.leave()
      showNotice('配對已過期或電腦已結束連線，這次沒有傳送；請重新配對', 'danger', 6000)
    } else if (sequence === sendSequence) {
      showNotice('傳送失敗；請移開再掃一次')
    }
  } finally {
    clearTimeout(slow)
  }
}

function disconnect() {
  remote.leave()
  showNotice('已中斷連線；改在這支手機上領票', 'info')
}

// 都掃不到: an order number, a buyer's exact name or email, or a 學號. Here the
// station looks it up; paired, this phone finds the order and sends it
async function openManual() {
  const value = manualId.value.normalize('NFKC').trim()
  if (!value || manualBusy.value) return
  manualError.value = ''
  manualChoices.value = []
  manualBusy.value = true
  try {
    if (!remoteLink.value) {
      manualError.value = (await station.value?.search(value)) || ''
      if (!manualError.value) manualId.value = ''
      return
    }
    const query = classifySearch(value)
    if (!query) {
      manualError.value = `請輸入${SEARCH_HINT}`
      return
    }
    if (query.kind === 'order') {
      sendManual(query.orderId, searchLabel(query))
      return
    }
    const orders = (await lookupOrders(query)).orders || []
    const pick = pickOrder(orders)
    if (!orders.length) manualError.value = notFoundText(query)
    else if (pick) sendManual(pick.id, pick.customerName || `訂單 ${pick.id}`)
    else manualChoices.value = choices(orders)
  } catch (error) {
    console.error('Order lookup failed', error)
    const code = String(error?.code || '').replace('functions/', '')
    manualError.value = code === 'invalid-argument' ? `請輸入完整的${SEARCH_HINT}` : `查詢失敗（${code || 'unknown'}）；請再試一次`
  } finally {
    manualBusy.value = false
  }
}

function sendManual(orderId, what) {
  manualId.value = ''
  manualChoices.value = []
  sendToDesk({ orderId, ticketCode: '' }, what)
}

function sendChoice(order) {
  sendManual(order.id, order.customerName || `訂單 ${order.id}`)
}

function itemsOf(order) {
  return (order?.items || []).map((item) => `${item.name} × ${item.quantity}`).join('、')
}

function openGuide() {
  guideOpen.value = true
}

function onGuideHide() {
  markGuideSeen(GUIDE_SEEN_KEY)
  // first visit: ask for the camera only after the guide explained it
  firstGuide.value = false
}

onMounted(() => {
  // opened from a pairing QR code with the phone's own camera app
  if (route.query.link !== undefined) {
    const linkId = String(route.query.link)
    // out of the address without router.replace, which would remake the
    // page (MainLayout keys it by the full path) and drop the pairing
    window.history.replaceState(window.history.state, '', router.resolve({ name: route.name }).href)
    if (isScanLinkId(linkId)) pair(linkId)
    else showNotice('配對連結不正確，請重新掃描電腦上的 QR Code')
  } else {
    remote.restore()
  }
  if (initialOrderId) window.history.replaceState(window.history.state, '', router.resolve({ name: route.name }).href)

  if (!isGuideSeen(GUIDE_SEEN_KEY)) {
    firstGuide.value = true
    guideOpen.value = true
  }
})

onBeforeUnmount(() => {
  clearTimeout(noticeTimer)
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
  --danger: #e07f7f;

  min-height: 100vh;
  padding: 96px 16px 80px;
  background:
    radial-gradient(ellipse 60% 40% at 90% 0%, rgba(228, 164, 104, .07), transparent 65%),
    var(--void);
  color: var(--off-white);
  font-family: 'Manrope', 'Noto Sans TC', sans-serif;
  -webkit-font-smoothing: antialiased;
}

.scan-content {
  width: min(100%, 1120px);
  margin: 0 auto;
}

.scan-page.paired .scan-content {
  width: min(100%, 520px);
}

.page-heading {
  margin-bottom: 16px;
  padding: 14px 0;
  border-top: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
}

.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow {
  margin: 0 0 4px;
  color: var(--ember);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .28em;
}

.eyebrow span {
  color: rgba(242, 240, 233, .4);
  font-size: 10px;
  letter-spacing: .12em;
}

.page-heading h1 {
  margin: 0;
  font-family: 'Noto Sans TC', 'Manrope', sans-serif;
  font-size: clamp(1.5rem, 5vw, 2rem);
  font-weight: 800;
  line-height: 1.3;
}

.help-button {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, .025);
  color: var(--lunar);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.help-button:hover {
  color: var(--ember);
}

.remote-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 12px;
  padding: 10px 12px 10px 14px;
  border: 1px solid rgba(119, 191, 139, .35);
  background: rgba(119, 191, 139, .07);
}

.remote-bar p {
  margin: 0;
}

.remote-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
}

.remote-title i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #77bf8b;
  box-shadow: 0 0 0 4px rgba(119, 191, 139, .14);
}

.remote-meta {
  margin-top: 4px !important;
  color: var(--lunar);
  font-size: 12.5px;
  line-height: 1.6;
}

.remote-disconnect {
  flex: none;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--lunar);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.remote-disconnect:hover,
.remote-disconnect:focus-visible {
  border-color: var(--off-white);
  color: var(--off-white);
}

.phone-status {
  margin: 0 0 12px;
  padding: 12px 14px;
  border-left: 3px solid var(--line);
  background: rgba(255, 255, 255, .03);
  color: var(--lunar);
  font-size: 15px;
  line-height: 1.5;
}

.phone-status.waiting {
  border-left-color: var(--ember);
  background: rgba(228, 164, 104, .1);
  color: var(--off-white);
  font-weight: 700;
}

.scan-notice {
  min-height: 1.6em;
  margin: 10px 0;
  color: var(--danger);
  font-size: 14px;
  line-height: 1.6;
}

.scan-notice.ok {
  color: #77bf8b;
  font-weight: 700;
}

.scan-notice.info {
  color: var(--lunar);
}

.manual {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, .02);
  text-align: left;
  width: 100%;
}

.order-entry summary {
  color: var(--off-white);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.order-entry form {
  margin-top: 12px;
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

.manual-hint {
  margin: 6px 0 0;
  color: var(--lunar);
  font-size: 12px;
}

.manual-choices {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}

.manual-choices p {
  margin: 0;
  color: var(--lunar);
  font-size: 13px;
}

.manual-choices button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  height: auto;
  padding: 10px 12px;
  text-align: left;
}

.manual-choices button span {
  color: var(--lunar);
  font-size: 12px;
  font-weight: 400;
}

.manual-error {
  margin: 8px 0 0;
  color: var(--danger);
  font-size: 13px;
}

.desk-entry {
  margin-top: 28px;
  padding: 16px 18px;
  border: 1px dashed var(--line);
}

.desk-entry h2 {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
}

.desk-entry p {
  margin: 0;
  color: var(--lunar);
  font-size: 12.5px;
  line-height: 1.7;
}

.desk-entry-link {
  display: inline-block;
  margin-top: 10px;
  color: var(--ember);
  font-size: 13px;
  text-decoration: none;
}

.desk-entry-link:hover {
  text-decoration: underline;
}

.secondary-button {
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

@media (max-width: 420px) {
  .manual-row {
    flex-direction: column;
  }
}

/* a phone: room for the camera and the order under it */
@media (max-width: 600px) {
  .scan-page {
    padding-top: 76px;
  }

  .page-heading {
    margin-bottom: 10px;
    padding: 8px 0;
  }

  .eyebrow {
    display: none;
  }

  .page-heading h1 {
    font-size: 1.35rem;
  }
}
</style>
