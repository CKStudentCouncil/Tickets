import { boot } from 'quasar/wrappers'
import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'

// `yarn test:site` runs the site against local Firebase emulators with test
// data (scripts/test-site.mjs), so nothing touches the live project
const EMULATORS = process.env.FIREBASE_EMULATORS === 'true'

const firebaseConfig = EMULATORS ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-cksc-ticket', appId: 'demo-app' } : {
  apiKey: 'AIzaSyDpURP6Src9JzM5nttBCpA9eCllwRobJtc',
  authDomain: 'cksc-ticket.firebaseapp.com',
  projectId: 'cksc-ticket',
  storageBucket: 'cksc-ticket.firebasestorage.app',
  messagingSenderId: '612340629816',
  appId: '1:612340629816:web:eec6974f9164564d6481cd',
  measurementId: 'G-38C5F865D4'
}

export const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app, 'asia-east1')

if (EMULATORS) {
  const host = window.location.hostname
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8080)
  connectFunctionsEmulator(functions, host, 5001)
}

// Analytics pulls in Google's gtag script (~160 KB), so it starts only a few
// seconds after the page has loaded instead of competing with it. Resolves to
// null where the browser doesn't support it (src/utils/analytics.js).
const ANALYTICS_DELAY_MS = 3000

export const analyticsReady = new Promise((resolve) => {
  const start = () =>
    import('firebase/analytics')
      .then(async ({ getAnalytics, isSupported }) => resolve((await isSupported()) ? getAnalytics(app) : null))
      .catch(() => resolve(null))
  const later = () => setTimeout(start, ANALYTICS_DELAY_MS)

  if (EMULATORS) resolve(null)
  else if (document.readyState === 'complete') later()
  else window.addEventListener('load', later, { once: true })
})

export default boot(() => {})
