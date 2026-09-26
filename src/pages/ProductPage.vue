<template>
  <div class="product-page">
    <router-link to="/" class="back-button" aria-label="回到票種列表">
      <q-icon name="arrow_back" size="18px" />
    </router-link>

    <div v-if="loading" class="ticket-state">
      <p><span class="loading-dot" />載入中…</p>
    </div>

    <div v-else-if="loadError" class="ticket-state">
      <h3>資訊載入失敗</h3>
      <p>請重新整理頁面後再試</p>
      <button type="button" class="btn" @click="loadTicketTypes">
        重新載入
      </button>
    </div>

    <div v-else-if="!ticketType" class="ticket-state">
      <h3>找不到這個票種</h3>
      <p>這個票種可能已下架，或連結有誤</p>
      <router-link to="/" class="btn">回到列表</router-link>
    </div>

    <div v-else class="product-detail">
      <section class="purchase-card">
        <p class="eyebrow">CK PARTY NIGHT</p>
        <h1>{{ ticketType.name }} {{ ticketType.price ? ` - NT$ ${ticketType.price.toLocaleString()}` : '' }}</h1>

        <p
          v-if="purchaseLimit"
          class="ticket-limit"
        >
          每人限購 {{ purchaseLimit }} 張
        </p>

        <div class="divider" />

        <button
          v-if="status.state === 'selling' && !showOrderForm"
          type="button"
          class="primary-button"
          @click="openOrderForm"
        >
          購買 {{ ticketType.name }}
        </button>

        <div v-if="showOrderForm" class="order-panel">
          <p class="eyebrow">填寫訂購資訊</p>

          <div class="order-form">
            <label>
              數量
              <input type="number" v-model.number="quantity" min="1" :max="maxQuantity">
            </label>

            <label>
              學校 / 身分
              <select v-model="buyer.school">
                <option disabled value="">請選擇</option>
                <option v-for="s in schoolOptions" :key="s" :value="s">{{ s }}</option>
              </select>
            </label>

            <template v-if="needsClass">
              <label>
                班級
                <input v-model="buyer.class" placeholder="例：329/三數">
              </label>

              <label>
                座號
                <input v-model="buyer.number" placeholder="例：01">
              </label>
            </template>

            <label v-if="buyer.school === '建中老師'">
              辦公室
              <input v-model="buyer.office" placeholder="例：莊三">
            </label>

            <label>
              姓名
              <input v-model="buyer.customerName">
            </label>

            <label>
              電話
              <input v-model="buyer.customerPhone" type="tel" autocomplete="tel">
            </label>

            <label>
              Email
              <input v-model="buyer.customerEmail" type="email" autocomplete="email">
            </label>
          </div>

          <p class="order-summary">
            <span>應付金額</span>
            <strong>NT$ {{ (ticketType.price || 0) * quantity }}</strong>
          </p>

          <p v-if="orderError" class="order-error">{{ orderError }}</p>

          <div class="order-panel-actions">
            <button
              type="button"
              class="secondary-button"
              :disabled="submitting"
              @click="closeOrderForm"
            >
              取消
            </button>

            <button
              type="button"
              class="primary-button"
              :disabled="!canSubmitOrder || submitting"
              @click="submitDirectOrder"
            >
              {{ submitting ? '送出中…' : '確認送出訂單' }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToastStore } from 'src/stores/toast'
import { submitOrder } from 'src/services/orderService'
import {
  ELIGIBLE_IDENTITIES,
  fetchTicketTypes,
  getPurchaseLimit,
  getTicketStatus
} from 'src/services/ticketTypeService'
import { CAMPUS_SCHOOLS, SCHOOLS } from 'src/data/schools'

const MAX_TICKETS_PER_ORDER = 20 // same cap as functions/lib/orders.js
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const route = useRoute()
const router = useRouter()
const toast = useToastStore()

const ticketTypes = ref([])
const loading = ref(true)
const loadError = ref(false)

const ticketType = computed(() =>
  ticketTypes.value.find((type) => type.id === route.params.id) || null
)

const status = computed(() =>
  ticketType.value ? getTicketStatus(ticketType.value) : null
)

const purchaseLimit = computed(() =>
  ticketType.value ? getPurchaseLimit(ticketType.value) : null
)

async function loadTicketTypes() {
  loading.value = true
  loadError.value = false

  try {
    ticketTypes.value = await fetchTicketTypes()
  } catch (error) {
    console.error('Load ticket types error:', error)
    loadError.value = true
    ticketTypes.value = []
  } finally {
    loading.value = false
  }
}

onMounted(loadTicketTypes)

/* ---------- inline order form ---------- */

const showOrderForm = ref(false)
const submitting = ref(false)
const orderError = ref('')
const quantity = ref(1)
const buyer = ref({
  school: '',
  class: '',
  number: '',
  office: '',
  customerName: '',
  customerPhone: '',
  customerEmail: ''
})

// Campus-only tickets can only be bought by students of the partner schools
const schoolOptions = computed(() =>
  ticketType.value?.eligibleBuyerIdentity === ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS
    ? CAMPUS_SCHOOLS
    : SCHOOLS
)

const needsClass = computed(() => CAMPUS_SCHOOLS.includes(buyer.value.school))

const maxQuantity = computed(() => purchaseLimit.value || MAX_TICKETS_PER_ORDER)

const canSubmitOrder = computed(() =>
  !!buyer.value.school &&
  !!buyer.value.customerName.trim() &&
  !!buyer.value.customerPhone.trim() &&
  EMAIL_PATTERN.test(buyer.value.customerEmail.trim()) &&
  (!needsClass.value || (!!buyer.value.class.trim() && !!buyer.value.number.trim())) &&
  Number.isInteger(quantity.value) &&
  quantity.value > 0 &&
  quantity.value <= maxQuantity.value
)

function openOrderForm() {
  if (!ticketType.value || status.value.state !== 'selling') return
  quantity.value = 1
  orderError.value = ''
  if (!schoolOptions.value.includes(buyer.value.school)) buyer.value.school = ''
  showOrderForm.value = true
}

function closeOrderForm() {
  showOrderForm.value = false
  orderError.value = ''
}

async function submitDirectOrder() {
  if (!ticketType.value || !canSubmitOrder.value || submitting.value) return

  submitting.value = true
  orderError.value = ''

  const { school, customerName, customerPhone, customerEmail } = buyer.value

  try {
    // The price is decided by the server from the ticket settings
    const result = await submitOrder({
      school,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerEmail: customerEmail.trim(),
      class: needsClass.value ? buyer.value.class.trim() : '',
      number: needsClass.value ? buyer.value.number.trim() : '',
      office: school === '建中老師' ? buyer.value.office.trim() : '',
      items: [{ id: ticketType.value.id, quantity: quantity.value }]
    })

    showOrderForm.value = false
    toast.show(`訂單 #${result.id} 已送出。`)
    router.push({ name: 'order-success', query: { id: result.id } })
  } catch (error) {
    console.error('Submit order error:', error)
    // HttpsError messages from createOrder are already user-facing Chinese
    orderError.value = error?.message && error.code !== 'functions/internal'
      ? error.message
      : '訂單送出失敗，請稍後再試。'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
@import 'src/css/productpage.scss';
</style>