<template>
  <div ref="root" class="share">
    <div v-for="bar in bars" :key="bar.label" class="share-row">
      <span class="share-name">{{ bar.label }}</span>
      <span class="share-bar">
        <span
          v-for="(segment, i) in visibleOf(bar)"
          :key="segment.key"
          class="share-segment"
          :class="{ last: i === visibleOf(bar).length - 1 }"
          :style="{ flexGrow: segment.value, background: segment.color }"
          @pointerenter="active = { bar, segment }"
          @pointerdown="active = { bar, segment }"
          @pointerleave="active = null"
        >
          <span v-if="fits(segment)" class="segment-label" :style="{ color: segment.textColor }">
            {{ formatPercent(segment.share) }}
          </span>
        </span>
        <span v-if="!visibleOf(bar).length" class="share-empty">尚無資料</span>
      </span>
    </div>

    <!-- every value stays readable without hovering (and on paper) -->
    <div class="share-legend-wrap">
      <table class="share-legend">
        <thead>
          <tr>
            <th scope="col"><span class="sr-only">類別</span></th>
            <th v-for="bar in bars" :key="bar.label" scope="col">{{ bar.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(segment, i) in bars[0]?.segments || []" :key="segment.key">
            <th scope="row">
              <span class="swatch" :style="{ background: segment.color }" aria-hidden="true" />
              {{ segment.label }}
            </th>
            <td v-for="bar in bars" :key="bar.label" class="num">{{ formatPercent(bar.segments[i].share) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="share-readout" aria-hidden="true">{{ readout }}</p>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatPercent } from 'src/utils/salesAnalytics'

// Part-to-whole as one bar per year. Each category keeps its colour slot
// whatever a year sold; plain HTML, so the PDF export draws it as shown.
const props = defineProps({
  // [{ label, segments: [{ key, label, value, share, color, textColor }] }], same categories in each
  bars: { type: Array, required: true },
  format: { type: Function, required: true }
})

const root = ref(null)
const width = ref(600)
const active = ref(null)
let observer = null

onMounted(() => {
  observer = new ResizeObserver(([entry]) => { width.value = entry.contentRect.width })
  observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

const visibleOf = (bar) => bar.segments.filter((segment) => segment.value > 0)
// a share is written inside its segment only when it fits with room to spare
const fits = (segment) => segment.share * (width.value - 84) >= 48

const readout = computed(() => (active.value
  ? `${active.value.segment.label}・${active.value.bar.label}：${props.format(active.value.segment.value)}（${formatPercent(active.value.segment.share)}）`
  : ''))
</script>

<style scoped>
.share-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: center;
  gap: 12px;

  margin-bottom: 10px;
}

.share-name {
  color: var(--ink-soft);
  font-size: 12px;
}

.share-bar {
  position: relative;
  display: flex;
  gap: 2px;

  height: 24px;
}

.share-segment {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;

  min-width: 0;

  transition: filter .2s ease;
}

/* the data end is rounded; the baseline stays square */
.share-segment.last {
  border-radius: 0 4px 4px 0;
}

.share-segment:hover {
  filter: brightness(1.15);
}

.segment-label {
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.share-empty {
  display: flex;
  align-items: center;

  color: var(--muted);
  font-size: 12px;
}

/* with many bars, the table scrolls rather than widening the page */
.share-legend-wrap {
  margin-top: 14px;
  overflow-x: auto;
}

.share-legend {
  border-collapse: collapse;

  font-size: 12px;
}

.share-legend th,
.share-legend td {
  padding: 5px 22px 5px 0;

  text-align: left;
  font-weight: 400;
  white-space: nowrap;
}

.share-legend thead th {
  color: var(--muted);
  font-size: 11px;
}

.share-legend tbody th {
  color: var(--ink-soft);
}

.share-legend td {
  color: var(--ink);
  text-align: right;
}

.swatch {
  display: inline-block;

  width: 10px;
  height: 10px;
  margin-right: 8px;

  border-radius: 2px;
}

.share-readout {
  min-height: 18px;
  margin: 8px 0 0;

  color: var(--ink-soft);
  font-size: 12px;
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
  .share-segment {
    transition: none;
  }
}
</style>
