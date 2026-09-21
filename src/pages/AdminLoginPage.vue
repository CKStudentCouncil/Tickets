<template>
  <div class="auth-page">
    <div class="auth-shell">
      <header class="auth-header">
        <p class="eyebrow">Account</p>
        <h1>Sign In</h1>
        <p class="auth-subtitle">Staff Only</p>
      </header>

  <div class="auth-card">
    <!--
      <div v-if="isInLineApp" class="notice">
        <p class="notice-title">LINE 用戶請注意</p>
        <p>請改用外部瀏覽器開啟（例如 Safari、Chrome），否則將無法完成登入</p>
        <button type="button" class="notice-btn" @click="openExternal">
          開啟外部瀏覽器
        </button>
      </div>

      <div class="notice">
        <p class="notice-title">CK APP 用戶請注意</p>
        <p>請改用外部瀏覽器開啟（例如 Safari、Chrome），否則將無法完成登入</p>
        <button type="button" class="notice-btn" @click="openExternal">
          開啟外部瀏覽器
        </button>
      </div>
    -->

    <button
      type="button"
      class="google-btn"
      :disabled="isLoading"
      @click="handleGoogleAuth"
    >
      <template v-if="isLoading">
        <span class="google-spinner" />
        處理中...
      </template>
      <template v-else>
        <svg class="google-icon" viewBox="0 0 48 48">
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
        Sign in with Google
      </template>
    </button>

    <label class="terms-label">
      <input v-model="agree" type="checkbox">
      我已閱讀並同意 <router-link to="/terms">使用者條款</router-link>
    </label>
  </div>
</div>

  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult
} from 'firebase/auth'
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs
} from 'firebase/firestore'
import { auth, db } from 'src/boot/firebase'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const toast = useToastStore()

const agree = ref(false)
const isLoading = ref(false)
const isInLineApp = ref(false)

function isLineApp() {
  const ua = navigator.userAgent.toLowerCase()
  return ua.includes('line/') || ua.includes('liff/')
}

function openExternal() {
  window.open('https://souvenir.cksc.tw', '_blank')
}

async function linkUserAccount(user) {
  const userRef = doc(db, 'users', user.uid)
  const existingSnap = await getDoc(userRef)

  if (existingSnap.exists()) {
    const data = existingSnap.data()
    await setDoc(
      userRef,
      {
        email: user.email,
        displayName: user.displayName || data.displayName || '',
        photoURL: user.photoURL || '',
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    )
    return data.role || null
  }

  const email = (user.email || '').toLowerCase()
  const pendingQuery = query(
    collection(db, 'pendingUsers'),
    where('email', '==', email)
  )
  const pendingSnap = await getDocs(pendingQuery)

  if (pendingSnap.empty) {
    return null
  }

  const pendingDoc = pendingSnap.docs[0]
  const pendingData = pendingDoc.data()

  await setDoc(userRef, {
    email,
    displayName: user.displayName || pendingData.name || '',
    photoURL: user.photoURL || '',
    name: pendingData.name || '',
    role: pendingData.role,
    uid: user.uid,
    pending: false,
    createdAt: pendingData.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })
  await deleteDoc(
    doc(
      db,
      'pendingUsers',
      pendingDoc.id
    )
  )
  return pendingData.role
}

async function afterLogin(user) {
  const role = await linkUserAccount(user)
  await authStore.init()

  if (!role || !['super_admin', 'admin', 'manager'].includes(role)) {
    toast.show('此帳號尚未被授權，請聯繫系統管理員新增帳號')
    await authStore.signOut()
    return
  }

  toast.show('登入成功！')
  const fallback = role === 'manager' ? '/scan' : '/admin'
  const redirect = route.query.redirect || fallback
  router.replace(String(redirect))
}

onMounted(async () => {
  isInLineApp.value = isLineApp()
  try {
    isLoading.value = true
    const result = await getRedirectResult(auth)
    if (result?.user) await afterLogin(result.user)
  } catch (error) {
    console.error('Redirect result error:', error)
    if (error.code === 'auth/account-exists-with-different-credential') {
      toast.show('此帳號已使用其他方式註冊')
    } else if (error.code === 'auth/popup-closed-by-user') {
      toast.show('登入已取消')
    } else {
      toast.show('Google 認證失敗，請重試')
    }
  } finally {
    isLoading.value = false
  }
})

async function handleGoogleAuth() {
  if (!agree.value) {
    toast.show('請先閱讀並同意使用者條款')
    return
  }

  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })

  try {
    isLoading.value = true
    if (isInLineApp.value) {
      await signInWithRedirect(auth, provider)
    } else {
      const result = await signInWithPopup(auth, provider)
      await afterLogin(result.user)
      isLoading.value = false
    }
  } catch (error) {
    console.error('Google Auth error:', error)
    if (error.code === 'auth/popup-closed-by-user') {
      toast.show('Google 登入被取消')
    } else if (error.code === 'auth/popup-blocked') {
      toast.show('彈出視窗被阻擋，請允許彈出視窗後重試')
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      toast.show('此帳號已使用其他方式註冊')
    } else if (error.code !== 'auth/cancelled-popup-request') {
      toast.show('Google 認證失敗，請重試')
    }
    isLoading.value = false
  }
}
</script>

<style scoped>
@import 'src/css/adminloginpage.scss';
</style>