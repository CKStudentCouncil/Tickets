<template>
  <div class="app-shell">
    <header class="site-header">
      <router-link to="/" class="brand" aria-label="建中紀念品首頁">
        <img src="../../public/cksclogo.png" alt="CK Souvenir Logo" class="brand-mark" />
        <span>CK Souvenir 2.0</span>
      </router-link>

      <nav class="primary-nav" aria-label="主要導覽">
        <router-link to="/" exact-active-class="is-active">首頁</router-link>
        <router-link to="/orders" active-class="is-active">我的訂單</router-link>
        <router-link to="/about" active-class="is-active">關於我們</router-link>
      </nav>

      <div class="header-actions">
        <router-link to="/cart" class="bag-link" aria-label="開啟購物袋">
          <q-icon name="shopping_bag" size="1.2rem" />
          <span class="bag-label">購物袋</span>
          <span v-if="itemCount" class="bag-count">{{ itemCount }}</span>
        </router-link>
        <div class="menu-wrapper">
          <button
            class="more-button"
            type="button"
            aria-label="更多選項"
            @click.stop="menuOpen = !menuOpen"
          >
            <q-icon name="more_horiz" size="1.35rem" />
          </button>

          <div v-if="menuOpen" class="menu-popover"></div>
        </div>
      </div>

      <div v-if="menuOpen" class="menu-popover">
        <router-link to="/terms" @click="menuOpen = false">
          使用者條款
        </router-link>

        <router-link to="/policy" @click="menuOpen = false">
          銷售與退貨條款
        </router-link>

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
          訂單管理
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
            <router-link to="/policy">銷售與退貨條款</router-link>
          </nav>
        </div>
  
        <div class="footer-col">
          <p class="footer-heading">Links</p>
          <nav class="footer-links">
            <a href="https://cksc.tw" target="_blank">建中班聯會</a>
            <a href="https://cktfgpromo.cksc.tw" target="_blank">建北特約官網</a>
              <div class="footer-social">
              <a
                href="https://www.instagram.com/cksc.81st/"
                target="_blank"
                rel="noopener"
                aria-label="Instagram"
                class="social-icon"
              >
                <svg class="ig-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2.5" y="2.5" width="19" height="19" rx="5" stroke="currentColor" stroke-width="1.6"/>
                <circle cx="12" cy="12" r="4.4" stroke="currentColor" stroke-width="1.6"/>
                <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor"/>
              </svg>
              </a>
            </div>
          </nav>
        </div>
  
        <div class="footer-col footer-brand">
          <div class="footer-logo">
            <span>CK Souvenir</span>
          </div>
          <p class="footer-meta">Taipei Municipal Chien Kuo High School Student Council</p>
          <p class="footer-meta">Developed by Chris Sun and Jim Tang</p>
        </div>
      </div> 
      <div class="footer-bottom">
        <span>© <span class="num">{{ currentYear }}</span> CK Souvenir. All rights reserved.</span>
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