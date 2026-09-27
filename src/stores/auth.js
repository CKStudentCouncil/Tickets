import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from 'src/boot/firebase'
import { isSchoolAccount as isSchoolEmail } from 'src/data/schools'

const ROLE_RANK = { manager: 1, admin: 2, super_admin: 3 }

export const useAuthStore = defineStore('auth', () => {
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

  // A slower, older load must not overwrite a newer one (e.g. the auth
  // listener finishing after refresh() on first login).
  let loadSeq = 0

  async function loadUser(firebaseUser) {
    const seq = ++loadSeq

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
      // uid and email always come from the signed-in account: the rules
      // compare against request.auth, not whatever the users doc holds
      if (seq === loadSeq) {
        user.value = {
          ...base,
          ...(userDoc.exists() ? userDoc.data() : {}),
          uid: base.uid,
          email: base.email
        }
      }
    } catch {
      if (seq === loadSeq) user.value = { ...base, role: null }
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
    email,
    isSchoolAccount,
    displayName,
    init,
    refresh,
    signOut
  }
})
