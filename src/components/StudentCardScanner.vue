<template>
  <div class="card-scanner">
    <div class="scanner-card">
      <div class="scanner-card-head">
        <span>學生證掃描</span>
        <span class="scanner-status" :class="{ busy: engine !== 'ready' }"><i />{{ engineLabel }}</span>
      </div>
      <div class="viewfinder card-view">
        <video ref="video" muted playsinline autoplay aria-label="相機畫面" />
        <div v-if="cameraState === 'on'" class="card-frame" :class="{ seen: cardSeen }" aria-hidden="true" />
        <p v-if="cameraState === 'starting'" class="overlay">正在開啟相機…</p>
        <div v-else-if="cameraState === 'off'" class="overlay">
          <p v-if="cameraError">{{ cameraError }}</p>
          <p v-else-if="result">已讀到學號 <strong class="mono">{{ result.studentId }}</strong></p>
          <p v-else>已停止掃描</p>
          <button type="button" class="primary-button" @click="startCamera()">{{ result ? '掃描下一張學生證' : '重新開始掃描' }}</button>
        </div>
      </div>
      <p class="scanner-caption">
        <span>02</span> 學生證橫放在框內，拿穩即可；手指壓到卡片邊角也沒關係，別蓋住學號
      </p>
    </div>

    <p class="scan-notice" :class="noticeTone" role="status" aria-live="polite">{{ notice }}</p>

    <div class="card-actions">
      <label class="secondary-button photo-button">
        拍照辨識
        <input type="file" accept="image/*" capture="environment" @change="readPhoto">
      </label>
    </div>

    <section v-if="result" class="results" aria-live="polite">
      <h2>{{ result.email }}</h2>
      <p v-if="!result.orders.length" class="manual-help">這個帳號沒有訂單。請確認學號，或改掃票券 QR Code。</p>
      <button
        v-for="order in result.orders"
        :key="order.id"
        type="button"
        class="order-row"
        @click="emit('open', { orderId: order.id, studentId: result.studentId })"
      >
        <span class="order-main">
          <strong>{{ order.customerName || '（未填姓名）' }}</strong>
          <span class="mono">{{ order.id }}</span>
        </span>
        <span class="order-items">{{ itemsText(order) }}</span>
        <span class="order-state" :class="{ done: order.delivered }">
          {{ order.delivered ? '已領票' : '未領票' }}{{ order.paid ? '' : '・未付款' }}
        </span>
      </button>
    </section>

    <form class="manual" @submit.prevent="lookup(studentId)">
      <label for="student-id">學號（辨識結果，可修改）</label>
      <div class="manual-row">
        <input
          id="student-id"
          v-model="studentId"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          placeholder="例如 1130524"
          :aria-invalid="!!lookupError"
        >
        <button type="submit" class="secondary-button" :disabled="looking">查詢訂單</button>
      </div>
      <p v-if="otherReads.length" class="manual-help">
        其他可能：
        <button v-for="text in otherReads" :key="text" type="button" class="chip" @click="lookup(text)">{{ text }}</button>
      </p>
      <p v-if="lookupError" class="manual-error" role="alert">{{ lookupError }}</p>
      <p class="manual-help">會查 Email 為 ck{學號}@gl.ck.tp.edu.tw 的訂單。學生證可以影印或翻拍，領票前務必核對證件照片與本人。</p>
    </form>

  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { findStudentOrders } from 'src/services/orderService'
import { cleanStudentId, STUDENT_ID_LENGTH } from 'src/data/schools'
import { cameraErrorMessage } from 'src/utils/qrScanner'
import { createStudentIdReader } from 'src/utils/studentIdOcr'

const props = defineProps({
  deviceId: { type: String, default: '' }
})
const emit = defineEmits(['open'])

// a pause between camera frames, so the phone stays responsive
const FRAME_GAP_MS = 150
// one reading this sure is enough; otherwise two frames in a row must agree
const SURE_CONFIDENCE = 92

const video = ref(null)
// starting | on | off
const cameraState = ref('starting')
const cameraError = ref('')
// loading | ready | failed
const engine = ref('loading')
const cardSeen = ref(false)
const notice = ref('')
const noticeTone = ref('info')
const studentId = ref('')
const otherReads = ref([])
const looking = ref(false)
const lookupError = ref('')
const result = ref(null)

const engineLabel = computed(() => ({ loading: '載入辨識引擎…', ready: '辨識引擎就緒', failed: '辨識引擎載入失敗' })[engine.value])

const reader = createStudentIdReader({ idLength: STUDENT_ID_LENGTH })
let stream = null
let sequence = 0
let lastRead = ''
let unmounted = false

function say(text, tone = 'info') {
  notice.value = text
  noticeTone.value = tone
}

function itemsText(order) {
  return order.items.map((item) => `${item.name} × ${item.quantity}`).join('、')
}

async function startCamera(deviceId = props.deviceId) {
  stopCamera()
  const run = ++sequence
  cameraState.value = 'starting'
  cameraError.value = ''
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
    video.value.srcObject = media
    await video.value.play().catch(() => {})
    cameraState.value = 'on'
    lastRead = ''
    result.value = null
    say(engine.value === 'ready' ? '把學生證放進框內' : '第一次使用要下載辨識引擎（約 15 MB），請稍候…')
    loop(run)
  } catch (error) {
    if (run !== sequence) return
    console.error('Camera failed to start', error)
    cameraError.value = cameraErrorMessage(error)
    cameraState.value = 'off'
  }
}

function stopCamera() {
  sequence++
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  if (video.value) video.value.srcObject = null
  cardSeen.value = false
  if (cameraState.value !== 'starting') cameraState.value = 'off'
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
        if (run !== sequence || unmounted) break
        cardSeen.value = read.cardFound
        if (read.id) {
          const sure = read.confidence >= SURE_CONFIDENCE && read.votes >= 2
          if (sure || read.id === lastRead) {
            accept(read.id, read.candidates)
            break
          }
          say(`讀到 ${read.id}，再確認一次…`)
        } else {
          say(read.cardFound ? '找到學生證，正在讀學號…' : '把學生證放進框內')
        }
        lastRead = read.id || ''
      }
      await new Promise((resolve) => setTimeout(resolve, FRAME_GAP_MS))
    }
  } catch (error) {
    console.error('Student card OCR failed', error)
    engine.value = 'failed'
    say('辨識引擎無法載入，請檢查網路，或直接輸入學號', 'danger')
  }
}

function accept(id, candidates = []) {
  navigator.vibrate?.(60)
  stopCamera()
  studentId.value = id
  otherReads.value = candidates.map((c) => c.text).filter((text) => text !== id).slice(0, 3)
  say(`讀到學號 ${id}`, 'ok')
  lookup(id)
}

async function readPhoto(event) {
  const [file] = event.target.files || []
  event.target.value = ''
  if (!file) return
  stopCamera()
  say('辨識照片中…')
  try {
    const read = await reader.recognize(file)
    engine.value = 'ready'
    if (read.id) accept(read.id, read.candidates)
    else say('讀不到學號；請重拍（學號不要被手指或反光擋住），或直接輸入', 'danger')
  } catch (error) {
    console.error('Student card OCR failed', error)
    engine.value = 'failed'
    say('辨識失敗，請直接輸入學號', 'danger')
  }
}

async function lookup(value) {
  const id = cleanStudentId(value)
  lookupError.value = ''
  if (!id) {
    lookupError.value = '學號格式不正確'
    return
  }
  studentId.value = id
  looking.value = true
  try {
    result.value = await findStudentOrders(id)
  } catch (error) {
    console.error('Student order lookup failed', error)
    lookupError.value = error.message || '查詢失敗，請稍後再試'
  } finally {
    looking.value = false
  }
}

function onVisibilityChange() {
  if (document.hidden && cameraState.value === 'on') stopCamera()
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

.scan-notice {
  min-height: 1.6em;
  margin: 12px 0 0;
  color: var(--danger);
  font-size: 14px;
}

.scan-notice.ok {
  color: #77bf8b;
}

.scan-notice.info {
  color: var(--lunar);
}

.card-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
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

.results {
  margin-top: 16px;
}

.results h2 {
  margin: 0 0 10px;
  color: var(--off-white);
  font-family: monospace;
  font-size: 13px;
  font-weight: 600;
  word-break: break-all;
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

.order-main .mono {
  color: var(--lunar);
  font-family: monospace;
  font-size: 12px;
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

@media (max-width: 420px) {
  .manual-row {
    flex-direction: column;
  }

  .manual-row button {
    width: 100%;
  }
}
</style>
