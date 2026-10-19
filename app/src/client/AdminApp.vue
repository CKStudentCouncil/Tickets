<template>
  <router-view />
  <AppToast />
</template>

<script setup>
import AppToast from 'src/components/AppToast.vue'
import { initAnalytics } from 'src/utils/analytics'

// staff pages show buyers' personal data: never recorded
initAnalytics({ recordSessions: false })
</script>
