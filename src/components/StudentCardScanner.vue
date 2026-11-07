<template>
  <div class="card-scanner">
    <div class="scanner-card">
      <p v-if="prompt && !compact" class="scanner-prompt" role="status">{{ prompt }}</p>

      <div class="viewfinder">
        <video ref="video" muted playsinline autoplay aria-label="相機畫面" />
        <div v-if="phase === 'scanning'" :class="card ? 'card-frame' : 'qr-frame'" :data-seen="cardSeen || null" aria-hidden="true" />
        <p v-if="phase === 'scanning'" class="live-hint" role="status" aria-live="polite">{{ hint }}</p>
        <!-- QR codes are read meanwhile: the picture shows through -->
        <div v-if="phase === 'scanning' && card && engine === 'loading'" class="engine-loading" role="status">
          <p><span class="spinner" aria-hidden="true" />辨識引擎載入中…</p>
        </div>

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
            <button v-if="!compact" type="button" class="secondary-button" @click="editId">手動改學號</button>
          </div>
        </div>

        <div v-else-if="phase === 'error'" class="overlay danger" role="alert">
          <p class="overlay-label">✕ {{ lookupEnabled ? '查詢失敗' : '讀不到學號' }}</p>
          <p class="overlay-note">{{ errorText }}</p>
          <div class="overlay-actions">
            <button v-if="lookupEnabled && studentId" type="button" class="primary-button" @click="lookup(studentId)">再查一次</button>
            <button type="button" class="secondary-button" @click="startCamera()">重新掃描</button>
          </div>
        </div>

        <div v-else-if="phase === 'stopped'" class="overlay">
          <p>{{ cameraError || '相機已暫停' }}</p>
          <button type="button" class="primary-button" @click="startCamera()">開啟相機</button>
        </div>
      </div>

      <div v-if="cameras.length > 1" class="camera-row">
        <label :for="`camera-${uid}`">鏡頭</label>
        <select :id="`camera-${uid}`" :value="currentCamera" @change="switchCamera($event.target.value)">
          <option v-for="(camera, index) in cameras" :key="camera.deviceId" :value="camera.deviceId">
            {{ camera.label || `鏡頭 ${index + 1}` }}
          </option>
        </select>
      </div>

      <p v-if="!compact" class="scanner-caption">
        <span>{{ card && qr ? '01' : card ? '02' : '01' }}</span>
        <template v-if="card && qr">票券 QR Code 或學生證都可以，放進框內會自動辨識；學生證橫放拿穩，別蓋住學號</template>
        <template v-else-if="card">學生證橫放在框內拿穩，讀到學號會自動{{ lookupEnabled ? '查訂單' : '核對' }}；手指壓到卡片邊角沒關係，別蓋住學號</template>
        <template v-else>將票券 QR Code 放入框線內，系統會自動辨識</template>
      </p>
    </div>

    <!-- compact: the page has its own search box (訂單編號、姓名或學號) -->
    <form v-if="card && !compact" class="manual" @submit.prevent="submitId">
      <label :for="`student-id-${uid}`">讀不到時，輸入學號</label>
      <div class="manual-row">
        <input
          :id="`student-id-${uid}`"
          ref="idInput"
          v-model="studentId"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          placeholder="例如 11300524"
          :aria-invalid="!!formError"
          @input="formError = ''"
        >
        <button type="submit" class="secondary-button" :disabled="phase === 'looking'">{{ lookupEnabled ? '查詢訂單' : '核對學號' }}</button>
        <label class="secondary-button photo-button">
          拍照
          <input type="file" accept="image/*" capture="environment" @change="readPhoto">
        </label>
      </div>
      <p v-if="formError" class="manual-error" role="alert">{{ formError }}</p>
      <p v-if="!compact" class="manual-help">
        {{ lookupEnabled ? '會查 Email 為 ck{學號}@gl.ck.tp.edu.tw 的訂單。' : '學號要和訂單 Email ck{學號}@gl.ck.tp.edu.tw 相符。' }}學生證可以影印或翻拍，領票前務必核對證件照片與本人。
      </p>
    </form>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { findStudentOrders } from 'src/services/orderService'
import { CARD_ID_CORNER, CARD_ID_PATTERN, cleanStudentId, repairCardId } from 'src/data/schools'
import { acquireCamera, releaseCamera } from 'src/utils/camera'
import { cameraErrorMessage, createDecoder, listCameras } from 'src/utils/qrScanner'
import { createStudentIdReader } from 'src/utils/studentIdOcr'

// The check-in camera: reads 建中 student cards (`card`), ticket QR codes
// (`qr`), or both at once, so staff can scan either first.
const props = defineProps({
  deviceId: { type: String, default: '' },
  // paired with a computer: an order found is sent there, and this page
  // stays for the next card
  paired: { type: Boolean, default: false },
  card: { type: Boolean, default: true },
  qr: { type: Boolean, default: false },
  // look up the orders of a card's 學號 (`open`); off, the 學號 is handed
  // over as read (`read`), for the order page to compare
  lookup: { type: Boolean, default: true },
  // an order the lookup opens at once when the student has it
  preferOrderId: { type: String, default: '' },
  title: { type: String, default: '' },
  // inside the order page, whose checklist already says what to scan
  compact: { type: Boolean, default: false },
  // what staff are asked for, above the camera (e.g. whose card)
  prompt: { type: String, default: '' },
  // the 學號 the page waits for (the order shown): read once, it is taken
  // at once, since a misread is never exactly that number
  expect: { type: String, default: '' },
  // 'card' | 'qr': that one was scanned for the order, the other is wanted
  scanned: { type: String, default: '' }
})
// `open({ orderId, studentId })`: found by lookup | `read({ studentId, candidates })`:
// lookup off | `qr(text)`: every QR code in view (the page decides) |
// `camera(deviceId)`: the one picked, so the page reuses it next time
const emit = defineEmits(['open', 'read', 'qr', 'camera'])

// a pause between camera frames, so the phone stays responsive
const FRAME_GAP_MS = 150
const QR_GAP_MS = 150
// a card in view: QR codes are looked for less often, leaving the phone to
// the card
const QR_CARD_GAP_MS = 600
// one reading this sure is enough (only 11x00xxx numbers are read at all);
// otherwise two frames must agree within CONFIRM_MS. A frame that reads
// nothing in between does not start over
const SURE_CONFIDENCE = 90
const CONFIRM_MS = 4000
// a frame's runner-up this sure counts for the next frame too
const RUNNER_UP_CONFIDENCE = 80

const uid = Math.random().toString(36).slice(2, 8)
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

const lookupEnabled = computed(() => props.lookup)
function idleHint() {
  if (props.scanned === 'card' && props.qr) return '學生證掃描成功，請掃描 QR Code'
  if (props.scanned === 'qr' && props.card) return 'QR Code 掃描成功，請掃描學生證'
  return props.card && props.qr ? '把 QR Code 或學生證放進框內' : props.card ? '把學生證放進框內' : '把票券 QR Code 放進框內'
}

let reader = null
let stream = null
let sequence = 0
// the 學號 each recent frame read: [{ at, ids }]
let recentReads = []
let unmounted = false
let qrDecoder = null

function itemsText(order) {
  return order.items.map((item) => `${item.name} × ${item.quantity}`).join('、')
}

// The camera is shared with the other check-in pages (src/utils/camera.js)
// and stays open between cards: some browsers (Firefox) ask for permission
// again every time it is reopened
async function startCamera(deviceId = currentCamera.value || props.deviceId) {
  pauseReading()
  const run = sequence
  cameraError.value = ''
  result.value = null
  opening.value = null
  otherReads.value = []
  if (stream?.getVideoTracks().some((track) => track.readyState === 'live')) {
    beginReading(run)
    return
  }
  dropStream()
  phase.value = 'starting'
  try {
    const camera = await acquireCamera(deviceId)
    if (run !== sequence || unmounted) {
      releaseCamera()
      return
    }
    stream = camera.stream
    currentCamera.value = camera.deviceId
    // names are known once access is granted
    listCameras().then((list) => { cameras.value = list }).catch(() => {})
    video.value.srcObject = stream
    await video.value.play().catch(() => {})
    beginReading(run)
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

function beginReading(run) {
  phase.value = 'scanning'
  recentReads = []
  hint.value = idleHint()
  if (props.card) loop(run)
  if (props.qr) qrLoop(run)
}

// another camera: the open one is closed first (phones allow one at a time)
function switchCamera(deviceId) {
  if (!deviceId || deviceId === currentCamera.value) return
  pauseReading()
  dropStream()
  currentCamera.value = deviceId
  emit('camera', deviceId)
  startCamera(deviceId)
}

// stops reading frames (the loops see `sequence`); the camera stays open
function pauseReading() {
  sequence++
  cardSeen.value = false
}

function dropStream() {
  if (!stream) return
  stream = null
  if (video.value) video.value.srcObject = null
  releaseCamera()
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

function getReader() {
  reader ||= createStudentIdReader({
    idLength: [8, 8],
    idPattern: CARD_ID_PATTERN,
    repairId: repairCardId,
    idCorner: CARD_ID_CORNER,
    findLines: true
  })
  return reader
}

// one frame at a time; a slow phone just reads fewer frames. A restarted
// camera starts a new loop and the old one ends at its next frame
async function loop(run) {
  try {
    await getReader().ready()
    engine.value = 'ready'
    while (run === sequence && !unmounted && props.card) {
      const frame = snapshot()
      if (frame) {
        const read = await reader.recognize(frame, { quick: true })
        if (run !== sequence || unmounted) return
        // a phone held up with its QR code is card-shaped too: only a card
        // with a row of digits in its corner slows the QR checks
        cardSeen.value = read.cardFound && read.numberSeen
        if (read.id) {
          const expected = expectedRead(read)
          // a card still in view after it was handed over (or sent) is not
          // read again: before, each pair of frames handed it once more and
          // the hint went 確認中 → 把學生證放進框內 → 確認中 for as long as
          // the card stayed
          if (!expected && read.id === sentId && Date.now() - sentAt < REPEAT_MS) {
            sentAt = Date.now()
            hint.value = props.paired ? `學號 ${read.id} 已傳送，換下一位` : `已讀到學號 ${read.id}`
            await new Promise((resolve) => setTimeout(resolve, FRAME_GAP_MS))
            continue
          }
          const again = readBefore(read)
          const sure = expected || again || read.confidence >= SURE_CONFIDENCE
          const id = expected || read.id
          if (sure) {
            accept(id, read.candidates)
            return
          }
          // waiting for a second reading: the next frame at once
          hint.value = `讀到 ${read.id}，確認中…`
          continue
        }
        hint.value = cardSeen.value ? '找到學生證，讀取學號中…' : idleHint()
      }
      await new Promise((resolve) => setTimeout(resolve, FRAME_GAP_MS))
    }
  } catch (error) {
    if (run !== sequence) return
    console.error('Student card OCR failed', error)
    engine.value = 'failed'
    hint.value = props.qr ? '學生證辨識引擎無法載入；QR Code 仍可掃描，學號請在下方輸入' : '辨識引擎無法載入，請檢查網路，或在下方輸入學號'
  }
}

// the 學號 the page waits for, when this frame read it (even as a runner-up)
function expectedRead(read) {
  const want = cleanStudentId(props.expect)
  if (!want) return ''
  return read.id === want || read.candidates.some((c) => c.text === want && c.confidence >= 60) ? want : ''
}

// whether another recent frame read this 學號 too; this frame is remembered
function readBefore(read) {
  const now = Date.now()
  recentReads = recentReads.filter((entry) => now - entry.at < CONFIRM_MS)
  const seen = recentReads.some((entry) => entry.ids.includes(read.id))
  const ids = read.candidates.filter((c) => c.text === read.id || c.confidence >= RUNNER_UP_CONFIDENCE).map((c) => c.text)
  recentReads.push({ at: now, ids })
  return seen
}

// QR codes are quick to find: checked on their own, much more often than
// the card is read
async function qrLoop(run) {
  try {
    qrDecoder ||= await createDecoder()
  } catch (error) {
    console.error('QR decoder failed to load', error)
    return
  }
  while (run === sequence && !unmounted && props.qr) {
    const source = video.value
    if (source?.readyState >= source?.HAVE_CURRENT_DATA && source.videoWidth) {
      try {
        const text = await qrDecoder.decode(source)
        if (text && run === sequence && !unmounted) emit('qr', text)
      } catch (error) {
        console.error('QR decode failed', error)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, props.card && cardSeen.value ? QR_CARD_GAP_MS : QR_GAP_MS))
  }
}

function accept(id, candidates = []) {
  navigator.vibrate?.(60)
  otherReads.value = candidates.map((c) => c.text).filter((text) => text !== id).slice(0, 3)
  if (props.lookup) {
    lookup(id, { keepReads: true })
    return
  }
  hand(id)
}

// lookup off: the page takes the 學號 from here and keeps reading what it
// still needs. The field empties again: the page shows the 學號, and a 學號
// left here would look like the next buyer's
function hand(id) {
  sentId = id
  sentAt = Date.now()
  studentId.value = ''
  emit('read', { studentId: id, candidates: otherReads.value })
  startCamera()
}

function submitId() {
  if (props.lookup) {
    lookup(studentId.value)
    return
  }
  const id = cleanStudentId(studentId.value)
  if (!id) {
    formError.value = '學號是 6 到 8 位數字'
    return
  }
  formError.value = ''
  hand(id)
}

async function readPhoto(event) {
  const [file] = event.target.files || []
  event.target.value = ''
  if (!file) return
  pauseReading()
  phase.value = 'looking'
  studentId.value = '辨識中…'
  try {
    const read = await getReader().recognize(file)
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
    const preferred = found.orders.find((order) => order.id === props.preferOrderId)
    // paired, the computer picks among several orders; the phone never stops to ask
    const first = props.paired ? found.orders.find((order) => !order.delivered) || found.orders[0] : null
    if (preferred) open(preferred)
    else if (found.orders.length === 1) open(found.orders[0])
    else if (first) open(first)
    else phase.value = found.orders.length ? 'choose' : 'none'
    if (phase.value === 'none' && props.paired) resumeSoon(PAIRED_MISS_MS)
  } catch (error) {
    if (run !== sequence || unmounted) return
    console.error('Student order lookup failed', error)
    errorText.value = lookupErrorText(error)
    phase.value = 'error'
  }
}

// paired, the phone sends the order and goes on reading by itself
const PAIRED_NEXT_MS = 700
const PAIRED_MISS_MS = 3000
// the 學號 last handed over (or sent, paired) and when it was last in view:
// while it stays in view it is not read again
const REPEAT_MS = 4000
let sentId = ''
let sentAt = 0
function resumeSoon(delay) {
  const run = sequence
  const shown = phase.value
  setTimeout(() => {
    if (run === sequence && phase.value === shown && !unmounted) startCamera()
  }, delay)
}

function open(order) {
  opening.value = order
  phase.value = 'opening'
  emit('open', { orderId: order.id, studentId: result.value.studentId })
  if (props.paired) {
    sentId = result.value.studentId
    sentAt = Date.now()
    resumeSoon(PAIRED_NEXT_MS)
  }
}

async function editId() {
  await nextTick()
  idInput.value?.focus()
  idInput.value?.select()
}

// one of the two scanned (or a new order): say what is wanted next
const IDLE_HINTS = ['把 QR Code 或學生證放進框內', '把學生證放進框內', '把票券 QR Code 放進框內', '學生證掃描成功，請掃描 QR Code', 'QR Code 掃描成功，請掃描學生證']
watch(() => props.scanned, () => {
  if (phase.value === 'scanning' && IDLE_HINTS.includes(hint.value)) hint.value = idleHint()
})

// what to read changed (the page got one of the two): read the rest
watch(() => [props.card, props.qr], () => {
  if (phase.value === 'scanning') startCamera()
})

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
  pauseReading()
  dropStream()
  reader?.terminate()
})

// the page restarts reading after it handled a QR code it could not use;
// forget(): the page dropped what it was given (取消), so the card still in
// view is read and handed over again
defineExpose({
  restart: () => startCamera(),
  forget: () => {
    sentId = ''
    recentReads = []
  }
})
</script>

<style scoped>
.scanner-card {
  padding: 12px;
  border: 1px solid var(--line);
  background: linear-gradient(145deg, rgba(255, 255, 255, .055), rgba(255, 255, 255, .018));
  box-shadow: 0 22px 55px rgba(0, 0, 0, .22);
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

/* ticket QR codes: the centre square the decoder reads */
.qr-frame {
  position: absolute;
  top: 50%;
  left: 50%;
  height: 70%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  border: 2px solid var(--ember);
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .35);
  pointer-events: none;
}

.scanner-prompt {
  margin: 0 0 10px;
  padding: 10px 12px;
  border-left: 3px solid var(--ember);
  background: rgba(228, 164, 104, .1);
  color: var(--off-white);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
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

.card-frame[data-seen] {
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

.engine-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(60, 62, 68, .55);
  color: var(--off-white);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: .04em;
  pointer-events: none;
}

.engine-loading p {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
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
