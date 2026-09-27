import { logEvent } from 'firebase/analytics'
import { analytics } from 'src/boot/firebase'

// Firebase Analytics (src/boot/firebase.js); skipped where the browser
// doesn't support it or it hasn't loaded yet
export function trackEvent(eventName, params = {}) {
  if (analytics) logEvent(analytics, eventName, params)
}
