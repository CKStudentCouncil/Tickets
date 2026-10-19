import posthog from 'posthog-js'

// PostHog (US cloud). Off unless PUBLIC_POSTHOG_KEY is set at build time.
const KEY = import.meta.env.PUBLIC_POSTHOG_KEY
let started = false

export function initAnalytics({ recordSessions = true } = {}) {
  if (!KEY || started || typeof window === 'undefined') return
  started = true
  posthog.init(KEY, {
    api_host: 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    // staff pages show buyers' personal data: never record them
    disable_session_recording: !recordSessions,
    capture_pageview: true
  })
}

export function identifyUser(user) {
  if (!started) return
  if (user?.uid) posthog.identify(user.uid, { role: user.role || 'buyer' })
  else posthog.reset()
}

// Same event names and parameters as the old Firebase Analytics events
export function trackEvent(eventName, params = {}) {
  if (started) posthog.capture(eventName, params)
}
