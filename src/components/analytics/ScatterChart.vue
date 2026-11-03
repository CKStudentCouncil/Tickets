<template>
  <div ref="frame" class="scatter-chart">
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
        v-for="tick in yTicks"
        :key="`y-grid-${tick}`"
        :x1="left"
        :x2="width - RIGHT"
        :y1="y(tick)"
        :y2="y(tick)"
        :stroke="tick === 0 ? palette.axis : palette.grid"
        stroke-width="1"
        shape-rendering="crispEdges"
      />
      <text
        v-for="tick in yTicks"
        :key="`y-tick-${tick}`"
        :x="left - 8"
        :y="y(tick)"
        dy="0.32em"
        text-anchor="end"
        :fill="palette.muted"
        font-size="11"
        :font-family="FONT"
      >{{ yFormat(tick) }}</text>
      <line
        v-for="tick in xTicks"
        :key="`x-grid-${tick}`"
        :x1="x(tick)"
        :x2="x(tick)"
        :y1="TOP"
        :y2="TOP + PLOT_HEIGHT"
        :stroke="palette.grid"
        stroke-width="1"
        shape-rendering="crispEdges"
      />
      <text
        v-for="tick in xTicks"
        :key="`x-tick-${tick}`"
        :x="x(tick)"
        :y="TOP + PLOT_HEIGHT + 16"
        text-anchor="middle"
        :fill="palette.muted"
        font-size="11"
        :font-family="FONT"
      >{{ xFormat(tick) }}</text>

      <text :x="left" :y="12" :fill="palette.muted" font-size="11" :font-family="FONT">{{ yTitle }}</text>
      <text
        :x="width - RIGHT"
        :y="HEIGHT - 4"
        text-anchor="end"
        :fill="palette.muted"
        font-size="11"
        :font-family="FONT"
      >{{ xTitle }}</text>

      <!-- the split between the quadrants, and what each corner holds -->
      <line
        v-if="xSplit !== null"
        :x1="x(xSplit)"
        :x2="x(xSplit)"
        :y1="TOP"
        :y2="TOP + PLOT_HEIGHT"
        :stroke="palette.axis"
        stroke-width="1"
        stroke-dasharray="4 4"
      />
      <text
        v-for="corner in corners"
        :key="corner.key"
        :x="corner.x"
        :y="corner.y"
        :dy="corner.dy"
        :text-anchor="corner.anchor"
        :fill="palette.muted"
        font-size="11"
        :font-family="FONT"
      >{{ corner.text }}</text>

      <!-- the biggest drawn first, so small ones stay on top -->
      <circle
        v-for="point in drawn"
        :key="point.key"
        :cx="point.cx"
        :cy="point.cy"
        :r="point.r"
        :fill="point.color"
        fill-opacity="0.85"
        :stroke="palette.surface"
        stroke-width="1.5"
      />
      <circle
        v-if="activePoint"
        :cx="activePoint.cx"
        :cy="activePoint.cy"
        :r="activePoint.r + 3"
        fill="none"
        :stroke="palette.text"
        stroke-width="1.5"
      />
      <text
        v-for="item in labels"
        :key="`label-${item.key}`"
        :x="item.x"
        :y="item.y"
        dy="0.32em"
        :text-anchor="item.anchor"
        :fill="palette.text"
        font-size="11"
        :font-family="FONT"
      >{{ item.text }}</text>
    </svg>

    <div v-if="activePoint" class="chart-tooltip" :style="tooltipStyle" aria-hidden="true">
      <p class="tip-title">
        <span class="tip-key" :style="{ background: activePoint.color }" />
        {{ activePoint.label }}
      </p>
      <p v-for="line in describe(activePoint)" :key="line" class="tip-row">{{ line }}</p>
    </div>

    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { niceTicks } from 'src/utils/salesAnalytics'

// Points by two measures, sized by a third, each named beside it where it
// fits. Every visual property is an SVG attribute (html2canvas draws SVG
// without the page's stylesheet when exporting PDF).
const props = defineProps({
  // [{ key, label, x, y, size, color }]; y may be negative
  points: { type: Array, required: true },
  label: { type: String, required: true },
  xFormat: { type: Function, required: true },
  yFormat: { type: Function, required: true },
  xTitle: { type: String, default: '' },
  yTitle: { type: String, default: '' },
  // a dashed line at this x; with y = 0 it splits the plot in four
  xSplit: { type: Number, default: null },
  // the corners' names: top left, top right, bottom left, bottom right
  quadrants: { type: Array, default: () => [] },
  // (point) => the tooltip's lines
  describe: { type: Function, required: true }
})

const FONT = "Manrope, 'Noto Sans TC', sans-serif"
const HEIGHT = 320
const TOP = 26
const BOTTOM = 44
const RIGHT = 16
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM
// keeps the bubbles off the plot's edges
const INSET = 20
const MIN_R = 5
const MAX_R = 18

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

const xTicks = computed(() => niceTicks(Math.max(0, ...props.points.map((point) => point.x)), { count: 4 }))
// symmetric around 0
const yTicks = computed(() => {
  const up = niceTicks(Math.max(0, ...props.points.map((point) => Math.abs(point.y))) || 0.01, { count: 2 })
  return [...up.slice(1).reverse().map((tick) => -tick), ...up]
})
const left = computed(() => Math.max(...yTicks.value.map((tick) => String(props.yFormat(tick)).length)) * 7 + 14)
const plotWidth = computed(() => Math.max(1, width.value - left.value - RIGHT))

const x = (value) => left.value + INSET + (value / xTicks.value.at(-1)) * (plotWidth.value - 2 * INSET)
const y = (value) => {
  const top = yTicks.value.at(-1)
  return TOP + INSET + ((top - value) / (2 * top)) * (PLOT_HEIGHT - 2 * INSET)
}

const maxSize = computed(() => Math.max(0, ...props.points.map((point) => point.size)))
const drawn = computed(() => props.points
  .map((point) => ({
    ...point,
    cx: x(point.x),
    cy: y(point.y),
    r: maxSize.value ? MIN_R + (MAX_R - MIN_R) * Math.sqrt(point.size / maxSize.value) : MIN_R
  }))
  .sort((a, b) => b.r - a.r))

const activePoint = computed(() => drawn.value.find((point) => point.key === active.value) || null)

const corners = computed(() => {
  const [topLeft, topRight, bottomLeft, bottomRight] = props.quadrants
  const x1 = left.value + 6
  const x2 = width.value - RIGHT - 6
  const y1 = TOP + 4
  const y2 = TOP + PLOT_HEIGHT - 4
  return [
    { key: 'tl', text: topLeft, x: x1, y: y1, dy: '0.8em', anchor: 'start' },
    { key: 'tr', text: topRight, x: x2, y: y1, dy: '0.8em', anchor: 'end' },
    { key: 'bl', text: bottomLeft, x: x1, y: y2, dy: '0', anchor: 'start' },
    { key: 'br', text: bottomRight, x: x2, y: y2, dy: '0', anchor: 'end' }
  ].filter((corner) => corner.text)
})

// about 11px a CJK character, 6.5px anything narrower
const textWidth = (text) => [...String(text)].reduce((sum, char) => sum + (char.charCodeAt(0) < 0x2e80 ? 6.5 : 11), 0)
const overlaps = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2

// Names beside their bubbles, the biggest first: right, left, above or
// below, wherever one clears the plot's edges, the other bubbles and the
// names already placed; none where nothing does (hover still names it).
const labels = computed(() => {
  const bubbles = drawn.value.map((point) => ({
    key: point.key, x1: point.cx - point.r, x2: point.cx + point.r, y1: point.cy - point.r, y2: point.cy + point.r
  }))
  const corner = corners.value.map((item) => {
    const w = textWidth(item.text)
    const x1 = item.anchor === 'start' ? item.x : item.x - w
    return { x1, x2: x1 + w, y1: item.dy === '0' ? item.y - 12 : item.y, y2: item.dy === '0' ? item.y : item.y + 12 }
  })
  const placed = []
  const result = []
  drawn.value.forEach((point) => {
    const w = textWidth(point.label)
    const h = 13
    const gap = point.r + 4
    const options = [
      { x: point.cx + gap, y: point.cy, anchor: 'start', box: { x1: point.cx + gap, x2: point.cx + gap + w } },
      { x: point.cx - gap, y: point.cy, anchor: 'end', box: { x1: point.cx - gap - w, x2: point.cx - gap } },
      { x: point.cx, y: point.cy - gap - h / 2, anchor: 'middle', box: { x1: point.cx - w / 2, x2: point.cx + w / 2 } },
      { x: point.cx, y: point.cy + gap + h / 2, anchor: 'middle', box: { x1: point.cx - w / 2, x2: point.cx + w / 2 } }
    ].map((option) => ({ ...option, box: { ...option.box, y1: option.y - h / 2, y2: option.y + h / 2 } }))
    const spot = options.find(({ box }) =>
      box.x1 >= left.value && box.x2 <= width.value - RIGHT && box.y1 >= TOP && box.y2 <= TOP + PLOT_HEIGHT &&
      !bubbles.some((bubble) => bubble.key !== point.key && overlaps(box, bubble)) &&
      ![...placed, ...corner].some((other) => overlaps(box, other)))
    if (!spot) return
    placed.push(spot.box)
    result.push({ key: point.key, text: point.label, x: spot.x, y: spot.y, anchor: spot.anchor })
  })
  return result
})

const tooltipStyle = computed(() => {
  const point = activePoint.value
  const top = `${Math.max(0, Math.min(HEIGHT - 110, point.cy - 20))}px`
  return point.cx > width.value * 0.55
    ? { right: `${width.value - point.cx + point.r + 10}px`, top }
    : { left: `${point.cx + point.r + 10}px`, top }
})

const summary = computed(() => `${props.label}，共 ${props.points.length} 項；可用方向鍵逐項查看`)

const announcement = computed(() => (fromKeyboard.value && activePoint.value
  ? `${activePoint.value.label}：${props.describe(activePoint.value).join('，')}`
  : ''))

// the nearest bubble within reach of the pointer
function pointAt(event) {
  fromKeyboard.value = false
  const rect = event.currentTarget.getBoundingClientRect()
  const px = event.clientX - rect.left
  const py = event.clientY - rect.top
  let nearest = null
  drawn.value.forEach((point) => {
    const distance = Math.hypot(point.cx - px, point.cy - py)
    if (distance <= Math.max(point.r + 10, 22) && (!nearest || distance < nearest.distance)) nearest = { key: point.key, distance }
  })
  active.value = nearest?.key ?? null
}

// a finger lifting off keeps the readout; a mouse leaving clears it
function leave(event) {
  if (event.pointerType === 'mouse') active.value = null
}

// left to right
const order = computed(() => [...drawn.value].sort((a, b) => a.cx - b.cx || b.cy - a.cy).map((point) => point.key))

function focusChart() {
  if (active.value === null && order.value.length) active.value = order.value[0]
}

function moveWithKeys(event) {
  const keys = order.value
  if (!keys.length) return
  const at = keys.indexOf(active.value)
  const moves = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }
  let next = null
  if (event.key in moves) next = keys[Math.min(keys.length - 1, Math.max(0, (at < 0 ? 0 : at + moves[event.key])))]
  else if (event.key === 'Home') next = keys[0]
  else if (event.key === 'End') next = keys.at(-1)
  else if (event.key === 'Escape') active.value = null
  if (next === null) return
  event.preventDefault()
  fromKeyboard.value = true
  active.value = next
}
</script>

<style scoped>
.scatter-chart {
  position: relative;
}

.chart-svg {
  display: block;
  /* vertical swipes still scroll the page */
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
  display: flex;
  align-items: center;
  gap: 8px;

  margin: 0 0 6px;

  color: var(--ink);
  font-size: 12.5px;
  font-weight: 600;
}

.tip-row {
  margin: 4px 0 0;

  color: var(--ink-soft);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.tip-key {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
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
