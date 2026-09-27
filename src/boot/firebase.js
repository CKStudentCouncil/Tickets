import { boot } from 'quasar/wrappers'
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { getFunctions } from 'firebase/functions'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { APP_CHECK_SITE_KEY } from 'src/config/app'

const firebaseConfig = {
  apiKey: 'AIzaSyDpURP6Src9JzM5nttBCpA9eCllwRobJtc',
  authDomain: 'cksc-ticket.firebaseapp.com',
  projectId: 'cksc-ticket',
  storageBucket: 'cksc-ticket.firebasestorage.app',
  messagingSenderId: '612340629816',
  appId: '1:612340629816:web:eec6974f9164564d6481cd',
  measurementId: 'G-38C5F865D4'
}

export const app = initializeApp(firebaseConfig)

// Lets the functions tell requests from this site apart from scripts
if (APP_CHECK_SITE_KEY) {
  // reCAPTCHA only issues tokens on the domains of the key, so `quasar dev`
  // uses a debug token instead, which must be added in Firebase console >
  // App Check > Apps > Manage debug tokens. Until it is, every Firebase call
  // (Google sign-in included) fails with appCheck/fetch-status-error 403.
  // With APP_CHECK_DEBUG_TOKEN set in the shell that runs `quasar dev`, that
  // one token is used everywhere; otherwise each browser profile makes up its
  // own and prints it in the console. process.env.DEV is false in
  // `quasar build`, so production never does this.
  if (process.env.DEV) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = process.env.APP_CHECK_DEBUG_TOKEN || true
  }

  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  })
}

export const auth = getAuth(app)
export const db = getFirestore(app)

export let analytics
isSupported().then((yes) => {
  if (yes) analytics = getAnalytics(app)
})

export const functions = getFunctions(app, 'asia-east1')

export default boot(() => {})
