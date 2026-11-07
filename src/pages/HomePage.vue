<template>
  <div class="storefront">
    <section class="hero" aria-label="COSMOS 建中舞會">
      <div class="hero-art" aria-hidden="true">
        <!-- resized copies of public/homepageposter.png (5008px, 7.7 MB), the
             source kept for the email artwork -->
        <picture>
          <source
            type="image/webp"
            srcset="/hero-poster-720.webp 720w, /hero-poster-1080.webp 1080w, /hero-poster-1440.webp 1440w, /hero-poster-2000.webp 2000w"
            sizes="100vw"
          />
          <img src="/hero-poster-1440.jpg" alt="" width="1076" height="1522" fetchpriority="high" />
        </picture>
      </div>
      <div class="hero-content">
        <p class="hero-eyebrow" style="letter-spacing: 6px;">2026 · CK PARTY NIGHT</p><div style="margin-bottom: 2.5ch; " />
        <h1 id="cosmos-title" class="hero-title" aria-label="COSMOS" style="margin-bottom: 0ch;">
          <!-- the poster's (public/poster.jpg) cream lettering, cut out beforehand
               so the page doesn't load the whole poster for it -->
          <svg class="hero-wordmark" viewBox="124 1232 818 80" aria-hidden="true" focusable="false">
            <image href="/cosmos-wordmark.png" x="124" y="1232" width="818" height="80" />
          </svg>
        </h1>
        <div class="hero-actions">
          <a href="#collection" class="secondary-link" @click.prevent="scrollToCollection">
            開始購票
            <q-icon name="south_east" />
          </a>
          <router-link to="/performer" class="secondary-link">
            演出陣容
            <q-icon name="south_east" />
          </router-link>
        </div>
      </div>
      <div class="hero-details">
        <dl class="event-details">
          <div class="event-detail">
            <dt>DATE <span>日期</span></dt>
            <dd style="font-size: large; "><time :datetime="EVENT_DATE.replaceAll('/', '-')">{{ EVENT_DATE.replaceAll('/', '.') }}</time></dd>
          </div>
            <div class="event-detail" style="margin-left: -5ch; ">
              <dt>LOCATION <span>地點</span></dt>
              <dd>{{ EVENT_VENUE }}</dd>
            </div>
        </dl>
      </div>
    </section>

    <section id="collection" ref="collectionSection" class="collection" aria-labelledby="tickets-title">
      <div class="section-heading">
        <div>
          <h2 id="tickets-title" class="eyebrow" style="margin-bottom: 0px">GET YOUR TICKETS</h2>
        </div>
      </div>

      <div class="collection-layout">
        <div class="ticket-selection" aria-live="polite" :aria-busy="loadingTicketTypes">
          <div class="ticket-selection-heading">
            <p>選擇票種</p>
            <span>ADMISSION / 2026</span>
          </div>

          <div v-if="loadingTicketTypes" class="ticket-state">
            <p><span class="loading-dot" />票種載入中…</p>
          </div>

          <div v-else-if="ticketTypesError" class="ticket-state">
            <h3>票種資訊載入失敗</h3>
            <p>請重新整理頁面後再試</p>
            <button type="button" class="btn" @click="loadTicketTypes">重新載入</button>
          </div>

          <div v-else-if="availableTicketTypes.length" class="product-grid">
            <router-link
              v-for="(ticketType, index) in availableTicketTypes"
              :key="ticketType.id"
              :to="`/product/${ticketType.id}`"
              class="product-card"
              :class="{ 'is-muted': statusOf(ticketType).state !== 'selling' }"
            >
              <div class="ticket-card-heading">
                <span class="ticket-number">{{ String(index + 1).padStart(2, '0') }} / ENTRY PASS</span>
                <span class="status-chip" :class="`status-${statusOf(ticketType).className}`">
                  <span class="status-dot" />
                  {{ statusOf(ticketType).label }}
                </span>
              </div>
              <div class="product-meta">
                <div class="ticket-name">
                  <h3>{{ ticketType.name }}</h3>
                  <p v-if="isAdminOnlyType(ticketType)" class="ticket-limit">
                    測試票・僅管理員可見、可購買
                  </p>
                  <p v-if="isFriendSchoolsOnlyType(ticketType)" class="ticket-limit">
                    限建中及友校在學學生購買
                  </p>
                  <p v-if="!ticketType.unlimited && ticketType.purchaseLimitPerPerson" class="ticket-limit">
                    每人限購 {{ ticketType.purchaseLimitPerPerson }} 張
                  </p>
                </div>
                <div class="ticket-price" v-if="ticketType.price != null">
                  <span>NT$</span>
                  <strong>{{ ticketType.price.toLocaleString() }}</strong>
                </div>
                <span class="ticket-arrow" aria-hidden="true"><q-icon name="north_east" /></span>
              </div>
            </router-link>
          </div>

          <div v-else class="ticket-state">
            <h3>目前尚無開放購買的票種</h3>
            <p>票券資訊將於開放販售後顯示</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  getTicketStatus,
  isAdminOnlyType,
  isFriendSchoolsOnlyType,
  isTicketTypeListed,
  loadStorefront
} from 'src/services/ticketTypeService'
import { EVENT_DATE, EVENT_VENUE } from 'src/config/app'
import { useNow } from 'src/composables/useNow'
import { useAuthStore } from 'src/stores/auth'

const auth = useAuthStore()
const ticketTypes = ref([])
const soldOut = ref({})
const loadingTicketTypes = ref(true)
const ticketTypesError = ref(false)
const collectionSection = ref(null)

// status labels follow the clock without a reload (PARTY-24)
const now = useNow(10000)

function statusOf(ticketType) {
  return getTicketStatus(ticketType, now.value, soldOut.value)
}

const availableTicketTypes = computed(() =>
  // 測試票 only for admins
  ticketTypes.value.filter((ticketType) => isTicketTypeListed(ticketType, now.value, { isAdmin: auth.isAdmin }))
)

function scrollToCollection() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  collectionSection.value?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })
}

async function loadTicketTypes() {
  loadingTicketTypes.value = true
  ticketTypesError.value = false

  try {
    ;[ticketTypes.value, soldOut.value] = await loadStorefront()
  } catch (error) {
    console.error('Load ticket types error:', error)
    ticketTypesError.value = true
    ticketTypes.value = []
    soldOut.value = {}
  } finally {
    loadingTicketTypes.value = false
  }
}

onMounted(loadTicketTypes)
</script>

<style scoped lang="scss">
@import 'src/css/homepage.scss';
</style>
