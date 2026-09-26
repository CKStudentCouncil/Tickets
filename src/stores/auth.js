import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from 'src/boot/firebase'

const ROLE_RANK = { manager: 1, admin: 2, super_admin: 3 }

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const loading = ref(true)

  const role = computed(() => user.value?.role || null)
  const hasRole = (minRole) => (ROLE_RANK[role.value] || 0) >= ROLE_RANK[minRole]

  const isManager = computed(() => hasRole('manager'))
  const isAdmin = computed(() => hasRole('admin'))
  const isSuperAdmin = computed(() => hasRole('super_admin'))
  const isLoggedIn = computed(() => !!user.value)

  // Name recorded on orders / content edited by this staff member
  const displayName = computed(
    () => user.value?.name || user.value?.displayName || user.value?.email || '管理員'
  )

  async function loadUser(firebaseUser) {
    if (!firebaseUser) {
      user.value = null
      return
    }

    const base = {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      photoURL: firebaseUser.photoURL
    }

    try {
      const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid))
      user.value = { ...base, ...(userDoc.exists() ? userDoc.data() : {}) }
    } catch {
      user.value = { ...base, role: null }
    }
  }

  let initPromise = null

  function init() {
    if (initPromise) return initPromise

    initPromise = new Promise((resolve) => {
      onAuthStateChanged(auth, async (firebaseUser) => {
        await loadUser(firebaseUser)
        loading.value = false
        resolve()
      })
    })

    return initPromise
  }

  // Re-read the profile, e.g. right after the users doc was created on first login
  async function refresh() {
    await init()
    await loadUser(auth.currentUser)
  }

  async function signOut() {
    await firebaseSignOut(auth)
    user.value = null
  }

  return {
    user,
    loading,
    role,
    isManager,
    isAdmin,
    isSuperAdmin,
    isLoggedIn,
    displayName,
    init,
    refresh,
    signOut
  }
})
