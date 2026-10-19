<template>
  <router-view />
  <AppToast />
</template>

<script setup>
import AppToast from 'src/components/AppToast.vue'
import { initAnalytics } from 'src/utils/analytics'
import { useRoute } from 'vue-router'
import { watch } from 'vue'

// Session recordings never include the staff pages (buyers' personal data)
const route = useRoute()
watch(() => route.matched.length && route.meta, (meta) => {
  if (meta) initAnalytics({ recordSessions: !meta.isAdminSection })
}, { immediate: true })
</script>
