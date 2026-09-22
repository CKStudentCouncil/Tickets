<template>
  <div class="app-shell">
    <header class="site-header">
      <router-link to="/" class="brand" aria-label="建中舞會購票系統首頁">
        <img src="../../public/cksclogo.png" alt="建中舞會購票系統 Logo" class="brand-mark" />
        <span>建中舞會購票系統</span>
      </router-link>

      <div class="header-actions">
        <router-link to="/about" class="about-link" aria-label="關於我們">
          About
        </router-link>
        <router-link to="/story" class="story-link" aria-label="舞會故事">
          Story
        </router-link>
        <router-link to="/orders" class="order-link" aria-label="我的訂單">
          Tickets
        </router-link>

        <div class="menu-wrapper">
          <button
            class="menu-toggle"
            type="button"
            aria-label="切換導覽選單"
            aria-haspopup="true"
            :aria-expanded="menuOpen"
            @click.stop="menuOpen = !menuOpen"
          >
            <q-icon name="menu" size="1.3rem" />
          </button>

          <nav class="primary-nav" :class="{ open: menuOpen }" aria-label="主要導覽">
            <router-link to="/" exact-active-class="is-active" @click="menuOpen = false">首頁</router-link>
            <router-link to="/orders" active-class="is-active" @click="menuOpen = false">已購門票</router-link>
            <router-link to="/about" active-class="is-active" @click="menuOpen = false">關於我們</router-link>

            <div class="nav-divider" role="separator" />

            <router-link to="/terms" @click="menuOpen = false">
              使用者條款
            </router-link>

            <!--<router-link to="/policy" @click="menuOpen = false">
              銷售與退貨條款
            </router-link>-->

            <router-link to="/survey" @click="menuOpen = false">
              使用者問卷
            </router-link>

            <router-link
              v-if="auth.isManager && !auth.isAdmin"
              to="/admin"
              @click="menuOpen = false"
            >
              通知管理
            </router-link>

            <router-link
              v-if="auth.isAdmin"
              to="/admin"
              @click="menuOpen = false"
            >
              後台管理
            </router-link>

            <router-link
              v-if="auth.isSuperAdmin"
              to="/admin/account"
              @click="menuOpen = false"
            >
              帳號管理
            </router-link>

            <router-link
              v-if="auth.isManager"
              to="/admin/survey"
              @click="menuOpen = false"
            >
              問卷管理
            </router-link>

            <router-link
              v-if="!auth.isLoggedIn"
              to="/admin/login"
              @click="menuOpen = false"
            >
              幹部登入
            </router-link>

            <button
              v-if="auth.isManager || auth.isSuperAdmin || auth.isAdmin"
              type="button"
              @click="handleSignOut"
            >
              登出
            </button>
          </nav>
        </div>
      </div>
    </header>

    <main class="page-container">
      <router-view v-if="!auth.loading" :key="$route.fullPath" />
      <div v-else class="loading-screen" role="status">正在為你準備商品…</div>
    </main>

    <footer class="site-footer">
      <div class="footer-grid">
        <div class="footer-col">
          <p class="footer-heading">Navigation</p>
          <nav class="footer-links">
            <router-link to="/">首頁</router-link>
            <router-link to="/orders">我的訂單</router-link>
            <router-link to="/about">關於我們</router-link>
            <router-link to="/survey">使用者問卷</router-link>
          </nav>
        </div>

        <div class="footer-col">
          <p class="footer-heading">Legal</p>
          <nav class="footer-links">
            <router-link to="/terms">使用者條款</router-link>
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
          <p class="footer-meta">Developed by Chris Sun and Jim Tang</p>
        </div>
      </div>
      <div class="footer-bottom">
        <span>© <span class="num">{{ currentYear }}</span> CK Tickets. All rights reserved.</span>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from 'src/stores/auth'
import { useCartStore } from 'src/stores/cart'
import { useToastStore } from 'src/stores/toast'

const router = useRouter()
const auth = useAuthStore()
const cart = useCartStore()
const toast = useToastStore()

const menuOpen = ref(false)
const currentYear = computed(() => new Date().getFullYear())

const itemCount = computed(() =>
  cart.cartItems.reduce((total, item) => total + item.quantity, 0)
)

function closeMenu() {
  menuOpen.value = false
}

function handleClickOutside(event) {
  const menu = document.querySelector('.menu-wrapper')

  if (menu && !menu.contains(event.target)) {
    closeMenu()
  }
}

onMounted(() => {
  if (auth.loading) auth.init()

  document.addEventListener(
    'click',
    handleClickOutside
  )
})

onBeforeUnmount(() => {
  document.removeEventListener(
    'click',
    handleClickOutside
  )
})

async function handleSignOut() {
  await auth.signOut()
  menuOpen.value = false

  toast.show('Logged out')
  router.push('/')
}
</script>

<style scoped>
@import 'src/css/mainlayout.scss';
</style>