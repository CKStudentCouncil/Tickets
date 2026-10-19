<template>
  <div ref="container" class="turnstile-widget" />
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { TURNSTILE_SITE_KEY } from 'src/config/app'

// Cloudflare Turnstile check; v-model holds the token, '' until it is solved
// or after it expired. Tokens are single-use: call reset() after every
// request that sent one.
const props = defineProps({
  action: { type: String, required: true }
})
const token = defineModel({ type: String, default: '' })

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let scriptPromise
function loadTurnstile() {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => resolve(window.turnstile)
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('Turnstile failed to load'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

const container = ref(null)
let widgetId = null
let unmounted = false

onMounted(async () => {
  try {
    const turnstile = await loadTurnstile()
    if (unmounted) return
    widgetId = turnstile.render(container.value, {
      sitekey: TURNSTILE_SITE_KEY,
      action: props.action,
      language: 'zh-tw',
      size: 'flexible',
      callback: (value) => (token.value = value),
      'expired-callback': () => (token.value = ''),
      'error-callback': () => (token.value = '')
    })
  } catch (error) {
    console.error('Turnstile load error:', error)
  }
})

onBeforeUnmount(() => {
  unmounted = true
  token.value = '' // its expiry would go unnoticed once the widget is gone
  if (widgetId !== null) window.turnstile?.remove(widgetId)
})

function reset() {
  token.value = ''
  if (widgetId !== null) window.turnstile?.reset(widgetId)
}

defineExpose({ reset })
</script>

<style scoped>
.turnstile-widget {
  min-height: 65px;
}
</style>
