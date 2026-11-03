<template>
  <div ref="frame" class="column-chart">
    <svg
      class="chart-svg"
      :width="width"
      :height="HEIGHT"
      :viewBox="`0 0 ${width} ${HEIGHT}`"
      role="img"
      :aria-label="label"
      tabindex="0"
      @pointerdown="pointAt"
      @pointermove="pointAt"
      @pointerleave="leave"
      @focus="focusChart"
      @blur="active = null"
      @keydown="moveWithKeys"
    >
      <line
        v-for="tick in ticks"
        :key="`grid-${tick}`"
        :x1="left"
        :x2="width - RIGHT"
        :y1="y(tick)"
        :y2="y(tick)"
        :stroke="tick === 0 ? palette.axis : palette.grid"
        stroke-width="1"
        shape-rendering="crispEdges"
      />
      <text
        v-for="tick in ticks"
        :key="`tick-${tick}`"
        :x="left - 8"
        :y="y(tick)"
        dy="0.32em"
        text-anchor="end"
        :fill="palette.muted"
        font-size="11"
        :font-family="FONT"
      >{{ axisFormat(tick) }}</text>

      <rect
        v-if="active !== null"
        :x="groupX(active)"
        :y="TOP"
        :width="groupWidth"
        :height="PLOT_HEIGHT"
        :fill="palette.grid"
        fill-opacity="0.6"
      />
      <g v-for="(name, i) in labels" :key="`group-${i}`">
        <path
          v-for="bar in barsOf(i)"
          :key="bar.key"
          :d="bar.path"
          :fill="bar.color"
        />
      </g>
      <text
        v-for="i in xTicks"
        :key="`x-${i}`"
        :x="groupX(i) + groupWidth / 2"
        :y="HEIGHT - 8"
        text-anchor="middle"
        :fill="palette.muted"
        font-size="11"
        :font-family="FONT"
      >{{ labels[i] }}</text>
    </svg>

    <div v-if="active !== null" class="chart-tooltip" :style="tooltipStyle" aria-hidden="true">
      <p class="tip-title">{{ tooltipTitle(active) }}</p>
      <p v-for="item in series" :key="item.key" class="tip-row">
        <span class="tip-key" :style="{ background: item.color }" />
        <strong>{{ format(item.values[active]) }}</strong>
        <span>{{ item.label }}<template v-if="item.detail">　{{ item.detail(active) }}</template></span>
      </p>
    </div>

    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { niceTicks } from 'src/utils/salesAnalytics'

// Columns per label, one per series side by side. Every visual property is
// an SVG attribute (html2canvas draws SVG without the page's stylesheet).
const props = defineProps({
  labels: { type: Array, required: true },
  // [{ key, label, color, values: [number], detail?: (i) => text }]
  series: { type: Array, required: true },
  label: { type: String, required: true },
  format: { type: Function, required: true },
  axisFormat: { type: Function, required: true },
  tooltipTitle: { type: Function, required: true }
})

const FONT = "Manrope, 'Noto Sans TC', sans-serif"
const HEIGHT = 220
const TOP = 12
const BOTTOM = 28
const RIGHT = 8
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM
const GAP = 2

const palette = inject('chartPalette')
const frame = ref(null)
const width = ref(600)
const active = ref(null)
const fromKeyboard = ref(false)
let observer = null

onMounted(() => {
  observer = new ResizeObserver(([entry]) => { width.value = Math.max(240, Math.round(entry.contentRect.width)) })
  observer.observe(frame.value)
})
onBeforeUnmount(() => observer?.disconnect())

const ticks = computed(() => niceTicks(Math.max(0, ...props.series.flatMap((item) => item.values))))
const left = computed(() => Math.max(...ticks.value.map((tick) => String(props.axisFormat(tick)).length)) * 7 + 14)
const groupWidth = computed(() => (width.value - left.value - RIGHT) / Math.max(1, props.labels.length))
const groupX = (i) => left.value + i * groupWidth.value
const y = (value) => TOP + PLOT_HEIGHT - (value / ticks.value.at(-1)) * PLOT_HEIGHT

// thin columns, at most 24px, with a 2px gap between a label's series
const barWidth = computed(() => {
  const k = props.series.length
  return Math.max(2, Math.min(24, (groupWidth.value * 0.72 - GAP * (k - 1)) / k))
})

// rounded at the data end, square at the baseline
function columnPath(x, value) {
  const base = y(0)
  const top = y(value)
  const r = Math.min(4, barWidth.value / 2, base - top)
  const w = barWidth.value
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`
}

function barsOf(i) {
  const k = props.series.length
  const start = groupX(i) + (groupWidth.value - (barWidth.value * k + GAP * (k - 1))) / 2
  return props.series
    .map((item, j) => ({ key: item.key, color: item.color, value: item.values[i] || 0, x: start + j * (barWidth.value + GAP) }))
    .filter((bar) => bar.value > 0)
    .map((bar) => ({ key: bar.key, color: bar.color, path: columnPath(bar.x, bar.value) }))
}

const xTicks = computed(() => {
  const longest = Math.max(1, ...props.labels.map((name) => String(name).length))
  const step = [1, 2, 3, 4, 6, 12].find((n) => groupWidth.value * n >= longest * 7 + 8) || props.labels.length
  return props.labels.map((_, i) => i).filter((i) => i % step === 0)
})

const tooltipStyle = computed(() => {
  const px = groupX(active.value) + groupWidth.value / 2
  return px > width.value * 0.55
    ? { right: `${width.value - px + 14}px`, top: `${TOP}px` }
    : { left: `${px + 14}px`, top: `${TOP}px` }
})

const announcement = computed(() => (fromKeyboard.value && active.value !== null
  ? `${props.tooltipTitle(active.value)}：${props.series.map((item) => `${item.label} ${props.format(item.values[active.value])}`).join('，')}`
  : ''))

function pointAt(event) {
  if (!props.labels.length) return
  fromKeyboard.value = false
  const offset = event.clientX - event.currentTarget.getBoundingClientRect().left
  const i = Math.floor((offset - left.value) / groupWidth.value)
  active.value = i >= 0 && i < props.labels.length ? i : null
}

function leave(event) {
  if (event.pointerType === 'mouse') active.value = null
}

function focusChart() {
  if (active.value === null && props.labels.length) active.value = 0
}

function moveWithKeys(event) {
  const lastIndex = props.labels.length - 1
  const moves = { ArrowLeft: -1, ArrowRight: 1 }
  let next = null
  if (event.key in moves) next = Math.min(lastIndex, Math.max(0, (active.value ?? 0) + moves[event.key]))
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = lastIndex
  else if (event.key === 'Escape') active.value = null
  if (next === null) return
  event.preventDefault()
  fromKeyboard.value = true
  active.value = next
}
</script>

<style scoped>
.column-chart {
  position: relative;
}

.chart-svg {
  display: block;
  touch-action: pan-y;
  outline: none;
}

.chart-svg:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 4px;
}

.chart-tooltip {
  position: absolute;
  z-index: 2;

  min-width: 140px;
  padding: 10px 12px;

  border: 1px solid var(--line);
  background: var(--tooltip);
  box-shadow: 0 12px 30px rgba(0, 0, 0, .35);

  pointer-events: none;
}

.tip-title {
  margin: 0 0 6px;

  color: var(--muted);
  font-size: 11px;
}

.tip-row {
  display: flex;
  align-items: center;
  gap: 8px;

  margin: 4px 0 0;

  color: var(--muted);
  font-size: 11.5px;
  white-space: nowrap;
}

.tip-row strong {
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.tip-key {
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 2px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>
