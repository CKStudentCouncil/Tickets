<template>
  <div class="station" :class="[{ 'with-camera': camera, 'one-order': fixed }, flash ? `flash-${flash}` : '']">
    <div v-if="camera" class="station-camera">
      <StudentCardScanner
        :device-id="savedCamera()"
        :card="cameraMode !== 'qr'"
        :qr="cameraMode !== 'card'"
        :lookup="false"
        title="QR Code 和學生證都可以掃"
        compact
        :expect="expectedCard"
        :scanned="scannedOne"
        @read="({ studentId }) => handleCard(studentId)"
        @qr="handleQr"
        @camera="saveCamera"
      />
      <slot name="camera-extra" />
    </div>

    <div class="station-main">
      <p v-if="notice" class="station-notice" :class="notice.tone" role="status" aria-live="polite">{{ notice.text }}</p>

      <!-- another buyer's scan while this one is half done: ask first -->
      <div v-if="prompt?.kind === 'switch'" class="station-prompt" role="alert">
        <p class="prompt-title">{{ prompt.title }}</p>
        <p class="prompt-text">{{ prompt.text }}</p>
        <div class="prompt-actions">
          <button type="button" class="prompt-primary" @click="acceptSwitch">切換到 {{ prompt.name }}</button>
          <button type="button" class="prompt-secondary" @click="prompt = null">留在 {{ current?.order.customerName || '這筆' }}</button>
        </div>
      </div>

      <!-- a 學號 with several orders -->
      <div v-else-if="prompt?.kind === 'choose'" class="station-prompt" role="dialog" aria-label="選擇訂單">
        <p class="prompt-title">{{ prompt.title }}</p>
        <p class="prompt-text">點選要領的那一筆，或直接掃那一筆的 QR Code{{ prompt.scans?.studentId ? '；學生證不用再掃，每一筆掃 QR Code 就好' : '' }}</p>
        <div class="choose-list">
          <button v-for="item in prompt.orders" :key="item.id" type="button" class="choose-row" @click="choose(item)">
            <strong>{{ item.customerName || '（未填姓名）' }}</strong>
            <span>{{ [item.school, itemsOf(item)].filter(Boolean).join('・') }}</span>
            <span class="choose-state" :class="{ done: item.delivered }">{{ item.delivered ? '已領票' : '未領票' }}{{ item.paid ? '' : '・未付款' }}</span>
          </button>
        </div>
        <button type="button" class="prompt-secondary" @click="prompt = null">取消</button>
      </div>

      <PickupPanel
        v-if="current"
        ref="panel"
        :order="current.order"
        :checks="checks"
        :scans="current.scans"
        :is-admin="auth.isAdmin"
        :busy="busy"
        :error="panelError"
        :clearable="!fixed"
        :detail-link="!fixed"
        :keyboard="keyboard"
        :auto-ms="autoMs"
        @collect="collect()"
        @force="collect"
        @clear="clear"
        @mark-paid="markPaid"
        @exception="setException"
        @undo="undoException"
        @stop-auto="stopAuto"
      />

      <!-- stays until the next scan -->
      <div v-else-if="done" class="station-done" role="status">
        <p class="done-title"><Check :size="28" :stroke-width="3" aria-hidden="true" /> 已領票</p>
        <p class="done-name">{{ done.name }}</p>
        <ul class="done-tickets" aria-label="交付的票">
          <li v-for="(item, index) in done.tickets" :key="index">
            <span>{{ item.name }}</span>
            <strong>× {{ item.quantity }}</strong>
          </li>
        </ul>
        <p class="done-money" :class="done.money.kind">
          <span>{{ done.money.label }}</span>
          <strong v-if="done.money.amount">{{ done.money.amount }}</strong>
        </p>
        <p class="done-meta">請交付紙本票券</p>
        <slot v-if="!fixed" name="idle-extra" />
      </div>

      <div v-else-if="loading" class="station-idle" role="status">
        <p class="idle-title">載入訂單中…</p>
      </div>

      <div v-else-if="!fixed" class="station-idle">
        <ScanLine class="idle-icon" :size="40" aria-hidden="true" />
        <p class="idle-title">{{ idleTitle }}</p>
        <p class="idle-text">{{ idleText }}</p>
        <slot name="idle-extra" />
      </div>

      <div v-if="!fixed && !current && recent.length" class="recent">
        <p class="recent-title">剛領完</p>
        <ul>
          <li v-for="item in recent" :key="item.id + item.at">
            <button type="button" @click="load(item.id)">
              <span>{{ item.name }}</span>
              <span class="recent-meta">{{ item.time }}・{{ item.how }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, ScanLine } from 'lucide-vue-next'
import PickupPanel from 'src/components/PickupPanel.vue'
import StudentCardScanner from 'src/components/StudentCardScanner.vue'
import { SITE_URL } from 'src/config/app'
import { accountStudentId, cleanStudentId } from 'src/data/schools'
import { isTimeout, withTimeout } from 'src/utils/withTimeout'
import { fetchCancelledOrder, fetchOrder, findStudentOrders, lookupOrders, updateOrderDelivery, updateOrderPayment } from 'src/services/orderService'
import { fetchTicketTypes } from 'src/services/ticketTypeService'
import { useAuthStore } from 'src/stores/auth'
import { amountText, cardMatches, pickupChecks } from 'src/utils/pickupChecks'
import { SEARCH_HINT, choices, classifySearch, notFoundText, pickOrder, searchLabel } from 'src/utils/pickupSearch'
import { parseTicketQr } from 'src/utils/ticketQr'

// The check-in station: one buyer at a time, never leaving the page. Every
// scan (this camera, a paired phone, a typed order number) goes to
// receive(); it ticks a row of the order shown, opens the buyer's order, or
// asks before replacing a half-checked one. Staff press one button at the
// end, or none when the ticket's QR code and the buyer's own student card
// both match (a short countdown, which they can stop); 已領票 then stays on
// screen until the next buyer's scan.
const props = defineProps({
  // this device's camera (StudentCardScanner); off at a computer a phone scans for
  camera: { type: Boolean, default: true },
  // Enter collects, Esc clears (a computer)
  keyboard: { type: Boolean, default: false },
  // one order only (its order page): no idle screen, no switching
  fixed: { type: Boolean, default: false },
  initialOrderId: { type: String, default: '' },
  // the order already loaded by the page (skips fetching it again)
  initialOrder: { type: Object, default: null },
  initialScans: { type: Object, default: () => ({}) },
  // this device's camera: auto (QR Code and card) | qr | card
  cameraMode: { type: String, default: 'auto' },
  // QR codes the page handles itself (a phone's pairing code): return true
  qrFilter: { type: Function, default: null },
  // shown while waiting, e.g. 手機掃描後會出現在這裡
  idleHint: { type: String, default: '' }
})
// need({ orderId, name, qr, card } | null): what a paired phone should scan
// collected(order): an order was just collected
// updated(order): the order shown changed otherwise (marked paid)
const emit = defineEmits(['need', 'collected', 'updated'])

const auth = useAuthStore()
const origins = [...new Set([new URL(SITE_URL).origin, window.location.origin])]

// The buyer's QR code or card stays in view for a while: each counts once
// until it has been out of view this long
const REPEAT_GAP_MS = 3000
const NOTICE_MS = 4500
// QR Code and student card both match: collected this long after, unless
// staff stop it
const AUTO_MS = 2000
// a student card read counts for that student's other orders (several
// orders, one card) while they keep coming: this long after the last one
const CARD_KEEP_MS = 60000
const RECENT_LIMIT = 3
const CAMERA_KEY = 'cksc.scanCamera'

const ticketTypes = ref([])
// { order, scans: { code, studentId }, exceptions: { qr, id } }
const current = ref(null)
const loading = ref(false)
const busy = ref(false)
const panelError = ref('')
const panel = ref(null)
// the 學號 on the order shown, still to be scanned: the camera takes it on
// the first reading
// one of QR Code and card scanned, the other still wanted
const scannedOne = computed(() => (current.value && !current.value.order.delivered ? checks.value?.need?.done || '' : ''))
const expectedCard = computed(() => {
  const entry = current.value
  if (!entry || entry.order.delivered || entry.scans.studentId) return ''
  return accountStudentId(entry.order.customerEmail)
})
// { kind: 'switch', title, text, name, orderId, order, scans } | { kind: 'choose', title, orders, scans }
const prompt = ref(null)
const notice = ref(null)
// 已領票: which tickets to hand over and the money; stays until the next scan
const done = ref(null)
const recent = ref([])
const flash = ref('')
// the countdown running (AUTO_MS) or 0; autoSkip: the order staff stopped
// it for, or whose automatic collect failed (back to the button)
const autoMs = ref(0)
const autoSkip = ref('')
let autoTimer = 0

const checks = computed(() => current.value && pickupChecks(current.value.order, {
  ticketTypes: ticketTypes.value,
  scans: current.value.scans,
  exceptions: current.value.exceptions,
  isAdmin: auth.isAdmin
}))

const idleTitle = computed(() => (props.camera ? '掃 QR Code 或學生證開始' : '等待掃描'))
const idleText = computed(() => props.idleHint || '先掃哪一個都可以，相機會一直開著，等你掃下一樣')

let loadSequence = 0
// the order load in progress: a card or a search waits for it, so neither
// cancels it and leaves 載入訂單中… on screen
let loadingNow = null
// a read that takes this long is asked again once (a phone's connection
// may have dropped meanwhile), then given up on
const LOAD_TIMEOUT_MS = [8000, 12000]
async function afterLoad() {
  while (loadingNow) await loadingNow
}
let noticeTimer = 0
let flashTimer = 0
const seen = new Map()

function isNew(key) {
  const now = Date.now()
  const last = seen.get(key) || 0
  seen.set(key, now)
  return now - last > REPEAT_GAP_MS
}

function itemsOf(order) {
  return (order?.items || []).map((item) => `${item.name} × ${item.quantity}`).join('、')
}

// the done screen's money line: 收款 (taken at the desk just now), 已付款
// (paid before) or 免付款 (guests)
function moneyOf(order, paidHere) {
  const amount = amountText(order).trim()
  if (paidHere) return { kind: 'collect', label: amount ? '收款' : '已收款', amount }
  if (order.complimentary) return { kind: 'free', label: '免付款', amount: '' }
  return { kind: 'paid', label: '已付款', amount }
}

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

// ---------- feedback: a vibration, a beep and a flash, so staff know without looking ----------
let audio = null
function beep(ok) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)()
    if (audio.state === 'suspended') audio.resume()
    const tone = audio.createOscillator()
    const gain = audio.createGain()
    tone.frequency.value = ok ? 1046 : 220
    tone.type = ok ? 'sine' : 'square'
    gain.gain.setValueAtTime(0.08, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (ok ? 0.12 : 0.3))
    tone.connect(gain).connect(audio.destination)
    tone.start()
    tone.stop(audio.currentTime + (ok ? 0.12 : 0.3))
  } catch {
    // no sound here; the flash and the text still say it
  }
}
function feedback(kind) {
  navigator.vibrate?.(kind === 'ok' ? 60 : [80, 60, 80])
  beep(kind === 'ok')
  flash.value = kind
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flash.value = '' }, 700)
}

function say(text, tone = 'bad', duration = NOTICE_MS) {
  notice.value = { text, tone }
  clearTimeout(noticeTimer)
  if (duration) noticeTimer = setTimeout(() => { notice.value = null }, duration)
}

// ---------- scans ----------
// a card carried over from the student's last order is not work done here
const hasProgress = (entry) => !!(entry && (entry.scans.code || (entry.scans.studentId && !entry.scans.cardCarried) || entry.exceptions.qr || entry.exceptions.id))
const blank = () => ({ code: '', studentId: '', cardCarried: false })

// { studentId, at }: the last student card read at this station
let cardOnFile = null
function rememberCard(studentId) {
  cardOnFile = { studentId, at: Date.now() }
}
// the card for an order just opened: the student's own, read lately; an
// order of anyone else means the student has gone
function carriedCard(order) {
  if (!cardOnFile) return ''
  if (Date.now() - cardOnFile.at > CARD_KEEP_MS || !cardMatches(order, cardOnFile.studentId)) {
    cardOnFile = null
    return ''
  }
  cardOnFile.at = Date.now()
  return cardOnFile.studentId
}

function handleQr(text) {
  if (panel.value?.dialogOpen?.()) return
  if (props.qrFilter?.(text)) return
  const ticket = parseTicketQr(text, origins)
  if (!ticket) {
    if (isNew(`bad:${text}`)) {
      feedback('bad')
      say('這不是本系統的票券 QR Code')
    }
    return
  }
  if (!isNew(`qr:${text}`)) return
  route(ticket.orderId, { code: ticket.ticketCode })
}

async function handleCard(value, hintOrderId = '') {
  if (panel.value?.dialogOpen?.()) return
  const studentId = cleanStudentId(value)
  if (!studentId || !isNew(`card:${studentId}`)) return
  done.value = null
  rememberCard(studentId)
  await afterLoad()
  const shown = current.value
  if (shown && !shown.order.delivered && cardMatches(shown.order, studentId)) {
    addScans({ studentId })
    return
  }
  const sequence = ++loadSequence
  say(`查詢學號 ${studentId} 的訂單…`, 'info', 0)
  let found
  try {
    found = await findStudentOrders(studentId)
  } catch (error) {
    if (sequence !== loadSequence) return
    console.error('Student order lookup failed', error)
    feedback('bad')
    say(lookupError(error))
    return
  }
  if (sequence !== loadSequence) return
  notice.value = null
  const orders = found.orders || []
  const notTheirs = shown && !shown.order.delivered ? `這張學生證（學號 ${studentId}）不是 ${shown.order.customerName || '這筆訂單'} 的` : ''
  if (!orders.length) {
    feedback('bad')
    say(notTheirs ? `${notTheirs}，也查不到它的訂單` : `學號 ${studentId} 沒有訂單：請核對學號，或請對方出示 QR Code`, 'bad', 6000)
    return
  }
  const waiting = orders.filter((order) => !order.delivered)
  const pick = orders.find((order) => order.id === hintOrderId) || (waiting.length === 1 ? waiting[0] : orders.length === 1 ? orders[0] : null)
  if (pick) {
    route(pick.id, { studentId }, notTheirs)
    return
  }
  feedback('ok')
  const list = waiting.length ? waiting : orders
  prompt.value = { kind: 'choose', title: `學號 ${studentId} 有 ${list.length} 筆訂單`, orders: list, scans: { studentId } }
}

function searchError(error) {
  const code = String(error?.code || '').replace('functions/', '')
  if (code === 'permission-denied') return '這個帳號不能查訂單，請用工作人員帳號登入'
  if (code === 'invalid-argument') return `請輸入完整的${SEARCH_HINT}`
  if (code === 'unavailable' || !navigator.onLine) return '網路不穩，查詢失敗；請再試一次'
  return `查詢失敗（${code || 'unknown'}）`
}

function lookupError(error) {
  const code = String(error?.code || '').replace('functions/', '')
  if (code === 'permission-denied') return '這個帳號不能查學號，請用工作人員帳號登入'
  if (code === 'unavailable' || !navigator.onLine) return '網路不穩，學號查詢失敗；請再掃一次，或改掃 QR Code'
  return `學號查詢失敗（${code || 'unknown'}）；請改掃 QR Code`
}

// one order's scan: ticks it when shown, else opens it (asking first when
// the one shown is half done)
async function route(orderId, scans, why = '') {
  done.value = null
  await afterLoad()
  const shown = current.value
  if (shown?.order.id === orderId) {
    addScans(scans)
    return
  }
  if (props.fixed) {
    feedback('bad')
    say(`這是另一筆訂單（${orderId}），不是這一筆`)
    return
  }
  if (shown && hasProgress(shown) && !shown.order.delivered) {
    // read the other order first: one that can't be read is not offered,
    // so the half-checked buyer stays on screen
    const sequence = ++loadSequence
    let order
    try {
      order = await withTimeout(fetchOrder(orderId), LOAD_TIMEOUT_MS[0])
    } catch (error) {
      if (sequence !== loadSequence) return
      console.error('Failed to read the other order', error)
      feedback('bad')
      say('網路不穩，讀不到剛掃的訂單；請再掃一次')
      return
    }
    if (sequence !== loadSequence) return
    feedback('bad')
    if (!order) {
      const cancelled = await withTimeout(fetchCancelledOrder(orderId), LOAD_TIMEOUT_MS[0]).catch(() => null)
      if (sequence !== loadSequence) return
      say(goneText(orderId, cancelled), 'bad', 8000)
      return
    }
    const name = order.customerName || '（未填姓名）'
    prompt.value = {
      kind: 'switch',
      title: why || `掃到另一筆訂單：${name}`,
      text: `${shown.order.customerName || '目前這筆'}還沒領完。要換成 ${name} 嗎？`,
      name,
      orderId,
      order,
      scans
    }
    return
  }
  await load(orderId, scans)
}

function acceptSwitch() {
  const next = prompt.value
  prompt.value = null
  if (next) load(next.orderId, next.scans, next.order)
}

function choose(order) {
  const scans = prompt.value?.scans || {}
  prompt.value = null
  load(order.id, scans)
}

function addScans(scans) {
  const entry = current.value
  if (!entry) return
  const next = { ...entry.scans }
  let changed = false
  if (scans.code && scans.code !== next.code) {
    next.code = scans.code
    changed = true
  }
  if (scans.studentId && (scans.studentId !== next.studentId || next.cardCarried)) {
    next.studentId = scans.studentId
    next.cardCarried = false
    changed = true
  }
  if (!changed) return
  entry.scans = next
  panelError.value = ''
  const qrBad = scans.code && scans.code !== entry.order.ticketCode
  feedback(qrBad ? 'bad' : 'ok')
}

// an order that is not there: cancelled (from cancelledOrders) or never was
function goneText(orderId, cancelled) {
  if (!cancelled) return `找不到訂單 ${orderId}`
  return `訂單 ${orderId}${cancelled.customerName ? `（${cancelled.customerName}）` : ''}已取消，不得領票`
}

function load(orderId, scans = {}, known = null) {
  const run = loadOrder(orderId, scans, known).finally(() => {
    if (loadingNow === run) loadingNow = null
  })
  loadingNow = run
  return run
}

async function loadOrder(orderId, scans, known) {
  const sequence = ++loadSequence
  done.value = null
  prompt.value = null
  notice.value = null
  panelError.value = ''
  autoSkip.value = ''
  loading.value = true
  try {
    let order = known
    for (const [attempt, ms] of LOAD_TIMEOUT_MS.entries()) {
      if (order) break
      try {
        order = await withTimeout(fetchOrder(orderId), ms)
        break
      } catch (error) {
        if (!isTimeout(error) || attempt === LOAD_TIMEOUT_MS.length - 1 || sequence !== loadSequence) throw error
        say('網路較慢，再試一次…', 'info', 0)
      }
    }
    if (sequence !== loadSequence) return
    if (!order) {
      const cancelled = await withTimeout(fetchCancelledOrder(orderId), LOAD_TIMEOUT_MS[0]).catch(() => null)
      if (sequence !== loadSequence) return
      current.value = null
      feedback('bad')
      say(goneText(orderId, cancelled), 'bad', 8000)
      return
    }
    const carried = !scans.studentId && !order.delivered ? carriedCard(order) : ''
    current.value = {
      order: { ...order, delivered: !!order.delivered },
      scans: { ...blank(), ...scans, ...(carried ? { studentId: carried, cardCarried: true } : {}) },
      exceptions: { qr: null, id: null }
    }
    notice.value = null
    const qrBad = scans.code && scans.code !== order.ticketCode
    // an order page opening by itself makes no sound
    if (!(props.fixed && known)) feedback(order.delivered || qrBad ? 'bad' : 'ok')
  } catch (error) {
    if (sequence !== loadSequence) return
    console.error('Failed to load order', error)
    feedback('bad')
    say('網路不穩，訂單載入失敗；請再掃一次')
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

function clear() {
  loadSequence++
  current.value = null
  prompt.value = null
  panelError.value = ''
  loading.value = false
}

function setException({ key, value }) {
  if (!current.value) return
  current.value.exceptions = { ...current.value.exceptions, [key]: value }
}

function undoException(key) {
  if (!current.value) return
  current.value.exceptions = { ...current.value.exceptions, [key]: null }
}

// ---------- the one action ----------
async function collect(forceReason = '') {
  const entry = current.value
  const state = checks.value
  if (!entry || busy.value || entry.order.delivered) return
  if (!forceReason && !state?.canCollect) return
  busy.value = true
  panelError.value = ''
  const { order } = entry
  try {
    const patch = await updateOrderDelivery(order.id, true, {
      ...state.request,
      ...(forceReason ? { overrideReason: forceReason } : {})
    })
    const collected = { ...order, ...patch, delivered: true }
    emit('collected', collected)
    // the same student's next order takes the card from here
    if (state.cardOk) rememberCard(state.request.studentId)
    feedback('ok')
    const paidHere = !forceReason && state.autoPay
    const how = forceReason
      ? '管理員強制領票'
      : state.rows.some((row) => row.state === 'excepted') ? '例外處理' : `${state.cardOk ? 'QR＋學生證' : 'QR Code'}${paidHere ? `・現場收款${state.money}` : ''}`
    recent.value = [{ id: order.id, name: order.customerName || order.id, at: Date.now(), time: clock(new Date()), how }, ...recent.value].slice(0, RECENT_LIMIT)
    if (props.fixed) {
      entry.order = collected
      return
    }
    current.value = null
    done.value = {
      name: order.customerName || order.id,
      tickets: (order.items || []).map((item) => ({ name: item.name, quantity: item.quantity })),
      money: moneyOf(order, paidHere)
    }
  } catch (error) {
    console.error('Collect failed', error)
    feedback('bad')
    // no automatic retry: staff press the button
    autoSkip.value = order.id
    panelError.value = error.message || '領票失敗，請再按一次'
    if (error?.details?.delivered === true || /已領票/.test(error.message || '')) {
      entry.order = { ...entry.order, ...(error.details || {}), delivered: true }
    }
  } finally {
    busy.value = false
  }
}

async function markPaid() {
  const entry = current.value
  if (!entry || busy.value || !auth.isAdmin) return
  busy.value = true
  panelError.value = ''
  try {
    const patch = await updateOrderPayment(entry.order.id, true, !!entry.order.paid)
    entry.order = { ...entry.order, ...patch }
    emit('updated', entry.order)
    feedback('ok')
  } catch (error) {
    console.error('Mark paid failed', error)
    panelError.value = error.message || '標記付款失敗，請再試一次'
  } finally {
    busy.value = false
  }
}

function clock(date) {
  return date.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false })
}

// ---------- 都掃不到: an order number, a name, an email or a 學號, typed ----------
// A typed 學號 only finds the orders: it does not tick the student card.
// Returns '' or what was wrong with the text
async function search(text) {
  const query = classifySearch(text)
  if (!query) return `請輸入${SEARCH_HINT}`
  done.value = null
  if (query.kind === 'order') {
    await route(query.orderId, {})
    return ''
  }
  const label = searchLabel(query)
  await afterLoad()
  const sequence = ++loadSequence
  say(`查詢 ${label} 的訂單…`, 'info', 0)
  let found
  try {
    found = await lookupOrders(query)
  } catch (error) {
    if (sequence !== loadSequence) return ''
    notice.value = null
    console.error('Order lookup failed', error)
    return searchError(error)
  }
  if (sequence !== loadSequence) return ''
  notice.value = null
  const orders = found.orders || []
  if (!orders.length) return notFoundText(query)
  const pick = pickOrder(orders)
  if (pick) {
    await route(pick.id, {})
    return ''
  }
  const list = choices(orders)
  prompt.value = { kind: 'choose', title: `${label} 有 ${list.length} 筆訂單`, orders: list, scans: {} }
  return ''
}

// ---------- outside scans (a paired phone, a typed order number) ----------
// { orderId, ticketCode?, studentId? }
function receive(scan) {
  if (!scan?.orderId) return
  if (scan.ticketCode) {
    if (isNew(`remote:${scan.orderId}:${scan.ticketCode}`)) route(scan.orderId, { code: scan.ticketCode })
  } else if (scan.studentId) {
    handleCard(scan.studentId, scan.orderId)
  } else {
    route(scan.orderId, {})
  }
}

// ---------- keyboard ----------
// another dialog (e.g. the guide) is open; one fading out no longer counts,
// so Enter works right after an exception is chosen
const dialogShown = () => [...document.querySelectorAll('.q-dialog__inner')]
  .some((element) => ![...element.classList].some((name) => name.endsWith('-leave-active')))

function onKey(event) {
  if (!props.keyboard || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target
  if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
  if (panel.value?.dialogOpen?.() || dialogShown()) return
  // a focused button does its own thing on Enter, except one in a dialog
  // that is closing (pressed just now)
  const ownButton = target?.tagName === 'BUTTON' && !target.closest('.q-dialog__inner')
  if (event.key === 'Enter' && current.value && checks.value?.canCollect && !ownButton) {
    event.preventDefault()
    collect()
  } else if (event.key === 'Escape') {
    if (prompt.value) prompt.value = null
    else if (current.value && !props.fixed) clear()
    else if (done.value) done.value = null
  }
}

// ---------- QR Code and student card both match: collect by itself ----------
// held while staff have a question or a dialog open, or are already sending
watch(
  () => {
    const entry = current.value
    if (!entry || !checks.value?.auto || busy.value || prompt.value || panel.value?.dialogOpen?.()) return ''
    if (entry.order.id === autoSkip.value) return ''
    return `${entry.order.id}:${entry.scans.code}:${entry.scans.studentId}`
  },
  (key) => {
    clearTimeout(autoTimer)
    autoMs.value = key ? AUTO_MS : 0
    if (!key) return
    autoTimer = setTimeout(() => {
      autoMs.value = 0
      collect()
    }, AUTO_MS)
  }
)

function stopAuto() {
  if (current.value) autoSkip.value = current.value.order.id
}

// what a paired phone should scan for the order shown
watch(
  () => {
    const entry = current.value
    const need = checks.value?.need
    if (!entry || entry.order.delivered || !need || (!need.qr && !need.card)) return null
    return JSON.stringify({ orderId: entry.order.id, name: entry.order.customerName || '', qr: need.qr, card: need.card, done: need.done })
  },
  (value) => emit('need', value ? JSON.parse(value) : null),
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('keydown', onKey)
  fetchTicketTypes().then((types) => { ticketTypes.value = types }).catch((error) => console.error('Failed to load ticket types', error))
  if (props.initialOrderId) {
    const known = props.initialOrder?.id === props.initialOrderId ? props.initialOrder : null
    load(props.initialOrderId, props.initialScans, known)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  clearTimeout(noticeTimer)
  clearTimeout(flashTimer)
  clearTimeout(autoTimer)
  audio?.close?.()
})

defineExpose({ receive, search, load, clear, current })
</script>

<style scoped>
.station {
  --ok: #77bf8b;
  --bad: #e07f7f;
  --wait: #e4a468;
  --ink: #f2f0e9;
  --quiet: #9aa3ac;
  --line: rgba(242, 240, 233, .14);

  display: grid;
  gap: 20px;
  color: var(--ink);
}

@media (min-width: 900px) {
  .station.with-camera {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }

  .station.with-camera .station-camera {
    position: sticky;
    top: 88px;
  }
}

.station-camera {
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: box-shadow .2s;
}

.flash-ok .station-camera :deep(.viewfinder) {
  box-shadow: 0 0 0 4px var(--ok);
}

.flash-bad .station-camera :deep(.viewfinder) {
  box-shadow: 0 0 0 4px var(--bad);
}

.station-main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.station-notice {
  margin: 0;
  padding: 12px 14px;
  border-left: 3px solid var(--bad);
  background: rgba(224, 127, 127, .09);
  color: var(--ink);
  font-size: 15px;
  line-height: 1.6;
}

.station-notice.info {
  border-left-color: var(--wait);
  background: rgba(228, 164, 104, .08);
}

.station-prompt {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--wait);
  background: rgba(228, 164, 104, .08);
}

.station-prompt p {
  margin: 0;
}

.prompt-title {
  font-size: 17px;
  font-weight: 800;
}

.prompt-text {
  color: rgba(242, 240, 233, .82);
  font-size: 14px;
  line-height: 1.6;
}

.prompt-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.prompt-primary,
.prompt-secondary {
  min-height: 44px;
  padding: 0 16px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
}

.prompt-primary {
  border-color: var(--wait);
  background: var(--wait);
  color: #120b04;
}

.prompt-secondary {
  align-self: flex-start;
}

.choose-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choose-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, .03);
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.choose-row:hover {
  border-color: var(--wait);
}

.choose-row strong {
  font-size: 16px;
}

.choose-row span {
  color: var(--quiet);
  font-size: 13px;
}

.choose-state {
  grid-column: 2;
  grid-row: 1;
  color: var(--wait) !important;
}

.choose-state.done {
  color: var(--quiet) !important;
}

.station-done {
  padding: 28px 20px;
  border: 1px solid var(--ok);
  background: rgba(119, 191, 139, .1);
  text-align: center;
}

.station-done p {
  margin: 0;
}

.done-title {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--ok);
  font-size: 28px;
  font-weight: 800;
}

.done-name {
  margin-top: 8px !important;
  font-size: 22px;
  font-weight: 700;
}

.done-tickets {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
}

.done-tickets li {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 12px;
  font-size: clamp(1.5rem, 4vw, 2rem);
  font-weight: 800;
  line-height: 1.25;
}

.done-tickets strong {
  font-variant-numeric: tabular-nums;
}

.done-money {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 10px;
  margin: 14px auto 0 !important;
  padding: 8px 16px;
  border: 1px solid var(--line);
  color: rgba(242, 240, 233, .8);
  font-size: 17px;
  font-weight: 700;
}

.done-money strong {
  font-size: clamp(1.5rem, 4vw, 2rem);
  font-variant-numeric: tabular-nums;
}

/* cash taken at the desk: the number staff act on */
.done-money.collect {
  border-color: var(--wait);
  background: rgba(228, 164, 104, .14);
  color: var(--wait);
}

.done-meta {
  margin-top: 12px !important;
  color: rgba(242, 240, 233, .8);
  font-size: 15px;
}

.station-done :deep(.order-entry) {
  margin-top: 18px;
  text-align: left;
}

.station-idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 20px;
  border: 1px dashed var(--line);
  text-align: center;
}

.station-idle p {
  margin: 0;
}

.idle-icon {
  color: var(--wait);
}

.idle-title {
  font-size: 22px;
  font-weight: 800;
}

.idle-text {
  max-width: 34em;
  color: var(--quiet);
  font-size: 14px;
  line-height: 1.6;
}

.recent-title {
  margin: 0 0 6px;
  color: var(--quiet);
  font-size: 12px;
  letter-spacing: .08em;
}

.recent ul {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.recent button {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.recent-meta {
  color: var(--quiet);
  font-size: 13px;
}

/* a phone: the one button, once it can be pressed, stays under the thumb */
@media (max-width: 899px) {
  .station-main :deep(.collect-button.ready) {
    position: sticky;
    bottom: 12px;
    z-index: 2;
    box-shadow: 0 10px 30px rgba(0, 0, 0, .45);
  }
}
</style>
