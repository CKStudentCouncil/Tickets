import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { client, unwrap } from 'src/api'
import { isSchoolAccount as isSchoolEmail, SCHOOL_ACCOUNT_DOMAIN } from 'src/data/schools'
import { identifyUser } from 'src/utils/analytics'

const ROLE_RANK = { manager: 1, admin: 2, super_admin: 3 }

export const useAuthStore = defineStore('auth', () => {
  // { uid, email, displayName, photoURL, name (staff name), role }
  const user = ref(null)
  const loading = ref(true)

  const role = computed(() => user.value?.role || null)
  const hasRole = (minRole) =>
    (Object.hasOwn(ROLE_RANK, role.value) ? ROLE_RANK[role.value] : 0) >= ROLE_RANK[minRole]

  const isManager = computed(() => hasRole('manager'))
  const isAdmin = computed(() => hasRole('admin'))
  const isSuperAdmin = computed(() => hasRole('super_admin'))
  const isLoggedIn = computed(() => !!user.value)

  // Everyone signs in with Google to buy; 本校學生 tickets need a school account
  const email = computed(() => user.value?.email || '')
  const isSchoolAccount = computed(() => isSchoolEmail(email.value))

  // Name recorded on orders / content edited by this staff member
  const displayName = computed(
    () => user.value?.name || user.value?.displayName || user.value?.email || '管理員'
  )

  // A slower, older load must not overwrite a newer one
  let loadSeq = 0

  async function loadUser() {
    const seq = ++loadSeq
    try {
      const { user: me } = await unwrap(client.me.$get())
      if (seq === loadSeq) user.value = me
    } catch (error) {
      console.error('Load session error:', error)
      if (seq === loadSeq) user.value = null
    }
    identifyUser(user.value)
  }

  let initPromise = null

  function init() {
    if (!initPromise) {
      initPromise = loadUser().finally(() => {
        loading.value = false
      })
    }
    return initPromise
  }

  async function refresh() {
    await init()
    await loadUser()
  }

  // Google sign-in through Better Auth: the page leaves for Google and comes
  // back to `callbackURL` signed in. `school` hints Google to the school
  // domain (still checked by the checkout for campus tickets).
  async function signIn({ school = false, callbackURL = '/' } = {}) {
    const response = await fetch('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'google',
        callbackURL,
        errorCallbackURL: `/login?error=1&redirect=${encodeURIComponent(callbackURL)}`,
        ...(school ? { additionalParams: { hd: SCHOOL_ACCOUNT_DOMAIN } } : {})
      })
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body?.url) throw Object.assign(new Error(body?.message || '無法開始 Google 登入'), { code: 'auth/start-failed' })
    window.location.assign(body.url)
  }

  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    user.value = null
    identifyUser(null)
  }

  return {
    user,
    loading,
    role,
    isManager,
    isAdmin,
    isSuperAdmin,
    isLoggedIn,
    email,
    isSchoolAccount,
    displayName,
    init,
    refresh,
    signIn,
    signOut
  }
})
