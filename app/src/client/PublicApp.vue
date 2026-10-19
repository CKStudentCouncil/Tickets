<template>
  <router-view />
  <AppToast />
</template>

<script setup>
import AppToast from 'src/components/AppToast.vue'
import { initAnalytics } from 'src/utils/analytics'

initAnalytics({ recordSessions: true })
</script>
