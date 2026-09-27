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
