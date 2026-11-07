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
      <p v-else-if="wantsFriendAccount" class="school-hint">
        此票種限建中及友校學生購買，請使用建中帳號，或選「使用友校帳號登入」後選擇你的學校。
      </p>
      <p v-else-if="wantsEduAccount" class="school-hint">
        學生優先購買期間須使用學校帳號（Email 結尾為 edu.tw）登入。建中同學請用建中帳號，友校同學請選「使用友校帳號登入」，其他學校同學請選「使用其他 Google 帳號登入」並選擇學校帳號。
        無法使用學校帳號的話，也可以用一般帳號登入，在票券頁填寫學生切結後購買。
      </p>

      <div class="sign-in-options">
        <template v-for="option in SIGN_IN_OPTIONS" :key="option.mode">
          <button
            type="button"
            class="google-btn"
            :class="{ recommended: isRecommended(option.mode) }"
            :disabled="!!loadingMode"
            :aria-expanded="option.mode === 'friend' ? friendPickerOpen : undefined"
            :aria-controls="option.mode === 'friend' ? 'friend-school-list' : undefined"
            @click="option.mode === 'friend' ? (friendPickerOpen = !friendPickerOpen) : signIn(option.mode)"
          >
            <span v-if="loadingMode === option.mode && option.mode !== 'friend'" class="google-spinner" />
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

            <svg
              v-if="option.mode === 'friend'"
              class="expand-icon"
              :class="{ open: friendPickerOpen }"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" />
            </svg>
          </button>

          <div
            v-if="option.mode === 'friend' && friendPickerOpen"
            id="friend-school-list"
            class="friend-schools"
            role="group"
            aria-label="選擇你的學校"
          >
            <button
              v-for="school in FRIEND_SCHOOLS"
              :key="school"
              type="button"
              class="friend-school-btn"
              :disabled="!!loadingMode"
              @click="signIn('friend', school)"
            >
              <span v-if="loadingSchool === school" class="google-spinner small" />
              <span class="btn-text">
                <strong>{{ school }}</strong>
                <small>@{{ FRIEND_SCHOOL_DOMAINS[school] }}</small>
              </span>
            </button>
          </div>
        </template>
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
        <li>{{ FRIEND_SCHOOLS.join('、') }}同學可選「使用友校帳號登入」，以學校帳號登入；標示「限建中及友校在學學生購買」的票種須以建中或友校學校帳號購買。</li>
        <li>部分票種開賣初期為學生優先購買，期間須以學校帳號（Email 結尾為 edu.tw）登入。</li>
        <li>沒有學校帳號，或學校帳號無法完成驗證（例如學校不允許用學校帳號登入外部網站）的學生，可以用一般帳號登入，在票券頁填寫學生切結後購買。</li>
        <li>訂單確認信會寄到你登入的 Google 帳號信箱，之後用同一個帳號登入即可查看訂單。</li>
        <li>建班及友校幹部請使用已開通權限的 Google 帳號登入，登入後即可進入後台。</li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
import { auth } from 'src/boot/firebase'
import {
  FRIEND_SCHOOLS,
  FRIEND_SCHOOL_DOMAINS,
  SCHOOL_ACCOUNT_DOMAIN,
  accountSchoolOf,
  isEduAccount,
  isSchoolAccount
} from 'src/data/schools'
import { updateStaffProfile } from 'src/services/staffAccountService'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { safeRedirect } from 'src/utils/redirect'

// `friend` opens the list of 友校; each signs in with that school's domain
const SIGN_IN_OPTIONS = [
  { mode: 'school', title: '使用建中帳號登入', hint: `@${SCHOOL_ACCOUNT_DOMAIN}・可購買本校學生票` },
  { mode: 'friend', title: '使用友校帳號登入', hint: FRIEND_SCHOOLS.join('、') },
  { mode: 'any', title: '使用其他 Google 帳號登入', hint: '家長、老師、其他學校與校外人士，或無法使用學校帳號者' }
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
// the 友校 being signed in to, while loadingMode is `friend`
const loadingSchool = ref('')

// set by the product page of a 本校學生 ticket, `friend` by a 僅限建中及友校
// ticket, or `edu` by a 學生 ticket
const wantsSchoolAccount = route.query.account === 'school'
const wantsFriendAccount = route.query.account === 'friend'
const wantsEduAccount = route.query.account === 'edu'

const friendPickerOpen = ref(wantsFriendAccount)

function isRecommended(mode) {
  if (mode === 'school') return wantsSchoolAccount || wantsFriendAccount
  return mode === 'friend' && wantsFriendAccount
}

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

async function afterLogin(user, mode, school) {
  // loads the profile of the account just signed in; an invited staff
  // member's account is activated there (stores/auth.js)
  await authStore.refresh()

  const isStaff = authStore.isManager

  if (isStaff) {
    try {
      await updateStaffProfile(user)
    } catch (error) {
      console.error('Staff profile update error:', error)
    }
  }

  if (authStore.inviteError?.code === 'permission-denied') {
    toast.show('幹部帳號授權資料無法驗證，請聯繫舞會總副召')
  } else if (mode === 'school' && !isSchoolAccount(user.email)) {
    toast.show(`${user.email} 不是 @${SCHOOL_ACCOUNT_DOMAIN} 帳號，無法購買本校學生票`)
  } else if (mode === 'friend' && accountSchoolOf(user.email) !== school) {
    toast.show(`${user.email} 不是${school}帳號（@${FRIEND_SCHOOL_DOMAINS[school]}）`)
  } else if (wantsFriendAccount && !accountSchoolOf(user.email)) {
    toast.show(`${user.email} 不是建中或友校帳號，無法購買限建中及友校學生的票種`)
  } else if (wantsEduAccount && !isEduAccount(user.email)) {
    toast.show(`${user.email} 不是學校帳號（edu.tw），學生優先購買期間須在票券頁填寫學生切結才能購買`)
  } else {
    toast.show(isStaff ? '登入成功，歡迎回來' : '登入成功')
  }

  await router.replace(safeRedirect(route.query.redirect, isStaff ? '/admin' : '/'))
}

// `school` is the 友校 chosen for the `friend` mode
async function signIn(mode, school = '') {
  if (loadingMode.value) return

  if (!agree.value) {
    toast.show('請先閱讀並同意使用者條款')
    return
  }

  const provider = new GoogleAuthProvider()
  const hd =
    mode === 'school' ? SCHOOL_ACCOUNT_DOMAIN : mode === 'friend' ? FRIEND_SCHOOL_DOMAINS[school] : ''

  // hd only narrows Google's account list; createOrder checks the domain again
  provider.setCustomParameters(hd ? { prompt: 'select_account', hd } : { prompt: 'select_account' })

  loadingMode.value = mode
  loadingSchool.value = school

  try {
    const { user } = await signInWithPopup(auth, provider)
    await afterLogin(user, mode, school)
  } catch (error) {
    console.error('Google Auth error:', error)

    if (error.code === 'auth/popup-closed-by-user') {
      toast.show('Google 登入已取消')
    } else if (error.code === 'auth/popup-blocked') {
      toast.show('彈出視窗被阻擋，請允許彈出視窗後重試')
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      toast.show('此帳號已使用其他方式註冊')
    } else if (error.code !== 'auth/cancelled-popup-request') {
      toast.show('Google 登入失敗，請重試')
    }
  } finally {
    loadingMode.value = ''
    loadingSchool.value = ''
  }
}
</script>

<style scoped>
@import 'src/css/loginpage.scss';
</style>
