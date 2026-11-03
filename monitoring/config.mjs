// What `node monitoring/deploy.mjs` sets up in Cloud Logging / Monitoring for
// watching createOrder during a sale opening: log-based metrics over the one
// line each call writes (functions/lib/checkoutLog.js), a dashboard and alert
// policies. See monitoring/README.md.

// createOrder is a 2nd gen function: Cloud Run service `createorder`
export const SERVICE = 'createorder'
export const DASHBOARD_NAME = '購票即時監控'
const ALERT_PREFIX = '購票：'

const LOG_FILTER = [
  'resource.type="cloud_run_revision"',
  `resource.labels.service_name="${SERVICE}"`,
  'jsonPayload.metric="checkout"'
].join(' AND ')

const label = (key, description) => ({ key, valueType: 'STRING', description })
const extract = (field) => `EXTRACT(jsonPayload.${field})`
// 10 ms to about 75 s
const MS_BUCKETS = { exponentialBuckets: { numFiniteBuckets: 40, growthFactor: 1.25, scale: 10 } }

function msDistribution(name, field, description, { filter = '', labels = [] } = {}) {
  return {
    name,
    description,
    filter: [LOG_FILTER, `jsonPayload.${field}:*`, filter].filter(Boolean).join(' AND '),
    metricDescriptor: { metricKind: 'DELTA', valueType: 'DISTRIBUTION', unit: 'ms', labels: labels.map(([key, text]) => label(key, text)) },
    valueExtractor: extract(field),
    labelExtractors: Object.fromEntries(labels.map(([key]) => [key, extract(key)])),
    bucketOptions: MS_BUCKETS
  }
}

export const METRICS = [
  {
    name: 'checkout_count',
    description: 'createOrder calls by outcome, error code and stock gate result',
    filter: LOG_FILTER,
    metricDescriptor: {
      metricKind: 'DELTA',
      valueType: 'INT64',
      unit: '1',
      labels: [
        label('outcome', 'created, replayed, sold_out, busy, rejected or error'),
        label('code', 'HttpsError code sent to the buyer, or ok'),
        label('gate', 'off, admitted, turned_away or no_answer')
      ]
    },
    labelExtractors: { outcome: extract('outcome'), code: extract('code'), gate: extract('gate') }
  },
  msDistribution('checkout_latency_ms', 'totalMs', 'Whole createOrder call', { labels: [['outcome', 'how the call ended']] }),
  msDistribution('checkout_checks_ms', 'checksMs', 'Turnstile, shop open and rate limit checks'),
  msDistribution('checkout_gate_ms', 'gateMs', 'Stock gate Redis call', { filter: 'jsonPayload.gate!="off"' }),
  msDistribution('checkout_look_ms', 'lookMs', 'Unlocked looks at the stock shards, added up per call'),
  msDistribution('checkout_tx_ms', 'txMs', 'Order transactions, all attempts added up per call'),
  {
    name: 'checkout_tx_attempts',
    description: 'Order transactions tried per call (lost races for stock shards)',
    filter: `${LOG_FILTER} AND jsonPayload.txAttempts>0`,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'DISTRIBUTION', unit: '1' },
    valueExtractor: extract('txAttempts'),
    bucketOptions: { linearBuckets: { numFiniteBuckets: 10, width: 1, offset: 0.5 } }
  }
]

/* ---------- dashboard ---------- */

const userMetric = (name, more = '') =>
  `metric.type="logging.googleapis.com/user/${name}" AND resource.type="cloud_run_revision"${more ? ` AND ${more}` : ''}`
const runMetric = (type) =>
  `metric.type="run.googleapis.com/${type}" AND resource.type="cloud_run_revision" AND resource.label.service_name="${SERVICE}"`

const PERIOD = '60s'
const rate = (groupByFields = []) => ({ alignmentPeriod: PERIOD, perSeriesAligner: 'ALIGN_RATE', crossSeriesReducer: 'REDUCE_SUM', groupByFields })
const percentile = (p, groupByFields = []) => ({ alignmentPeriod: PERIOD, perSeriesAligner: 'ALIGN_DELTA', crossSeriesReducer: `REDUCE_PERCENTILE_${p}`, groupByFields })

const series = (filter, aggregation, { plotType = 'LINE', legend } = {}) => ({
  timeSeriesQuery: { timeSeriesFilter: { filter, aggregation } },
  plotType,
  minAlignmentPeriod: PERIOD,
  ...(legend ? { legendTemplate: legend } : {})
})
const ratio = (numerator, denominator, legend) => ({
  timeSeriesQuery: {
    timeSeriesFilterRatio: {
      numerator: { filter: numerator, aggregation: rate() },
      denominator: { filter: denominator, aggregation: rate() }
    }
  },
  plotType: 'LINE',
  minAlignmentPeriod: PERIOD,
  legendTemplate: legend
})
const chart = (title, dataSets, yLabel) => ({ title, xyChart: { dataSets, timeshiftDuration: '0s', yAxis: { label: yLabel, scale: 'LINEAR' } } })

const GATE_ON = 'metric.label.gate=one_of("admitted","turned_away","no_answer")'

export function dashboard(project) {
  const widgets = [
    chart('每秒結果（依 outcome）', [
      series(userMetric('checkout_count'), rate(['metric.label.outcome']), { plotType: 'STACKED_AREA', legend: '${metric.labels.outcome}' })
    ], '次/秒'),
    chart('成功訂單總耗時', [50, 95, 99].map((p) =>
      series(userMetric('checkout_latency_ms', 'metric.label.outcome="created"'), percentile(p), { legend: `p${p}` })
    ), 'ms'),
    chart('總耗時 p95（依 outcome）', [
      series(userMetric('checkout_latency_ms'), percentile(95, ['metric.label.outcome']), { legend: '${metric.labels.outcome}' })
    ], 'ms'),
    chart('各階段耗時 p95', [
      series(userMetric('checkout_checks_ms'), percentile(95), { legend: '檢查（Turnstile 等）' }),
      series(userMetric('checkout_gate_ms'), percentile(95), { legend: 'Redis 閘門' }),
      series(userMetric('checkout_look_ms'), percentile(95), { legend: '看庫存分片' }),
      series(userMetric('checkout_tx_ms'), percentile(95), { legend: '訂單交易' })
    ], 'ms'),
    chart('Redis 閘門結果', [
      series(userMetric('checkout_count', GATE_ON), rate(['metric.label.gate']), { plotType: 'STACKED_AREA', legend: '${metric.labels.gate}' })
    ], '次/秒'),
    chart('Redis 閘門命中率與無回應比例', [
      ratio(userMetric('checkout_count', 'metric.label.gate="turned_away"'), userMetric('checkout_count', GATE_ON), '擋下（命中）'),
      ratio(userMetric('checkout_count', 'metric.label.gate="no_answer"'), userMetric('checkout_count', GATE_ON), '無回應')
    ], '比例'),
    chart('失敗原因（依錯誤碼）', [
      series(userMetric('checkout_count', 'NOT metric.label.code="ok"'), rate(['metric.label.code']), { plotType: 'STACKED_BAR', legend: '${metric.labels.code}' })
    ], '次/秒'),
    chart('搶庫存的交易次數', [50, 95, 99].map((p) =>
      series(userMetric('checkout_tx_attempts'), percentile(p), { legend: `p${p}` })
    ), '次'),
    chart('Cloud Run 請求延遲', [50, 95, 99].map((p) =>
      series(runMetric('request_latencies'), percentile(p), { legend: `p${p}` })
    ), 'ms'),
    chart('Cloud Run 實例數', [
      series(runMetric('container/instance_count'), { alignmentPeriod: PERIOD, perSeriesAligner: 'ALIGN_MAX', crossSeriesReducer: 'REDUCE_SUM', groupByFields: ['metric.label.state'] }, { legend: '${metric.labels.state}' })
    ], '個'),
    chart('每實例同時處理的請求（p99）', [
      series(runMetric('container/max_request_concurrencies'), percentile(99), { legend: 'p99' })
    ], '個（上限 250）'),
    chart('CPU 使用率', [95, 50].map((p) =>
      series(runMetric('container/cpu/utilizations'), percentile(p), { legend: `p${p}` })
    ), '比例'),
    {
      title: '錯誤的購票紀錄（outcome = error）與 createOrder 的錯誤 log',
      logsPanel: {
        filter: [
          'resource.type="cloud_run_revision"',
          `resource.labels.service_name="${SERVICE}"`,
          '(jsonPayload.outcome="error" OR severity>=ERROR)'
        ].join(' AND '),
        resourceNames: [`projects/${project}`]
      }
    }
  ]

  // two charts per row, 24 of 48 columns each; the logs panel spans the row
  const tiles = widgets.map((widget, i) => {
    const wide = !widget.xyChart
    return { xPos: wide ? 0 : (i % 2) * 24, yPos: Math.floor(i / 2) * 16, width: wide ? 48 : 24, height: 16, widget }
  })
  return { displayName: DASHBOARD_NAME, mosaicLayout: { columns: 48, tiles } }
}

/* ---------- alert policies ---------- */

function threshold(displayName, { filter, aggregations, denominatorFilter, denominatorAggregations, value }) {
  return {
    displayName,
    conditionThreshold: {
      filter,
      aggregations,
      ...(denominatorFilter ? { denominatorFilter, denominatorAggregations } : {}),
      comparison: 'COMPARISON_GT',
      thresholdValue: value,
      duration: '120s',
      trigger: { count: 1 }
    }
  }
}

function policy(name, documentation, condition) {
  return {
    displayName: `${ALERT_PREFIX}${name}`,
    documentation: { content: documentation, mimeType: 'text/markdown' },
    combiner: 'OR',
    conditions: [condition],
    alertStrategy: { autoClose: '1800s' }
  }
}

export const ALERTS = [
  policy(
    '錯誤比例超過 2%',
    `createOrder 連續兩分鐘有超過 2% 的呼叫以 internal 錯誤結束。到儀表板「${DASHBOARD_NAME}」最下方的 log 面板看錯誤內容。`,
    threshold('outcome=error 佔全部呼叫的比例 > 2%', {
      filter: userMetric('checkout_count', 'metric.label.outcome="error"'),
      aggregations: [rate()],
      denominatorFilter: userMetric('checkout_count'),
      denominatorAggregations: [rate()],
      value: 0.02
    })
  ),
  policy(
    '成功訂單 p95 超過 5 秒',
    '成功下單的 createOrder 連續兩分鐘 p95 超過 5 秒。看儀表板的「各階段耗時 p95」找出慢在哪一段，以及實例數是否不夠（CREATE_ORDER_MIN_INSTANCES）。',
    threshold('created 的 p95 > 5000 ms', {
      filter: userMetric('checkout_latency_ms', 'metric.label.outcome="created"'),
      aggregations: [percentile(95)],
      value: 5000
    })
  ),
  policy(
    'Redis 閘門無回應超過 10%',
    'STOCK_GATE 開著，但連續兩分鐘有超過 10% 的呼叫等不到 Upstash（逾時 800 ms 或連不上），這些購票直接進 Firestore。看 Upstash 主控台的狀態與用量。',
    threshold('gate=no_answer 佔閘門呼叫的比例 > 10%', {
      filter: userMetric('checkout_count', 'metric.label.gate="no_answer"'),
      aggregations: [rate()],
      denominatorFilter: userMetric('checkout_count', GATE_ON),
      denominatorAggregations: [rate()],
      value: 0.1
    })
  )
]
