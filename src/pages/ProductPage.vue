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
      <!--<div class="image-frame">
        <img
          :src="`/images/ticket-${ticketType.id}.png`"
          :alt="ticketType.name"
          :class="{ 'is-muted-img': status.state !== 'selling' }"
          @error="handleImageError"
        >
        <span class="status-chip" :class="`status-${status.className}`">
          <span class="status-dot" />
          <span>{{ status.label }}</span>
        </span>
      </div>-->

      <section class="purchase-card">
        <p class="eyebrow">CK PARTY NIGHT</p>
        <h1>{{ ticketType.name }} {{ ticketType.price ? ` - NT$ ${ticketType.price.toLocaleString()}` : '' }}</h1>

        <p
          v-if="!ticketType.unlimited && ticketType.purchaseLimitPerPerson"
          class="ticket-limit"
        >
          每人限購 {{ ticketType.purchaseLimitPerPerson }} 張
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
                <option v-for="s in SCHOOLS" :key="s" :value="s">{{ s }}</option>
              </select>
            </label>

            <label>
              班級
              <input v-model="buyer.class">
            </label>

            <label>
              座號
              <input v-model="buyer.number">
            </label>

            <label>
              姓名
              <input v-model="buyer.customerName">
            </label>

            <label>
              電話
              <input v-model="buyer.customerPhone">
            </label>

            <label>
              Email
              <input type="email" v-model="buyer.customerEmail">
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
import { doc, getDoc } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { useCartStore } from 'src/stores/cart'
import { useToastStore } from 'src/stores/toast'
import { submitOrder, setLastSubmittedOrderId } from 'src/services/orderService'

const route = useRoute()
const router = useRouter()
const cart = useCartStore()
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

async function loadTicketTypes() {
  loading.value = true
  loadError.value = false

  try {
    const snapshot = await getDoc(
      doc(db, 'settings', 'ticketTypes')
    )

    if (!snapshot.exists()) {
      ticketTypes.value = []
      return
    }

    const data = snapshot.data()

    ticketTypes.value = Array.isArray(data.types)
      ? data.types.filter(
          (type) =>
            type &&
            type.id &&
            type.name
        )
      : []
  } catch (error) {
    console.error('Load ticket types error:', error)
    loadError.value = true
    ticketTypes.value = []
  } finally {
    loading.value = false
  }
}

function getTicketStatus(type) {
  const now = new Date()

  if (!type.salesStartTime || !type.salesEndTime) {
    return {
      state: 'unavailable',
      label: '尚未開放',
      className: 'upcoming'
    }
  }

  const start = new Date(type.salesStartTime)
  const end = new Date(type.salesEndTime)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return {
      state: 'unavailable',
      label: '尚未開放',
      className: 'upcoming'
    }
  }

  if (now < start) {
    return {
      state: 'upcoming',
      label: '尚未開賣',
      className: 'upcoming'
    }
  }

  if (now > end) {
    return {
      state: 'ended',
      label: '已結束',
      className: 'ended'
    }
  }

  return {
    state: 'selling',
    label: '販售中',
    className: 'selling'
  }
}

function handleImageError(event) {
  event.target.style.display = 'none'
}

function add() {
  if (!ticketType.value || status.value.state !== 'selling') return

  cart.addToCart(ticketType.value)
  toast.show(`已將「${ticketType.value.name}」加入購票清單。`)
}

onMounted(loadTicketTypes)

/* ---------------- direct order submission (inline, no dialog) ---------------- */

// mirrors SCHOOL_IDENTITIES keys in src/services/orderService.js
const SCHOOLS = [
  '建國中學', '北一女中', '中山女高', '景美女中',
  '成功高中', '師大附中', '建中家長會', '建中老師', '其他學校或社會人士'
]

const showOrderForm = ref(false)
const submitting = ref(false)
const orderError = ref('')
const quantity = ref(1)
const buyer = ref({
  school: '',
  class: '',
  number: '',
  customerName: '',
  customerPhone: '',
  customerEmail: ''
})

const maxQuantity = computed(() =>
  ticketType.value && !ticketType.value.unlimited
    ? ticketType.value.purchaseLimitPerPerson || 1
    : 99
)

const canSubmitOrder = computed(() =>
  !!buyer.value.school &&
  !!buyer.value.customerName &&
  !!buyer.value.customerPhone &&
  !!buyer.value.customerEmail &&
  quantity.value > 0 &&
  quantity.value <= maxQuantity.value
)

function openOrderForm() {
  if (!ticketType.value || status.value.state !== 'selling') return
  quantity.value = 1
  orderError.value = ''
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

  const unitPrice = ticketType.value.price || 0
  const items = [{
    id: ticketType.value.id,
    name: ticketType.value.name,
    price: unitPrice,
    quantity: quantity.value
  }]

  try {
    const result = await submitOrder({
      ...buyer.value,
      items,
      finalTotal: unitPrice * quantity.value
    })

    setLastSubmittedOrderId(result.id)
    showOrderForm.value = false
    toast.show(`訂單 #${result.id} 已送出。`)
    router.push(`/order-success?id=${result.id}`)
  } catch (error) {
    console.error('Submit order error:', error)
    orderError.value = '訂單送出失敗，請稍後再試。'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
@import 'src/css/productpage.scss'
</style>