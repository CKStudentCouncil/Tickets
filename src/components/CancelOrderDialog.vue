<template>
  <q-dialog :model-value="modelValue" :persistent="busy" aria-labelledby="cancel-order-title" @update:model-value="close">
    <div v-if="orders.length" class="cancel-modal">
      <p class="cancel-eyebrow">{{ orders.length > 1 ? 'Cancel orders' : 'Cancel order' }}</p>
      <h2 id="cancel-order-title">
        <template v-if="single">取消 <span class="mono">{{ single.id }}</span></template>
        <template v-else>取消 <span class="num">{{ eligible.length }}</span> 筆訂單</template>
      </h2>

      <!-- ---------- after sending: what was cancelled and what was not ---------- -->
      <template v-if="results">
        <p class="cancel-done" role="status">已取消 <strong class="num">{{ results.done.length }}</strong> 筆{{ results.refund ? `，待退款合計 NT$ ${results.refund.toLocaleString()}` : '' }}</p>
        <template v-if="results.skipped.length">
          <p class="cancel-warn" role="alert">{{ results.skipped.length }} 筆沒有取消，訂單維持原狀：</p>
          <ul class="cancel-list">
            <li v-for="item in results.skipped" :key="item.orderId">
              <span class="mono">{{ item.orderId }}</span>
              <span class="cancel-list-note">{{ item.message }}</span>
            </li>
          </ul>
        </template>
        <div class="cancel-actions">
          <button type="button" class="cancel-btn" @click="close(false)">完成</button>
        </div>
      </template>

      <template v-else>
        <dl v-if="single" class="cancel-summary">
          <div><dt>購票人</dt><dd>{{ single.customerName || '—' }}</dd></div>
          <div><dt>金額</dt><dd class="num">NT$ {{ totalOf(single).toLocaleString() }}・{{ single.paid ? '已付款' : '未付款' }}</dd></div>
          <div><dt>已寄通知</dt><dd>繳費 {{ noticeCountsOf(single).payment }} 次・領票 {{ noticeCountsOf(single).pickup }} 次</dd></div>
        </dl>
        <template v-else-if="eligible.length">
          <dl class="cancel-summary">
            <div><dt>訂單</dt><dd><span class="num">{{ eligible.length }}</span> 筆・已付款 <span class="num">{{ paidOrders.length }}</span> 筆</dd></div>
            <div><dt>金額合計</dt><dd class="num">NT$ {{ sumOf(eligible).toLocaleString() }}</dd></div>
          </dl>
          <ul class="cancel-list">
            <li v-for="item in eligible" :key="item.id">
              <span class="mono">{{ item.id }}</span>
              <span>{{ item.customerName || '—' }}</span>
              <span class="num">NT$ {{ totalOf(item).toLocaleString() }}{{ item.paid ? '・已付款' : '' }}</span>
            </li>
          </ul>
        </template>

        <template v-if="blocked.length">
          <p class="cancel-error" role="alert">
            {{ eligible.length ? `${blocked.length} 筆不能取消，不會送出：` : blocked.length === 1 ? cancelBlockOf(blocked[0]) : '所選訂單都不能取消：' }}
          </p>
          <ul v-if="eligible.length || blocked.length > 1" class="cancel-list">
            <li v-for="item in blocked" :key="item.id">
              <span class="mono">{{ item.id }}</span>
              <span class="cancel-list-note">{{ cancelBlockOf(item) }}</span>
            </li>
          </ul>
        </template>

        <template v-if="eligible.length">
          <fieldset class="cancel-field">
            <legend>取消原因</legend>
            <label v-for="(label, key) in CANCEL_REASONS" :key="key" class="cancel-choice" :class="{ disabled: !applies(key) }">
              <input v-model="reason" type="radio" name="cancel-reason" :value="key" :disabled="!applies(key) || busy">
              <span>{{ label }}</span>
              <small v-if="single && reasonBlockOf(single, key)">{{ reasonBlockOf(single, key) }}</small>
              <small v-else-if="!single && applies(key) < eligible.length">
                {{ applies(key) ? `適用 ${applies(key)} / ${eligible.length} 筆，其餘會略過` : '所選訂單都不符合' }}
              </small>
            </label>
          </fieldset>

          <label class="cancel-field">
            <span class="cancel-label">說明{{ noteRequired ? '（必填）' : '（選填）' }}{{ single ? '' : '，每筆訂單相同' }}</span>
            <textarea v-model="note" :maxlength="MAX_CANCEL_NOTE" rows="2" :disabled="busy" placeholder="例如：購票人來信申請、重複下單" />
          </label>

          <fieldset v-if="paidOrders.length" class="cancel-field">
            <legend>退款{{ single ? '' : `（已付款的 ${paidOrders.length} 筆）` }}</legend>
            <label class="cancel-choice">
              <input v-model="refundMode" type="radio" name="cancel-refund" value="full" :disabled="busy">
              <span v-if="single">全額退款 NT$ {{ totalOf(single).toLocaleString() }}</span>
              <span v-else>每筆全額退款，合計 NT$ {{ sumOf(paidOrders).toLocaleString() }}</span>
            </label>
            <label class="cancel-choice">
              <input v-model="refundMode" type="radio" name="cancel-refund" value="none" :disabled="busy">
              <span>不退款</span>
            </label>
            <label v-if="single" class="cancel-choice">
              <input v-model="refundMode" type="radio" name="cancel-refund" value="custom" :disabled="busy">
              <span>部分退款</span>
              <input
                v-if="refundMode === 'custom'"
                v-model.number="refundAmount"
                class="refund-input num"
                type="number"
                min="0"
                :max="totalOf(single)"
                step="1"
                inputmode="numeric"
                aria-label="退款金額"
                :disabled="busy"
              >
            </label>
            <p v-if="refundHint" class="cancel-hint">{{ refundHint }}</p>
          </fieldset>

          <label v-if="withEmail.length" class="cancel-choice cancel-notify">
            <input v-model="notify" type="checkbox" :disabled="busy">
            <span>寄送取消通知信給購票人{{ single ? '' : `（${withEmail.length} 筆有 Email）` }}</span>
          </label>

          <p class="cancel-hint">
            訂單會移到「取消與退款」頁，票券與每人購買額度退回；購票人在購票紀錄會看到已取消{{ paidOrders.length ? '與退款金額' : '' }}，QR Code 失效
          </p>
          <p v-if="busy && !single" class="cancel-hint" role="status">正在取消… {{ progress }} / {{ eligible.length }}</p>
          <p v-if="error" class="cancel-error" role="alert">{{ error }}</p>
        </template>

        <div class="cancel-actions">
          <button v-if="eligible.length" type="button" class="cancel-btn danger" :disabled="!canSubmit" @click="submit">
            {{ busy ? '取消中…' : single ? '確認取消訂單' : `確認取消 ${submitCount} 筆訂單` }}
          </button>
          <button type="button" class="cancel-btn" :disabled="busy" @click="close(false)">返回</button>
        </div>
      </template>
    </div>
  </q-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { CANCEL_REASONS, MAX_CANCEL_NOTE, MAX_CANCEL_ORDERS, NOTE_REQUIRED_REASONS } from 'src/data/cancellations'
import { cancelBlockOf, noticeCountsOf, reasonBlockOf } from 'src/utils/cancellations'
import { cancelOrders } from 'src/services/orderService'

// One order or several picked together: each is cancelled in its own
// transaction (cancelOrders), so one that changed meanwhile is reported and
// the rest still go through.
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  orders: { type: Array, default: () => [] },
  // picked when the dialog opens, if it applies (逾期處理)
  defaultReason: { type: String, default: '' }
})
// cancelled: { orderIds, refundAmount } of every order now in cancelledOrders
const emit = defineEmits(['update:modelValue', 'cancelled'])

const reason = ref('')
const note = ref('')
const refundMode = ref('full')
const refundAmount = ref(0)
const notify = ref(true)
const busy = ref(false)
const error = ref('')
const progress = ref(0)
// { done, skipped, refund } once sent with some left behind
const results = ref(null)

const totalOf = (order) => Math.max(0, Number(order?.finalTotal) || 0)
const sumOf = (list) => list.reduce((total, order) => total + totalOf(order), 0)

const eligible = computed(() => props.orders.filter((order) => !cancelBlockOf(order)))
const blocked = computed(() => props.orders.filter((order) => cancelBlockOf(order)))
const single = computed(() => (props.orders.length === 1 && eligible.value.length === 1 ? eligible.value[0] : null))
const paidOrders = computed(() => eligible.value.filter((order) => order.paid === true))
const withEmail = computed(() => eligible.value.filter((order) => String(order.customerEmail || '').includes('@')))
const noteRequired = computed(() => NOTE_REQUIRED_REASONS.includes(reason.value))

// how many of the picked orders the reason applies to
const applies = (key) => eligible.value.filter((order) => !reasonBlockOf(order, key)).length
const submitCount = computed(() => (reason.value ? applies(reason.value) : eligible.value.length))

const refundHint = computed(() => {
  if (reason.value === 'uncollected') return '銷售條款第四條：經通知三次仍未領票者，得不退還已付款項'
  if (reason.value === 'violation') return '銷售條款第四條：違反第七條者，得拒絕入場並不退還已付款項'
  if (reason.value === 'buyer_request') return '銷售條款第五條：購票人解除契約時應退還已付款項'
  return ''
})

const refund = computed(() => {
  if (!paidOrders.value.length) return null
  if (refundMode.value === 'custom') return refundAmount.value
  return refundMode.value
})

const canSubmit = computed(() => {
  if (busy.value || !eligible.value.length || !reason.value || !applies(reason.value)) return false
  if (noteRequired.value && !note.value.trim()) return false
  if (refundMode.value === 'custom') {
    return !!single.value && Number.isInteger(refundAmount.value) && refundAmount.value >= 0 && refundAmount.value <= totalOf(single.value)
  }
  return true
})

// a fresh form each time it opens
watch(() => props.modelValue, (open) => {
  if (!open) return
  reason.value = props.defaultReason && applies(props.defaultReason) ? props.defaultReason : ''
  note.value = ''
  refundMode.value = 'full'
  refundAmount.value = single.value ? totalOf(single.value) : 0
  notify.value = true
  error.value = ''
  progress.value = 0
  results.value = null
})

function close(value = false) {
  if (busy.value) return
  emit('update:modelValue', value)
}

async function submit() {
  if (!canSubmit.value) return
  busy.value = true
  error.value = ''
  progress.value = 0
  const ids = eligible.value.filter((order) => !reasonBlockOf(order, reason.value)).map((order) => order.id)
  const input = { reason: reason.value, note: note.value.trim(), refund: refund.value, notify: notify.value }
  const done = []
  const skipped = []
  let refunded = 0

  try {
    for (let start = 0; start < ids.length; start += MAX_CANCEL_ORDERS) {
      const chunk = ids.slice(start, start + MAX_CANCEL_ORDERS)
      try {
        const response = await cancelOrders(chunk, input)
        response.results.forEach((result) => {
          if (result.status === 'skipped') skipped.push(result)
          else {
            done.push(result.orderId)
            refunded += Number(result.refundAmount) || 0
          }
        })
      } catch (cause) {
        // a failed call cancelled none of its orders; the next ones may still go
        console.error(cause)
        chunk.forEach((orderId) => skipped.push({ orderId, message: cause?.message || '取消失敗，請重試' }))
        if (cause?.code === 'functions/permission-denied') break
      }
      progress.value = Math.min(ids.length, start + chunk.length)
    }
  } finally {
    busy.value = false
  }

  if (done.length) emit('cancelled', { orderIds: done, refundAmount: refunded })
  if (single.value && skipped.length) {
    error.value = skipped[0].message || '取消失敗，請重試'
  } else if (skipped.length) {
    results.value = { done, skipped, refund: refunded }
  } else {
    emit('update:modelValue', false)
  }
}
</script>

<style scoped>
.cancel-modal {
  --off-white: #f2f0e9;
  --lunar: #9aa3ac;
  --ember: #e4a468;
  --line: rgba(242, 240, 233, .14);
  --danger: #c97878;

  width: min(100%, 560px);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  padding: 28px;
  background: #0d1015;
  border: 1px solid var(--line);
  color: var(--off-white);
  font-family: 'Manrope', 'Noto Sans TC', sans-serif;
}

.cancel-eyebrow {
  margin: 0 0 8px;
  color: var(--danger);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .16em;
  text-transform: uppercase;
}

.cancel-modal h2 {
  margin: 0 0 20px;
  font-family: 'Noto Sans TC', 'Manrope', sans-serif;
  font-size: 1.25rem;
  line-height: 1.4;
}

.cancel-summary {
  display: grid;
  gap: 6px;
  margin: 0 0 20px;
  font-size: 13px;
}

.cancel-summary div {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 12px;
}

.cancel-summary dt {
  color: var(--lunar);
}

.cancel-summary dd {
  margin: 0;
}

.cancel-field {
  display: block;
  margin: 0 0 18px;
  padding: 0;
  border: 0;
}

.cancel-field legend,
.cancel-label {
  display: block;
  margin-bottom: 8px;
  color: rgba(242, 240, 233, .55);
  font-size: 11px;
  font-weight: 600;
}

.cancel-choice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  min-height: 44px;
  padding: 8px 0;
  font-size: 14px;
  cursor: pointer;
}

.cancel-choice.disabled {
  color: rgba(242, 240, 233, .38);
  cursor: not-allowed;
}

.cancel-choice small {
  flex-basis: 100%;
  padding-left: 26px;
  color: rgba(242, 240, 233, .55);
  font-size: 12px;
}

.cancel-choice input[type="radio"],
.cancel-choice input[type="checkbox"] {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--ember);
}

.cancel-notify {
  margin: -6px 0 6px;
}

.cancel-field textarea,
.refund-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  color: var(--off-white);
  font: inherit;
  font-size: 14px;
}

.refund-input {
  width: 140px;
  min-height: 40px;
  padding: 6px 10px;
}

.cancel-field textarea:focus,
.refund-input:focus {
  border-color: var(--ember);
  outline: none;
}

.cancel-hint {
  margin: 4px 0 16px;
  color: var(--lunar);
  font-size: 12px;
  line-height: 1.6;
}

.cancel-error {
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid rgba(201, 120, 120, .45);
  color: var(--danger);
  font-size: 13px;
  line-height: 1.6;
}

.mono {
  font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
}

.num {
  font-variant-numeric: tabular-nums;
}

.cancel-btn {
  min-height: 44px;
  padding: 11px 20px;
  border: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  color: var(--off-white);
  font-family: 'Manrope', 'Noto Sans TC', sans-serif;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background .25s ease, border-color .25s ease, color .25s ease;
}

.cancel-btn:hover:not(:disabled) {
  border-color: var(--ember);
  color: var(--ember);
}

.cancel-btn.danger {
  border-color: var(--danger);
  background: var(--danger);
  color: #160a0a;
}

.cancel-btn.danger:hover:not(:disabled) {
  border-color: #d98e8e;
  background: #d98e8e;
  color: #160a0a;
}

.cancel-btn:disabled {
  opacity: .4;
  cursor: not-allowed;
}

.cancel-list {
  max-height: 180px;
  overflow-y: auto;
  margin: 0 0 20px;
  padding: 0;
  list-style: none;
  border-top: 1px solid rgba(242, 240, 233, .08);
  font-size: 12.5px;
}

.cancel-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(242, 240, 233, .08);
}

.cancel-list li > :last-child {
  margin-left: auto;
}

.cancel-list-note {
  color: rgba(242, 240, 233, .55);
}

.cancel-done {
  margin: 0 0 16px;
  font-size: 14px;
}

.cancel-warn {
  margin: 0 0 10px;
  color: var(--danger);
  font-size: 13px;
}

.cancel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
}

@media (max-width: 480px) {
  .cancel-modal {
    padding: 22px 16px;
  }
}
</style>
