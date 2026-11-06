<template>
  <div class="card-scanner">
    <div class="scanner-card">
      <div class="scanner-card-head">
        <span>學生證掃描</span>
        <span class="scanner-status" :class="{ busy: engine !== 'ready' }"><i />{{ engineLabel }}</span>
      </div>

      <div class="viewfinder">
        <video ref="video" muted playsinline autoplay aria-label="相機畫面" />
        <div v-if="phase === 'scanning'" class="card-frame" :class="{ seen: cardSeen }" aria-hidden="true" />
        <p v-if="phase === 'scanning'" class="live-hint" role="status" aria-live="polite">{{ hint }}</p>

        <div v-if="phase === 'starting'" class="overlay">
          <p>正在開啟相機…</p>
        </div>

        <div v-else-if="phase === 'looking'" class="overlay">
          <p class="overlay-label">學號</p>
          <p class="big-id">{{ studentId }}</p>
          <p><span class="spinner" aria-hidden="true" />查詢訂單中…</p>
        </div>

        <div v-else-if="phase === 'opening'" class="overlay ok">
          <p class="overlay-label">✓ 找到訂單</p>
          <p class="big-name">{{ opening?.customerName || studentId }}</p>
          <p>{{ paired ? '已傳送到電腦' : '開啟訂單中…' }}</p>
          <button v-if="paired" type="button" class="primary-button" @click="startCamera()">掃描下一張學生證</button>
        </div>

        <div v-else-if="phase === 'choose'" class="overlay choose" role="dialog" aria-label="選擇訂單">
          <p class="overlay-label">學號 {{ result.studentId }} 有 {{ result.orders.length }} 筆訂單，請選擇</p>
          <div class="order-list">
            <button v-for="order in result.orders" :key="order.id" type="button" class="order-row" @click="open(order)">
              <span class="order-main">
                <strong>{{ order.customerName || '（未填姓名）' }}</strong>
                <span class="order-state" :class="{ done: order.delivered }">
                  {{ order.delivered ? '已領票' : '未領票' }}{{ order.paid ? '' : '・未付款' }}
                </span>
              </span>
              <span class="order-items">{{ itemsText(order) }}</span>
              <span class="order-id">{{ order.id }}</span>
            </button>
          </div>
          <button type="button" class="secondary-button" @click="startCamera()">取消，重新掃描</button>
        </div>

        <div v-else-if="phase === 'none'" class="overlay danger" role="alert">
          <p class="overlay-label">✕ 找不到訂單</p>
          <p class="big-id">{{ result.studentId }}</p>
          <p class="overlay-note">{{ result.email }} 沒有任何訂單。請核對學生證上的學號，或請對方出示票券 QR Code。</p>
          <p v-if="otherReads.length" class="overlay-note">
            是不是讀錯了？
            <button v-for="text in otherReads" :key="text" type="button" class="chip" @click="lookup(text)">{{ text }}</button>
          </p>
          <div class="overlay-actions">
            <button type="button" class="primary-button" @click="startCamera()">重新掃描</button>
            <button type="button" class="secondary-button" @click="editId">手動改學號</button>
          </div>
        </div>

        <div v-else-if="phase === 'error'" class="overlay danger" role="alert">
          <p class="overlay-label">✕ 查詢失敗</p>
          <p class="overlay-note">{{ errorText }}</p>
          <div class="overlay-actions">
            <button v-if="studentId" type="button" class="primary-button" @click="lookup(studentId)">再查一次</button>
            <button type="button" class="secondary-button" @click="startCamera()">重新掃描</button>
          </div>
        </div>

        <div v-else-if="phase === 'stopped'" class="overlay">
          <p>{{ cameraError || '相機已暫停' }}</p>
          <button type="button" class="primary-button" @click="startCamera()">開啟相機</button>
        </div>
      </div>

      <div v-if="cameras.length > 1" class="camera-row">
        <label for="card-camera">鏡頭</label>
        <select id="card-camera" :value="currentCamera" @change="switchCamera($event.target.value)">
          <option v-for="(camera, index) in cameras" :key="camera.deviceId" :value="camera.deviceId">
            {{ camera.label || `鏡頭 ${index + 1}` }}
          </option>
        </select>
      </div>

      <p class="scanner-caption">
        <span>02</span> 學生證橫放在框內拿穩，讀到學號會自動查訂單；手指壓到卡片邊角沒關係，別蓋住學號
      </p>
    </div>

    <form class="manual" @submit.prevent="lookup(studentId)">
      <label for="student-id">讀不到時，輸入學號</label>
      <div class="manual-row">
        <input
          id="student-id"
          ref="idInput"
          v-model="studentId"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          placeholder="例如 1130524"
          :aria-invalid="!!formError"
          @input="formError = ''"
        >
        <button type="submit" class="secondary-button" :disabled="phase === 'looking'">查詢訂單</button>
        <label class="secondary-button photo-button">
          拍照
          <input type="file" accept="image/*" capture="environment" @change="readPhoto">
        </label>
      </div>
      <p v-if="formError" class="manual-error" role="alert">{{ formError }}</p>
      <p class="manual-help">會查 Email 為 ck{學號}@gl.ck.tp.edu.tw 的訂單。學生證可以影印或翻拍，領票前務必核對證件照片與本人。</p>
    </form>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { findStudentOrders } from 'src/services/orderService'
import { cleanStudentId, STUDENT_ID_LENGTH } from 'src/data/schools'
import { cameraErrorMessage } from 'src/utils/qrScanner'
import { createStudentIdReader } from 'src/utils/studentIdOcr'

const props = defineProps({
  deviceId: { type: String, default: '' },
  // paired with a computer: an order found is sent there, and this page
  // stays for the next card
  paired: { type: Boolean, default: false }
})
// `camera`: the deviceId picked, so the page reuses it next time
const emit = defineEmits(['open', 'camera'])

// a pause between camera frames, so the phone stays responsive
const FRAME_GAP_MS = 150
// one reading this sure is enough; otherwise two frames in a row must agree
const SURE_CONFIDENCE = 92

const video = ref(null)
const idInput = ref(null)
// starting | scanning | looking | opening | choose | none | error | stopped
const phase = ref('starting')
const cameraError = ref('')
// loading | ready | failed
const engine = ref('loading')
const cardSeen = ref(false)
const hint = ref('')
const studentId = ref('')
const otherReads = ref([])
const formError = ref('')
const errorText = ref('')
const result = ref(null)
const opening = ref(null)
const cameras = ref([])
const currentCamera = ref('')

const engineLabel = computed(() => ({ loading: '載入辨識引擎…', ready: '辨識引擎就緒', failed: '辨識引擎載入失敗' })[engine.value])

const reader = createStudentIdReader({ idLength: STUDENT_ID_LENGTH })
let stream = null
let sequence = 0
let lastRead = ''
let unmounted = false

function itemsText(order) {
  return order.items.map((item) => `${item.name} × ${item.quantity}`).join('、')
}

// The camera stays open between cards: some browsers (Firefox) ask for
// permission again every time it is reopened
async function startCamera(deviceId = currentCamera.value || props.deviceId) {
  pauseReading()
  const run = sequence
  cameraError.value = ''
  result.value = null
  opening.value = null
  otherReads.value = []
  if (stream?.getVideoTracks().some((track) => track.readyState === 'live')) {
    phase.value = 'scanning'
    lastRead = ''
    hint.value = '把學生證放進框內'
    loop(run)
    return
  }
  stopTracks()
  phase.value = 'starting'
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('getUserMedia unavailable'), { name: 'NotSupportedError' })
    }
    const media = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    })
    if (run !== sequence || unmounted) {
      media.getTracks().forEach((track) => track.stop())
      return
    }
    stream = media
    currentCamera.value = media.getVideoTracks()[0]?.getSettings().deviceId || deviceId
    // names are known once access is granted
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      cameras.value = devices.filter((device) => device.kind === 'videoinput' && device.deviceId)
    }).catch(() => {})
    video.value.srcObject = media
    await video.value.play().catch(() => {})
    phase.value = 'scanning'
    lastRead = ''
    hint.value = engine.value === 'ready' ? '把學生證放進框內' : '第一次使用要下載辨識引擎（約 15 MB），請稍候…'
    loop(run)
  } catch (error) {
    if (run !== sequence) return
    // the saved camera is gone (another phone, unplugged): use the default
    if (deviceId) {
      currentCamera.value = ''
      emit('camera', '')
      startCamera('')
      return
    }
    console.error('Camera failed to start', error)
    cameraError.value = cameraErrorMessage(error)
    phase.value = 'stopped'
  }
}

// another camera: the open one is closed first (phones allow one at a time)
function switchCamera(deviceId) {
  if (!deviceId || deviceId === currentCamera.value) return
  stopCamera()
  currentCamera.value = deviceId
  emit('camera', deviceId)
  startCamera(deviceId)
}

// stops reading frames (the loop sees `sequence`); the camera stays open
function pauseReading() {
  sequence++
  cardSeen.value = false
}

function stopTracks() {
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  if (video.value) video.value.srcObject = null
}

function stopCamera() {
  pauseReading()
  stopTracks()
}

// a still copy of the frame: the video moves on while it is being read
function snapshot() {
  const source = video.value
  if (!source?.videoWidth) return null
  const canvas = document.createElement('canvas')
  canvas.width = source.videoWidth
  canvas.height = source.videoHeight
  canvas.getContext('2d').drawImage(source, 0, 0)
  return canvas
}

// one frame at a time; a slow phone just reads fewer frames. A restarted
// camera starts a new loop and the old one ends at its next frame
async function loop(run) {
  try {
    await reader.ready()
    engine.value = 'ready'
    while (run === sequence && !unmounted) {
      const frame = snapshot()
      if (frame) {
        const read = await reader.recognize(frame, { quick: true })
        if (run !== sequence || unmounted) return
        cardSeen.value = read.cardFound
        if (read.id) {
          const sure = read.confidence >= SURE_CONFIDENCE && read.votes >= 2
          if (sure || read.id === lastRead) {
            accept(read.id, read.candidates)
            return
          }
          hint.value = `讀到 ${read.id}，確認中…`
        } else {
          hint.value = read.cardFound ? '找到學生證，讀取學號中…' : '把學生證放進框內'
        }
        lastRead = read.id || ''
      }
      await new Promise((resolve) => setTimeout(resolve, FRAME_GAP_MS))
    }
  } catch (error) {
    if (run !== sequence) return
    console.error('Student card OCR failed', error)
    engine.value = 'failed'
    hint.value = '辨識引擎無法載入，請檢查網路，或在下方輸入學號'
  }
}

function accept(id, candidates = []) {
  navigator.vibrate?.(60)
  otherReads.value = candidates.map((c) => c.text).filter((text) => text !== id).slice(0, 3)
  lookup(id, { keepReads: true })
}

async function readPhoto(event) {
  const [file] = event.target.files || []
  event.target.value = ''
  if (!file) return
  pauseReading()
  phase.value = 'looking'
  studentId.value = '辨識中…'
  try {
    const read = await reader.recognize(file)
    engine.value = 'ready'
    if (read.id) {
      accept(read.id, read.candidates)
      return
    }
    studentId.value = ''
    errorText.value = '照片裡讀不到學號。請重拍（學號不要被手指或反光擋住），或直接輸入學號。'
  } catch (error) {
    console.error('Student card OCR failed', error)
    engine.value = 'failed'
    studentId.value = ''
    errorText.value = '辨識引擎無法載入，請檢查網路，或直接輸入學號。'
  }
  phase.value = 'error'
}

function lookupErrorText(error) {
  const code = String(error?.code || '').replace('functions/', '')
  if (code === 'permission-denied') return '這個帳號沒有查詢權限，請用工作人員帳號登入。'
  if (code === 'unauthenticated') return '請先登入工作人員帳號。'
  if (code === 'unavailable' || !navigator.onLine) return '網路連線不穩，請稍後再試。'
  // the callable missing on the server answers 404 without CORS headers
  if (code === 'not-found' || code === 'internal') return `伺服器沒有學生證查詢功能（${code}），可能還沒部署。請先改掃票券 QR Code。`
  return `伺服器沒有回應（${code || 'unknown'}）。請稍後再試，或改掃票券 QR Code。`
}

async function lookup(value, { keepReads = false } = {}) {
  const id = cleanStudentId(value)
  if (!id) {
    formError.value = '學號是 6 到 8 位數字'
    return
  }
  pauseReading()
  formError.value = ''
  if (!keepReads) otherReads.value = otherReads.value.filter((text) => text !== id)
  studentId.value = id
  result.value = null
  phase.value = 'looking'
  const run = sequence
  try {
    const found = await findStudentOrders(id)
    if (run !== sequence || unmounted) return
    result.value = found
    if (found.orders.length === 1) open(found.orders[0])
    else phase.value = found.orders.length ? 'choose' : 'none'
  } catch (error) {
    if (run !== sequence || unmounted) return
    console.error('Student order lookup failed', error)
    errorText.value = lookupErrorText(error)
    phase.value = 'error'
  }
}

function open(order) {
  opening.value = order
  phase.value = 'opening'
  emit('open', { orderId: order.id, studentId: result.value.studentId })
}

async function editId() {
  await nextTick()
  idInput.value?.focus()
  idInput.value?.select()
}

// in the background only reading pauses: closing the camera would make
// some browsers ask for permission again. Back in view, a camera the phone
// closed meanwhile is reopened
let resumeOnShow = false
function onVisibilityChange() {
  if (document.hidden) {
    resumeOnShow = phase.value === 'scanning'
    if (resumeOnShow) pauseReading()
  } else if (resumeOnShow) {
    resumeOnShow = false
    startCamera()
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  startCamera()
})

onBeforeUnmount(() => {
  unmounted = true
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopCamera()
  reader.terminate()
})
</script>

<style scoped>
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

.scanner-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--lunar);
  font-size: 11px;
  letter-spacing: .04em;
}

.scanner-status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #77bf8b;
  box-shadow: 0 0 0 4px rgba(119, 191, 139, .12);
}

.scanner-status.busy i {
  background: var(--ember);
  box-shadow: 0 0 0 4px rgba(228, 164, 104, .14);
}

.viewfinder {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: #000;
}

.viewfinder video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* the 85.6 × 54 mm card shape */
.card-frame {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 84%;
  aspect-ratio: 85.6 / 54;
  transform: translate(-50%, -50%);
  border: 2px dashed var(--ember);
  border-radius: 10px;
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .35);
  pointer-events: none;
  transition: border-color .2s;
}

.card-frame.seen {
  border-style: solid;
  border-color: #77bf8b;
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

.overlay strong {
  color: var(--off-white);
  font-size: 20px;
  letter-spacing: .08em;
}

.mono {
  font-family: monospace;
}

.camera-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 4px 0;
  color: var(--lunar);
  font-size: 12px;
}

.camera-row select {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 0;
  background: var(--surface-soft);
  color: var(--off-white);
  font-family: inherit;
  font-size: 13px;
}

.scanner-caption {
  margin: 13px 4px 2px;
  color: var(--lunar);
  font-size: 11px;
  line-height: 1.6;
  letter-spacing: .02em;
}

.scanner-caption span {
  margin-right: 8px;
  color: var(--ember);
  font-family: monospace;
}





.photo-button {
  display: inline-flex;
  align-items: center;
}

.photo-button input {
  display: none;
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

.secondary-button:disabled {
  opacity: .5;
  cursor: default;
}

.primary-button {
  border-color: var(--ember);
  background: var(--ember);
  color: #111;
  font-weight: 700;
}

.manual {
  margin-top: 20px;
  padding: 20px;
  border: 1px solid var(--line-soft);
  background: rgba(255, 255, 255, .02);
}

.manual > label {
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
  font-size: 18px;
  letter-spacing: .08em;
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

.chip {
  margin: 4px 6px 0 0;
  padding: 3px 10px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--off-white);
  font-family: monospace;
  font-size: 13px;
  cursor: pointer;
}



.order-row {
  display: grid;
  gap: 4px;
  width: 100%;
  margin-bottom: 10px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, .03);
  color: var(--off-white);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.order-row:hover {
  border-color: var(--ember);
}

.order-main {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px 12px;
  font-size: 15px;
}


.order-items {
  color: var(--lunar);
  font-size: 13px;
}

.order-state {
  color: var(--ember);
  font-size: 12.5px;
  font-weight: 700;
}

.order-state.done {
  color: var(--lunar);
}

.live-hint {
  position: absolute;
  left: 50%;
  bottom: 12px;
  max-width: calc(100% - 24px);
  margin: 0;
  padding: 6px 14px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: rgba(5, 6, 8, .78);
  color: var(--off-white);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.overlay.ok {
  background: rgba(16, 40, 24, .92);
}

.overlay.danger {
  background: rgba(48, 14, 14, .93);
}

.overlay.choose {
  justify-content: flex-start;
  overflow-y: auto;
}

.overlay-label {
  color: var(--off-white);
  font-size: 15px;
  font-weight: 700;
}

.overlay.ok .overlay-label {
  color: #8fd6a3;
}

.overlay.danger .overlay-label {
  color: #f0a3a3;
}

.big-id {
  color: var(--off-white);
  font-family: monospace;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: .1em;
}

.big-name {
  color: var(--off-white);
  font-size: 26px;
  font-weight: 800;
}

.overlay-note {
  max-width: 340px;
  font-size: 13px;
}

.overlay-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: 8px;
  vertical-align: -2px;
  border: 2px solid rgba(242, 240, 233, .25);
  border-top-color: var(--ember);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.order-list {
  width: 100%;
}

.order-list .order-row {
  margin-bottom: 8px;
  padding: 10px 12px;
}

.order-id {
  color: var(--lunar);
  font-family: monospace;
  font-size: 11.5px;
}

@media (max-width: 420px) {
  .manual-row {
    flex-direction: column;
  }

  .manual-row button {
    width: 100%;
  }
}
</style>
