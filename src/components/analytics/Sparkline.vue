<template>
  <div ref="frame" class="sparkline">
    <svg
      :width="width"
      :height="HEIGHT"
      :viewBox="`0 0 ${width} ${HEIGHT}`"
      role="img"
      :aria-label="label"
    >
      <line
        v-if="zeroY !== null"
        x1="0"
        :x2="width"
        :y1="zeroY"
        :y2="zeroY"
        :stroke="palette.axis"
        stroke-width="1"
        stroke-dasharray="2 3"
        shape-rendering="crispEdges"
      />
      <path :d="path" fill="none" :stroke="palette.previous" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      <circle v-if="end" :cx="end.x" :cy="end.y" r="3" :fill="palette.current" :stroke="palette.surface" stroke-width="1.5" />
    </svg>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'

// A stat tile's trend across its width: the earlier values in the
// de-emphasis grey, the latest as an accent dot, and a dashed zero line when
// the values cross it. No axes; the tile's numbers carry the values.
const props = defineProps({
  // oldest first; null leaves a gap
  values: { type: Array, required: true },
  label: { type: String, required: true }
})

const HEIGHT = 32
const PAD = 4

const palette = inject('chartPalette')
const frame = ref(null)
const width = ref(112)
let observer = null

onMounted(() => {
  observer = new ResizeObserver(([entry]) => { width.value = Math.max(60, Math.round(entry.contentRect.width)) })
  observer.observe(frame.value)
})
onBeforeUnmount(() => observer?.disconnect())

const known = computed(() => props.values.filter((value) => value != null))
const low = computed(() => Math.min(...known.value))
const high = computed(() => Math.max(...known.value))

const x = (i) => (props.values.length < 2 ? width.value / 2 : PAD + (i * (width.value - 2 * PAD)) / (props.values.length - 1))
const y = (value) => (high.value === low.value
  ? HEIGHT / 2
  : PAD + ((high.value - value) / (high.value - low.value)) * (HEIGHT - 2 * PAD))

const path = computed(() => {
  let d = ''
  let drawing = false
  props.values.forEach((value, i) => {
    if (value == null) {
      drawing = false
      return
    }
    d += `${drawing ? 'L' : 'M'}${x(i).toFixed(1)},${y(value).toFixed(1)}`
    drawing = true
  })
  return d
})

const end = computed(() => {
  for (let i = props.values.length - 1; i >= 0; i--) {
    if (props.values[i] != null) return { x: x(i), y: y(props.values[i]) }
  }
  return null
})

const zeroY = computed(() => (known.value.length && low.value < 0 && high.value > 0 ? y(0) : null))
</script>

<style scoped>
.sparkline svg {
  display: block;
  overflow: visible;
}
</style>
