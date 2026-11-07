import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from 'src/boot/firebase'
import { accountSchoolOf, isEduAccount as isEduEmail, isSchoolAccount as isSchoolEmail } from 'src/data/schools'
import { isOnSellerList } from 'src/services/sellerService'
import { isOnOfficerList } from 'src/services/guestService'
import { activateStaffInvite, fetchStaffInvite, startedActivation } from 'src/services/staffAccountService'
import { ROLE_RANK } from 'src/data/roles'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const loading = ref(true)

  const role = computed(() => user.value?.role || null)
  const hasRole = (minRole) =>
    (Object.hasOwn(ROLE_RANK, role.value) ? ROLE_RANK[role.value] : 0) >= ROLE_RANK[minRole]

  const isManager = computed(() => hasRole('manager'))
  const isAdmin = computed(() => hasRole('admin'))
  const isSuperAdmin = computed(() => hasRole('super_admin'))
  const isDeveloper = computed(() => hasRole('developer'))
  const isLoggedIn = computed(() => !!user.value)
  // on the 學弟登記賣票 list (sellers/{email}), kept by super admins
  const isSeller = computed(() => user.value?.isSeller === true)
  // on the 公關票 officer list (officers/{email}), kept by super admins
  const isOfficer = computed(() => user.value?.isOfficer === true)

  // Everyone signs in with Google to buy; 本校學生 tickets need a school account
  const email = computed(() => user.value?.email || '')
  const isSchoolAccount = computed(() => isSchoolEmail(email.value))
  // 學生 tickets need any school's account (edu.tw)
  const isEduAccount = computed(() => isEduEmail(email.value))
  // 建國中學 or the 友校 whose student account this is ('' for others);
  // 僅限建中及友校 tickets need one
  const accountSchool = computed(() => accountSchoolOf(email.value))

  // Name recorded on orders / content edited by this staff member
  const displayName = computed(
    () => user.value?.name || user.value?.displayName || user.value?.email || '管理員'
  )

  // the last staff invite of this account that could not be activated
  // (e.g. permission-denied); the login page tells the person
  const inviteError = ref(null)

  // A slower, older load must not overwrite a newer one (e.g. the auth
  // listener finishing after refresh() on first login).
  let loadSeq = 0

  // users/{uid} for an account that has none yet: an invited staff member
  // gets theirs now, also one who was already signed in when invited, since
  // a signed-in account never sees the login page (src/router/index.js).
  // null for buyers, or when activating fails; they carry on as buyers.
  async function activateInvite(firebaseUser, invite) {
    try {
      const started = startedActivation(firebaseUser.uid)
      const profile = started ? await started : invite ? await activateStaffInvite(firebaseUser, invite) : null
      inviteError.value = null
      return profile
    } catch (error) {
      console.error('Staff invite activation error:', error)
      inviteError.value = error
      return null
    }
  }

  async function loadUser(firebaseUser) {
    const seq = ++loadSeq

    if (!firebaseUser) {
      user.value = null
      inviteError.value = null
      return
    }

    const base = {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      photoURL: firebaseUser.photoURL
    }

    try {
      // the invite is asked for alongside, not after, so a buyer's sign-in
      // doesn't load any slower; staff have no invite left
      const [userDoc, invite, isSeller, isOfficer] = await Promise.all([
        getDoc(doc(db, 'users', firebaseUser.uid)),
        fetchStaffInvite(firebaseUser.email),
        firebaseUser.email ? isOnSellerList(firebaseUser.email) : false,
        firebaseUser.email ? isOnOfficerList(firebaseUser.email) : false
      ])
      const profile = userDoc.exists() ? userDoc.data() : await activateInvite(firebaseUser, invite)
      // uid and email always come from the signed-in account: the rules
      // compare against request.auth, not whatever the users doc holds
      if (seq === loadSeq) {
        user.value = {
          ...base,
          ...(profile || {}),
          uid: base.uid,
          email: base.email,
          isSeller,
          isOfficer
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
    isDeveloper,
    isLoggedIn,
    isSeller,
    isOfficer,
    inviteError,
    email,
    isSchoolAccount,
    isEduAccount,
    accountSchool,
    displayName,
    init,
    refresh,
    signOut
  }
})
