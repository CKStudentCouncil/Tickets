<template>
  <div class="login-page">
    <section class="login-card">
      <p class="eyebrow">CK Tickets · Sign in</p>
      <h1>登入</h1>
      <p class="lead">購票、查看訂單與入場 QR Code 都需要先登入 Google 帳號</p>

      <div v-if="inAppBrowser" class="notice" role="alert">
        <p class="notice-title">{{ inAppBrowser }} 內建瀏覽器無法使用 Google 登入</p>
        <p>請改用 Safari 或 Chrome 開啟本頁：點右上角「⋯」選擇「在瀏覽器中開啟」，或複製連結後貼到瀏覽器。</p>
        <div class="notice-actions">
          <a v-if="externalUrl" :href="externalUrl" class="notice-btn">用瀏覽器開啟</a>
          <button type="button" class="notice-btn" @click="copyLink">複製連結</button>
        </div>
      </div>

      <p v-if="wantsSchoolAccount" class="school-hint">
        如若要購買早鳥票或一售票，請使用建中帳號（@{{ SCHOOL_ACCOUNT_DOMAIN }}）登入。
      </p>

      <div class="sign-in-options">
        <button
          v-for="option in SIGN_IN_OPTIONS"
          :key="option.mode"
          type="button"
          class="google-btn"
          :class="{ recommended: option.mode === 'school' && wantsSchoolAccount }"
          :disabled="!!loadingMode"
          @click="signIn(option.mode)"
        >
          <span v-if="loadingMode === option.mode" class="google-spinner" />
          <svg v-else class="google-icon" viewBox="0 0 48 48" aria-hidden="true">
            <path
              d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
              fill="#4285F4"
            />
            <path
              d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
              fill="#34A853"
            />
            <path
              d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
              fill="#FBBC05"
            />
            <path
              d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
              fill="#EA4335"
            />
          </svg>

          <span class="btn-text">
            <strong>{{ option.title }}</strong>
            <small>{{ option.hint }}</small>
          </span>
        </button>
      </div>

      <label class="consent">
        <input v-model="agree" type="checkbox">
        <span>
          我已閱讀並同意
          <router-link to="/terms" target="_blank">使用者條款</router-link>
        </span>
      </label>

      <ul class="login-notes">
        <li>
          早鳥票、一售票限建中在學學生購買，必須以
          <span class="mono">@{{ SCHOOL_ACCOUNT_DOMAIN }}</span> 帳號登入。
        </li>
        <li>訂單確認信會寄到你登入的 Google 帳號信箱，之後用同一個帳號登入即可查看訂單。</li>
        <li>建班及友校幹部請使用已開通權限的 Google 帳號登入，登入後即可進入後台。</li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { SCHOOL_ACCOUNT_DOMAIN, isSchoolAccount } from 'src/data/schools'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { safeRedirect } from 'src/utils/redirect'

const SIGN_IN_OPTIONS = [
  { mode: 'school', title: '使用建中帳號登入', hint: `@${SCHOOL_ACCOUNT_DOMAIN}・可購買本校學生票` },
  { mode: 'any', title: '使用其他 Google 帳號登入', hint: '友校學生、家長、老師與校外人士' }
]

// Google refuses to sign in inside app webviews (disallowed_useragent)
const IN_APP_BROWSERS = [
  ['LINE', /\bLine\//i],
  ['Instagram', /Instagram/i],
  ['Facebook', /FBAN|FBAV|FB_IAB/i],
  ['Threads', /Barcelona/i],
  ['WeChat', /MicroMessenger/i]
]

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const toast = useToastStore()
const agree = ref(false)
const loadingMode = ref('')

// set by the product page of a 本校學生 ticket
const wantsSchoolAccount = route.query.account === 'school'

const userAgent = navigator.userAgent
const inAppBrowser = IN_APP_BROWSERS.find(([, pattern]) => pattern.test(userAgent))?.[0] || ''

// LINE opens links with openExternalBrowser=1 in the phone's browser, and
// Android can hand the page to Chrome; elsewhere the buyer copies the link
function getExternalUrl() {
  if (!inAppBrowser) return ''
  const url = new URL(window.location.href)
  if (inAppBrowser === 'LINE') {
    url.searchParams.set('openExternalBrowser', '1')
    return url.toString()
  }
  if (/Android/i.test(userAgent)) {
    return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;end`
  }
  return ''
}
const externalUrl = getExternalUrl()

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    toast.show('已複製連結，請貼到 Safari 或 Chrome 開啟')
  } catch {
    toast.show('無法自動複製，請手動複製網址列的連結')
  }
}

const redirectTarget = () => (typeof route.query.redirect === 'string' ? route.query.redirect : '')

// Back from Google (/login?done=<mode>): an invited staff member got their
// role on the server as the session was created.
async function afterLogin(mode) {
  await authStore.refresh()
  if (!authStore.isLoggedIn) {
    toast.show('Google 登入失敗，請重試')
    return
  }
  if (mode === 'school' && !isSchoolAccount(authStore.email)) {
    toast.show(`${authStore.email} 不是 @${SCHOOL_ACCOUNT_DOMAIN} 帳號，無法購買本校學生票`)
  } else {
    toast.show(authStore.isManager ? '登入成功，歡迎回來' : '登入成功')
  }
  await router.replace(safeRedirect(redirectTarget(), authStore.isManager ? '/admin' : '/'))
}

onMounted(() => {
  if (route.query.done) afterLogin(String(route.query.done))
  else if (route.query.error) toast.show('Google 登入失敗或已取消，請重試')
})

async function signIn(mode) {
  if (loadingMode.value) return
  if (!agree.value) {
    toast.show('請先閱讀並同意使用者條款')
    return
  }

  loadingMode.value = mode
  try {
    const params = new URLSearchParams({ done: mode, ...(redirectTarget() ? { redirect: redirectTarget() } : {}) })
    // hd only narrows Google's account list; the checkout checks the domain again
    await authStore.signIn({ school: mode === 'school', callbackURL: `/login?${params}` })
  } catch (error) {
    console.error('Google Auth error:', error)
    toast.show('Google 登入失敗，請重試')
    loadingMode.value = ''
  }
}
</script>

<style scoped>
@import 'src/css/loginpage.scss';
</style>
