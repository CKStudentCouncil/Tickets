<template>
  <span>{{ formatCountdown(target, now) }}</span>
</template>

<script setup>
import { useNow } from 'src/composables/useNow'
import { formatCountdown } from 'src/utils/datetime'

// Ticks on its own, so the page around it doesn't re-render every second
defineProps({
  target: { type: [Date, String, Object], required: true }
})

const now = useNow()
</script>
