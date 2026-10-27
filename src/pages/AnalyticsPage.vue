<template>
  <div v-if="!auth.isSuperAdmin" class="state-screen">
    <h2>權限不足</h2>
    <button type="button" class="btn" @click="$router.push('/admin')">回到後台</button>
  </div>

  <div v-else-if="loading" class="state-screen">
    <p>載入中...</p>
  </div>

  <div v-else ref="pageRoot" class="analytics-page" :class="{ exporting }">
    <div class="page-heading" :class="partClass(0)">
      <p class="eyebrow">後台管理</p>
      <div class="heading-row">
        <h1>銷售報表</h1>
        <p v-if="exporting" class="live-status">匯出時間　<span class="num">{{ exportStamp }}</span></p>
        <p v-else class="live-status" :class="{ offline: liveError }" role="status">
          <span class="live-dot" aria-hidden="true" />
          <template v-if="liveError">即時連線中斷，請重新整理頁面</template>
          <template v-else>即時更新　<span class="num">{{ formatClock(updatedAt) }}</span></template>
        </p>
      </div>
      <p class="period-note">{{ periodNote }}</p>
    </div>

    <p v-if="unfinishedPurge && !exporting" class="notice" role="status">
      有一次清除訂單尚未完成，部分訂單同時在目前訂單與封存資料中
      <router-link :to="{ name: 'admin' }">前往後台繼續清除</router-link>
    </p>

    <div v-if="!exporting" class="filter-row">
      <label v-if="archives.length" class="compare-select">
        <span>比較</span>
        <select v-model="compareYear">
          <option v-for="item in archives" :key="item.year" :value="item.year">{{ item.year }} 年</option>
          <option :value="null">不比較</option>
        </select>
      </label>

      <div v-if="archives.length" class="segmented" role="group" aria-label="比較範圍">
        <button
          v-for="option in BASIS_OPTIONS"
          :key="option.value"
          type="button"
          :class="{ active: basis === option.value }"
          :aria-pressed="basis === option.value"
          @click="basis = option.value"
        >
          {{ option.label }}
        </button>
      </div>

      <div class="filter-actions">
        <button type="button" class="btn-outline" :disabled="timelineEmpty" @click="exportPdf">
          匯出 PDF
        </button>
        <button
          type="button"
          class="btn-outline"
          :aria-expanded="importOpen"
          @click="importOpen ? closeImport() : (importOpen = true)"
        >
          {{ importOpen ? '收起匯入' : '匯入往年資料' }}
        </button>
      </div>
    </div>

    <div v-if="importOpen && !exporting" class="panel import-panel">
      <h2>匯入往年資料</h2>
      <p class="panel-copy">
        選擇往年在後台匯出的訂單 Excel（.xlsx），或清除訂單時下載的完整備份；只會上傳圖表需要的欄位：購票時間、學校、年級、票種與金額，
        姓名、電話、Email、班級與座號都不會上傳
      </p>
      <input class="file-input" type="file" accept=".xlsx" aria-label="選擇訂單 Excel" @change="onImportFile">

      <div v-if="importSummary" class="import-preview">
        <div v-if="!importSummary.error || importSummary.year" class="import-stats">
          <div>
            <span>年度</span>
            <strong class="num">{{ importSummary.year || '—' }}</strong>
          </div>
          <div>
            <span>訂單</span>
            <strong class="num">{{ formatCount(importSummary.orderCount) }} 筆</strong>
          </div>
          <div>
            <span>營收</span>
            <strong class="num">{{ formatCurrency(importSummary.revenue) }}</strong>
          </div>
        </div>
        <div v-if="importSummary.orderCount" class="import-dates">
          <label>
            <span>開賣日</span>
            <input v-model="importDraft.openDate" type="date">
          </label>
          <label>
            <span>結束日</span>
            <input v-model="importDraft.closeDate" type="date">
          </label>
        </div>
        <p v-if="importSummary.orderCount" class="panel-copy">開賣日算第 1 天，年度取開賣日的年份；日期已依訂單時間自動帶入，可以修改</p>
        <p v-if="importSummary.outside" class="import-note">
          有 {{ importSummary.outside }} 筆訂單不在這段期間內，圖表會把它們算在第一天或最後一天
        </p>
        <p v-if="importSummary.skipped" class="import-note">
          有 {{ importSummary.skipped }} 筆訂單的建立時間無法辨識，不會匯入
        </p>
        <p v-if="importSummary.replaces && !importSummary.error" class="import-note">
          已經匯入過 {{ importSummary.year }} 年的資料，這次匯入會取代它
        </p>
        <p v-if="importSummary.error" class="import-error" role="alert">{{ importSummary.error }}</p>
        <div class="import-actions">
          <button
            type="button"
            class="btn"
            :disabled="importing || !!importSummary.error"
            @click="saveImport"
          >
            {{ importing ? '匯入中...' : '確認匯入' }}
          </button>
          <button type="button" class="btn-outline" :disabled="importing" @click="closeImport">取消</button>
        </div>
      </div>
    </div>

    <div v-else-if="!archives.length && !exporting" class="panel hint-panel">
      <p class="panel-copy">
        還沒有往年資料，目前只顯示今年的數據；按「匯入往年資料」選擇往年的訂單 Excel，或在活動結束後於後台「清除所有訂單」，之後就能逐年比較
      </p>
    </div>

    <div class="report" :class="{ refreshing: archiveLoading }">
      <section class="kpi-grid" :class="partClass(0)" aria-label="重點指標">
        <article v-for="kpi in kpis" :key="kpi.key" class="kpi">
          <p class="kpi-label">{{ kpi.label }}</p>
          <p class="kpi-value">{{ kpi.value }}</p>
          <p v-if="hasPrevious" class="kpi-compare">
            <span v-if="kpi.change" class="kpi-change" :class="kpi.change.direction">
              <span aria-hidden="true">{{ ARROWS[kpi.change.direction] }}</span>
              <span class="sr-only">{{ CHANGE_WORDS[kpi.change.direction] }}</span>
              {{ kpi.change.text }}
            </span>
            <span v-if="kpi.progress" class="kpi-change flat">{{ kpi.progress }}</span>
            <span>{{ compareLabel }} {{ kpi.previous }}</span>
          </p>
          <p v-if="kpi.previousFull" class="kpi-note">{{ previous.year }} 年全期 {{ kpi.previousFull }}</p>
          <p v-if="kpi.note" class="kpi-note">{{ kpi.note }}</p>
        </article>
      </section>

      <section class="analytics-section" :class="partClass(0, true)">
        <div class="section-heading">
          <p class="eyebrow">期間分析</p>
          <div v-if="!exporting" class="segmented small" role="group" aria-label="分析期間">
            <button
              v-for="option in PERIODS"
              :key="option.key"
              type="button"
              :class="{ active: periodKey === option.key }"
              :aria-pressed="periodKey === option.key"
              @click="periodKey = option.key"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <p class="section-note num">{{ periodRangeNote }}</p>
        <div class="kpi-grid period-grid">
          <article v-for="tile in periodTiles" :key="tile.key" class="kpi">
            <p class="kpi-label">{{ tile.label }}</p>
            <p class="kpi-value">{{ tile.value }}</p>
            <p v-for="line in tile.compares" :key="line.label" class="kpi-compare">
              <span v-if="line.change" class="kpi-change" :class="line.change.direction">
                <span aria-hidden="true">{{ ARROWS[line.change.direction] }}</span>
                <span class="sr-only">{{ CHANGE_WORDS[line.change.direction] }}</span>
                {{ line.change.text }}
              </span>
              <span>{{ line.label }}</span>
            </p>
          </article>
        </div>
        <div class="stack">
          <ChartCard
            v-for="metric in periodCards"
            :key="metric.id"
            :title="variantTitle('銷售趨勢', metric.label)"
            :subtitle="metric.subtitle"
            :legend="periodLegend"
            legend-shape="line"
            :table="metric.table"
            :empty="metric.empty"
          >
            <template #controls>
              <div class="segmented small" role="group" aria-label="趨勢指標">
                <button
                  v-for="metric in METRICS"
                  :key="metric.key"
                  type="button"
                  :class="{ active: periodMetricKey === metric.key }"
                  :aria-pressed="periodMetricKey === metric.key"
                  @click="periodMetricKey = metric.key"
                >
                  {{ metric.label }}
                </button>
              </div>
              <div class="segmented small" role="group" aria-label="時間單位">
                <button
                  v-for="option in periodGranularities"
                  :key="option.key"
                  type="button"
                  :class="{ active: periodGranularity === option.key }"
                  :aria-pressed="periodGranularity === option.key"
                  @click="periodGranularityChoice = option.key"
                >
                  {{ option.label }}
                </button>
              </div>
            </template>
            <LineChart
              :series="metric.series"
              :label="`${metric.subtitle}折線圖`"
              :format="metric.format"
              :axis-format="metric.axis"
              :x-label="periodXLabel"
              :tooltip-title="periodTitle"
              :integer="['orders', 'tickets'].includes(metric.key)"
              area
            />
          </ChartCard>
        </div>
      </section>

      <section class="analytics-section" :class="partClass(1)">
        <div class="section-heading">
          <p class="eyebrow">時間與銷售</p>
          <div v-if="!exporting" class="segmented small" role="group" aria-label="累積或每日">
            <button
              v-for="option in TIMELINE_MODES"
              :key="option.key"
              type="button"
              :class="{ active: timelineMode === option.key }"
              :aria-pressed="timelineMode === option.key"
              @click="timelineMode = option.key"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <div class="stack">
          <template v-for="mode in timelineCards" :key="mode.id">
            <ChartCard
              :title="`${mode.label}營收`"
              :subtitle="timelineSubtitle(mode, '營收')"
              :legend="legend"
              legend-shape="line"
              :table="mode.revenue.table"
              :empty="mode.revenue.empty"
            >
              <LineChart
                :series="mode.revenue.series"
                :label="`${mode.label}營收折線圖`"
                :format="formatCurrency"
                :axis-format="formatCompact"
                :x-label="dayTick"
                :tooltip-title="dayTitle"
                :x-step-offset="1"
                area
              />
            </ChartCard>

            <ChartCard
              :title="`${mode.label}售出張數`"
              :subtitle="timelineSubtitle(mode, '售出張數')"
              :legend="legend"
              legend-shape="line"
              :table="mode.tickets.table"
              :empty="mode.tickets.empty"
            >
              <LineChart
                :series="mode.tickets.series"
                :label="`${mode.label}售出張數折線圖`"
                :format="formatCount"
                :axis-format="formatCount"
                :x-label="dayTick"
                :tooltip-title="dayTitle"
                :x-step-offset="1"
                integer
                area
              />
            </ChartCard>
          </template>

          <ChartCard
            v-for="metric in slotCards"
            :key="metric.id"
            :title="variantTitle('每日表現', metric.label)"
            :subtitle="`開賣後每天的${metric.label}`"
            :legend="legend"
            legend-shape="line"
            :table="metric.table"
            :empty="metric.empty"
          >
            <template #controls>
              <div class="segmented small" role="group" aria-label="指標">
                <button
                  v-for="metric in SLOT_METRICS"
                  :key="metric.key"
                  type="button"
                  :class="{ active: slotMetricKey === metric.key }"
                  :aria-pressed="slotMetricKey === metric.key"
                  @click="slotMetricKey = metric.key"
                >
                  {{ metric.label }}
                </button>
              </div>
            </template>
            <LineChart
              :series="metric.series"
              :label="`每日${metric.label}折線圖`"
              :format="metric.format"
              :axis-format="metric.axis"
              :x-label="dayTick"
              :tooltip-title="dayTitle"
              :x-step-offset="1"
              :integer="['orders', 'tickets'].includes(metric.key)"
            />
          </ChartCard>

          <ChartCard
            title="購票時段"
            subtitle="各時段的訂單占比（台灣時間）"
            :legend="legend"
            :table="hourTable"
            :empty="isEmptyShares(hourRows)"
          >
            <ColumnChart
              :labels="HOUR_LABELS"
              :series="hourSeries"
              label="各時段訂單占比長條圖"
              :format="formatPercent"
              :axis-format="formatPercentTick"
              :tooltip-title="(hour) => `${hour}:00–${hour}:59`"
            />
          </ChartCard>
        </div>
      </section>

      <section class="analytics-section" :class="partClass(2)">
        <div class="section-heading">
          <p class="eyebrow">身分與銷售</p>
          <div v-if="!exporting" class="segmented small" role="group" aria-label="身分分析指標">
            <button
              v-for="metric in METRICS"
              :key="metric.key"
              type="button"
              :class="{ active: groupMetricKey === metric.key }"
              :aria-pressed="groupMetricKey === metric.key"
              @click="groupMetricKey = metric.key"
            >
              {{ metric.label }}
            </button>
          </div>
        </div>
        <div class="stack stack-gap">
          <ChartCard
            title="各身分營收占比"
            subtitle="依學校／身分比較營收占比，並細分五所友校"
            :table="groupShareTable"
            :empty="!groupShareBars.some((bar) => bar.segments.some((segment) => segment.value))"
          >
            <ShareBar :bars="groupShareBars" :format="formatCurrency" />
          </ChartCard>
        </div>
        <!-- its own block: the PDF moves a block that would straddle two pages whole -->
        <div v-if="hasPrevious" class="stack stack-gap">
          <ChartCard
            title="各身分的市占與變化"
            :subtitle="`橫軸是 ${current.year} 年的購票張數占比（虛線為平均），縱軸是與 ${compareLabel}相比增減的百分點，圓越大張數越多；左上是占比還小但正在成長的對象`"
            :legend="portfolioPoints.map((point) => ({ label: point.label, color: point.color }))"
            :table="portfolioTable"
            :empty="!portfolioPoints.length"
          >
            <ScatterChart
              :points="portfolioPoints"
              label="各身分購票張數占比與變化的泡泡圖"
              :x-format="formatPercentTick"
              :y-format="formatPointsTick"
              :x-title="`${current.year} 年張數占比 →`"
              y-title="↑ 占比增減（百分點）"
              :x-split="1 / portfolioPoints.length"
              :quadrants="['小眾・成長', '主力・成長', '小眾・下滑', '主力・下滑']"
              :describe="describePortfolio"
            />
          </ChartCard>
        </div>
        <div class="card-grid">
          <template v-for="metric in groupCards" :key="metric.id">
            <ChartCard
              :title="variantTitle('各校／身分', metric.label)"
              :subtitle="`依訂購時選擇的學校／身分，比較${metric.label}`"
              :legend="legend"
              :table="identityTable"
              :empty="!report.identities.length"
            >
              <BarList :rows="metric.identityRows" :colors="colors" :series-labels="seriesLabels" :format="metric.format" />
            </ChartCard>

            <ChartCard
              :title="variantTitle('建中學生年級', metric.label)"
              :subtitle="`學校為建國中學的訂單，依班級判斷年級，比較${metric.label}`"
              :legend="legend"
              :table="gradeTable"
              :empty="!report.grades.length"
            >
              <BarList :rows="metric.gradeRows" :colors="colors" :series-labels="seriesLabels" :format="metric.format" />
            </ChartCard>
          </template>
        </div>
      </section>

      <section class="analytics-section" :class="partClass(3)">
        <div class="section-heading">
          <p class="eyebrow">客單價</p>
        </div>
        <div class="stack stack-gap">
          <ChartCard
            title="營收集中度"
            :subtitle="concentrationSubtitle"
            :legend="concentrationLegend"
            legend-shape="line"
            :table="concentrationTable"
            :empty="report.concentration.curve[20] == null"
          >
            <LineChart
              :series="concentrationSeries"
              label="購買者營收集中度曲線"
              :format="formatPercent"
              :axis-format="formatPercentTick"
              :x-label="(i) => `${i * 5}%`"
              :tooltip-title="(i) => `營收最高的前 ${i * 5}% 購買者`"
            />
          </ChartCard>
        </div>
        <div class="card-grid">
          <ChartCard
            title="訂單金額分布"
            subtitle="各金額區間（NT$）的訂單占比"
            :legend="legend"
            :table="valueTable"
            :empty="isEmptyShares(report.values)"
          >
            <BarList :rows="valueRows" :colors="colors" :series-labels="seriesLabels" :format="formatPercent" />
          </ChartCard>

          <ChartCard
            v-for="mode in unitCards"
            :key="mode.id"
            :title="variantTitle('每筆訂單張數', mode.label)"
            :subtitle="mode.subtitle"
            :legend="legend"
            :table="mode.table"
            :empty="mode.empty"
          >
            <template #controls>
              <div class="segmented small" role="group" aria-label="訂單或張數占比">
                <button
                  v-for="mode in UNIT_MODES"
                  :key="mode.key"
                  type="button"
                  :class="{ active: unitModeKey === mode.key }"
                  :aria-pressed="unitModeKey === mode.key"
                  @click="unitModeKey = mode.key"
                >
                  {{ mode.label }}
                </button>
              </div>
            </template>
            <BarList :rows="mode.rows" :colors="colors" :series-labels="seriesLabels" :format="formatPercent" />
          </ChartCard>
        </div>
      </section>

      <section class="analytics-section" :class="partClass(4)">
        <div class="section-heading">
          <p class="eyebrow">行銷</p>
        </div>
        <div class="stack stack-gap">
          <ChartCard
            title="宣傳高峰"
            :subtitle="`${current.year} 年每天的訂單數與前 7 天的平均；高出平均最多的日子，可以對照當天的宣傳貼文或通知看效果`"
            :legend="peakLegend"
            legend-shape="line"
            :table="peakTable"
            :empty="timelineEmpty"
          >
            <LineChart
              :series="peakSeries"
              label="每日訂單數與前 7 天平均折線圖"
              :format="formatCount"
              :axis-format="formatCount"
              :x-label="dayTick"
              :tooltip-title="dayTitle"
              :x-step-offset="1"
              integer
              area
            />
            <template v-if="report.peaks.days.length">
              <p class="peak-caption">高出前 7 天平均最多的日子</p>
              <ol class="peak-list">
                <li v-for="peak in report.peaks.days" :key="peak.day">
                  <span class="peak-day num">{{ formatDay(timeline.dayStart(current, peak.day)) }}</span>
                  <span class="peak-value num">{{ formatCount(peak.value) }} 筆</span>
                  <span class="peak-gain num">
                    多 {{ formatCount(peak.value - peak.baseline) }} 筆（{{ (peak.value / peak.baseline).toFixed(1) }} 倍）
                  </span>
                </li>
              </ol>
            </template>
          </ChartCard>

          <ChartCard
            title="熱門購票時段"
            :subtitle="`${current.year} 年各星期、各時段的訂單數，可用來安排宣傳貼文與通知的時間`"
            :table="weekHourTable"
            :empty="!current.rows.length"
          >
            <HeatGrid
              :rows="HEAT_DAYS"
              :columns="HOUR_LABELS"
              :values="report.weekHours"
              :color="palette.current"
              label="各星期與時段的訂單數熱度圖"
              :describe="describeWeekHour"
            />
          </ChartCard>

          <ChartCard
            title="各身分的購票時段"
            :subtitle="`${current.year} 年各身分的訂單落在哪些時段（台灣時間），每一列以該身分訂單最多的時段為最深；可依對象安排宣傳的時間`"
            :table="groupHourTable"
            :empty="!report.groupHours.length"
          >
            <HeatGrid
              :rows="report.groupHours.map((group) => group.label)"
              :row-notes="report.groupHours.map((group) => formatCount(group.orders))"
              :columns="HOUR_LABELS"
              :values="report.groupHours.map((group) => group.hours.map((hour) => hour.share))"
              :color="palette.current"
              row-width="84px"
              row-scale
              label="各身分各時段訂單占比的熱度圖"
              :describe="describeGroupHour"
            />
          </ChartCard>

          <ChartCard
            title="各身分的得知管道"
            subtitle="問卷中各身分的回覆者選擇各管道的比例，可複選；身分旁是回覆數，回覆少的身分僅供參考"
            :table="channelReachTable"
            :empty="!channelReach.length"
          >
            <HeatGrid
              :rows="channelReach.map((group) => group.label)"
              :row-notes="channelReach.map((group) => formatCount(group.respondents))"
              :columns="channelColumns"
              :values="channelReach.map((group) => group.channels.map((channel) => channel.share))"
              :color="palette.current"
              row-width="104px"
              :cell-label="formatPercentTick"
              label="各身分得知活動管道比例的熱度圖"
              :describe="describeChannelReach"
            />
          </ChartCard>

          <ChartCard
            title="各階段的購買者組成"
            :subtitle="`${current.year} 年開賣後各階段售出的張數，依購買者身分細分；看哪些對象較早購票、哪些對象要靠後段宣傳`"
            :table="stageMixTable"
            :empty="!stageMixBars.length"
          >
            <ShareBar :bars="stageMixBars" :format="formatTickets" />
          </ChartCard>
        </div>
        <div class="card-grid">
          <ChartCard
            title="得知活動的管道"
            :subtitle="survey ? `使用者問卷 ${formatCount(survey.respondents)} 份回覆選擇各管道的比例，可複選` : '使用者問卷的回覆'"
            :table="channelTable"
            :empty="!survey || !survey.respondents"
          >
            <BarList :rows="channelRows" :colors="[colors[0]]" :series-labels="['問卷回覆']" :format="formatPercent" />
          </ChartCard>

          <ChartCard
            title="開賣後的銷售節奏"
            subtitle="開賣後各階段售出的張數占比，看開賣與宣傳的效果"
            :legend="legend"
            :table="stageTable"
            :empty="isEmptyShares(report.stages)"
          >
            <BarList :rows="stageRows" :colors="colors" :series-labels="seriesLabels" :format="formatPercent" />
          </ChartCard>

          <ChartCard
            title="各星期的訂單占比"
            subtitle="訂單成立在星期幾（台灣時間）"
            :legend="legend"
            :table="weekdayTable"
            :empty="isEmptyShares(report.weekdays)"
          >
            <BarList :rows="weekdayRows" :colors="colors" :series-labels="seriesLabels" :format="formatPercent" />
          </ChartCard>

          <ChartCard
            title="回購次數"
            :subtitle="`${current.year} 年每位購買者成立的訂單數，共 ${formatCount(report.repeat.buyers)} 位購買者`"
            :table="repeatTable"
            :empty="!report.repeat.buyers"
          >
            <BarList :rows="repeatRows" :colors="[colors[0]]" :series-labels="[seriesLabels[0]]" :format="formatPercent" />
          </ChartCard>
        </div>
      </section>

      <p class="page-footnote" :class="partClass(4)">
        日期與時段以台灣時間計算；「同期」只比較往年開賣後同一天、同一時刻為止的資料，「全期」比較往年整段銷售期間；
        開賣前成立的訂單（例如測試訂單）算在第 1 天，往年結束日之後的訂單算在最後一天；營收是訂單金額，包含還沒付款的訂單，
        平均客單價不含 NT$0 的訂單
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, provide, ref } from 'vue'
import BarList from 'src/components/analytics/BarList.vue'
import ChartCard from 'src/components/analytics/ChartCard.vue'
import ColumnChart from 'src/components/analytics/ColumnChart.vue'
import HeatGrid from 'src/components/analytics/HeatGrid.vue'
import LineChart from 'src/components/analytics/LineChart.vue'
import ScatterChart from 'src/components/analytics/ScatterChart.vue'
import ShareBar from 'src/components/analytics/ShareBar.vue'
import { useSalesAnalytics } from 'src/composables/useSalesAnalytics'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { downloadElementPartsAsPdf } from 'src/utils/pdf'
import {
  PERIODS,
  WEEKDAY_LABELS,
  defaultGranularity,
  formatCompact,
  formatCount,
  formatCurrency,
  formatDay,
  formatDecimal,
  formatPercent,
  formatPeriod,
  granularityOptions,
  inRange,
  periodSeries,
  resolvePeriod,
  summarize,
  taipeiDate
} from 'src/utils/salesAnalytics'

// Chart colours, as SVG attributes: the admin's dark theme on screen, ink on
// white in the PDF. This year is the accent; the year it's compared with is
// grey context (contrast checked against both backgrounds). `groups` are
// the identity groups' categorical slots, validated as a palette against
// each background; `groupText` is the label colour inside each.
const SCREEN_PALETTE = {
  surface: '#0a0b0d', grid: '#1b1e23', axis: '#3b4048', text: '#d9d7d0', muted: '#8d959e',
  current: '#e4a468', previous: '#7d848c',
  groups: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#8066cc', '#14a6b8', '#a97845', '#707780'],
  groupText: ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff']
}
const PRINT_PALETTE = {
  surface: '#ffffff', grid: '#ececf0', axis: '#c7c7cc', text: '#1d1d1f', muted: '#6e6e73',
  current: '#b35f17', previous: '#8a9097',
  groups: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#8066cc', '#14a6b8', '#a97845', '#707780'],
  groupText: ['#ffffff', '#ffffff', '#ffffff', '#0b0b0b', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff']
}
const HEAT_DAYS = ['一', '二', '三', '四', '五', '六', '日']
const PERIOD_COMPARISONS = { today: '昨天同時段', '7d': '前 7 天', '30d': '前 30 天', month: '上月同期' }
const TOP_TICKET_TYPES = 8

// 全期: the compared year's whole sale. 同期: only up to the same day and time
// of its sale as now.
const BASIS_OPTIONS = [
  { value: 'full', label: '全期' },
  { value: 'same', label: '同期' }
]

// Totals (additive) grow through the sale; averages and rates don't.
const KPI_META = {
  revenue: { label: '營收', format: formatCurrency, additive: true },
  orders: { label: '訂單數', format: formatCount, additive: true },
  aov: { label: '平均客單價', format: formatCurrency, note: '不含 NT$0 訂單' },
  tickets: { label: '售出張數', format: formatCount, additive: true },
  ticketsPerOrder: { label: '平均每單張數', format: formatDecimal },
  paidRate: { label: '收款率', format: formatPercent, note: '已付款訂單的金額占營收' }
}

const METRICS = [
  { key: 'revenue', label: '營收', format: formatCurrency, axis: formatCompact },
  { key: 'orders', label: '訂單數', format: formatCount, axis: formatCount },
  { key: 'tickets', label: '售出張數', format: formatCount, axis: formatCount },
  { key: 'aov', label: '平均客單價', format: formatCurrency, axis: formatCompact }
]
// 每日表現: the daily revenue and tickets have charts of their own above it
const SLOT_METRICS = METRICS.filter((metric) => !['revenue', 'tickets'].includes(metric.key))
const TIMELINE_MODES = [
  { key: 'cumulative', label: '累積' },
  { key: 'daily', label: '每日' }
]

// 每筆訂單張數 as a share of orders, or of the tickets they sold
const UNIT_MODES = [
  { key: 'orders', label: '訂單占比', subtitle: '一筆訂單買了幾張票', unit: '筆' },
  { key: 'tickets', label: '張數占比', subtitle: '一次買幾張的訂單合計賣出的票占總張數的比例，看多張一起買的訂單貢獻多少銷量', unit: '張' }
]

// 得知管道 column heads; the readout and table use the full names
const CHANNEL_SHORT = {
  '班聯會官方 Instagram': '官方 IG',
  '班代或班級轉知': '班級轉知',
  '同學或朋友分享': '親友分享',
  '建中相關社群': '建中社群'
}

const ARROWS = { up: '▲', down: '▼', flat: '－' }
const CHANGE_WORDS = { up: '成長', down: '減少', flat: '' }
const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => String(hour))

const auth = useAuthStore()
const {
  now,
  loading,
  liveError,
  updatedAt,
  basis,
  archives,
  compareYear,
  archiveLoading,
  unfinishedPurge,
  current,
  previous,
  report,
  survey,
  importDraft,
  importSummary,
  importing,
  readImportFile,
  cancelImport,
  confirmImport
} = useSalesAnalytics()

const slotMetricKey = ref('orders')
const groupMetricKey = ref('tickets')

const exporting = ref(false)
const palette = computed(() => (exporting.value ? PRINT_PALETTE : SCREEN_PALETTE))

// A chart with a toggle shows the chosen option on screen; the PDF has every
// option, each named in its title. The chosen option's card keeps the id
// 'chosen' either way, so neither switching options nor an export replaces
// it with a new one (which would lose its table view).
function variants(options, chosenKey) {
  const chosen = options.find((option) => option.key === chosenKey) || options[0]
  return exporting.value
    ? options.map((option) => ({ ...option, id: option === chosen ? 'chosen' : option.key }))
    : [{ ...chosen, id: 'chosen' }]
}
const variantTitle = (title, label) => (exporting.value ? `${title}（${label}）` : title)
provide('chartPalette', palette)
// Chart cards hide their buttons too.
provide('exportingPdf', exporting)

const hasPrevious = computed(() => report.value.hasPrevious)
const timeline = computed(() => report.value.timeline)
const seriesLabels = computed(() =>
  hasPrevious.value ? [`${current.value.year} 年`, `${previous.value.year} 年`] : [`${current.value.year} 年`]
)
const colors = computed(() => (hasPrevious.value ? [palette.value.current, palette.value.previous] : [palette.value.current]))
const legend = computed(() => seriesLabels.value.map((label, i) => ({ label, color: colors.value[i] })))

function formatClock(date, short = false) {
  if (!date) return ''
  return date.toLocaleTimeString('zh-TW', {
    hour12: false,
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    second: short ? undefined : '2-digit'
  })
}

function formatTickets(value) {
  return `${formatCount(value)} 張`
}

function formatPercentTick(value) {
  return `${Math.round(value * 100)}%`
}

// a change of share: "+2.5 個百分點"
function formatPoints(ratio) {
  if (Math.abs(ratio) < 0.0005) return '持平'
  return `${ratio > 0 ? '+' : '−'}${(Math.abs(ratio) * 100).toFixed(1)} 個百分點`
}

function formatPointsTick(ratio) {
  if (!ratio) return '0'
  return `${ratio > 0 ? '+' : '−'}${Number((Math.abs(ratio) * 100).toFixed(1))}`
}

function shortDate(isoDate) {
  const [, month, day] = isoDate.split('-').map(Number)
  return `${month}/${day}`
}

const periodNote = computed(() => {
  const cur = current.value
  const parts = [
    cur.elapsed < 0
      ? `今年 ${shortDate(cur.openDate)} 開賣，尚未開始`
      : `今年 ${shortDate(cur.openDate)} 開賣，今天是第 ${cur.days} 天`
  ]
  const prev = previous.value
  if (prev) {
    parts.push(`比較 ${prev.year} 年（${shortDate(prev.openDate)}–${shortDate(prev.closeDate)}，共 ${prev.days} 天）`)
    if (report.value.sameTime) parts.push(`同期：${prev.year} 年只算到開賣第 ${Math.max(1, cur.days)} 天 ${formatClock(new Date(), true)}`)
  }
  return parts.join('　·　')
})

// ---- KPI tiles ----

// What the compared year's numbers cover.
const compareLabel = computed(() => `${previous.value?.year} 年${report.value.sameTime ? '同期' : '全期'}`)

// Change against the compared year; none when it had nothing to compare with.
function change(value, previousValue) {
  if (value == null || !previousValue) return null
  const ratio = (value - previousValue) / previousValue
  if (Math.abs(ratio) < 0.0005) return { direction: 'flat', text: '持平' }
  return { direction: ratio > 0 ? 'up' : 'down', text: formatPercent(Math.abs(ratio)) }
}

const kpis = computed(() =>
  report.value.kpis.map((kpi) => {
    const meta = KPI_META[kpi.key]
    // A running total against a finished year's total is progress, not a drop.
    const progress = meta.additive && report.value.ongoing && !report.value.sameTime && kpi.previous > 0
    return {
      key: kpi.key,
      label: meta.label,
      note: meta.note,
      value: meta.format(kpi.value),
      previous: meta.format(kpi.previous),
      previousFull: kpi.previousFull == null ? '' : meta.format(kpi.previousFull),
      progress: progress ? `已達 ${formatPercent(kpi.value / kpi.previous)}` : '',
      change: progress ? null : change(kpi.value, kpi.previous)
    }
  })
)

// ---- Time ----

function dayTick(i) {
  return `第${i + 1}天`
}

function dayTitle(i) {
  return `開賣第 ${i + 1} 天`
}

function timeSeries(metric) {
  const series = [{
    key: 'current',
    label: seriesLabels.value[0],
    color: colors.value[0],
    values: timeline.value.current[metric],
    detail: (i) => formatDay(timeline.value.dayStart(current.value, i))
  }]
  if (timeline.value.previous) {
    series.push({
      key: 'previous',
      label: seriesLabels.value[1],
      color: colors.value[1],
      values: timeline.value.previous[metric],
      detail: (i) => formatDay(timeline.value.dayStart(previous.value, i))
    })
  }
  return series
}

const timelineMode = ref('cumulative')

function timelineSubtitle(mode, measure) {
  const text = `開賣後每天的${mode.key === 'cumulative' ? '累積' : ''}${measure}`
  return report.value.sameTime ? `${text}，${previous.value.year} 年只算到同一時間` : text
}

// no line rises above 0
const isFlat = (series) => !series.some((item) => item.values.some((value) => value > 0))
// no orders on any day (NT$0 orders count, so this is not about revenue)
const timelineEmpty = computed(() => isFlat(timeSeries('orders')))

// A timeline chart's series with its table view and empty state
function timelineCard(metric, format) {
  const series = timeSeries(metric)
  return { series, table: seriesTable(series, format), empty: isFlat(series) }
}

const timelineCards = computed(() => variants(TIMELINE_MODES, timelineMode.value).map((mode) => ({
  ...mode,
  revenue: timelineCard(mode.key === 'cumulative' ? 'cumulative' : 'revenue', formatCurrency),
  tickets: timelineCard(mode.key === 'cumulative' ? 'cumulativeTickets' : 'tickets', formatCount)
})))
const slotCards = computed(() =>
  variants(SLOT_METRICS, slotMetricKey.value).map((metric) => ({ ...metric, ...timelineCard(metric.key, metric.format) })))

// ---- Shares (hours, order values, tickets per order) ----

const hourRows = computed(() =>
  report.value.hours.current.map((entry, hour) => ({
    label: `${hour}:00–${hour}:59`,
    current: entry,
    previous: report.value.hours.previous[hour]
  }))
)

function isEmptyShares(rows) {
  return !rows.some((row) => row.current.count || (hasPrevious.value && row.previous.count))
}

// Column series from rows of { current: { count, share }, previous: {...} }.
function shareColumns(rows, unit) {
  const series = [{
    key: 'current',
    label: seriesLabels.value[0],
    color: colors.value[0],
    values: rows.map((row) => row.current.share),
    detail: (i) => `${formatCount(rows[i].current.count)} ${unit}`
  }]
  if (hasPrevious.value) {
    series.push({
      key: 'previous',
      label: seriesLabels.value[1],
      color: colors.value[1],
      values: rows.map((row) => row.previous.share),
      detail: (i) => `${formatCount(rows[i].previous.count)} ${unit}`
    })
  }
  return series
}

const hourSeries = computed(() => shareColumns(hourRows.value, '筆'))

// Bar rows from rows of { label, current, previous }.
function barRows(rows, pick) {
  return rows.map((row) => ({
    label: row.label,
    values: hasPrevious.value ? [pick(row.current), pick(row.previous)] : [pick(row.current)]
  }))
}

const groupCards = computed(() => variants(METRICS, groupMetricKey.value).map((metric) => ({
  ...metric,
  identityRows: barRows(report.value.identities, (summary) => summary[metric.key]),
  gradeRows: barRows(report.value.grades, (summary) => summary[metric.key])
})))
const valueRows = computed(() => barRows(report.value.values, (entry) => entry.share))

const unitModeKey = ref('orders')
const unitCards = computed(() => variants(UNIT_MODES, unitModeKey.value).map((mode) => {
  const shares = mode.key === 'orders' ? report.value.units : report.value.unitTickets
  return {
    ...mode,
    rows: barRows(shares, (entry) => entry.share),
    table: shareTable('每筆張數', shares, mode.unit),
    empty: isEmptyShares(shares)
  }
}))

const ticketTypeLists = computed(() => {
  const list = (label, color, types) => ({
    label,
    color,
    rows: types.slice(0, TOP_TICKET_TYPES).map((type) => ({ label: type.label, values: [type.units] }))
  })
  const lists = [list(seriesLabels.value[0], colors.value[0], report.value.ticketTypes.current)]
  if (hasPrevious.value) lists.push(list(seriesLabels.value[1], colors.value[1], report.value.ticketTypes.previous))
  return lists
})

// A ShareBar bar of the identity groups; each group keeps its colour slot.
function groupBar(label, groups, valueOf) {
  return {
    label,
    segments: groups.map((group, i) => ({
      key: group.key,
      label: group.label,
      value: valueOf(group),
      share: group.share,
      color: palette.value.groups[i],
      textColor: palette.value.groupText[i]
    }))
  }
}

// Identity groups' revenue as one bar per year.
const groupShareBars = computed(() => {
  const bars = [groupBar(seriesLabels.value[0], report.value.identityGroups.current, (group) => group.revenue)]
  if (report.value.identityGroups.previous) {
    bars.push(groupBar(seriesLabels.value[1], report.value.identityGroups.previous, (group) => group.revenue))
  }
  return bars
})

// Identity groups by this year's share of tickets and its change since the
// compared year, sized by tickets
const portfolioPoints = computed(() => {
  const before = report.value.identityGroups.previous
  if (!before) return []
  return report.value.identityGroups.current
    .map((group, i) => ({
      key: group.key,
      label: group.label,
      x: group.ticketShare,
      y: group.ticketShare - before[i].ticketShare,
      size: group.tickets,
      color: palette.value.groups[i],
      previous: before[i]
    }))
    .filter((point) => point.size || point.previous.tickets)
})

function describePortfolio(point) {
  return [
    `${seriesLabels.value[0]} ${formatPercent(point.x)}（${formatTickets(point.size)}）`,
    `${compareLabel.value} ${formatPercent(point.previous.ticketShare)}（${formatTickets(point.previous.tickets)}）`,
    `占比 ${formatPoints(point.y)}`
  ]
}

// ---- 期間分析: a window of this year's sale against the one before it ----

const periodKey = ref('7d')
const periodMetricKey = ref('revenue')
// null: whatever suits the window's length
const periodGranularityChoice = ref(null)

const firstOrderAt = computed(() => current.value.rows.reduce((first, row) =>
  (row.at !== null && (first === null || row.at < first) ? row.at : first), null))
const periodRange = computed(() => resolvePeriod(periodKey.value, { now: now.value.getTime(), earliest: firstOrderAt.value }))
const periodComparison = computed(() => PERIOD_COMPARISONS[periodKey.value] || '')
const periodGranularities = computed(() => granularityOptions(periodRange.value))
const periodGranularity = computed(() =>
  (periodGranularities.value.some((option) => option.key === periodGranularityChoice.value)
    ? periodGranularityChoice.value
    : defaultGranularity(periodRange.value)))

const periodRangeNote = computed(() => {
  const range = periodRange.value
  const text = formatPeriod(range, now.value.getTime()) || '—'
  return range.previous
    ? `${text}，對照${periodComparison.value} ${formatPeriod(range.previous, now.value.getTime())}`
    : `${text}，今年的所有訂單`
})

// Each tile against the window before; the average order value also
// against this year's whole sale
const periodTiles = computed(() => {
  const range = periodRange.value
  const totals = summarize(inRange(current.value.rows, range))
  const before = range.previous ? summarize(inRange(current.value.rows, range.previous)) : null
  const all = summarize(current.value.rows)
  const versus = (key, format) => (before
    ? [{ label: `較${periodComparison.value} ${format(before[key])}`, change: change(totals[key], before[key]) }]
    : [])

  return [
    { key: 'revenue', label: '營收', value: formatCurrency(totals.revenue), compares: versus('revenue', formatCurrency) },
    { key: 'orders', label: '訂單數', value: formatCount(totals.orders), compares: versus('orders', formatCount) },
    {
      key: 'aov',
      label: '平均客單價',
      value: formatCurrency(totals.aov),
      compares: [
        ...(range.previous ? [{ label: `較今年全期平均 ${formatCurrency(all.aov)}`, change: change(totals.aov, all.aov) }] : []),
        ...versus('aov', formatCurrency)
      ]
    },
    { key: 'tickets', label: '售出張數', value: formatCount(totals.tickets), compares: versus('tickets', formatCount) }
  ]
})

const periodPoints = computed(() => periodSeries(current.value.rows, periodRange.value, periodGranularity.value, now.value.getTime()))
const periodXLabel = (i) => periodPoints.value[i]?.label ?? ''
const periodTitle = (i) => periodPoints.value[i]?.title ?? ''
const periodChartSubtitleOf = (metric) =>
  `${{ hour: '每小時', day: '每日', month: '每月' }[periodGranularity.value]}的${metric.label}`
const periodLegend = computed(() => [
  { label: '本期', color: palette.value.current },
  ...(periodRange.value.previous ? [{ label: periodComparison.value, color: palette.value.previous }] : [])
])
function periodChartSeriesOf(key) {
  const series = [{
    key: 'current',
    label: '本期',
    color: palette.value.current,
    values: periodPoints.value.map((point) => point.current[key])
  }]
  if (periodRange.value.previous) {
    series.push({
      key: 'previous',
      label: periodComparison.value,
      color: palette.value.previous,
      values: periodPoints.value.map((point) => (point.previous ? point.previous[key] : null)),
      detail: (i) => periodPoints.value[i]?.previous?.title || ''
    })
  }
  return series
}

const periodCards = computed(() => variants(METRICS, periodMetricKey.value).map((metric) => {
  const series = periodChartSeriesOf(metric.key)
  return { ...metric, series, subtitle: periodChartSubtitleOf(metric), table: periodTableOf(metric), empty: isFlat(series) }
}))

// ---- 行銷 ----

const channelRows = computed(() => (survey.value?.rows || []).map((row) => ({ label: row.label, values: [row.share] })))
const stageRows = computed(() => barRows(report.value.stages, (entry) => entry.share))
const weekdayRows = computed(() => barRows(report.value.weekdays, (entry) => entry.share))
const repeatRows = computed(() => report.value.repeat.bands.map((band) => ({ label: band.label, values: [band.share] })))

function describeWeekHour(row, hour, value) {
  return `${WEEKDAY_LABELS[row]} ${hour}:00–${hour}:59　${formatCount(value)} 筆訂單`
}

// 得知管道 by identity: all respondents first, then each identity that answered
const channelReach = computed(() => (survey.value?.respondents
  ? [{ label: '全部回覆', respondents: survey.value.respondents, channels: survey.value.rows }, ...survey.value.identities]
  : []))
const channelColumns = computed(() => (survey.value?.rows || []).map((row) => CHANNEL_SHORT[row.label] || row.label))

function describeChannelReach(row, column, share) {
  const group = channelReach.value[row]
  return `${group.label}・${survey.value.rows[column].label}　${formatPercent(share)}（${formatCount(group.channels[column].count)} / ${formatCount(group.respondents)} 份）`
}

function describeGroupHour(row, hour, share) {
  const group = report.value.groupHours[row]
  return `${group.label} ${hour}:00–${hour}:59　${formatPercent(share)}（${formatCount(group.hours[hour].count)} 筆）`
}

// Daily orders against the mean of the 7 days before each
const peakLegend = computed(() => [
  { label: '每日訂單', color: palette.value.current },
  { label: '前 7 天平均', color: palette.value.previous }
])
const peakSeries = computed(() => [
  {
    key: 'orders',
    label: '每日訂單',
    color: palette.value.current,
    values: timeline.value.current.orders,
    detail: (i) => formatDay(timeline.value.dayStart(current.value, i))
  },
  { key: 'baseline', label: '前 7 天平均', color: palette.value.previous, values: report.value.peaks.baseline }
])

// The share of revenue from the top 0%, 5%, … 100% of buyers, against an even split
const concentrationLegend = computed(() => [
  { label: seriesLabels.value[0], color: palette.value.current },
  { label: '平均分配', color: palette.value.previous }
])
const concentrationSeries = computed(() => {
  const { buyers, curve } = report.value.concentration
  return [
    {
      key: 'current',
      label: seriesLabels.value[0],
      color: palette.value.current,
      values: curve,
      detail: (i) => `${formatCount(Math.round((i / 20) * buyers))} 位購買者`
    },
    { key: 'even', label: '平均分配', color: palette.value.previous, values: curve.map((_, i) => i / 20) }
  ]
})
const concentrationSubtitle = computed(() => {
  const { buyers, curve } = report.value.concentration
  return `${current.value.year} 年 ${formatCount(buyers)} 位購買者依營收由高到低排列；前 20% 的購買者貢獻 ${formatPercent(curve[4])} 的營收，曲線越往左上彎越集中`
})

// This year's sale stages, each split by identity group
const stageMixBars = computed(() =>
  report.value.stageGroups.map((stage) => groupBar(stage.label, stage.groups, (group) => group.count)))

// ---- Table views ----

function seriesTable(series, format) {
  return {
    columns: ['天數', ...series.map((s) => s.label)],
    rows: Array.from({ length: timeline.value.days }, (_, i) => [
      dayTitle(i),
      ...series.map((s) => format(s.values[i] ?? null))
    ])
  }
}

function shareTable(header, rows, unit) {
  const cell = (entry) => `${formatPercent(entry.share)}（${formatCount(entry.count)} ${unit}）`
  return {
    columns: [header, ...seriesLabels.value],
    rows: rows.map((row) => [row.label, cell(row.current), ...(hasPrevious.value ? [cell(row.previous)] : [])])
  }
}

function groupTable(header, rows) {
  const columns = [header]
  seriesLabels.value.forEach((year) => columns.push(`${year}購票張數`, `${year}營收`, `${year}訂單`, `${year}客單價`))
  return {
    columns,
    rows: rows.map((row) => [
      row.label,
      ...[row.current, row.previous]
        .slice(0, seriesLabels.value.length)
        .flatMap((summary) => [formatCount(summary.tickets), formatCurrency(summary.revenue), formatCount(summary.orders), formatCurrency(summary.aov)])
    ])
  }
}

const hourTable = computed(() => shareTable('時段', hourRows.value, '筆'))
const identityTable = computed(() => groupTable('學校／身分', report.value.identities))
const gradeTable = computed(() => groupTable('年級', report.value.grades))
const valueTable = computed(() => shareTable('訂單金額（NT$）', report.value.values, '筆'))
const stageTable = computed(() => shareTable('階段', report.value.stages, '張'))
const weekdayTable = computed(() => shareTable('星期', report.value.weekdays, '筆'))

const ticketTypeTable = computed(() => {
  const latest = new Map(report.value.ticketTypes.current.map((type) => [type.label, type]))
  const earlier = new Map(hasPrevious.value ? report.value.ticketTypes.previous.map((type) => [type.label, type]) : [])
  const columns = ['票種']
  seriesLabels.value.forEach((year) => columns.push(`${year}張數`, `${year}金額`))
  return {
    columns,
    rows: [...new Set([...latest.keys(), ...earlier.keys()])].map((label) => [
      label,
      ...[latest, earlier]
        .slice(0, seriesLabels.value.length)
        .flatMap((types) => [formatCount(types.get(label)?.units || 0), formatCurrency(types.get(label)?.amount || 0)])
    ])
  }
})

function periodTableOf({ key, format }) {
  const compared = Boolean(periodRange.value.previous)
  return {
    columns: ['時間', '本期', ...(compared ? [periodComparison.value] : [])],
    rows: periodPoints.value.map((point) => [
      point.title,
      format(point.current[key]),
      ...(compared ? [point.previous ? `${format(point.previous[key])}（${point.previous.title}）` : '—'] : [])
    ])
  }
}

const groupShareTable = computed(() => ({
  columns: ['身分', ...groupShareBars.value.flatMap((bar) => [`${bar.label}營收`, `${bar.label}占比`])],
  rows: report.value.identityGroups.current.map((group, i) => [
    group.label,
    ...groupShareBars.value.flatMap((bar) => [formatCurrency(bar.segments[i].value), formatPercent(bar.segments[i].share)])
  ])
}))

const channelTable = computed(() => ({
  columns: ['管道', '選擇比例', '回覆數'],
  rows: (survey.value?.rows || []).map((row) => [row.label, formatPercent(row.share), formatCount(row.count)])
}))

const channelReachTable = computed(() => ({
  columns: ['身分', '回覆數', ...(survey.value?.rows || []).map((row) => row.label)],
  rows: channelReach.value.map((group) => [
    group.label,
    formatCount(group.respondents),
    ...group.channels.map((channel) => formatPercent(channel.share))
  ])
}))

const stageMixTable = computed(() => ({
  columns: ['身分', ...report.value.stageGroups.map((stage) => stage.label)],
  rows: (report.value.stageGroups[0]?.groups || []).map((group, i) => [
    group.label,
    ...report.value.stageGroups.map((stage) => `${formatPercent(stage.groups[i].share)}（${formatCount(stage.groups[i].count)} 張）`)
  ])
}))

const portfolioTable = computed(() => ({
  columns: ['身分', `${seriesLabels.value[0]}張數`, `${seriesLabels.value[0]}占比`, `${compareLabel.value}占比`, '增減'],
  rows: portfolioPoints.value.map((point) => [
    point.label,
    formatCount(point.size),
    formatPercent(point.x),
    formatPercent(point.previous.ticketShare),
    formatPoints(point.y)
  ])
}))

const groupHourTable = computed(() => ({
  columns: ['身分', ...HOUR_LABELS.map((hour) => `${hour} 時`)],
  rows: report.value.groupHours.map((group) => [group.label, ...group.hours.map((hour) => formatPercent(hour.share))])
}))

const peakTable = computed(() => ({
  columns: ['天數', '日期', '訂單數', '前 7 天平均'],
  rows: timeline.value.current.orders.map((orders, i) => [
    dayTitle(i),
    formatDay(timeline.value.dayStart(current.value, i)),
    formatCount(orders),
    formatDecimal(report.value.peaks.baseline[i])
  ])
}))

const concentrationTable = computed(() => {
  const { buyers, curve } = report.value.concentration
  return {
    columns: ['營收最高的', '購買者', '營收占比'],
    rows: curve.slice(1).map((share, i) => [
      `前 ${(i + 1) * 5}%`,
      formatCount(Math.round(((i + 1) / 20) * buyers)),
      formatPercent(share)
    ])
  }
})

const repeatTable = computed(() => ({
  columns: ['訂單數', '購買者', '占比'],
  rows: report.value.repeat.bands.map((band) => [band.label, formatCount(band.count), formatPercent(band.share)])
}))

const weekHourTable = computed(() => ({
  columns: ['星期', ...HOUR_LABELS.map((hour) => `${hour} 時`)],
  rows: report.value.weekHours.map((hours, row) => [WEEKDAY_LABELS[row], ...hours.map((count) => formatCount(count))])
}))

// ---- PDF export ----

const toast = useToastStore()
const pageRoot = ref(null)
const exportStamp = ref('')

// The PDF is drawn a part at a time (downloadElementPartsAsPdf): the
// heading, KPIs and 期間分析, then each section. The others are hidden, not
// removed, so their cards keep their state (e.g. a table view).
const EXPORT_PARTS = 5
const exportPart = ref(null)
// `breaks`: it starts a new page within its part
function partClass(part, breaks = false) {
  if (exportPart.value === null) return null
  return exportPart.value === part ? { 'export-break': breaks } : 'export-hidden'
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

// The report as shown, without the controls, on white. html2pdf lays its
// copy out at the PDF's printable width, so the page is narrowed to that
// width first (.exporting) and the charts get a few frames to redraw at it.
async function exportPdf() {
  if (exporting.value) return
  toast.show('正在產生 PDF…')
  exportStamp.value = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })
  exporting.value = true
  try {
    await downloadElementPartsAsPdf(pageRoot.value, `銷售報表_${taipeiDate(Date.now())}.pdf`, EXPORT_PARTS, async (part) => {
      exportPart.value = part
      await nextTick()
      for (let i = 0; i < 3; i++) await nextFrame()
    })
  } catch (error) {
    console.error('PDF export failed:', error)
    toast.show('PDF 匯出失敗，請再試一次')
  } finally {
    exporting.value = false
    exportPart.value = null
  }
}

// ---- Import ----

const importOpen = ref(false)

function onImportFile(event) {
  const [file] = event.target.files
  // Lets the same file be picked again after a cancel.
  event.target.value = ''
  if (file) readImportFile(file)
}

async function saveImport() {
  if (await confirmImport()) importOpen.value = false
}

function closeImport() {
  cancelImport()
  importOpen.value = false
}
</script>

<style scoped>
@import 'src/css/analyticspage.scss';
</style>
