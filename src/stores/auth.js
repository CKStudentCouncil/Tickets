import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from 'src/boot/firebase'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const loading = ref(true)

  const isAdmin = computed(() =>
    user.value?.role === 'admin' ||
    user.value?.role === 'super_admin'
  )

  const isSuperAdmin = computed(() =>
    user.value?.role === 'super_admin'
  )

  const isManager = computed(() =>
    ['manager', 'admin', 'super_admin']
      .includes(user.value?.role)
  )

  const isLoggedIn = computed(() => !!user.value)

  let initPromise = null

  function init() {
    if (initPromise) return initPromise

    initPromise = new Promise((resolve) => {

      onAuthStateChanged(auth, async (currentUser) => {

        if (currentUser) {

          try {

            const userRef = doc(db, 'users', currentUser.uid)
            const userDoc = await getDoc(userRef)

            const userData = userDoc.exists()
              ? userDoc.data()
              : {}

            user.value = {
              ...currentUser,
              ...userData
            }

          } catch {

            user.value = {
              ...currentUser,
              role: null
            }

          }

        } else {

          user.value = null

        }

        loading.value = false
        resolve()

      })

    })

    return initPromise
  }

  async function signOut() {
    await firebaseSignOut(auth)
    user.value = null
  }

  return { user, loading, isAdmin, isSuperAdmin, isManager, isLoggedIn, init, signOut }
})
