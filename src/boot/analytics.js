import { boot } from 'quasar/wrappers'

const MEASUREMENT_ID = 'G-38C5F865D4'

export const trackEvent = (eventName, params = {}) => {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', eventName, params)
  }
}

export default boot(({ router }) => {
  router.afterEach((to) => {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', {
        page_title: to.meta.title || document.title,
        page_location: window.location.href,
        page_path: to.fullPath,
        send_to: MEASUREMENT_ID
      })
    }
  })
})