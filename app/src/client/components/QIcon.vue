<template>
  <component :is="icon" class="q-icon" :size="pixelSize" :stroke-width="1.75" aria-hidden="true" />
</template>

<script setup>
// Stand-in for Quasar's q-icon: the material icon names used on the site,
// drawn with lucide icons
import { computed } from 'vue'
import { ArrowLeft, ArrowDownRight, ArrowUpRight, Check, Menu } from 'lucide-vue-next'

const ICONS = { arrow_back: ArrowLeft, south_east: ArrowDownRight, north_east: ArrowUpRight, check: Check, menu: Menu }

const props = defineProps({
  name: { type: String, required: true },
  size: { type: String, default: '1em' }
})

const icon = computed(() => ICONS[props.name] || Check)
// lucide takes a length; rem and em values follow the 16px root size
const pixelSize = computed(() => {
  const match = /^([\d.]+)(px|rem|em)?$/.exec(props.size)
  if (!match) return 16
  return match[2] === 'px' ? Number(match[1]) : Number(match[1]) * 16
})
</script>

<style scoped>
.q-icon {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}
</style>
