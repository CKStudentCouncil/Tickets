<template>
  <ul class="bar-list">
    <li v-for="row in rows" :key="row.label" class="bar-row">
      <span class="bar-label">{{ row.label }}</span>
      <span class="bar-lines">
        <span v-for="(value, i) in row.values" :key="i" class="bar-line">
          <span class="bar-track">
            <span class="bar-fill" :style="{ width: widthOf(value), background: colors[i] }" />
          </span>
          <span class="bar-value num">
            {{ format(value) }}
            <span class="sr-only">（{{ seriesLabels[i] }}）</span>
          </span>
        </span>
      </span>
    </li>
  </ul>
</template>

<script setup>
import { computed } from 'vue'

// Horizontal bars with their values beside them: one bar per series in each
// row, this year on top. Plain HTML, so the PDF export draws it as shown.
const props = defineProps({
  // [{ label, values: [number | null] }]
  rows: { type: Array, required: true },
  colors: { type: Array, required: true },
  seriesLabels: { type: Array, required: true },
  format: { type: Function, required: true }
})

const max = computed(() => Math.max(0, ...props.rows.flatMap((row) => row.values.filter((value) => value != null))))
const widthOf = (value) => (max.value && value ? `${(value / max.value) * 100}%` : '0')
</script>

<style scoped>
.bar-list {
  margin: 0;
  padding: 0;

  list-style: none;
}

.bar-row {
  display: grid;
  grid-template-columns: minmax(84px, 30%) minmax(0, 1fr);
  align-items: center;
  gap: 14px;

  padding: 9px 0;

  border-bottom: 1px solid var(--line-soft);
}

.bar-row:last-child {
  border-bottom: 0;
}

.bar-label {
  overflow: hidden;

  color: var(--ink-soft);
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-lines {
  display: flex;
  flex-direction: column;
  gap: 5px;

  min-width: 0;
}

.bar-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px;
  align-items: center;
  gap: 10px;
}

.bar-track {
  display: block;
  height: 8px;
}

/* rounded at the data end, square at the baseline */
.bar-fill {
  display: block;
  height: 100%;
  min-width: 0;
  border-radius: 0 3px 3px 0;

  transition: width .3s ease;
}

.bar-value {
  color: var(--ink);
  font-size: 12px;
  text-align: right;
  white-space: nowrap;
}

.bar-line + .bar-line .bar-value {
  color: var(--muted);
}

.num {
  font-variant-numeric: tabular-nums;
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

@media (prefers-reduced-motion: reduce) {
  .bar-fill {
    transition: none;
  }
}
</style>
