<template>
  <section class="pickup-panel" :aria-busy="busy">
    <header class="buyer">
      <div class="buyer-text">
        <p class="buyer-name">{{ order.customerName || '（未填姓名）' }}</p>
        <p class="buyer-meta">
          <span v-if="buyerType">{{ buyerType }}・</span>{{ itemsText }}
          <span class="mono">・{{ order.id }}</span>
        </p>
      </div>
      <button v-if="clearable" type="button" class="clear-button" aria-label="清除這筆，回到待命（Esc）" title="清除這筆（Esc）" @click="$emit('clear')">
        <X :size="18" aria-hidden="true" />
      </button>
    </header>

    <p v-if="order.delivered" class="banner bad" role="alert">
      <TriangleAlert :size="18" aria-hidden="true" />
      <span>已領票{{ deliveredBy }}，不能再領</span>
    </p>

    <ol v-else class="rows" aria-label="領票檢查">
      <li v-for="row in checks.rows" :key="row.key" class="row" :class="row.state">
        <span class="mark" aria-hidden="true">
          <Check v-if="row.state === 'done'" :size="18" :stroke-width="3" />
          <Check v-else-if="row.state === 'excepted'" :size="18" :stroke-width="3" />
          <TriangleAlert v-else-if="row.state === 'bad'" :size="18" />
          <Eye v-else-if="row.state === 'look'" :size="18" />
          <Banknote v-else-if="row.state === 'pay'" :size="18" />
          <ScanLine v-else :size="18" />
        </span>
        <div class="row-body">
          <p class="row-title">
            {{ row.title }}
            <span class="sr-only">：{{ STATE_WORDS[row.state] }}</span>
          </p>
          <p class="row-text">{{ row.text }}</p>
          <p v-if="row.hint" class="row-hint">{{ row.hint }}</p>
        </div>
        <button
          v-if="row.action"
          type="button"
          class="row-action"
          :disabled="!row.action.allowed || busy"
          :title="row.action.allowed ? '' : '請管理員登入處理'"
          @click="openAction(row.action.kind)"
        >
          {{ row.action.label }}<span v-if="!row.action.allowed" class="need-admin">需管理員</span>
        </button>
        <button v-else-if="row.state === 'excepted'" type="button" class="row-undo" :disabled="busy" @click="$emit('undo', row.key)">
          撤銷
        </button>
      </li>
    </ol>

    <button
      v-if="!order.delivered"
      type="button"
      class="collect-button"
      :class="{ ready: checks.canCollect, auto: counting }"
      :style="counting ? { '--auto-ms': `${autoMs}ms` } : null"
      :disabled="!checks.canCollect || busy"
      @click="$emit('collect')"
    >
      <span>{{ busy ? '處理中…' : checks.label }}</span>
      <kbd v-if="keyboard && checks.canCollect && !busy" aria-hidden="true">Enter</kbd>
    </button>

    <p v-if="counting" class="auto-note" role="status">
      <span>QR Code 和學生證都相符，馬上自動領票</span>
      <button type="button" class="auto-stop" @click="$emit('stop-auto')">取消</button>
    </p>

    <p v-if="error" class="panel-error" role="alert">{{ error }}</p>

    <div v-if="canForce || detailLink" class="panel-links">
      <button
        v-if="canForce"
        type="button"
        class="force-button"
        :disabled="busy"
        @click="openAction('force')"
      >
        <ShieldAlert :size="16" aria-hidden="true" />
        管理員強制領票…
      </button>
      <router-link v-if="detailLink" class="detail-link" :to="{ name: 'admin-order-detail', params: { id: order.id } }">
        查看訂單詳情
        <ChevronRight :size="16" aria-hidden="true" />
      </router-link>
    </div>

    <!-- 沒帶 QR Code (admins) -->
    <q-dialog v-model="dialogs.qr" aria-labelledby="no-qr-title">
      <form class="pickup-dialog" @submit.prevent="confirmQr">
        <h2 id="no-qr-title">沒帶 QR Code</h2>
        <p class="dialog-lead">略過 QR Code 驗證。會記在這筆訂單的領票紀錄，寫上你的名字。</p>
        <template v-if="checks.cardOk">
          <p class="dialog-ok"><Check :size="16" aria-hidden="true" /> 學生證學號 {{ scans.studentId }} 與訂單相符</p>
          <div class="dialog-actions">
            <button type="button" class="dialog-cancel" @click="dialogs.qr = false">取消</button>
            <button type="submit" class="dialog-confirm">以學生證代替 QR Code</button>
          </div>
        </template>
        <template v-else>
          <label class="dialog-field">
            你怎麼確認是本人、買過這張票？（必填）
            <input v-model.trim="qrReason" maxlength="500" placeholder="例如：手機沒電，核對身分證與訂單 Email" required>
          </label>
          <p class="dialog-note">建中學生可以先掃學生證，就能直接以學生證代替。</p>
          <div class="dialog-actions">
            <button type="button" class="dialog-cancel" @click="dialogs.qr = false">取消</button>
            <button type="submit" class="dialog-confirm" :disabled="!qrReason">略過 QR Code</button>
          </div>
        </template>
      </form>
    </q-dialog>

    <!-- 沒帶學生證 (any staff) -->
    <q-dialog v-model="dialogs.id" aria-labelledby="no-card-title">
      <form class="pickup-dialog" @submit.prevent="confirmId">
        <h2 id="no-card-title">沒帶學生證</h2>
        <p class="dialog-lead">用其他方式確認是本人。選了之後這一列會變黃色，記在領票紀錄。</p>
        <fieldset class="dialog-choices">
          <legend class="sr-only">查驗方式</legend>
          <label v-for="method in ID_CHECK_METHODS" :key="method.value" class="choice" :class="{ picked: idMethod === method.value }">
            <input v-model="idMethod" type="radio" name="id-method" :value="method.value">
            <span>{{ method.label }}</span>
          </label>
        </fieldset>
        <label class="dialog-field">
          說明{{ idMethod === 'other' ? '（必填）' : '（選填）' }}
          <input v-model.trim="idNote" :maxlength="ID_NOTE_MAX" placeholder="例如：學生證補辦中，核對身分證" :required="idMethod === 'other'">
        </label>
        <div class="dialog-actions">
          <button type="button" class="dialog-cancel" @click="dialogs.id = false">取消</button>
          <button type="submit" class="dialog-confirm" :disabled="!idReady">用這個方式查驗</button>
        </div>
      </form>
    </q-dialog>

    <!-- 管理員強制領票 -->
    <q-dialog v-model="dialogs.force" aria-labelledby="force-title">
      <form class="pickup-dialog" @submit.prevent="confirmForce">
        <h2 id="force-title">管理員強制領票</h2>
        <p class="dialog-lead">會略過下面還沒完成的檢查，直接標記已領票：</p>
        <ul class="dialog-skips">
          <li v-for="row in skipped" :key="row.key"><TriangleAlert :size="14" aria-hidden="true" /> {{ row.title }}：{{ row.text }}</li>
        </ul>
        <label class="dialog-field">
          原因（必填，記在訂單）
          <input v-model.trim="forceReason" maxlength="500" placeholder="例如：核對身分證與訂單 Email" required>
        </label>
        <div class="dialog-actions">
          <button type="button" class="dialog-cancel" @click="dialogs.force = false">取消</button>
          <button type="submit" class="dialog-confirm danger" :disabled="!forceReason || busy">略過檢查並領票</button>
        </div>
      </form>
    </q-dialog>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { Banknote, Check, ChevronRight, Eye, ScanLine, ShieldAlert, TriangleAlert, X } from 'lucide-vue-next'
import { ID_CHECK_METHODS, ID_NOTE_MAX } from 'src/data/pickup'
import { getBuyerTypeLabel } from 'src/utils/buyerIdentity'
import { unfinishedRows } from 'src/utils/pickupChecks'

// One order's pickup checklist (src/utils/pickupChecks.js): a row per check,
// ticked by scans; the exceptions are buttons in the row they replace, each
// with a dialog that says what it skips. The station (PickupStation.vue)
// holds the state and sends the result.
const props = defineProps({
  order: { type: Object, required: true },
  checks: { type: Object, required: true },
  scans: { type: Object, default: () => ({}) },
  isAdmin: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  // ✕ goes back to waiting for the next buyer (the station)
  clearable: { type: Boolean, default: false },
  // a link to the order's own page (not on that page itself)
  detailLink: { type: Boolean, default: false },
  // a computer: Enter collects
  keyboard: { type: Boolean, default: false },
  // the station collects by itself this many ms from now (0: it does not)
  autoMs: { type: Number, default: 0 }
})
// collect | clear | mark-paid | exception({ key: 'qr' | 'id', value }) |
// undo(key) | force(reason) | stop-auto (back to the button)
const emit = defineEmits(['collect', 'clear', 'mark-paid', 'exception', 'undo', 'force', 'stop-auto'])

const STATE_WORDS = { pay: '等待收款', wait: '等待中', look: '請目視確認', done: '完成', excepted: '以例外方式完成', bad: '有問題' }

const dialogs = reactive({ qr: false, id: false, force: false })
const qrReason = ref('')
const idMethod = ref('')
const idNote = ref('')
const forceReason = ref('')

const buyerType = computed(() => getBuyerTypeLabel(props.order))
const itemsText = computed(() => (props.order.items || []).map((item) => `${item.name} × ${item.quantity}`).join('、'))
const skipped = computed(() => unfinishedRows(props.checks))
const canForce = computed(() => props.isAdmin && !props.order.delivered && skipped.value.length > 0 && !props.checks.unpaid)
const idReady = computed(() => !!idMethod.value && (idMethod.value !== 'other' || !!idNote.value))
const counting = computed(() => props.autoMs > 0 && !props.busy && !props.order.delivered)

const deliveredBy = computed(() => {
  const at = toDate(props.order.deliveryUpdatedAt)
  const time = at ? at.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
  const by = props.order.deliveryUpdatedByName || ''
  return time || by ? `（${[time, by].filter(Boolean).join(' ')}）` : ''
})

function toDate(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function openAction(kind) {
  if (kind === 'paid') {
    emit('mark-paid')
    return
  }
  if (kind === 'qr') qrReason.value = ''
  if (kind === 'id') {
    idMethod.value = ''
    idNote.value = ''
  }
  if (kind === 'force') forceReason.value = ''
  dialogs[kind] = true
}

function confirmQr() {
  if (props.checks.cardOk) emit('exception', { key: 'qr', value: { byCard: true } })
  else if (qrReason.value) emit('exception', { key: 'qr', value: { reason: qrReason.value } })
  else return
  dialogs.qr = false
}

function confirmId() {
  if (!idReady.value) return
  emit('exception', { key: 'id', value: { method: idMethod.value, note: idNote.value } })
  dialogs.id = false
}

function confirmForce() {
  if (!forceReason.value) return
  emit('force', forceReason.value)
  dialogs.force = false
}

// another order: no dialog stays open over it
watch(() => props.order.id, () => {
  dialogs.qr = false
  dialogs.id = false
  dialogs.force = false
})

defineExpose({ dialogOpen: () => dialogs.qr || dialogs.id || dialogs.force })
</script>

<style scoped>
.pickup-panel {
  --ok: #77bf8b;
  --warn: #e2c35b;
  --bad: #e07f7f;
  --wait: #e4a468;
  --ink: #f2f0e9;
  --quiet: #9aa3ac;
  --line: rgba(242, 240, 233, .14);

  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--ink);
}

.buyer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.buyer p {
  margin: 0;
}

.buyer-name {
  font-size: clamp(1.6rem, 4vw, 2.1rem);
  font-weight: 800;
  line-height: 1.25;
}

.buyer-meta {
  margin-top: 4px !important;
  color: var(--quiet);
  font-size: 14px;
  line-height: 1.6;
}

.mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
}

.clear-button {
  flex: none;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--quiet);
  cursor: pointer;
}

.clear-button:hover,
.clear-button:focus-visible {
  border-color: var(--ink);
  color: var(--ink);
}

.banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 14px 16px;
  font-size: 16px;
  font-weight: 700;
}

.banner.bad {
  border: 1px solid var(--bad);
  background: rgba(224, 127, 127, .1);
  color: var(--bad);
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, .02);
  transition: border-color .2s, background-color .2s;
}

.mark {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid currentColor;
  color: var(--wait);
}

.row.wait .mark {
  border-style: dashed;
  animation: waiting 1.6s ease-in-out infinite;
}

.row.done {
  border-color: rgba(119, 191, 139, .55);
  background: rgba(119, 191, 139, .08);
}

.row.done .mark {
  border-color: var(--ok);
  background: var(--ok);
  color: #08100b;
}

.row.excepted {
  border-color: rgba(226, 195, 91, .6);
  background: rgba(226, 195, 91, .08);
}

.row.excepted .mark {
  border-color: var(--warn);
  background: var(--warn);
  color: #151004;
}

.row.bad {
  border-color: rgba(224, 127, 127, .65);
  background: rgba(224, 127, 127, .09);
}

.row.bad .mark {
  color: var(--bad);
}

.row.look .mark {
  color: var(--ink);
}

.row.pay {
  border-color: rgba(228, 164, 104, .5);
}

.row.pay .mark {
  color: #e4a468;
}

.row-body p {
  margin: 0;
}

.row-title {
  font-size: 16px;
  font-weight: 700;
}

.row-text {
  margin-top: 2px !important;
  color: rgba(242, 240, 233, .82);
  font-size: 14px;
  line-height: 1.55;
}

.row.bad .row-text {
  color: var(--bad);
}

.row-hint {
  margin-top: 2px !important;
  color: var(--quiet);
  font-size: 13px;
  line-height: 1.5;
}

.row-action,
.row-undo {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}

.row-action:hover:not(:disabled),
.row-undo:hover:not(:disabled) {
  border-color: var(--wait);
  color: var(--wait);
}

.row-action:disabled {
  color: var(--quiet);
  cursor: not-allowed;
  opacity: .7;
}

.need-admin {
  display: block;
  font-size: 11px;
}

.row-undo {
  color: var(--quiet);
}

.collect-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 10px 16px;
  border: 1px dashed var(--line);
  background: transparent;
  color: var(--quiet);
  font: inherit;
  font-size: 19px;
  font-weight: 800;
  cursor: not-allowed;
}

.collect-button.ready {
  border: 1px solid var(--wait);
  background: var(--wait);
  color: #120b04;
  cursor: pointer;
}

.collect-button.ready:hover:not(:disabled) {
  filter: brightness(1.06);
}

/* the automatic collect counting down: the button fills from the left */
.collect-button.auto {
  position: relative;
  overflow: hidden;
}

.collect-button.auto::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(18, 11, 4, .2);
  transform-origin: left;
  animation: auto-fill var(--auto-ms, 2000ms) linear forwards;
}

.collect-button.auto > * {
  position: relative;
}

@keyframes auto-fill {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

.auto-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  color: rgba(242, 240, 233, .82);
  font-size: 14px;
  line-height: 1.5;
}

.auto-stop {
  flex: none;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.auto-stop:hover,
.auto-stop:focus-visible {
  border-color: var(--wait);
  color: var(--wait);
}

.collect-button kbd {
  padding: 2px 6px;
  border: 1px solid rgba(18, 11, 4, .35);
  font: 600 11px 'JetBrains Mono', ui-monospace, monospace;
}

.panel-error {
  margin: 0;
  color: var(--bad);
  font-size: 14px;
  line-height: 1.6;
}

.panel-links {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.detail-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 36px;
  margin-left: auto;
  color: var(--lunar);
  font-size: 13px;
  text-decoration: none;
}

.detail-link:hover {
  color: var(--off-white);
}

.force-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid rgba(224, 127, 127, .45);
  background: transparent;
  color: var(--bad);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.force-button:hover:not(:disabled) {
  background: rgba(224, 127, 127, .1);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@keyframes waiting {
  50% { opacity: .45; }
}

@media (prefers-reduced-motion: reduce) {
  .row.wait .mark,
  .collect-button.auto::before {
    animation: none;
  }
}

@media (max-width: 520px) {
  .row {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .mark {
    width: 32px;
    height: 32px;
  }

  .row-action,
  .row-undo {
    grid-column: 2;
    justify-self: start;
  }
}
</style>

<!-- q-dialog teleports to the body, outside the scoped styles above -->
<style lang="scss">
@import 'src/css/pickupdialog.scss';
</style>
