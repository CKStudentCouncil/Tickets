<template>
  <article class="chart-card">
    <header class="card-head">
      <div class="card-titles">
        <h3 class="card-title">{{ title }}</h3>
        <p v-if="subtitle" class="card-subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="!exporting && ($slots.controls || (table && !empty))" class="card-controls">
        <slot name="controls" />
        <button
          v-if="table && !empty"
          type="button"
          class="card-toggle"
          :aria-pressed="showTable"
          @click="showTable = !showTable"
        >
          {{ showTable ? '看圖表' : '看表格' }}
        </button>
      </div>
    </header>

    <ul v-if="legend.length > 1 && !empty" class="card-legend">
      <li v-for="item in legend" :key="item.label">
        <span class="legend-key" :class="legendShape" :style="{ background: item.color }" aria-hidden="true" />
        {{ item.label }}
      </li>
    </ul>

    <p v-if="empty" class="card-empty">尚無資料</p>
    <div v-else-if="showTable && !exporting" class="card-table">
      <table>
        <thead>
          <tr>
            <th v-for="column in table.columns" :key="column" scope="col">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in table.rows" :key="i">
            <th scope="row">{{ row[0] }}</th>
            <td v-for="(cell, j) in row.slice(1)" :key="j">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="card-body">
      <slot />
    </div>
  </article>
</template>

<script setup>
import { inject, ref } from 'vue'

// One chart of the sales report: its title, what it shows, a legend for
// more than one series, and the same numbers as a table.
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  // [{ label, color }]
  legend: { type: Array, default: () => [] },
  // 'line' for line charts, 'square' for bars
  legendShape: { type: String, default: 'square' },
  // { columns: [...], rows: [[...]] }, the chart's table view
  table: { type: Object, default: null },
  empty: { type: Boolean, default: false }
})

// the PDF is the charts alone, without buttons
const exporting = inject('exportingPdf', ref(false))
const showTable = ref(false)
</script>

<style scoped>
.chart-card {
  min-width: 0;
  padding: 22px 22px 20px;

  border: 1px solid var(--card-line);
  background: var(--card);

  break-inside: avoid;
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px 18px;
}

.card-titles {
  min-width: 0;
}

.card-title {
  margin: 0;

  color: var(--ink);
  font-family: 'Noto Sans TC', 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
}

.card-subtitle {
  margin: 4px 0 0;

  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

.card-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.card-toggle {
  min-height: 30px;
  padding: 0 11px;

  border: 1px solid var(--line);
  border-radius: 0;
  background: transparent;

  color: var(--muted);
  font-family: inherit;
  font-size: 11px;

  cursor: pointer;
}

.card-toggle:hover,
.card-toggle[aria-pressed='true'] {
  border-color: var(--accent);
  color: var(--accent);
}

.card-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;

  margin: 14px 0 0;
  padding: 0;

  list-style: none;

  color: var(--ink-soft);
  font-size: 12px;
}

.card-legend li {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.legend-key {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.legend-key.line {
  width: 16px;
  height: 2px;
  border-radius: 1px;
}

.card-body {
  margin-top: 16px;
}

.card-empty {
  margin: 28px 0 12px;

  color: var(--muted);
  font-size: 13px;
  text-align: center;
}

.card-table {
  max-height: 420px;
  margin-top: 16px;
  overflow: auto;
}

.card-table table {
  width: 100%;
  border-collapse: collapse;

  font-size: 12.5px;
}

.card-table th,
.card-table td {
  padding: 9px 12px 9px 0;

  border-bottom: 1px solid var(--line-soft);

  text-align: left;
  font-weight: 400;
  white-space: nowrap;
}

.card-table thead th {
  position: sticky;
  top: 0;

  background: var(--card-solid);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}

.card-table tbody th {
  color: var(--ink-soft);
}

.card-table td {
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.card-table thead th:not(:first-child) {
  text-align: right;
}
</style>
