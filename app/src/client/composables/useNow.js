import { onBeforeUnmount, onMounted, ref } from 'vue'

// A reactive "now" that ticks, so time-based computeds (sale status,
// countdowns) update without a page reload.
export function useNow(intervalMs = 1000) {
  const now = ref(new Date())
  let timer = null

  onMounted(() => {
    timer = setInterval(() => {
      now.value = new Date()
    }, intervalMs)
  })

  onBeforeUnmount(() => clearInterval(timer))

  return now
}
