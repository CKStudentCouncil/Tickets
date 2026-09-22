<template>
  <div class="product-page">
    <router-link to="/" class="back-button" aria-label="回到票種列表">
      <q-icon name="arrow_back" size="18px" />
    </router-link>

    <div v-if="loading" class="ticket-state">
      <p><span class="loading-dot" />票種載入中…</p>
    </div>

    <div v-else-if="loadError" class="ticket-state">
      <h3>票種資訊載入失敗</h3>
      <p>請重新整理頁面後再試。</p>
      <button type="button" class="btn" @click="loadTicketTypes">
        重新載入
      </button>
    </div>

    <div v-else-if="!ticketType" class="ticket-state">
      <h3>找不到這個票種</h3>
      <p>這個票種可能已下架，或連結有誤。</p>
      <router-link to="/" class="btn">回到票種列表</router-link>
    </div>

    <div v-else class="product-detail">
      <div class="image-frame">
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
      </div>

      <section class="purchase-card">
        <p class="eyebrow">CK PARTY NIGHT</p>
        <h1>{{ ticketType.name }}</h1>

        <p
          v-if="!ticketType.unlimited && ticketType.purchaseLimitPerPerson"
          class="ticket-limit"
        >
          每人限購 {{ ticketType.purchaseLimitPerPerson }} 張
        </p>

        <div class="divider" />

        <p class="description">本票種為站票，請於開賣期間完成下單，並依通知完成後續流程。</p>

        <button
          type="button"
          class="primary-button"
          :disabled="status.state !== 'selling'"
          @click="add"
        >
          {{ status.state === 'selling' ? '加入購票清單' : status.label }}
          <q-icon v-if="status.state === 'selling'" name="add_shopping_cart" size="18px" />
        </button>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { doc, getDoc } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { useCartStore } from 'src/stores/cart'
import { useToastStore } from 'src/stores/toast'

const route = useRoute()
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
</script>

<style scoped>
@import 'src/css/productpage.scss'
</style>
