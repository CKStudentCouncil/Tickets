<template>
  <div class="heat">
    <div
      class="heat-grid"
      role="img"
      :aria-label="label"
      :style="{ gridTemplateColumns: `${rowWidth} repeat(${columns.length}, minmax(0, 1fr))` }"
    >
      <span />
      <span v-for="(column, c) in columns" :key="`column-${c}`" class="heat-column">{{ c % columnStep === 0 ? column : '' }}</span>
      <template v-for="(row, r) in values" :key="`row-${r}`">
        <span class="heat-row">
          <span class="heat-row-label">{{ rows[r] }}</span>
          <span v-if="rowNotes[r]" class="heat-row-note">{{ rowNotes[r] }}</span>
        </span>
        <span
          v-for="(value, c) in row"
          :key="c"
          class="heat-cell"
          :class="{ active: active && active.r === r && active.c === c, labelled: cellLabel }"
          :style="{ background: colorOf(value, r), color: cellLabel ? textOf(value, r) : null }"
          @pointerenter="active = { r, c }"
          @pointerdown="active = { r, c }"
          @pointerleave="active = null"
        >{{ cellLabel && value ? cellLabel(value) : '' }}</span>
      </template>
    </div>

    <div class="heat-foot">
      <span class="heat-scale" aria-hidden="true">
        少
        <span class="heat-ramp" :style="{ background: `linear-gradient(to right, ${colorOf(0.0001)}, ${colorOf(max)})` }" />
        多
      </span>
      <span class="heat-readout" aria-hidden="true">{{ active ? describe(active.r, active.c, values[active.r][active.c]) : '' }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, ref } from 'vue'

// A grid of counts in one hue, faint to full by count (sequential). Plain
// HTML, so the PDF export draws it as shown; the card's table view lists
// every value.
const props = defineProps({
  rows: { type: Array, required: true },
  columns: { type: Array, required: true },
  // values[row][column]
  values: { type: Array, required: true },
  // the hue, "#rrggbb"
  color: { type: String, required: true },
  label: { type: String, required: true },
  // (row, column, value) => the readout for a hovered cell
  describe: { type: Function, required: true },
  // the row labels' column, as a grid track
  rowWidth: { type: String, default: '28px' },
  // muted text after each row label, e.g. how many it counts
  rowNotes: { type: Array, default: () => [] },
  // (value) => the text written in a cell; none without it
  cellLabel: { type: Function, default: null },
  // each row faint to full by its own largest value, not the grid's
  rowScale: { type: Boolean, default: false }
})

const palette = inject('chartPalette')
const active = ref(null)
const max = computed(() => Math.max(0, ...props.values.flat()))
const rowMax = computed(() => props.values.map((row) => Math.max(0, ...row)))
// the value a row's (or, without one, the grid's) fullest colour stands for
const maxOf = (r) => (props.rowScale && r !== undefined ? rowMax.value[r] : max.value)
const columnStep = computed(() => (props.columns.length > 12 ? 3 : 1))

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const rgb = computed(() => rgbOf(props.color))
const alphaOf = (value, r) => 0.16 + 0.84 * (value / maxOf(r))

function colorOf(value, r) {
  if (!value || !maxOf(r)) return 'var(--line-soft)'
  return `rgba(${rgb.value.join(', ')}, ${alphaOf(value, r).toFixed(3)})`
}

// WCAG relative luminance of [r, g, b]
const luminanceOf = (channels) => channels
  .map((c) => c / 255)
  .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

// The chart's text or background colour, whichever reads better on the
// cell's colour over the background
function textOf(value, r) {
  if (!value || !maxOf(r)) return null
  const { surface, text } = palette.value
  const base = rgbOf(surface)
  const alpha = alphaOf(value, r)
  const cell = luminanceOf(rgb.value.map((c, i) => c * alpha + base[i] * (1 - alpha)))
  return contrast(cell, luminanceOf(rgbOf(text))) >= contrast(cell, luminanceOf(base)) ? text : surface
}
</script>

<style scoped>
.heat-grid {
  display: grid;
  gap: 2px;
}

.heat-column {
  align-self: end;

  color: var(--muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
  text-align: center;
}

.heat-row {
  display: flex;
  align-items: center;
  gap: 5px;

  min-width: 0;

  color: var(--muted);
  font-size: 11px;
}

.heat-row-label {
  overflow: hidden;

  text-overflow: ellipsis;
  white-space: nowrap;
}

.heat-row-note {
  flex: none;

  font-size: 10px;
  font-variant-numeric: tabular-nums;
  opacity: .75;
}

.heat-cell {
  height: 20px;
  border-radius: 2px;
}

.heat-cell.labelled {
  display: flex;
  align-items: center;
  justify-content: center;

  height: 26px;
  overflow: hidden;

  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.heat-cell.active {
  outline: 2px solid var(--ink);
  outline-offset: -1px;
}

.heat-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 22px;

  margin-top: 12px;

  color: var(--muted);
  font-size: 11px;
}

.heat-scale {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.heat-ramp {
  width: 90px;
  height: 8px;
  border-radius: 2px;
}

.heat-readout {
  color: var(--ink-soft);
  font-size: 12px;
}
</style>
