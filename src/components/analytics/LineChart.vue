<template>
  <div ref="frame" class="line-chart">
    <svg
      class="chart-svg"
      :width="width"
      :height="HEIGHT"
      :viewBox="`0 0 ${width} ${HEIGHT}`"
      role="img"
      :aria-label="summary"
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
        :x2="width - right"
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
      <text
        v-for="i in xTicks"
        :key="`x-${i}`"
        :x="x(i)"
        :y="HEIGHT - 8"
        :text-anchor="anchorOf(i)"
        :fill="palette.muted"
        font-size="11"
        :font-family="FONT"
      >{{ xLabel(i) }}</text>

      <path v-if="areaPath" :d="areaPath" :fill="series[0].color" fill-opacity="0.12" />
      <!-- the first series (this year) is drawn last, on top -->
      <path
        v-for="line in lines"
        :key="line.key"
        :d="line.path"
        fill="none"
        :stroke="line.color"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle
        v-if="endPoint"
        :cx="endPoint.x"
        :cy="endPoint.y"
        r="4"
        :fill="series[0].color"
        :stroke="palette.surface"
        stroke-width="2"
      />
      <text
        v-for="label in endLabels"
        :key="`end-${label.key}`"
        :x="label.x + 9"
        :y="label.y"
        dy="0.32em"
        :fill="palette.text"
        font-size="11"
        :font-family="FONT"
      >{{ label.text }}</text>

      <g v-if="active !== null">
        <line
          :x1="x(active)"
          :x2="x(active)"
          :y1="TOP"
          :y2="TOP + PLOT_HEIGHT"
          :stroke="palette.axis"
          stroke-width="1"
          shape-rendering="crispEdges"
        />
        <circle
          v-for="dot in activeDots"
          :key="`dot-${dot.key}`"
          :cx="x(active)"
          :cy="dot.y"
          r="4"
          :fill="dot.color"
          :stroke="palette.surface"
          stroke-width="2"
        />
      </g>
    </svg>

    <div v-if="active !== null" class="chart-tooltip" :style="tooltipStyle" aria-hidden="true">
      <p class="tip-title">{{ tooltipTitle(active) }}</p>
      <p v-for="item in activeRows" :key="item.key" class="tip-row">
        <span class="tip-key" :style="{ background: item.color }" />
        <strong>{{ format(item.value) }}</strong>
        <span>{{ item.label }}<template v-if="item.detail">　{{ item.detail }}</template></span>
      </p>
    </div>

    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { niceTicks } from 'src/utils/salesAnalytics'

// Lines over the days of a sale. Every visual property is an SVG attribute
// (html2canvas draws SVG without the page's stylesheet when exporting PDF).
const props = defineProps({
  // [{ key, label, color, values: [number | null], detail?: (i) => text }], first on top
  series: { type: Array, required: true },
  label: { type: String, required: true },
  format: { type: Function, required: true },
  axisFormat: { type: Function, required: true },
  xLabel: { type: Function, required: true },
  tooltipTitle: { type: Function, required: true },
  // x labels fall on i where (i + xStepOffset) is a multiple of the step
  xStepOffset: { type: Number, default: 0 },
  area: { type: Boolean, default: false },
  integer: { type: Boolean, default: false }
})

const FONT = "Manrope, 'Noto Sans TC', sans-serif"
const HEIGHT = 250
const TOP = 12
const BOTTOM = 30
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM

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
watch(() => props.series.map((item) => item.values.length).join(), () => { active.value = null })

const count = computed(() => Math.max(0, ...props.series.map((item) => item.values.length)))
const last = computed(() => count.value - 1)
const ticks = computed(() => niceTicks(
  Math.max(0, ...props.series.flatMap((item) => item.values.filter((value) => value != null))),
  { integer: props.integer }
))
const left = computed(() => Math.max(...ticks.value.map((tick) => String(props.axisFormat(tick)).length)) * 7 + 14)
// room for the line names at their ends
const right = computed(() => (props.series.length > 1 ? 50 : 14))
const plotWidth = computed(() => Math.max(1, width.value - left.value - right.value))

const x = (i) => (count.value <= 1 ? left.value + plotWidth.value / 2 : left.value + (i * plotWidth.value) / last.value)
const y = (value) => TOP + PLOT_HEIGHT - (value / ticks.value.at(-1)) * PLOT_HEIGHT
const at = (n) => n.toFixed(1)

// a missing value breaks the line
function pathOf(values) {
  let path = ''
  let drawing = false
  values.forEach((value, i) => {
    if (value == null) {
      drawing = false
      return
    }
    path += `${drawing ? 'L' : 'M'}${at(x(i))},${at(y(value))}`
    drawing = true
  })
  return path
}

const lines = computed(() => props.series
  .map((item) => ({ key: item.key, color: item.color, path: pathOf(item.values) }))
  .reverse())

const areaPath = computed(() => {
  const values = props.series[0]?.values || []
  if (!props.area || values.length < 2 || values.some((value) => value == null)) return ''
  const base = at(y(0))
  return `M${at(x(0))},${base}${values.map((value, i) => `L${at(x(i))},${at(y(value))}`).join('')}L${at(x(values.length - 1))},${base}Z`
})

const lastPointOf = (values) => {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return { i, value: values[i] }
  return null
}

const endPoint = computed(() => {
  const point = lastPointOf(props.series[0]?.values || [])
  return point ? { x: x(point.i), y: y(point.value) } : null
})

// each line's name at its end, while the ends are far enough apart
const endLabels = computed(() => {
  if (props.series.length < 2) return []
  const labels = props.series
    .map((item) => ({ item, point: lastPointOf(item.values) }))
    .filter(({ point }) => point)
    .map(({ item, point }) => ({ key: item.key, text: item.label, x: x(point.i), y: y(point.value) }))
  const crowded = labels.some((a, i) => labels.some((b, j) => i < j && Math.abs(a.x - b.x) < 40 && Math.abs(a.y - b.y) < 14))
  return crowded ? [] : labels
})

const xTicks = computed(() => {
  if (!count.value) return []
  const longest = Math.max(...Array.from({ length: count.value }, (_, i) => String(props.xLabel(i)).length))
  const fit = Math.max(1, Math.floor(plotWidth.value / (longest * 12 + 12)))
  const step = [1, 2, 5, 7, 10, 14, 15, 20, 30, 50, 100].find((n) => n >= count.value / fit) || Math.ceil(count.value / fit)
  const marks = [0]
  for (let i = 1; i < count.value; i++) {
    if ((i + props.xStepOffset) % step === 0 && i - marks.at(-1) >= step / 2) marks.push(i)
  }
  return marks
})

function anchorOf(i) {
  const half = (String(props.xLabel(i)).length * 11) / 2
  if (x(i) - half < 0) return 'start'
  if (x(i) + half > width.value) return 'end'
  return 'middle'
}

const activeRows = computed(() => (active.value === null ? [] : props.series
  .filter((item) => item.values[active.value] != null)
  .map((item) => ({
    key: item.key,
    color: item.color,
    label: item.label,
    value: item.values[active.value],
    detail: item.detail?.(active.value) || ''
  }))))

const activeDots = computed(() => activeRows.value.map((row) => ({ key: row.key, color: row.color, y: y(row.value) })))

const tooltipStyle = computed(() => {
  const px = x(active.value)
  return px > width.value * 0.55
    ? { right: `${width.value - px + 14}px`, top: `${TOP}px` }
    : { left: `${px + 14}px`, top: `${TOP}px` }
})

const summary = computed(() => {
  const main = props.series[0]
  const point = main && lastPointOf(main.values)
  return point ? `${props.label}：${main.label}最新為 ${props.format(point.value)}（${props.tooltipTitle(point.i)}）` : props.label
})

const announcement = computed(() => (fromKeyboard.value && active.value !== null
  ? `${props.tooltipTitle(active.value)}：${activeRows.value.map((row) => `${row.label} ${props.format(row.value)}`).join('，')}`
  : ''))

function pointAt(event) {
  if (!count.value) return
  fromKeyboard.value = false
  const offset = event.clientX - event.currentTarget.getBoundingClientRect().left
  active.value = count.value <= 1
    ? 0
    : Math.min(last.value, Math.max(0, Math.round(((offset - left.value) / plotWidth.value) * last.value)))
}

// a finger lifting off keeps the readout; a mouse leaving clears it
function leave(event) {
  if (event.pointerType === 'mouse') active.value = null
}

function focusChart() {
  if (active.value === null && count.value) active.value = last.value
}

function moveWithKeys(event) {
  if (!count.value) return
  const moves = { ArrowLeft: -1, ArrowRight: 1 }
  let next = null
  if (event.key in moves) next = Math.min(last.value, Math.max(0, (active.value ?? last.value) + moves[event.key]))
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = last.value
  else if (event.key === 'Escape') active.value = null
  if (next === null) return
  event.preventDefault()
  fromKeyboard.value = true
  active.value = next
}
</script>

<style scoped>
.line-chart {
  position: relative;
}

.chart-svg {
  display: block;
  /* vertical swipes still scroll the page; sideways ones move the crosshair */
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

  min-width: 150px;
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
  width: 14px;
  height: 2px;
  border-radius: 1px;
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
