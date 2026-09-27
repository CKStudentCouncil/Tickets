import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { SHOP_OPEN_AT } from 'src/config/app'
import { watchShopSettings } from 'src/services/shopService'
import { parseDate } from 'src/utils/datetime'

// Don't hold up navigation forever if Firestore can't be reached
const INIT_TIMEOUT_MS = 5000

export const useShopStore = defineStore('shop', () => {
  // settings/shop.openAt, kept live so "立即開賣" reaches open pages at once
  const savedOpenAt = ref(null)
  const ready = ref(false)

  // Falls back to the built-in default until a super admin sets a time
  const openAt = computed(() => parseDate(savedOpenAt.value) || SHOP_OPEN_AT)
  const isCustomised = computed(() => !!parseDate(savedOpenAt.value))

  function isOpen(now = new Date()) {
    return now >= openAt.value
  }

  let initPromise = null

  function init() {
    if (initPromise) return initPromise

    initPromise = new Promise((resolve) => {
      const done = () => {
        ready.value = true
        resolve()
      }

      setTimeout(done, INIT_TIMEOUT_MS)

      watchShopSettings(
        (data) => {
          savedOpenAt.value = data.openAt || null
          done()
        },
        (error) => {
          console.error('Load shop settings error:', error)
          done()
        }
      )
    })

    return initPromise
  }

  return { openAt, isCustomised, ready, isOpen, init }
})
