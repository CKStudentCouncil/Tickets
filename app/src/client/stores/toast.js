import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useToastStore = defineStore('toast', () => {
  const message = ref('')
  const visible = ref(false)
  const count = ref(1)
  let timeoutId = null
  let lastMessage = ''

  function show(msg, duration = 3000) {
    if (timeoutId) clearTimeout(timeoutId)

    if (lastMessage === msg && visible.value) {
      count.value += 1
    } else {
      message.value = msg
      count.value = 1
      lastMessage = msg
      visible.value = true
    }

    timeoutId = setTimeout(() => {
      visible.value = false
      count.value = 1
      lastMessage = ''
    }, duration)
  }

  return { message, visible, count, show }
})
