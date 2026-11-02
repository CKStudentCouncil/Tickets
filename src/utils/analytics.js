import { analyticsReady } from 'src/boot/firebase'

// Firebase Analytics (src/boot/firebase.js), which loads a few seconds after
// the page; events sent before then wait for it. Skipped where the browser
// doesn't support it.
export function trackEvent(eventName, params = {}) {
  analyticsReady.then(async (analytics) => {
    if (!analytics) return
    const { logEvent } = await import('firebase/analytics')
    logEvent(analytics, eventName, params)
  })
}
