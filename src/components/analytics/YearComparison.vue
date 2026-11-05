<template>
  <div class="compare-grid">
    <section v-if="scorecard" class="scorecard wide" aria-labelledby="scorecard-title">
      <h3 id="scorecard-title" class="group-title">{{ scorecard.year }} 年重點指標</h3>
      <p class="group-note">{{ scorecard.note }}</p>
      <div class="kpi-grid">
        <article v-for="kpi in scorecard.kpis" :key="kpi.key" class="kpi">
          <p class="kpi-label">{{ kpi.label }}</p>
          <p class="kpi-value num">{{ kpi.value }}</p>
          <p v-if="kpi.previous" class="kpi-compare">
            <span v-if="kpi.change" class="kpi-change" :class="kpi.change.tone">
              <span aria-hidden="true">{{ ARROWS[kpi.change.direction] }}</span>
              <span class="sr-only">{{ CHANGE_WORDS[kpi.change.direction] }}</span>
              {{ kpi.change.text }}
            </span>
            <span>{{ scorecard.previous }} 年 {{ kpi.previous }}</span>
          </p>
          <p v-if="kpi.note" class="kpi-note">{{ kpi.note }}</p>
          <Sparkline v-if="kpi.trend.length > 1" class="kpi-trend" :values="kpi.trend" :label="kpi.trendLabel" />
        </article>
      </div>
    </section>

    <template v-for="card in cards" :key="card.key">
      <h3 v-if="card.kind === 'heading'" class="group-title wide">{{ card.title }}</h3>
      <ChartCard
        v-else
        :class="{ wide: card.wide }"
        :title="card.title"
        :subtitle="card.subtitle"
        :legend="card.legend"
        :legend-shape="card.legendShape"
        :table="card.table"
        :empty="card.empty"
      >
        <template v-if="card.years?.length > 1" #controls>
          <label class="year-select">
            <span class="sr-only">年度</span>
            <select :value="card.chosen" @change="bridgeYear = Number($event.target.value)">
              <option v-for="year in card.years" :key="year" :value="year">{{ year }} 年</option>
            </select>
          </label>
        </template>
        <ColumnChart v-if="card.kind === 'column'" v-bind="card.chart" />
        <LineChart v-else-if="card.kind === 'line'" v-bind="card.chart" />
        <HeatGrid v-else-if="card.kind === 'heat'" v-bind="card.chart" />
        <WaterfallChart v-else-if="card.kind === 'waterfall'" v-bind="card.chart" />
        <ShareBar v-else v-bind="card.chart" />
      </ChartCard>
    </template>
  </div>
</template>

<script setup>
import { computed, provide, ref } from 'vue'
import ChartCard from './ChartCard.vue'
import ColumnChart from './ColumnChart.vue'
import HeatGrid from './HeatGrid.vue'
import LineChart from './LineChart.vue'
import ShareBar from './ShareBar.vue'
import Sparkline from './Sparkline.vue'
import WaterfallChart from './WaterfallChart.vue'
import { SCREEN_PALETTE } from 'src/data/chartPalette'
import {
  EXPENSE_CATEGORIES,
  balanceOf,
  expensesByCategory,
  identityTicketsOf,
  paceStats,
  salePaces
} from 'src/utils/historyData'
import { IDENTITY_GROUPS, formatCompact, formatCount, formatCurrency, formatDay, formatPercent } from 'src/utils/salesAnalytics'

// 歷年資料 (/super_admin/history): every year's sales, money, buyers and
// surveys side by side, from what the page already read (no further reads).
// The latest archived year's headline numbers lead, then the charts in
// three groups.
const props = defineProps({
  // historyYears(records), latest first
  years: { type: Array, required: true },
  // the page's records: the archives (byDay, bySchool, paidRevenue), the
  // claims and the 學弟賣票 registrations
  records: { type: Object, required: true }
})

// The cards sit on the stat tiles' colour (--field), which their SVG marks
// ring themselves with
const palette = { ...SCREEN_PALETTE, surface: '#0d0f13' }
provide('chartPalette', ref(palette))

const DAY_MS = 86_400_000
const PACE_YEARS = 3
// groups[0–2] stay apart in every pair, for series side by side or lines
// that cross. Money in is FIRST and money out SECOND wherever both show.
const [FIRST, SECOND, THIRD] = palette.groups
// the waterfall's totals: a neutral lighter than FIRST and SECOND, so it
// stays apart from both
const TOTAL = '#b4b9bf'
// 科目' slots: groups[0–6], then crimson for 未分類; grey or brown sit too
// close to 其他's teal beside it
const CATEGORY_SLOTS = [0, 1, 2, 3, 4, 5, 6, 8]
const IDENTITY_SLOTS = IDENTITY_GROUPS.map((_, i) => i)

const ARROWS = { up: '▲', down: '▼', flat: '' }
const CHANGE_WORDS = { up: '增加', down: '減少', flat: '' }

const formatTickets = (n) => (n == null ? '—' : `${formatCount(n)} 張`)
const formatPerOrder = (n) => (n == null ? '—' : `${n.toFixed(2)} 張`)
const formatDays = (n) => (n == null ? '—' : `${n} 天`)
const formatIndex = (n) => (n == null ? '—' : String(Math.round(n)))
const formatFraction = (n) => String(Number(n.toFixed(2)))
const formatPercentTick = (n) => `${Math.round(n * 100)}%`
const signedCurrency = (n) => (n == null ? '—' : n < 0 ? `−${formatCurrency(-n)}` : formatCurrency(n))
const sum = (list) => list.reduce((total, n) => total + n, 0)
const dayOf = (pace, day) => formatDay(new Date(pace.start + day * DAY_MS))
const legendOf = (series) => (series.length > 1 ? series.map(({ label, color }) => ({ label, color })) : [])
const heading = (key, title) => ({ key: `heading-${key}`, kind: 'heading', title })

// oldest first, left to right
const timeline = computed(() => [...props.years].reverse())
// the years with archived orders, oldest first
const archived = computed(() => timeline.value.filter((item) => item.archive))
const archiveOf = (year) => (props.records.archives || []).find((archive) => Number(archive.id) === year)

// per-ticket figures; a year without claims has no cost, not NT$0
const priceOf = (item) => (item.archive.ticketCount ? item.archive.revenue / item.archive.ticketCount : null)
const costOf = (item) => (item.reimbursements && item.archive.ticketCount ? item.spent / item.archive.ticketCount : null)
const spentOf = (item) => (item.reimbursements ? item.spent : null)

// ---- 重點指標: the latest archived year against the one before ----

// `absolute`: the change in NT$ (a profit may cross zero); `inverse`: down
// is the good direction
function changeOf(now, then, { absolute = false, inverse = false } = {}) {
  if (now == null || then == null || (!absolute && !then)) return null
  const diff = now - then
  const size = absolute ? Math.abs(diff) : Math.abs(diff / then)
  if (absolute ? size < 1 : size < 0.0005) return { direction: 'flat', tone: 'flat', text: '持平' }
  return {
    direction: diff > 0 ? 'up' : 'down',
    tone: (diff > 0) !== inverse ? 'good' : 'bad',
    text: absolute ? formatCurrency(size) : formatPercent(size)
  }
}

const scorecard = computed(() => {
  const list = archived.value
  if (!list.length) return null
  const latest = list[list.length - 1]
  const before = list.length > 1 ? list[list.length - 2] : null
  const profits = new Map(list.map((item) => [item.year, balanceOf(props.records, item.year)?.balance ?? null]))
  const span = `${list[0].year}–${latest.year}`

  const metrics = [
    { key: 'revenue', label: '訂單金額', of: (item) => item.archive.revenue, format: formatCurrency },
    { key: 'tickets', label: '售出張數', of: (item) => item.archive.ticketCount, format: formatTickets },
    { key: 'price', label: '平均票價', of: priceOf, format: formatCurrency, note: '含 NT$0 的公關票' },
    { key: 'spent', label: '報帳支出', of: spentOf, format: formatCurrency, inverse: true, note: '已核准與已撥款' },
    { key: 'cost', label: '每張票成本', of: costOf, format: formatCurrency, inverse: true, note: '報帳支出除以售出張數' },
    { key: 'profit', label: '目前利潤', of: (item) => profits.get(item.year), format: signedCurrency, absolute: true, note: '和收支頁的「目前利潤」相同' }
  ]

  return {
    year: latest.year,
    previous: before?.year ?? null,
    note: before
      ? `和 ${before.year} 年相比；小圖是 ${span} 年的走勢，亮點是 ${latest.year} 年`
      : '只有一年封存或匯入的資料，還不能和前一年比',
    kpis: metrics.map((metric) => {
      const trend = list.map(metric.of)
      return {
        key: metric.key,
        label: metric.label,
        value: metric.format(metric.of(latest)),
        previous: before ? metric.format(metric.of(before)) : '',
        change: before ? changeOf(metric.of(latest), metric.of(before), metric) : null,
        note: metric.note,
        trend,
        trendLabel: `${metric.label} ${span} 年：${list.map((item, i) => `${item.year} 年 ${metric.format(trend[i])}`).join('、')}`
      }
    })
  }
})

// ---- the charts ----

// A row per year, a column per series
const tableOf = (items, series, format) => ({
  columns: ['年度', ...series.map((item) => item.label)],
  rows: items.map((item, i) => [`${item.year} 年`, ...series.map((entry) => format(entry.values[i]))])
})

function columnCard({ key, title, subtitle, items, series, format, axisFormat = formatCount, integer = false, table = null }) {
  return {
    key,
    kind: 'column',
    title,
    subtitle,
    legend: legendOf(series),
    table: table || tableOf(items, series, format),
    empty: !items.length,
    chart: {
      labels: items.map((item) => String(item.year)),
      series,
      label: `${title}，依年度比較`,
      format,
      axisFormat,
      integer,
      tooltipTitle: (i) => `${items[i].year} 年`
    }
  }
}

// One part-to-whole bar a year, latest on top. A category no year has is
// left out; the others keep their colour slot.
//   bars [{ label, values: [n per category] }]
function shareCard({ key, title, subtitle, header, unit, categories, slots, bars, format }) {
  const kept = categories.map((_, i) => i).filter((i) => bars.some((bar) => bar.values[i] > 0))
  const shaped = bars.map((bar) => {
    const total = sum(bar.values)
    return {
      label: bar.label,
      segments: kept.map((i) => ({
        key: categories[i],
        label: categories[i],
        value: bar.values[i],
        share: total ? bar.values[i] / total : 0,
        color: palette.groups[slots[i]],
        textColor: palette.groupText[slots[i]]
      }))
    }
  })
  return {
    key,
    kind: 'share',
    wide: true,
    title,
    subtitle,
    legend: [],
    empty: !shaped.length,
    table: {
      columns: [header, ...shaped.flatMap((bar) => [`${bar.label}${unit}`, `${bar.label}占比`])],
      rows: kept.map((i, k) => [
        categories[i],
        ...shaped.flatMap((bar) => [format(bar.segments[k].value), formatPercent(bar.segments[k].share)])
      ])
    },
    chart: { bars: shaped, format }
  }
}

// 收支瀑布圖: the chosen year from its collected income to its 目前利潤
const bridgeYear = ref(null)

function bridgeCard(list) {
  const years = list.map((item) => item.year).reverse()
  const year = years.includes(bridgeYear.value) ? bridgeYear.value : years[0]
  const balance = year ? balanceOf(props.records, year) : null
  const incomes = balance
    ? [
        { key: 'orders', label: '訂單收入', kind: 'income', value: balance.orders },
        { key: 'sellers', label: '學弟賣票', kind: 'income', value: balance.sellers }
      ].filter((step) => step.value > 0)
    : []
  const steps = balance
    ? [
        ...incomes,
        ...(incomes.length > 1 ? [{ key: 'income', label: '已收款收入', kind: 'total' }] : []),
        ...EXPENSE_CATEGORIES
          .map((name, i) => ({ key: `expense-${name}`, label: name, kind: 'expense', value: balance.expenses[i] }))
          .filter((step) => step.value > 0),
        { key: 'profit', label: '目前利潤', kind: 'total' }
      ]
    : []

  let running = 0
  const rows = steps.map((step) => {
    if (step.kind !== 'total') running += step.kind === 'income' ? step.value : -step.value
    const amount = step.kind === 'total'
      ? signedCurrency(running)
      : `${step.kind === 'income' ? '+' : '−'}${formatCurrency(step.value)}`
    return [step.label, amount, signedCurrency(running)]
  })

  return {
    key: 'bridge',
    kind: 'waterfall',
    wide: true,
    title: '收支瀑布圖',
    subtitle: '已收款收入逐一扣掉各科目已核准與已撥款的報帳，得到目前利潤；算法和收支頁相同',
    legend: [{ label: '收入', color: FIRST }, { label: '支出', color: SECOND }, { label: '合計', color: TOTAL }],
    years,
    chosen: year,
    table: { columns: ['項目', '金額', '累計'], rows },
    empty: !steps.length,
    chart: {
      steps,
      colors: { income: FIRST, expense: SECOND, total: TOTAL },
      format: formatCurrency,
      label: year ? `${year} 年收支瀑布圖，從已收款收入到目前利潤` : '收支瀑布圖'
    }
  }
}

// 成長指數: each measure against the first archived year's, on one axis
function growthCard(list) {
  const base = list[0]
  const measures = [
    { key: 'revenue', label: '訂單金額', color: FIRST, of: (item) => item.archive.revenue, format: formatCurrency },
    { key: 'spent', label: '報帳支出', color: SECOND, of: spentOf, format: formatCurrency },
    { key: 'tickets', label: '售出張數', color: THIRD, of: (item) => item.archive.ticketCount, format: formatTickets }
  ]
  const series = list.length < 2
    ? []
    : measures
      .filter((measure) => measure.of(base) > 0)
      .map((measure) => ({
        key: measure.key,
        label: measure.label,
        color: measure.color,
        values: list.map((item) => (measure.of(item) == null ? null : (measure.of(item) / measure.of(base)) * 100)),
        detail: (i) => measure.format(measure.of(list[i]))
      }))

  return {
    key: 'growth',
    kind: 'line',
    wide: true,
    title: '成長指數',
    subtitle: base
      ? `以 ${base.year} 年為 100，比較訂單金額、報帳支出和售出張數各自成長多少；支出線高過訂單金額線，代表花費成長得比收入快`
      : '',
    legend: legendOf(series),
    legendShape: 'line',
    table: tableOf(list, series, formatIndex),
    empty: !series.length,
    chart: {
      series,
      label: base ? `成長指數，以 ${base.year} 年為 100` : '成長指數',
      format: formatIndex,
      axisFormat: formatIndex,
      xLabel: (i) => String(list[i].year),
      tooltipTitle: (i) => `${list[i].year} 年（${base.year} 年 = 100）`
    }
  }
}

// A row per day of sale, a column per year: `field` of each pace with its date
function dayTable(paces, field) {
  const days = Math.max(0, ...paces.map((pace) => pace.daily.length))
  return {
    columns: ['天數', ...paces.map((pace) => `${pace.year} 年`)],
    rows: Array.from({ length: days }, (_, day) => [
      `第 ${day + 1} 天`,
      ...paces.map((pace) => (day < pace.daily.length ? `${formatTickets(pace[field][day])}　${dayOf(pace, day)}` : '—'))
    ])
  }
}

// 銷售進度: the latest sales' running totals, the newest on top
function paceCard(paces) {
  const series = paces.map((pace, i) => ({
    key: String(pace.year),
    label: `${pace.year} 年`,
    color: [FIRST, SECOND, THIRD][i],
    values: pace.tickets,
    detail: (day) => dayOf(pace, day)
  }))
  return {
    key: 'pace',
    kind: 'line',
    wide: true,
    title: '銷售進度',
    subtitle: `從開賣日起每天累計賣出的票，比較最近 ${PACE_YEARS} 年賣票的速度；開賣前的訂單算在第 1 天`,
    legend: legendOf(series),
    legendShape: 'line',
    table: dayTable(paces, 'tickets'),
    empty: !series.length,
    chart: {
      series,
      label: '銷售進度，各年從開賣日起累計賣出的票',
      format: formatTickets,
      axisFormat: formatCompact,
      xLabel: (i) => `第 ${i + 1} 天`,
      tooltipTitle: (i) => `開賣第 ${i + 1} 天`,
      xStepOffset: 1,
      integer: true
    }
  }
}

// 每日銷售: every sale's days, one hue faint to full by tickets
function heatCard(paces) {
  const days = Math.max(0, ...paces.map((pace) => pace.daily.length))
  return {
    key: 'daily',
    kind: 'heat',
    wide: true,
    title: '每日銷售',
    subtitle: '開賣後每天賣出的票，顏色越深賣得越多；每一個封存或匯入的年份都在這裡',
    legend: [],
    table: dayTable(paces, 'daily'),
    empty: !paces.length,
    chart: {
      rows: paces.map((pace) => String(pace.year)),
      columns: Array.from({ length: days }, (_, day) => String(day + 1)),
      values: paces.map((pace) => Array.from({ length: days }, (_, day) => pace.daily[day] ?? 0)),
      color: palette.current,
      label: '每日銷售，各年開賣後每天賣出的票',
      rowWidth: '40px',
      describe: (r, c, value) => (c < paces[r].daily.length
        ? `${paces[r].year} 年開賣第 ${c + 1} 天，${dayOf(paces[r], c)}：${formatTickets(value)}`
        : `${paces[r].year} 年只賣了 ${paces[r].daily.length} 天`)
    }
  }
}

const cards = computed(() => {
  const list = archived.value
  const funded = timeline.value.filter((item) => item.archive || item.spent)
  const counted = list.filter((item) => item.archive.orderCount && item.archive.ticketCount)
  const surveyed = timeline.value.filter((item) => item.surveyResponses || item.partySurveyResponses)
  const selling = timeline.value.filter((item) => item.sellers || item.sellerRegistrations)
  const paces = salePaces(props.records.archives || [], Infinity)
  // oldest first, with how front-loaded each sale was
  const paced = [...paces].reverse()
    .map((pace) => ({ year: pace.year, stats: paceStats(pace) }))
    .filter((item) => item.stats)

  return [
    heading('money', '收支'),
    columnCard({
      key: 'money',
      title: '訂單金額與報帳支出',
      subtitle: '訂單金額含還沒收款的訂單；報帳支出只算已核准與已撥款',
      items: funded,
      series: [
        {
          key: 'revenue',
          label: '訂單金額',
          color: FIRST,
          values: funded.map((item) => item.archive?.revenue ?? null),
          // no column is not NT$0: the orders are still live
          detail: (i) => (funded[i].archive ? '' : '訂單還沒清除封存')
        },
        { key: 'spent', label: '報帳支出', color: SECOND, values: funded.map((item) => item.spent) }
      ],
      format: formatCurrency,
      axisFormat: formatCompact
    }),
    columnCard({
      key: 'unit',
      title: '每張票的收入與成本',
      subtitle: '都除以售出張數；平均票價含 NT$0 的公關票',
      items: counted,
      series: [
        { key: 'price', label: '平均票價', color: FIRST, values: counted.map(priceOf) },
        { key: 'cost', label: '每張票成本', color: SECOND, values: counted.map(costOf) }
      ],
      format: formatCurrency,
      axisFormat: formatCompact
    }),
    bridgeCard(list),
    shareCard({
      key: 'expenses',
      title: '報帳支出科目',
      subtitle: '每年已核准與已撥款的報帳花在哪些科目，和收支表的科目相同',
      header: '科目',
      unit: '金額',
      categories: EXPENSE_CATEGORIES,
      slots: CATEGORY_SLOTS,
      bars: props.years
        .filter((item) => item.spent)
        .map((item) => ({ label: `${item.year} 年`, values: expensesByCategory(props.records.reimbursements, item.year) })),
      format: formatCurrency
    }),

    heading('sales', '銷售'),
    columnCard({
      key: 'sold',
      title: '售出張數',
      subtitle: '封存或匯入的訂單共賣出的票',
      items: list,
      series: [{
        key: 'tickets',
        label: '售出張數',
        color: palette.current,
        values: list.map((item) => item.archive.ticketCount),
        detail: (i) => `${formatCount(list[i].archive.orderCount)} 筆訂單`
      }],
      format: formatTickets,
      table: {
        columns: ['年度', '售出張數', '訂單數'],
        rows: list.map((item) => [`${item.year} 年`, formatTickets(item.archive.ticketCount), formatCount(item.archive.orderCount)])
      }
    }),
    columnCard({
      key: 'perOrder',
      title: '每筆訂單張數',
      subtitle: '售出張數除以訂單數，一筆訂單平均買幾張',
      items: counted,
      series: [{
        key: 'perOrder',
        label: '每筆訂單張數',
        color: palette.current,
        values: counted.map((item) => item.archive.ticketCount / item.archive.orderCount)
      }],
      format: formatPerOrder,
      axisFormat: formatFraction
    }),
    growthCard(list),
    paceCard(paces.slice(0, PACE_YEARS)),
    columnCard({
      key: 'speed',
      title: '賣出一半與九成的票花了幾天',
      subtitle: '開賣日算第 1 天；天數越少賣得越快',
      items: paced,
      series: [
        { key: 'half', label: '賣出一半', color: FIRST, values: paced.map((item) => item.stats.half) },
        { key: 'most', label: '賣出九成', color: SECOND, values: paced.map((item) => item.stats.most) }
      ],
      format: formatDays,
      integer: true
    }),
    columnCard({
      key: 'front',
      title: '首日與首週賣出的比例',
      subtitle: '開賣第 1 天與前 7 天賣出的票占全部的比例；開賣前的訂單算在第 1 天',
      items: paced,
      series: [
        { key: 'day', label: '首日', color: FIRST, values: paced.map((item) => item.stats.firstDay) },
        { key: 'week', label: '首週', color: SECOND, values: paced.map((item) => item.stats.firstWeek) }
      ],
      format: formatPercent,
      axisFormat: formatPercentTick
    }),
    heatCard(paces),

    heading('people', '購買者與參與'),
    shareCard({
      key: 'identities',
      title: '購買者身分',
      subtitle: '每年賣出的票各是哪種身分買的，分法和銷售報表相同',
      header: '身分',
      unit: '張數',
      categories: IDENTITY_GROUPS.map((group) => group.label),
      slots: IDENTITY_SLOTS,
      bars: [...list].reverse()
        .map((item) => ({ label: `${item.year} 年`, values: identityTicketsOf(archiveOf(item.year)) }))
        .filter((bar) => sum(bar.values) > 0),
      format: formatTickets
    }),
    columnCard({
      key: 'surveys',
      title: '問卷回覆',
      subtitle: '購票系統問卷依填寫的年份，舞會滿意度調查依舞會年度',
      items: surveyed,
      series: [
        { key: 'survey', label: '購票系統問卷', color: FIRST, values: surveyed.map((item) => item.surveyResponses) },
        { key: 'party', label: '舞會滿意度調查', color: SECOND, values: surveyed.map((item) => item.partySurveyResponses) }
      ],
      format: formatCount
    }),
    columnCard({
      key: 'sellers',
      title: '學弟賣票',
      subtitle: '名單是當年加入的人數，登記依登記的年份',
      items: selling,
      series: [
        { key: 'sellers', label: '名單（當年加入）', color: FIRST, values: selling.map((item) => item.sellers) },
        { key: 'registrations', label: '登記', color: SECOND, values: selling.map((item) => item.sellerRegistrations) }
      ],
      format: formatCount
    })
  ]
})
</script>

<style scoped>
/* the chart components' colours, from the admin pages' */
.compare-grid {
  --ink: var(--off-white);
  --ink-soft: rgba(242, 240, 233, 0.78);
  --muted: #8d959e;
  --accent: var(--ember);
  --card: var(--field);
  --card-solid: var(--field);
  --card-line: var(--line-soft);
  --tooltip: #11151b;
  --focus: rgba(228, 164, 104, 0.55);
  --success: #9bbda3;

  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
  gap: 12px;
}

.wide {
  grid-column: 1 / -1;
}

/* ---------- groups ---------- */

/* its own line height: Quasar's h3 has a display one */
.group-title {
  margin: 0;

  color: var(--ink);
  font-family: 'Noto Sans TC', 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
}

/* a group after the one above starts with a rule */
.compare-grid > .group-title {
  margin-top: 22px;
  padding-top: 22px;

  border-top: 1px solid var(--line-soft);
}

.group-note {
  margin: 4px 0 14px;

  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

/* ---------- 重點指標 ---------- */

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;

  border: 1px solid var(--card-line);
  background: var(--card-line);
}

.kpi {
  display: flex;
  flex-direction: column;

  min-width: 0;
  padding: 18px 20px;

  background: var(--card-solid);
}

.kpi-label {
  margin: 0;

  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.kpi-value {
  margin: 8px 0 0;

  color: var(--ink);
  font-size: clamp(19px, 2.2vw, 26px);
  font-weight: 600;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.kpi-compare {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 10px;

  margin: 8px 0 0;

  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.kpi-change {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  font-weight: 700;
}

.kpi-change.good {
  color: var(--success);
}

.kpi-change.bad {
  color: var(--danger);
}

.kpi-change.flat {
  color: var(--ink-soft);
}

.kpi-note {
  margin: 4px 0 0;

  color: var(--muted);
  font-size: 11px;
  line-height: 1.6;
}

/* the trends line up at the tiles' feet */
.kpi-trend {
  margin-top: auto;
  padding-top: 14px;
}

.num {
  font-variant-numeric: tabular-nums;
}

/* ---------- controls ---------- */

.year-select select {
  min-height: 30px;
  padding: 0 10px;

  border: 1px solid var(--line);
  border-radius: 0;
  background: var(--card-solid);

  color: var(--ink);
  font-family: inherit;
  font-size: 12px;

  cursor: pointer;
}

.year-select select:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
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

@media (max-width: 720px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .kpi {
    padding: 14px;
  }
}

@media (max-width: 480px) {
  /* the panel's own padding is enough on a phone */
  .compare-grid :deep(.chart-card) {
    padding: 16px 14px;
  }
}
</style>
