<template>
  <div class="heat">
    <div class="heat-grid" role="img" :aria-label="label">
      <span />
      <span v-for="(column, c) in columns" :key="`column-${c}`" class="heat-column">{{ c % columnStep === 0 ? column : '' }}</span>
      <template v-for="(row, r) in values" :key="`row-${r}`">
        <span class="heat-row">{{ rows[r] }}</span>
        <span
          v-for="(value, c) in row"
          :key="c"
          class="heat-cell"
          :class="{ active: active && active.r === r && active.c === c }"
          :style="{ background: colorOf(value) }"
          @pointerenter="active = { r, c }"
          @pointerdown="active = { r, c }"
          @pointerleave="active = null"
        />
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
import { computed, ref } from 'vue'

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
  describe: { type: Function, required: true }
})

const active = ref(null)
const max = computed(() => Math.max(0, ...props.values.flat()))
const columnStep = computed(() => (props.columns.length > 12 ? 3 : 1))

const rgb = computed(() => [1, 3, 5].map((i) => parseInt(props.color.slice(i, i + 2), 16)).join(', '))

function colorOf(value) {
  if (!value || !max.value) return 'var(--line-soft)'
  return `rgba(${rgb.value}, ${(0.16 + 0.84 * (value / max.value)).toFixed(3)})`
}
</script>

<style scoped>
.heat-grid {
  display: grid;
  grid-template-columns: 28px repeat(24, minmax(0, 1fr));
  gap: 2px;
}

.heat-column {
  color: var(--muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.heat-row {
  display: flex;
  align-items: center;

  color: var(--muted);
  font-size: 11px;
}

.heat-cell {
  height: 20px;
  border-radius: 2px;
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
