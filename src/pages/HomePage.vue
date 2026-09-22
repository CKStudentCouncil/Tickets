<template>
  <div class="storefront">
    <section class="hero">
      <p class="eyebrow eyebrow-en">CK PARTY NIGHT</p>
      <h1 class="text-bold">建中舞會購票系統</h1>
      <a href="#collection" class="primary-link">
        探索票種
        <q-icon name="south_east" />
      </a>
    </section>

    <section id="collection" class="collection">
      <div class="section-heading">
        <p class="eyebrow">票種系列</p>
        <h2 class="text-bold">購買舞會門票</h2>
      </div>

      <div v-if="loadingTicketTypes" class="ticket-state">
        <p>票種載入中...</p>
      </div>

      <div v-else-if="ticketTypesError" class="ticket-state">
        <h3>票種資訊載入失敗</h3>
        <p>請重新整理頁面後再試。</p>
        <button
          type="button"
          class="btn"
          @click="loadTicketTypes"
        >
          重新載入
        </button>
      </div>

      <div v-else-if="availableTicketTypes.length" class="product-grid">
        <router-link
          v-for="ticketType in availableTicketTypes"
          :key="ticketType.id"
          :to="`/product/${ticketType.id}`"
          class="product-card"
        >
          <div class="product-image">
            <img
              :src="getTicketImage(ticketType)"
              :alt="ticketType.name"
              loading="lazy"
              @error="handleImageError"
            >
          </div>

          <div class="product-meta">
            <div>
              <p class="product-category">CK PARTY NIGHT</p>
              <h3>{{ ticketType.name }}</h3>
            </div>

            <q-icon name="arrow_forward" />
          </div>

          <div class="ticket-status">
            <span
              class="status-indicator"
              :class="getTicketStatus(ticketType).className"
            />
            <span>{{ getTicketStatus(ticketType).label }}</span>
          </div>

          <p
            v-if="!ticketType.unlimited && ticketType.purchaseLimitPerPerson"
            class="ticket-limit"
          >
            每人限購 {{ ticketType.purchaseLimitPerPerson }} 張
          </p>
        </router-link>
      </div>

      <div v-else class="ticket-state">
        <h3>目前尚無開放購買的票種</h3>
        <p>票券資訊將於開放販售後顯示。</p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { doc, getDoc } from 'firebase/firestore'
import { db } from 'src/boot/firebase'

const ticketTypes = ref([])
const loadingTicketTypes = ref(true)
const ticketTypesError = ref(false)

const availableTicketTypes = computed(() =>
  ticketTypes.value.filter((ticketType) => {
    const status = getTicketStatus(ticketType)
    return status.state !== 'ended'
  })
)

async function loadTicketTypes() {
  loadingTicketTypes.value = true
  ticketTypesError.value = false

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
          (ticketType) =>
            ticketType &&
            ticketType.id &&
            ticketType.name
        )
      : []
  } catch (error) {
    console.error('Load ticket types error:', error)
    ticketTypesError.value = true
    ticketTypes.value = []
  } finally {
    loadingTicketTypes.value = false
  }
}

function getTicketStatus(ticketType) {
  const now = new Date()

  if (!ticketType.salesStartTime || !ticketType.salesEndTime) {
    return {
      state: 'unavailable',
      label: '尚未開放',
      className: 'unavailable'
    }
  }

  const start = new Date(ticketType.salesStartTime)
  const end = new Date(ticketType.salesEndTime)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return {
      state: 'unavailable',
      label: '尚未開放',
      className: 'unavailable'
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

function getTicketImage(ticketType) {
  return `/images/ticket-${ticketType.id}.png`
}

function handleImageError(event) {
  event.target.style.display = 'none'
}

onMounted(loadTicketTypes)
</script>

<style scoped>
@import 'src/css/homepage.scss';
</style>