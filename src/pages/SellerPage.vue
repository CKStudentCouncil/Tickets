<template>
  <div class="seller-page">
    <header class="page-header">
      <p class="eyebrow">{{ auth.email }}</p>
      <h1>登記賣票</h1>
    </header>

    <div v-if="!auth.isSeller" class="empty-state">
      <h2>你不在賣票名單中</h2>
      <p>登記賣票只開放給班聯會名單上的同學。如果你要幫忙賣票，請聯絡總副召把你的 Google 帳號加入名單，再重新登入。</p>
    </div>

    <div v-else-if="loading" class="empty-state" role="status">
      載入中…
    </div>

    <div v-else-if="loadError" class="empty-state" role="alert">
      <h2>目前無法載入</h2>
      <p>連線可能暫時中斷，請重試。</p>
      <button type="button" class="primary-button" @click="load">重新載入</button>
    </div>

    <template v-else>
      <section class="card goal-card" aria-labelledby="goal-title">
        <div class="goal-head">
          <h2 id="goal-title">共同目標</h2>
          <p class="goal-numbers">
            <strong class="num">{{ total.toLocaleString() }}</strong>
            <span class="num"> / {{ program.goal.toLocaleString() }} 張</span>
          </p>
        </div>
        <div
          class="progress"
          role="progressbar"
          :aria-valuenow="total"
          aria-valuemin="0"
          :aria-valuemax="program.goal"
          aria-label="共同目標進度"
        >
          <span :style="{ width: `${goalPercent}%` }" />
        </div>
        <p class="muted">
          {{ SELLER_LAST_YEAR }}，今年目標先定 {{ program.goal.toLocaleString() }} 張。
          不會強制每個人賣到特定張數，賣特別多的之後會有獎勵！
        </p>
        <p class="mine">
          你已登記 <strong class="num">{{ myTotal }}</strong> 張
        </p>
      </section>

      <section class="card" aria-labelledby="form-title">
        <h2 id="form-title">登記拿票</h2>

        <p v-if="!program.enabled || !ticketType" class="notice">
          目前尚未開放登記，開放後就能在這裡登記。
        </p>

        <form v-else class="register-form" @submit.prevent="submit">
          <p class="muted">
            票種：{{ ticketType.name }}・每張 NT$ <span class="num">{{ Number(ticketType.price || 0).toLocaleString() }}</span>
          </p>

          <label class="field">
            <span>姓名</span>
            <input v-model="sellerName" type="text" maxlength="50" autocomplete="name" required>
          </label>

          <label class="field">
            <span>要拿幾張票</span>
            <input
              v-model.number="quantity"
              type="number"
              inputmode="numeric"
              min="1"
              :max="MAX_SELLER_TICKETS"
              step="1"
              required
            >
          </label>

          <p class="warning">
            登記後會直接從二售票扣除，拿票之後就一定要賣掉，不能退回。
          </p>

          <p v-if="submitError" class="error" role="alert">{{ submitError }}</p>

          <button type="submit" class="primary-button" :disabled="submitting || !canSubmit">
            {{ submitting ? '登記中…' : '確認登記' }}
          </button>
        </form>
      </section>

      <section class="card" aria-labelledby="guide-title">
        <h2 id="guide-title">怎麼賣</h2>
        <ol class="steps">
          <li v-for="step in SELLER_STEPS" :key="step">{{ step }}</li>
        </ol>

        <h3>宣傳方式</h3>
        <ul class="tips">
          <li v-for="tip in SELLER_TIPS" :key="tip">{{ tip }}</li>
        </ul>
        <a :href="SELLER_INSTAGRAM_URL" target="_blank" rel="noopener" class="text-link">CK Party Night Instagram</a>
      </section>

      <section class="card" aria-labelledby="history-title">
        <h2 id="history-title">我的登記紀錄</h2>
        <p v-if="registrations.length === 0" class="muted">還沒有登記紀錄</p>
        <ul v-else class="history">
          <li v-for="item in registrations" :key="item.id">
            <div>
              <p class="history-main">
                <span class="num">{{ item.quantity }}</span> 張・{{ item.ticketTypeName }}
              </p>
              <p class="muted num">{{ formatDateTime(item.createdAt) }}</p>
            </div>
            <div class="badges">
              <span class="badge" :class="{ on: item.delivered }">{{ item.delivered ? '已拿票' : '待拿票' }}</span>
              <span class="badge" :class="{ on: item.paid }">{{ item.paid ? '已交款' : '待交款' }}</span>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { fetchTicketTypes } from 'src/services/ticketTypeService'
import {
  createSellerRequestId,
  fetchMyRegistrations,
  fetchSellerEntry,
  fetchSellerProgram,
  fetchSellerTotal,
  registerSellerTickets
} from 'src/services/sellerService'
import {
  MAX_SELLER_TICKETS,
  SELLER_INSTAGRAM_URL,
  SELLER_LAST_YEAR,
  SELLER_STEPS,
  SELLER_TIPS
} from 'src/data/sellerGuide'
import { formatDateTime } from 'src/utils/datetime'

const auth = useAuthStore()
const toast = useToastStore()

const loading = ref(true)
const loadError = ref(false)
const program = ref({ enabled: false, ticketTypeId: '', goal: 0 })
const ticketTypes = ref([])
const total = ref(0)
const registrations = ref([])

const sellerName = ref('')
const quantity = ref(1)
const submitting = ref(false)
const submitError = ref('')
// kept until the registration succeeds, so a retry cannot register twice
let requestId = createSellerRequestId()

const ticketType = computed(() => ticketTypes.value.find((type) => type.id === program.value.ticketTypeId) || null)
const myTotal = computed(() => registrations.value.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0))
const goalPercent = computed(() =>
  program.value.goal > 0 ? Math.min(100, (total.value / program.value.goal) * 100) : 0
)
const canSubmit = computed(
  () =>
    sellerName.value.trim() !== '' &&
    Number.isInteger(quantity.value) &&
    quantity.value > 0 &&
    quantity.value <= MAX_SELLER_TICKETS
)

async function load() {
  loading.value = true
  loadError.value = false

  try {
    const [programData, types, totalCount, mine, entry] = await Promise.all([
      fetchSellerProgram(),
      fetchTicketTypes(),
      fetchSellerTotal(),
      fetchMyRegistrations(auth.user.uid),
      fetchSellerEntry(auth.email)
    ])
    program.value = programData
    ticketTypes.value = types
    total.value = totalCount
    registrations.value = mine
    if (!sellerName.value) {
      sellerName.value = entry?.name || mine[0]?.sellerName || auth.user?.displayName || ''
    }
  } catch (error) {
    console.error('Load seller page error:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// definite refusals, explained by the server's message (not enough tickets
// left, not on the list, registration closed, bad input)
const REFUSALS = [
  'functions/resource-exhausted',
  'functions/permission-denied',
  'functions/failed-precondition',
  'functions/invalid-argument'
]

async function submit() {
  if (!canSubmit.value || submitting.value) return
  if (!window.confirm(`確定要登記 ${quantity.value} 張嗎？拿票之後就一定要賣掉，不能退回。`)) return

  submitting.value = true
  submitError.value = ''

  try {
    const result = await registerSellerTickets({
      requestId,
      quantity: quantity.value,
      sellerName: sellerName.value.trim()
    })
    requestId = createSellerRequestId()
    quantity.value = 1
    toast.show(`已登記 ${result.quantity} 張，請私訊總副召約時間拿票`, 6000)
    await load()
  } catch (error) {
    console.error('Register seller tickets error:', error)
    if (REFUSALS.includes(error?.code)) {
      // nothing was saved: the next try is a new registration
      requestId = createSellerRequestId()
      submitError.value = error.message
    } else {
      submitError.value = '登記失敗，請稍後再試（再按一次不會重複登記）'
    }
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  if (auth.isSeller) load()
  else loading.value = false
})
</script>

<style scoped>
@import 'src/css/sellerpage.scss';
</style>
