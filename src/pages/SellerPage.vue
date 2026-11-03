<template>
  <div class="seller-page">
    <header class="page-header">
      <div class="header-copy">
        <p class="eyebrow"><span /> CK PARTY NIGHT / SELLER PROGRAM</p>
        <h1>賣票登記</h1>
      </div>
      <div class="account-chip">
        <span class="account-dot" aria-hidden="true" />
        <span>{{ auth.email }}</span>
      </div>
    </header>

    <div v-if="loading" class="empty-state" role="status">
      載入中…
    </div>

    <div v-else-if="!auth.isSeller" class="empty-state">
      <h2>你不在賣票名單中</h2>
      <p>登記賣票只開放給班聯會儲備幹部；如果你要幫忙賣票，請聯絡總副召把你的 Google 帳號加入名單，再重新整理這頁</p>
    </div>

    <div v-else-if="loadError" class="empty-state" role="alert">
      <h2>目前無法載入</h2>
      <p>連線可能暫時中斷，請重試</p>
      <button type="button" class="primary-button" @click="load">重新載入</button>
    </div>

    <template v-else>
      <section class="card goal-card" aria-labelledby="goal-title">
        <div class="goal-topline">
          <p class="section-label">01 / OUR COLLECTIVE GOAL</p>
          <p class="goal-status"><span /> {{ goalPercent >= 100 ? 'GOAL REACHED' : 'IN PROGRESS' }}</p>
        </div>
        <div class="goal-head">
          <div>
            <h2 id="goal-title">共同目標<em>{{ program.goal.toLocaleString() }}</em> 張</h2>
            <p class="muted">不會強制每個人賣到特定張數，賣特別多的之後會有獎勵！</p>
          </div>
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
        <div class="goal-footer">
          <p class="goal-note">{{ SELLER_LAST_YEAR }}，今年目標先定 {{ program.goal.toLocaleString() }} 張</p>
          <p class="mine"><strong class="num">{{ myTotal }}</strong> <span>你已登記的票券</span></p>
        </div>
      </section>

      <div class="action-grid">
        <section class="card registration-card" aria-labelledby="form-title">
          <div class="card-heading">
            <p class="section-label">02 / GET YOUR TICKETS</p>
            <span class="card-index">02</span>
          </div>
          <h2 id="form-title">登記拿票</h2>

          <p v-if="!program.enabled || !ticketType" class="notice">
            目前尚未開放登記，開放後就能在這裡登記
          </p>

          <form v-else class="register-form" @submit.prevent="submit">
            <div class="ticket-meta">
              <span>{{ ticketType.name }}</span>
              <strong>NT$ <span class="num">{{ Number(ticketType.price || 0).toLocaleString() }}</span> <small>/ 張</small></strong>
            </div>

            <label class="field">
              <span>姓名</span>
              <input v-model="sellerName" type="text" maxlength="50" autocomplete="name" required>
            </label>

            <label class="field">
              <span>要拿幾張票 <small>最多 {{ MAX_SELLER_TICKETS }} 張</small></span>
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

            <p class="warning"><span aria-hidden="true">!</span> 登記後會直接從二售票扣除，拿票之後就一定要賣掉，不能退回</p>

            <p v-if="submitError" class="error" role="alert">{{ submitError }}</p>

            <button type="submit" class="primary-button" :disabled="submitting || !canSubmit">
              <span>{{ submitting ? '登記中…' : '確認登記' }}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </section>

        <section class="card guide-card" aria-labelledby="guide-title">
          <div class="card-heading">
            <p class="section-label">03 / MAKE IT COUNT</p>
            <span class="card-index">03</span>
          </div>
          <h2 id="guide-title">怎麼賣</h2>
          <ol class="steps">
            <li v-for="(step, index) in SELLER_STEPS" :key="step"><span>0{{ index + 1 }}</span>{{ step }}</li>
          </ol>

          <h3>宣傳方式</h3>
          <ul class="tips">
            <li v-for="tip in SELLER_TIPS" :key="tip">{{ tip }}</li>
          </ul>
          <a :href="SELLER_INSTAGRAM_URL" target="_blank" rel="noopener" class="text-link">CK Party Night Instagram <span aria-hidden="true">↗</span></a>
        </section>
      </div>

      <section class="card" aria-labelledby="history-title">
        <div class="card-heading">
          <p class="section-label">04 / YOUR ACTIVITY</p>
          <span class="card-index">04</span>
        </div>
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
  fetchMyRegistrations,
  fetchSellerEntry,
  fetchSellerProgram,
  fetchSellerTotal,
  getPendingSellerRequest,
  isOnSellerList,
  registerSellerTickets,
  setPendingSellerRequest
} from 'src/services/sellerService'
import {
  MAX_SELLER_TICKETS,
  SELLER_INSTAGRAM_URL,
  SELLER_LAST_YEAR,
  SELLER_STEPS,
  SELLER_TIPS
} from 'src/data/sellerGuide'
import { createRequestId } from 'src/services/orderService'
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
    // the registration whose response was lost did go through
    if (mine.some((item) => item.id === getPendingSellerRequest(auth.user.uid))) {
      setPendingSellerRequest(auth.user.uid, null)
    }
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

  // An unresolved earlier request is sent again: if it was saved, the server
  // returns it instead of registering twice (even after a reload)
  const uid = auth.user.uid
  const requestId = getPendingSellerRequest(uid) || createRequestId()
  setPendingSellerRequest(uid, requestId)

  try {
    const result = await registerSellerTickets({
      requestId,
      quantity: quantity.value,
      sellerName: sellerName.value.trim()
    })
    setPendingSellerRequest(uid, null)
    quantity.value = 1
    toast.show(`已登記 ${result.quantity} 張，請私訊總副召約時間拿票`, 6000)
    await load()
  } catch (error) {
    console.error('Register seller tickets error:', error)
    if (REFUSALS.includes(error?.code)) {
      // nothing was saved: the next try is a new registration
      setPendingSellerRequest(uid, null)
      submitError.value = error.message
    } else {
      submitError.value = '登記失敗，請稍後再試（再按一次不會重複登記）'
    }
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  // the look at sign-in may have failed, or the seller was added since
  if (!auth.isSeller && (await isOnSellerList(auth.email))) await auth.refresh()

  if (auth.isSeller) load()
  else loading.value = false
})
</script>

<style scoped>
@import 'src/css/sellerpage.scss';
</style>
