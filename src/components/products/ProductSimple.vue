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
.product-page {
  --void: #050608;
  --charcoal: #14171c;
  --lunar: #9aa3ac;
  --off-white: #f2f0e9;
  --ember: #e4a468;
  --line: rgba(242, 240, 233, 0.14);
  --line-soft: rgba(242, 240, 233, 0.08);

  position: relative;
  max-width: 1120px;
  min-height: 100vh;
  margin: auto;
  padding: 110px 24px 96px;
  font-family: 'Manrope', 'Noto Sans TC', sans-serif;
  color: var(--off-white);
  background: var(--void);

  a, button { color: inherit; text-decoration: none; }
}

.back-button {
  position: absolute;
  top: 32px;
  left: 24px;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: transparent;
  color: var(--off-white);
  transition: border-color .3s ease, background .3s ease;
}
.back-button:hover { border-color: var(--ember); background: rgba(228, 164, 104, 0.08); }

.product-detail {
  display: grid;
  grid-template-columns: 1.05fr .95fr;
  gap: 56px;
  align-items: center;
}

.image-frame {
  position: relative;
  aspect-ratio: 4 / 5;
  overflow: hidden;
  background: var(--charcoal);
  border: 1px solid var(--line-soft);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: filter .4s ease;

    &.is-muted-img { filter: grayscale(0.55) brightness(0.75); }
  }
}
.status-chip {
  position: absolute;
  top: 14px; left: 14px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 6px 11px;
  background: rgba(5, 6, 8, 0.55);
  backdrop-filter: blur(6px);
  color: var(--off-white);
}
.status-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.status-selling .status-dot { background: var(--ember); box-shadow: 0 0 8px 1px rgba(228, 164, 104, 0.7); }
.status-upcoming .status-dot { background: var(--lunar); }
.status-ended .status-dot { background: #4a4f55; }
.status-upcoming { color: rgba(242, 240, 233, 0.7); }
.status-ended { color: rgba(242, 240, 233, 0.45); }

.purchase-card {
  max-width: 420px;
  padding: 36px;
  border: 1px solid var(--line-soft);
  background: var(--charcoal);
}

.eyebrow {
  margin: 0 0 12px;
  color: var(--ember);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.28em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 12px;
  font-family: 'Noto Sans TC', 'Manrope', sans-serif;
  font-size: clamp(1.9rem, 4vw, 2.6rem);
  line-height: 1.2;
  letter-spacing: 0.01em;
  font-weight: 800;
  color: var(--off-white);
}

.ticket-limit {
  margin: 0 0 24px;
  font-size: 12.5px;
  color: rgba(242, 240, 233, 0.5);
}

.divider {
  height: 1px;
  margin: 0 0 24px;
  background: var(--line-soft);
}

.description {
  margin: 0 0 28px;
  color: rgba(242, 240, 233, 0.6);
  line-height: 1.7;
  font-size: 13.5px;
}

.primary-button {
  width: 100%;
  padding: 15px 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--ember);
  background: var(--ember);
  color: #16110a;
  cursor: pointer;
  font: 700 14px 'Manrope', sans-serif;
  letter-spacing: 0.04em;
  transition: background .3s ease, opacity .3s ease;

  &:hover { background: #f0b57e; }

  &:disabled {
    background: transparent;
    border-color: var(--line);
    color: rgba(242, 240, 233, 0.45);
    cursor: not-allowed;
  }
}

/* ---------- loading / error / empty states ---------- */
.ticket-state {
  padding: clamp(60px, 10vh, 110px) 0;
  max-width: 420px;

  h3 {
    font-family: 'Noto Sans TC', 'Manrope', sans-serif;
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--off-white);
    margin: 0 0 12px;
  }
  p {
    font-size: 13.5px;
    color: rgba(242, 240, 233, 0.55);
    line-height: 1.7;
    margin: 0;
  }
  .btn {
    display: inline-block;
    margin-top: 22px;
    padding: 12px 22px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--off-white);
    font-size: 13px;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: border-color .3s ease, background .3s ease;

    &:hover { border-color: var(--ember); background: rgba(228, 164, 104, 0.08); }
  }
}
.loading-dot {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--ember);
  margin-right: 10px;
  animation: pulse 1.4s ease-in-out infinite;
}
@keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }

@media (max-width: 760px) {
  .product-page { padding: 96px 16px 56px; }
  .product-detail { grid-template-columns: 1fr; gap: 28px; }
  .purchase-card { max-width: 100%; padding: 28px; }
}
</style>
