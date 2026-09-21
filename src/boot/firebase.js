import { boot } from 'quasar/wrappers'
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getAnalytics, isSupported } from 'firebase/analytics'

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
export const storage = getStorage(app)

export let analytics
isSupported().then((yes) => {
  if (yes) analytics = getAnalytics(app)
})

export default boot(() => {})
