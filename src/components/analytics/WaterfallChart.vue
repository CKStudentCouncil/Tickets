<template>
  <div class="waterfall">
    <ol class="fall" :aria-label="label">
      <li
        v-for="(row, i) in rows"
        :key="row.key"
        class="fall-row"
        :class="[row.kind, { active: active === i }]"
        @pointerenter="active = i"
        @pointerdown="active = i"
        @pointerleave="leave"
      >
        <span class="fall-label">{{ row.label }}</span>
        <span class="fall-track" aria-hidden="true">
          <span v-if="crossesZero" class="fall-zero" :style="{ left: pct(0) }" />
          <span v-if="i > 0" class="fall-link" :style="{ left: pct(row.link) }" />
          <span class="fall-bar" :style="barStyle(row)" />
        </span>
        <span class="fall-value num">{{ row.text }}</span>
      </li>
    </ol>
    <p class="fall-readout" aria-hidden="true">{{ readout }}</p>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

// A bridge from income to what is left: each income step adds to the
// running total, each expense takes from it, and a total row shows where
// it stands. Plain HTML, like BarList; every step's amount is written
// beside it and the card's table view has the running totals.
const props = defineProps({
  // [{ key, label, kind: 'income' | 'expense' | 'total', value }]; an
  // expense's value is the amount spent (positive); a total takes none
  steps: { type: Array, required: true },
  // { income, expense, total }
  colors: { type: Object, required: true },
  format: { type: Function, required: true },
  label: { type: String, required: true }
})

const active = ref(null)

// each row's bar from → to, and `link`: the running total it starts from
const rows = computed(() => {
  let running = 0
  return props.steps.map((step) => {
    const before = running
    if (step.kind === 'total') {
      return { ...step, from: 0, to: running, link: running, total: running, text: signed(running) }
    }
    running += step.kind === 'income' ? step.value : -step.value
    return {
      ...step,
      from: before,
      to: running,
      link: before,
      total: running,
      text: `${step.kind === 'income' ? '+' : '−'}${props.format(step.value)}`
    }
  })
})

function signed(value) {
  return value < 0 ? `−${props.format(-value)}` : props.format(value)
}

const low = computed(() => Math.min(0, ...rows.value.flatMap((row) => [row.from, row.to])))
const high = computed(() => Math.max(0, ...rows.value.flatMap((row) => [row.from, row.to])))
const crossesZero = computed(() => low.value < 0)
const pct = (value) => `${((value - low.value) / (high.value - low.value || 1)) * 100}%`

function barStyle(row) {
  const start = Math.min(row.from, row.to)
  const end = Math.max(row.from, row.to)
  return {
    left: pct(start),
    width: `calc(${pct(end)} - ${pct(start)})`,
    background: props.colors[row.kind]
  }
}

const readout = computed(() => {
  const row = rows.value[active.value]
  if (!row) return ''
  return row.kind === 'total' ? `${row.label}　${row.text}` : `${row.label}　${row.text}，累計 ${signed(row.total)}`
})

// a finger lifting off keeps the readout; a mouse leaving clears it
function leave(event) {
  if (event.pointerType === 'mouse') active.value = null
}
</script>

<style scoped>
.fall {
  margin: 0;
  padding: 0;

  list-style: none;
}

/* every row the same height, so a link reaches the bar above */
.fall-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) 108px;
  align-items: center;
  gap: 12px;

  height: 32px;
}

.fall-row.active {
  background: var(--line-soft);
}

.fall-label {
  overflow: hidden;

  color: var(--ink-soft);
  font-size: 12.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fall-row.total .fall-label {
  color: var(--ink);
  font-weight: 700;
}

.fall-track {
  position: relative;

  height: 12px;
}

.fall-bar {
  position: absolute;
  top: 0;

  min-width: 2px;
  height: 100%;

  border-radius: 2px;
}

/* from the bar above's end down to this one's start */
.fall-link {
  position: absolute;
  bottom: 100%;

  height: 20px;

  border-left: 1px dashed var(--muted);
  opacity: .6;
}

.fall-zero {
  position: absolute;
  top: -10px;
  bottom: -10px;

  border-left: 1px solid var(--line);
}

.fall-value {
  color: var(--ink);
  font-size: 12px;
  text-align: right;
  white-space: nowrap;
}

.fall-row.total .fall-value {
  font-weight: 700;
}

.num {
  font-variant-numeric: tabular-nums;
}

.fall-readout {
  min-height: 18px;
  margin: 10px 0 0;

  color: var(--ink-soft);
  font-size: 12px;
}

/* narrower names and amounts leave the bars room on a phone */
@media (max-width: 480px) {
  .fall-row {
    grid-template-columns: 60px minmax(0, 1fr) 88px;
    gap: 8px;
  }

  .fall-label {
    font-size: 12px;
  }

  .fall-value {
    font-size: 11px;
  }
}
</style>
