import { boot } from 'quasar/wrappers'
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

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

export const auth = getAuth(app)
export const db = getFirestore(app)

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

  if (document.readyState === 'complete') later()
  else window.addEventListener('load', later, { once: true })
})

export const functions = getFunctions(app, 'asia-east1')

export default boot(() => {})
