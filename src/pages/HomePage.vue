<template>
  <div class="storefront">
    <section class="hero">
      <div class="starfield" aria-hidden="true" />

      <!--<div class="hole-wrap" aria-hidden="true">
        <div class="hole-halo" />
        <div class="hole-ring" />
        <div class="hole-grain" />
      </div>
      <div class="light-spill" aria-hidden="true" />
      <div class="dust" aria-hidden="true" />-->

      <svg class="terrain" viewBox="0 0 1440 260" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="terrainLit" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#05060a" />
            <stop offset="55%" stop-color="#0a0a0d" />
            <stop offset="82%" stop-color="#2a1a0e" />
            <stop offset="100%" stop-color="#5c3618" />
          </linearGradient>
        </defs>
        <path
          d="M0,180 L60,168 L140,176 L220,150 L300,168 L380,140 L470,162 L560,130 L650,158 L740,120 L830,150 L920,110 L1010,145 L1100,118 L1190,150 L1280,128 L1360,155 L1440,140 L1440,260 L0,260 Z"
          fill="url(#terrainLit)"
        />
        <ellipse cx="180" cy="172" rx="22" ry="7" fill="#0a0c11" opacity="0.7" />
        <ellipse cx="520" cy="150" rx="34" ry="9" fill="#0a0c11" opacity="0.6" />
        <ellipse cx="900" cy="128" rx="26" ry="8" fill="#201408" opacity="0.6" />
        <ellipse cx="1220" cy="140" rx="30" ry="9" fill="#301c0e" opacity="0.65" />
      </svg>

      <svg class="rover-astronaut" viewBox="0 0 160 120" fill="none" aria-hidden="true">
        <g opacity="0.9">
          <circle cx="38" cy="34" r="12" fill="#0a0c10" stroke="#3a4048" stroke-width="1.2" />
          <path d="M38 46 L38 68 M38 52 L24 60 M38 52 L52 60 M38 68 L28 84 M38 68 L48 84" stroke="#3a4048" stroke-width="2.4" stroke-linecap="round" />
          <rect x="30" y="44" width="16" height="16" rx="3" fill="#12151a" stroke="#3a4048" stroke-width="1" />
        </g>
        <g opacity="0.85" transform="translate(70,58)">
          <rect x="0" y="10" width="58" height="18" rx="3" fill="#0a0c10" stroke="#3a4048" stroke-width="1.2" />
          <circle cx="10" cy="34" r="9" fill="#0a0c10" stroke="#3a4048" stroke-width="1.2" />
          <circle cx="48" cy="34" r="9" fill="#0a0c10" stroke="#3a4048" stroke-width="1.2" />
          <rect x="14" y="-2" width="3" height="14" fill="#3a4048" />
          <rect x="4" y="-6" width="20" height="6" rx="1" fill="#12151a" stroke="#3a4048" stroke-width="1" />
        </g>
      </svg>

      <div class="hero-content">
        <div class="title-lockup">
          <p class="title-lockup-sub">2026 · CK PARTY NIGHT</p>
          <h1 class="title-lockup-brand">COSMOS</h1>
        </div>
        <p class="hero-meta">2026/12/13 · 建中明道樓後停車場</p>
        <a href="#collection" class="primary-link" @click.prevent="scrollToCollection">
          開始購票
          <q-icon name="south_east" />
        </a>
      </div>
    </section>

    <section id="collection" ref="collectionSection" class="collection">
      <div class="section-heading">
        <p class="eyebrow">Tickets</p>
        <h2>購買舞會門票</h2>
      </div>

      <div v-if="loadingTicketTypes" class="ticket-state">
        <p><span class="loading-dot" />票種載入中…</p>
      </div>

      <div v-else-if="ticketTypesError" class="ticket-state">
        <h3>票種資訊載入失敗</h3>
        <p>請重新整理頁面後再試。</p>
        <button type="button" class="btn" @click="loadTicketTypes">
          重新載入
        </button>
      </div>

      <div v-else-if="availableTicketTypes.length" class="product-grid">
        <router-link
          v-for="ticketType in availableTicketTypes"
          :key="ticketType.id"
          :to="`/product/${ticketType.id}`"
          class="product-card"
          :class="{ 'is-muted': getTicketStatus(ticketType).state !== 'selling' }"
        >
          <div class="product-image">
            <img
              :src="getTicketImage(ticketType)"
              :alt="ticketType.name"
              loading="lazy"
              :class="{ 'is-muted-img': getTicketStatus(ticketType).state !== 'selling' }"
              @error="handleImageError"
            >
            <span class="status-chip" :class="`status-${getTicketStatus(ticketType).className}`">
              <span class="status-dot" />
              <span>{{ getTicketStatus(ticketType).label }}</span>
            </span>
          </div>

          <div class="product-meta">
            <div>
              <p class="product-category">CK PARTY NIGHT</p>
              <h3>{{ ticketType.name }} {{ ticketType.price ? ` - NT$ ${ticketType.price.toLocaleString()}` : '' }}</h3>
            </div>

            <q-icon name="arrow_forward" />
            
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
import { fetchTicketTypes, getTicketStatus } from 'src/services/ticketTypeService'

const ticketTypes = ref([])
const loadingTicketTypes = ref(true)
const ticketTypesError = ref(false)
const collectionSection = ref(null)

const availableTicketTypes = computed(() =>
  ticketTypes.value.filter((ticketType) => getTicketStatus(ticketType).state !== 'ended')
)

function scrollToCollection() {
  collectionSection.value?.scrollIntoView({ behavior: 'smooth' })
}

async function loadTicketTypes() {
  loadingTicketTypes.value = true
  ticketTypesError.value = false

  try {
    ticketTypes.value = await fetchTicketTypes()
  } catch (error) {
    console.error('Load ticket types error:', error)
    ticketTypesError.value = true
    ticketTypes.value = []
  } finally {
    loadingTicketTypes.value = false
  }
}

// Optional artwork in public/images/; hidden when the file does not exist
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
