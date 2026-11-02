<template>
  <div class="seller-page officer-page street-page">
    <header class="page-header">
      <div class="header-copy">
        <p class="eyebrow"><span /> CK PARTY NIGHT / STREET SALES</p>
        <h1>路宣登記</h1>
        <p class="header-intro">路宣現場收下現金、交付紙本票券後在這裡登記張數；不需要購票人的任何資料</p>
      </div>
      <div class="account-chip">
        <span class="account-dot" aria-hidden="true" />
        <span>{{ auth.email }}</span>
      </div>
    </header>

    <div v-if="!auth.isAdmin" class="empty-state">
      <h2>權限不足</h2>
      <p>路宣登記只開放給管理員</p>
    </div>

    <div v-else-if="loading" class="empty-state" role="status">
      載入中…
    </div>

    <div v-else-if="loadError" class="empty-state" role="alert">
      <h2>目前無法載入</h2>
      <p>連線可能暫時中斷，請重試</p>
      <button type="button" class="primary-button" @click="load">重新載入</button>
    </div>

    <template v-else>
      <div class="action-grid">
        <section class="card registration-card" aria-labelledby="form-title">
          <div class="card-heading">
            <p class="section-label">01 / REGISTER A SALE</p>
            <span class="card-index">01</span>
          </div>
          <h2 id="form-title">登記一筆</h2>

          <p v-if="!program.enabled || !ticketType" class="notice">
            目前尚未開放路宣登記，開放後就能在這裡登記
          </p>

          <div v-else-if="lastSale" class="new-link" role="status">
            <p class="new-link-label">已登記・<span class="mono">{{ lastSale.id }}</span></p>
            <p class="sale-summary">
              <span class="num">{{ lastSale.quantity }}</span> 張・NT$ <span class="num">{{ lastSale.amount.toLocaleString() }}</span>
            </p>
            <p class="muted">
              請交付 <span class="num">{{ lastSale.quantity }}</span> 張紙本票券<template v-if="lastSale.change > 0">，並找零 NT$ <span class="num">{{ lastSale.change.toLocaleString() }}</span></template>
            </p>
            <div class="row-actions">
              <button ref="nextButton" type="button" class="primary-button" @click="lastSale = null">
                <span>登記下一筆</span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>

          <form v-else class="register-form" @submit.prevent="submit">
            <div class="ticket-meta">
              <span>{{ ticketType.name }}</span>
              <strong>NT$ <span class="num">{{ price.toLocaleString() }}</span> <small>/ 張</small></strong>
            </div>

            <h3 id="board-title">價目板</h3>
            <div class="board" role="group" aria-labelledby="board-title">
              <button
                v-for="quantity in BOARD_QUANTITIES"
                :key="quantity"
                type="button"
                class="board-option"
                :class="{ active: form.quantity === quantity }"
                :aria-pressed="form.quantity === quantity"
                :disabled="quantity > maxQuantity || submitting"
                @click="form.quantity = quantity"
              >
                <span class="board-quantity"><span class="num">{{ quantity }}</span> 張</span>
                <span class="board-price num">NT$ {{ (price * quantity).toLocaleString() }}</span>
              </button>
            </div>
            <div class="field">
              <span>其他張數 <small>最多 {{ maxQuantity }} 張</small></span>
              <QuantityStepper v-model="form.quantity" :max="maxQuantity" :disabled="submitting" />
            </div>

            <p class="amount-due">
              <span>應收現金</span>
              <strong class="num">NT$ {{ amount.toLocaleString() }}</strong>
            </p>

            <h3 id="change-title">找零計算</h3>
            <div class="field">
              <span>收到金額</span>
              <input
                v-model.number="received"
                type="number"
                inputmode="numeric"
                min="0"
                step="1"
                placeholder="0"
                aria-describedby="change-result"
                :disabled="submitting"
              >
            </div>
            <div class="cash-notes" role="group" aria-labelledby="change-title">
              <button
                v-for="note in CASH_NOTES"
                :key="note"
                type="button"
                class="secondary-button"
                :disabled="submitting"
                @click="addCash(note)"
              >
                + <span class="num">{{ note.toLocaleString() }}</span>
              </button>
              <button type="button" class="secondary-button" :disabled="submitting || !amount" @click="received = amount">剛好</button>
              <button type="button" class="secondary-button" :disabled="submitting || !received" @click="received = ''">清除</button>
            </div>
            <p id="change-result" class="change-result" :class="changeState" aria-live="polite">
              <template v-if="changeState === 'short'">
                <span>還差</span>
                <strong class="num">NT$ {{ (amount - receivedAmount).toLocaleString() }}</strong>
              </template>
              <template v-else>
                <span>找零</span>
                <strong class="num">NT$ {{ change.toLocaleString() }}</strong>
              </template>
            </p>

            <p class="warning"><span aria-hidden="true">!</span> 收下現金、交付紙本票券後再登記；登記後訂單就是已付款、已領票，不會寄 Email</p>

            <p v-if="submitError" class="error" role="alert">{{ submitError }}</p>

            <button type="submit" class="primary-button" :disabled="submitting || !validQuantity">
              <span>{{ submitting ? '登記中…' : `登記 ${validQuantity ? form.quantity : ''} 張・NT$ ${amount.toLocaleString()}` }}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </section>

        <section class="card guide-card" aria-labelledby="guide-title">
          <div class="card-heading">
            <p class="section-label">02 / HOW IT WORKS</p>
            <span class="card-index">02</span>
          </div>
          <h2 id="guide-title">怎麼登記</h2>
          <ol class="steps">
            <li v-for="(step, index) in STREET_STEPS" :key="step"><span>0{{ index + 1 }}</span>{{ step }}</li>
          </ol>
          <p class="muted guide-note">登記錯了請聯絡總副召刪除那筆，票會退回庫存，再重新登記</p>
        </section>
      </div>

      <section class="card" aria-labelledby="history-title">
        <div class="card-heading">
          <p class="section-label">03 / YOUR SALES</p>
          <span class="card-index">03</span>
        </div>
        <h2 id="history-title">我登記的路宣</h2>
        <p v-if="sales.length === 0" class="muted">還沒有登記紀錄</p>
        <ul v-else class="history">
          <li v-for="sale in sales" :key="sale.id">
            <div class="history-copy">
              <p class="history-main">
                <span class="num">{{ quantityOf(sale) }}</span> 張・NT$ <span class="num">{{ amountOf(sale).toLocaleString() }}</span>
              </p>
              <p class="muted num">
                {{ formatDateTime(sale.createdAt) }}・<router-link class="mono" :to="{ name: 'admin-order-detail', params: { id: sale.id } }">{{ sale.id }}</router-link>
              </p>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import QuantityStepper from 'src/components/QuantityStepper.vue'
import { BOARD_QUANTITIES, CASH_NOTES, MAX_STREET_TICKETS, STREET_STEPS } from 'src/data/streetSales'
import { fetchTicketTypes } from 'src/services/ticketTypeService'
import { fetchMyStreetSales, fetchStreetProgram, registerStreetSale } from 'src/services/streetSaleService'
import { createRequestId } from 'src/services/orderService'
import { formatDateTime } from 'src/utils/datetime'

const auth = useAuthStore()
const toast = useToastStore()

const emptyForm = () => ({ quantity: 1 })

const loading = ref(true)
const loadError = ref(false)
const program = ref({ enabled: false, ticketTypeId: '' })
const ticketTypes = ref([])
const sales = ref([])

const form = ref(emptyForm())
// cash the buyer handed over, for the change; '' when cleared
const received = ref('')
const submitting = ref(false)
const submitError = ref('')
// the sale just registered, shown until the next one starts
const lastSale = ref(null)
const nextButton = ref(null)

const ticketType = computed(() => ticketTypes.value.find((type) => type.id === program.value.ticketTypeId) || null)
const price = computed(() => Number(ticketType.value?.price) || 0)
// the type's per-person limit does not apply to street sales
const maxQuantity = MAX_STREET_TICKETS
const validQuantity = computed(() =>
  Number.isInteger(form.value.quantity) && form.value.quantity >= 1 && form.value.quantity <= maxQuantity
)
const amount = computed(() => (validQuantity.value ? price.value * form.value.quantity : 0))

const receivedAmount = computed(() => Math.max(0, Number(received.value) || 0))
const change = computed(() => Math.max(0, receivedAmount.value - amount.value))
// nothing typed yet, short of what is due, or enough
const changeState = computed(() => {
  if (!receivedAmount.value) return 'empty'
  return receivedAmount.value < amount.value ? 'short' : 'ok'
})

function addCash(note) {
  received.value = receivedAmount.value + note
}

const quantityOf = (sale) =>
  (Array.isArray(sale.items) ? sale.items : []).reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0)
const amountOf = (sale) => Number(sale.finalTotal) || 0

// a changed sale is another question
watch(form, () => { submitError.value = '' }, { deep: true })

async function load() {
  loadError.value = false
  try {
    const [programData, types, mine] = await Promise.all([
      fetchStreetProgram(),
      fetchTicketTypes(),
      fetchMyStreetSales(auth.email)
    ])
    program.value = programData
    ticketTypes.value = types
    sales.value = mine
  } catch (error) {
    console.error('Load street sale page error:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// definite refusals, explained by the server's message (not enough tickets
// left, closed, not an admin, bad input)
const REFUSALS = [
  'functions/resource-exhausted',
  'functions/permission-denied',
  'functions/failed-precondition',
  'functions/invalid-argument'
]

// The sale whose outcome is unknown (the response was lost): pressing again
// for the same quantity reuses its requestId, so the server returns that
// order instead of selling the tickets twice. Kept only on this page: a sale
// has nothing but its quantity, so a later sale of as many tickets must not
// be taken for a retry; the list below shows whether the lost one went in.
let pending = null
function requestIdFor(quantity) {
  if (pending?.quantity !== quantity) pending = { quantity, requestId: createRequestId() }
  return pending.requestId
}

async function submit() {
  if (!validQuantity.value || submitting.value) return

  const quantity = form.value.quantity
  const due = amount.value
  const changeDue = change.value
  const changeText = changeDue > 0 ? `，找零 NT$ ${changeDue.toLocaleString()}` : ''
  if (!window.confirm(`確定已收款 NT$ ${due.toLocaleString()}${changeText}，並交付 ${quantity} 張紙本票嗎？`)) return

  submitting.value = true
  submitError.value = ''

  try {
    const { id } = await registerStreetSale({ quantity, requestId: requestIdFor(quantity) })
    pending = null
    lastSale.value = { id, quantity, amount: due, change: changeDue }
    form.value = emptyForm()
    received.value = ''
    toast.show(`已登記 ${quantity} 張紙本票`, 6000)
    await load()
    await nextTick()
    nextButton.value?.focus({ preventScroll: true })
  } catch (error) {
    console.error('Register street sale error:', error)
    if (REFUSALS.includes(error?.code)) {
      // nothing was sold: the next try is a new sale
      pending = null
      submitError.value = error.message
      if (error.code === 'functions/failed-precondition') await load()
    } else {
      submitError.value = '登記結果不明，請先看下方「我登記的路宣」；沒有這筆再按一次（不會重複登記）'
      // the list shows it if it did go in
      await load()
    }
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  if (auth.isAdmin) load()
  else loading.value = false
})
</script>

<style scoped>
@import 'src/css/sellerpage.scss';
@import 'src/css/officerpage.scss';
@import 'src/css/streetpage.scss';
</style>
