import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { SHOP_OPEN_AT } from 'src/config/app'
import { watchShopSettings } from 'src/services/shopService'
import { isPublished, parseDate } from 'src/utils/datetime'

// Don't hold up navigation forever if Firestore can't be reached
const INIT_TIMEOUT_MS = 5000
const MAX_RETRY_MS = 60000

export const useShopStore = defineStore('shop', () => {
  // settings/shop.openAt, kept live so "立即開賣" reaches open pages at once
  const savedOpenAt = ref(null)
  // true once settings/shop has actually been read
  const loaded = ref(false)
  // true once navigation may go ahead: loaded, or gave up waiting for it
  const ready = ref(false)
  const now = ref(new Date())

  const customOpenAt = computed(() => parseDate(savedOpenAt.value))
  // Falls back to the built-in default until a super admin sets a time
  const openAt = computed(() => customOpenAt.value || SHOP_OPEN_AT)
  const isCustomised = computed(() => !!customOpenAt.value)

  function isOpen(at = new Date()) {
    return isPublished(openAt.value, at)
  }

  // Follows the clock, so pages react when the shop opens or the opening
  // time moves. Only changes of the boolean reach watchers and templates.
  const isOpenNow = computed(() => isOpen(now.value))

  let initPromise = null
  let retryMs = 5000

  // A listener stops for good after an error, so it is started again;
  // otherwise a page that loaded with the default time would never learn
  // the real one.
  function listen(onSettled) {
    watchShopSettings(
      (data) => {
        savedOpenAt.value = data.openAt || null
        loaded.value = true
        retryMs = 5000
        onSettled()
      },
      (error) => {
        console.error('Load shop settings error:', error)
        onSettled()
        setTimeout(() => listen(() => {}), retryMs)
        retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
      }
    )
  }

  function init() {
    if (initPromise) return initPromise

    setInterval(() => {
      now.value = new Date()
    }, 1000)

    initPromise = new Promise((resolve) => {
      const done = () => {
        ready.value = true
        resolve()
      }

      setTimeout(done, INIT_TIMEOUT_MS)
      listen(done)
    })

    return initPromise
  }

  return { openAt, isCustomised, loaded, ready, isOpen, isOpenNow, init }
})
