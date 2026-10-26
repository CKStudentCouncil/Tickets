<template>
  <div class="app-shell">
    <header class="site-header">
      <div class="blur-container" aria-hidden="true">
        <div class="blur-filter" />
        <div class="blur-filter" />
        <div class="blur-filter" />
        <div class="blur-filter" />
        <div class="blur-filter" />
      </div>

      <router-link to="/" class="brand" aria-label="建中舞會購票系統首頁">
        <span>CK Tickets</span>
      </router-link>

      <div class="header-actions">
        <router-link to="/about" class="about-link" aria-label="關於我們">
          About
        </router-link>
        <router-link to="/intro" class="intro-link" aria-label="舞會故事">
          Intro
        </router-link>
        <router-link to="/performer" class="order-link" aria-label="演出陣容">
          Lineup
        </router-link>

        <button
          v-if="!route.meta.isAdminSection"
          class="help-toggle"
          type="button"
          aria-label="購票教學"
          title="購票教學"
          @click="buyGuideOpen = true"
        >
          <CircleQuestionMark :size="18" :stroke-width="1.75" aria-hidden="true" />
        </button>

        <div class="menu-wrapper">
          <button
            ref="menuToggle"
            class="menu-toggle"
            type="button"
            aria-label="切換導覽選單"
            aria-haspopup="true"
            aria-controls="site-menu"
            :aria-expanded="menuOpen"
            @click.stop="toggleMenu"
          >
            <q-icon :name="menuOpen ? 'close' : 'menu'" size="1.3rem" />
          </button>

          <!-- phones: dims the page behind the drawer, a tap closes it -->
          <div class="nav-scrim" :class="{ open: menuOpen }" aria-hidden="true" @click="closeMenu()" />

          <nav
            id="site-menu"
            class="primary-nav"
            :class="{ open: menuOpen }"
            aria-label="主要導覽"
          >
            <div class="nav-head">
              <p class="nav-kicker">CK PARTY NIGHT · 2026</p>
              <button
                ref="menuClose"
                type="button"
                class="nav-close"
                aria-label="關閉選單"
                @click="closeMenu(true)"
              >
                <X :size="18" :stroke-width="1.75" aria-hidden="true" />
              </button>
            </div>

            <!-- the poster's lettering and orbit line, as on the home page -->
            <svg class="nav-wordmark" viewBox="124 1232 818 108" aria-hidden="true" focusable="false">
              <defs>
                <filter id="nav-cosmos-lettering" color-interpolation-filters="sRGB">
                  <feColorMatrix type="matrix" values="
                    1 0 0 0 0
                    0 1 0 0 0
                    0 0 1 0 0
                    .2126 .7152 .0722 0 0
                  " />
                  <feComponentTransfer>
                    <feFuncA type="linear" slope="8" intercept="-5.6" />
                  </feComponentTransfer>
                </filter>
                <clipPath id="nav-cosmos-letters">
                  <rect x="124" y="1232" width="818" height="76" />
                </clipPath>
                <linearGradient id="nav-cosmos-orbit" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0" stop-color="#f2f0e9" stop-opacity="0" />
                  <stop offset="0.5" stop-color="#f2f0e9" stop-opacity="0.85" />
                  <stop offset="1" stop-color="#f2f0e9" stop-opacity="0" />
                </linearGradient>
              </defs>
              <image
                href="/poster.jpg"
                width="1076"
                height="1522"
                filter="url(#nav-cosmos-lettering)"
                clip-path="url(#nav-cosmos-letters)"
              />
              <path
                class="nav-orbit"
                d="M 318 1300 Q 540 1362 762 1300"
                stroke="url(#nav-cosmos-orbit)"
              />
            </svg>

            <div
              v-for="(group, groupIndex) in navGroups"
              :key="group.key"
              class="nav-group"
              :class="{ compact: group.compact }"
              :style="{ '--g': groupIndex }"
            >
              <p class="nav-caption">
                <span>{{ String(groupIndex + 1).padStart(2, '0') }}</span>
                {{ group.caption }}
              </p>
              <div class="nav-links">
                <router-link
                  v-for="link in group.links"
                  :key="link.to"
                  :to="link.to"
                  exact-active-class="is-active"
                  @click="closeMenu()"
                >
                  <span class="nav-label">{{ link.label }}</span>
                  <span v-if="link.en" class="nav-en">{{ link.en }}</span>
                </router-link>
              </div>
            </div>

            <div class="nav-account" :style="{ '--g': navGroups.length }">
              <template v-if="auth.isLoggedIn">
                <button type="button" class="nav-signout" @click="handleSignOut">
                  <span>登出</span>
                  <LogOut :size="16" :stroke-width="1.75" aria-hidden="true" />
                </button>
              </template>

              <router-link
                v-else
                :to="{ name: 'login', query: { redirect: $route.fullPath } }"
                class="nav-signin"
                @click="closeMenu()"
              >
                <span>登入</span>
                <ArrowRight :size="16" :stroke-width="1.75" aria-hidden="true" />
              </router-link>
            </div>
          </nav>
        </div>
      </div>
    </header>

    <main class="page-container">
      <router-view v-if="!auth.loading" :key="$route.fullPath" />
      <div v-else class="loading-screen" role="status">載入中…</div>
    </main>

    <footer class="site-footer">
      <div class="footer-grid">
        <div class="footer-col">
          <p class="footer-heading">Navigation</p>
          <nav class="footer-links">
            <router-link to="/">首頁</router-link>
            <router-link to="/orders">已購門票</router-link>
            <router-link to="/policy">銷售條款</router-link>
            <router-link to="/terms">使用者條款</router-link>
            <router-link to="/survey">使用者問卷</router-link>
          </nav>
        </div>

        <div class="footer-col">
          <p class="footer-heading">Introduction</p>
          <nav class="footer-links">
            <router-link to="/about">關於我們</router-link>
            <router-link to="/intro">舞會介紹</router-link>
            <router-link to="/performer">社團與藝人</router-link>
          </nav>
        </div>

        <div class="footer-col">
          <p class="footer-heading">Links</p>
          <nav class="footer-links">
            <a href="https://cksc.tw" target="_blank">建中班聯會</a>
            <a href="https://cktfgpromo.cksc.tw" target="_blank">建北特約官網</a>
            <a href="https://souvenir.cksc.tw" target="_blank">建中校慶紀念品</a>
            <a href="https://www.instagram.com/cksc.81st/" target="_blank" rel="noopener">CKSC Instagram</a>
            <a href="https://www.instagram.com/ck_party_night/" target="_blank" rel="noopener">CK Party Night Instagram</a>
          </nav>
        </div>

        <div class="footer-col footer-brand">
          <div class="footer-logo">
            <span>建中舞會購票系統</span>
          </div>
          <p class="footer-meta">Taipei Municipal Chien Kuo High School Student Council</p>
          <p class="footer-meta">Developed by Chris Sun, Jim Tang and Dong Chen</p>
        </div>
      </div>
      <div class="footer-bottom text-center">
        <span>© <span class="num">{{ currentYear }}</span> CK Tickets. All rights reserved.</span>
      </div>
    </footer>

    <GuideDialog
      v-model="buyGuideOpen"
      :steps="BUY_GUIDE_STEPS"
      label="購票教學"
      finish-label="我知道了"
      @hide="markGuideSeen(BUY_GUIDE_SEEN_KEY)"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from 'src/stores/auth'
import { useShopStore } from 'src/stores/shop'
import { useToastStore } from 'src/stores/toast'
import { ArrowRight, CircleQuestionMark, LogOut, X } from 'lucide-vue-next'
import { EVENT_DATE, EVENT_VENUE } from 'src/config/app'
import GuideDialog from 'src/components/GuideDialog.vue'
import { BUY_GUIDE_STEPS } from 'src/data/buyGuide'
import { isGuideSeen, markGuideSeen } from 'src/utils/guideSeen'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const shop = useShopStore()
const toast = useToastStore()

// The router guard checks the opening time on the way in. A visitor already
// in the shop goes back to Coming Soon if it turns out to be later: the
// settings arrived after the guard stopped waiting, or a super admin
// postponed the opening.
watch(
  () => route.meta.shop && !auth.isManager && shop.loaded && !shop.isOpenNow,
  (mustLeave) => {
    if (mustLeave) router.replace({ name: 'comingsoon', query: { redirect: route.fullPath } })
  }
)

const menuOpen = ref(false)
const menuToggle = ref(null)
const menuClose = ref(null)

// One list feeds the desktop dropdown and the phone drawer; `en` is the
// drawer's small English label. Every target is a page of its own, so a
// link is marked only on exactly that page.
const navGroups = computed(() => {
  const groups = [
    {
      key: 'explore',
      caption: 'EXPLORE',
      links: [
        { to: '/', label: '首頁', en: 'Home' },
        { to: '/intro', label: '舞會介紹', en: 'Intro' },
        { to: '/performer', label: '社團與藝人', en: 'Lineup' },
        { to: '/about', label: '關於我們', en: 'About' }
      ]
    },
    {
      key: 'tickets',
      caption: 'TICKETS',
      links: [
        { to: '/orders', label: '已購門票', en: 'My Tickets' },
        ...(auth.isSeller ? [{ to: '/sell', label: '登記賣票', en: 'Sell' }] : [])
      ]
    },
    {
      key: 'info',
      caption: 'INFO',
      links: [
        { to: '/policy', label: '銷售條款', en: 'Policy' },
        { to: '/terms', label: '使用者條款', en: 'Terms' },
        { to: '/survey', label: '使用者問卷', en: 'Survey' }
      ]
    }
  ]

  const staff = [
    auth.isManager && { to: '/admin/scan', label: '掃描票券' },
    auth.isSuperAdmin && { to: '/super_admin/analytics', label: '銷售報表' },
    auth.isManager && !auth.isAdmin && { to: '/admin', label: '通知管理' },
    auth.isAdmin && { to: '/admin', label: '後台管理' },
    auth.isSuperAdmin && { to: '/admin/management', label: '票務管理' },
    auth.isSuperAdmin && { to: '/admin/account', label: '帳號管理' },
    auth.isManager && { to: '/admin/survey', label: '問卷管理' },
    auth.isSuperAdmin && { to: '/super_admin/guests', label: '公關票管理' },
    auth.isAdmin && { to: '/admin/sellers', label: '學弟賣票管理' },
    auth.isSuperAdmin && { to: '/admin/intromanagement', label: '舞會介紹管理' },
    auth.isSuperAdmin && { to: '/admin/performer', label: '社團與藝人管理' }
  ].filter(Boolean)

  if (staff.length) groups.push({ key: 'staff', caption: 'STAFF', links: staff, compact: true })
  return groups
})

// 購票教學 opens by itself on a device's first visit to the shop side
const BUY_GUIDE_SEEN_KEY = 'cksc.buyGuideSeen'
const buyGuideOpen = ref(false)
watch(
  () => !auth.loading && !!route.name && !route.meta.isAdminSection,
  (ready) => {
    if (ready && !isGuideSeen(BUY_GUIDE_SEEN_KEY)) buyGuideOpen.value = true
  },
  { immediate: true }
)
const currentYear = computed(() => new Date().getFullYear())

const isPhone = () => window.matchMedia('(max-width: 640px)').matches

async function toggleMenu() {
  menuOpen.value = !menuOpen.value

  // the drawer covers the toggle, so focus moves to its close button
  if (menuOpen.value && isPhone()) {
    await nextTick()
    menuClose.value?.focus({ preventScroll: true })
  }
}

// `restoreFocus` hands focus back to the toggle (close button, Escape)
function closeMenu(restoreFocus = false) {
  if (!menuOpen.value) return
  menuOpen.value = false
  if (restoreFocus) menuToggle.value?.focus({ preventScroll: true })
}

function handleClickOutside(event) {
  const menu = document.querySelector('.menu-wrapper')

  if (menu && !menu.contains(event.target)) {
    closeMenu()
  }
}

function handleKeydown(event) {
  if (event.key === 'Escape' && menuOpen.value) closeMenu(true)
}

// the page behind the phone drawer stays put (app.scss: html.menu-open)
watch(menuOpen, (open) => {
  document.documentElement.classList.toggle('menu-open', open)
})

watch(() => route.fullPath, () => closeMenu())

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeydown)
  document.documentElement.classList.remove('menu-open')
})

async function handleSignOut() {
  await auth.signOut()
  closeMenu()

  toast.show('已登出')
  router.push('/')
}
</script>

<style scoped>
@import 'src/css/mainlayout.scss';
</style>
