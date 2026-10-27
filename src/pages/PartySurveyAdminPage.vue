<template>
  <div v-if="loading" class="state">載入中...</div>

  <div v-else class="survey-admin-page">
    <div class="header-row">
      <div>
        <p class="eyebrow">舞會回饋分析</p>
        <h1>舞會滿意度調查</h1>
      </div>
      <button type="button" class="btn-outline" @click="$router.push('/admin')">返回後台</button>
    </div>

    <!-- this year's survey: open or close it, and the link to share -->
    <div class="panel">
      <div class="header-row header-row--tight">
        <div>
          <h2>{{ PARTY_YEAR }} 年問卷</h2>
          <p class="status" :class="{ open: isOpen }">
            <span class="status-dot" aria-hidden="true" />
            {{ isOpen ? '開放填寫中' : (currentSurvey ? '已關閉' : '尚未設定題目') }}
          </p>
        </div>
        <button
          type="button"
          class="btn-outline"
          :disabled="busy || (!isOpen && !currentSections.length)"
          @click="toggleOpen"
        >
          {{ isOpen ? '關閉問卷' : '開放填寫' }}
        </button>
      </div>

      <div class="share-link">
        <span class="mono">{{ SURVEY_URL }}</span>
        <button type="button" class="btn-outline btn-small" @click="copyLink">複製問卷連結</button>
      </div>
      <p class="panel-note">
        <template v-if="!currentSections.length">先在「題目設定」儲存題目，才能開放填寫</template>
        <template v-else>開放期間登入的使用者都能用連結填寫，回覆會存在 {{ PARTY_YEAR }} 年的資料中；關閉後就不再接受回覆</template>
      </p>

      <!-- email the link to everyone who bought a ticket -->
      <div class="mail-row">
        <button type="button" class="btn-outline" :disabled="!isOpen || sendingMail" @click="sendToBuyers">
          {{ sendingMail ? '處理中…' : '寄送問卷給所有購票者' }}
        </button>
        <button
          v-if="needsNotificationEnqueue(mailJob)"
          type="button"
          class="btn-outline"
          :disabled="sendingMail"
          @click="runNotificationJob(mailJob)"
        >
          繼續加入寄送佇列
        </button>
        <button v-if="canClearNotification(mailJob)" type="button" class="btn-outline" @click="setMailJob(null)">
          清除寄送紀錄
        </button>
      </div>
      <p v-if="mailJob" class="panel-note" role="status">{{ mailProgress }}</p>
      <p v-if="mailError" class="panel-note" role="alert">{{ mailError }}</p>
      <p v-else-if="!isOpen" class="panel-note">開放填寫後才能寄送</p>
    </div>

    <nav class="quick-nav">
      <button
        v-for="item in TABS"
        :key="item.key"
        type="button"
        class="quick-nav-btn"
        :class="{ 'quick-nav-btn--active': tab === item.key }"
        :aria-pressed="tab === item.key"
        @click="tab = item.key"
      >
        {{ item.label }}
      </button>
    </nav>

    <PartySurveyEditor
      v-if="tab === 'questions'"
      ref="editor"
      :year="PARTY_YEAR"
      :sections="currentSections"
      :response-count="years.includes(PARTY_YEAR) && year === PARTY_YEAR ? responses.length : 0"
      :copy-years="years.filter((item) => item !== PARTY_YEAR)"
      :saving="busy"
      @save="saveQuestions"
      @copy="copyFrom"
    />

    <template v-else>
      <div v-if="years.length" class="year-row">
        <label>
          <span>年度</span>
          <select v-model="year">
            <option v-for="item in years" :key="item" :value="item">{{ item }} 年</option>
          </select>
        </label>
        <label v-if="years.length > 1">
          <span>比較</span>
          <select v-model="compareYear">
            <option v-for="item in years.filter((item) => item !== year)" :key="item" :value="item">{{ item }} 年</option>
            <option :value="null">不比較</option>
          </select>
        </label>
      </div>

      <p v-if="responsesLoading" class="empty">載入中...</p>
      <p v-else-if="!summary.count" class="empty">{{ year }} 年還沒有回覆</p>

      <template v-else>
        <section class="section-group">
          <p class="eyebrow">總覽</p>

          <div class="stats">
            <div class="stat-card">
              <strong class="num">{{ summary.count }}</strong>
              <span>回收份數</span>
              <em v-if="compared" class="delta">{{ compareYear }} 年 {{ compared.count }} 份</em>
            </div>
          </div>

          <div v-if="lowest.length" class="panel">
            <h2>評分最低的項目</h2>
            <p class="panel-note">所有評分題中平均分數最低的三項，明年可以優先檢討</p>
            <ol class="lowest-list">
              <li v-for="row in lowest" :key="`${row.question}-${row.id}`">
                <span>{{ row.text }}</span>
                <strong class="num" :class="tierClass(row.average)">{{ formatScore(row.average) }}</strong>
              </li>
            </ol>
          </div>
        </section>

        <section v-for="section in summary.sections" :key="section.id" class="section-group">
          <p class="eyebrow">{{ section.title }}</p>
          <p v-if="compared && section.questions.some((q) => q.type === 'scale')" class="panel-note">
            分數下方是與 {{ compareYear }} 年相比的增減
          </p>

          <div v-for="q in section.questions" :key="q.id" class="panel">
            <h2 v-if="q.title">{{ q.title }}</h2>

            <template v-if="q.type === 'single' || q.type === 'multiple'">
              <p class="panel-note">
                {{ q.summary.answered }} 人回答{{ q.type === 'multiple' ? '，可複選，比例是選擇該項的人數占回答人數' : '' }}
              </p>
              <div class="bar-list">
                <div v-for="option in q.summary.options" :key="option.label" class="bar-row">
                  <span class="bar-label">{{ option.label }}</span>
                  <div class="bar-track">
                    <div class="bar-fill" :style="{ width: option.share * 100 + '%' }" />
                  </div>
                  <span class="bar-count num">{{ option.count }}<em class="delta">{{ formatPercent(option.share) }}</em></span>
                </div>
                <div v-if="q.summary.others.length" class="bar-row">
                  <span class="bar-label">其他</span>
                  <div class="bar-track">
                    <div class="bar-fill" :style="{ width: (q.summary.others.length / q.summary.answered) * 100 + '%' }" />
                  </div>
                  <span class="bar-count num">{{ q.summary.others.length }}</span>
                </div>
              </div>
              <details v-if="q.summary.others.length" class="others">
                <summary>「其他」的內容（{{ q.summary.others.length }}）</summary>
                <ul class="text-answers">
                  <li v-for="(text, i) in q.summary.others" :key="i">{{ text }}</li>
                </ul>
              </details>
            </template>

            <div v-else-if="q.type === 'scale'" class="bar-list">
              <div v-for="row in q.summary.rows" :key="row.id" class="bar-row">
                <span class="bar-label">{{ row.text }}</span>
                <div class="bar-track">
                  <div class="bar-fill" :class="tierClass(row.average)" :style="{ width: scoreToPercent(row.average) + '%' }" />
                </div>
                <span class="bar-count num">
                  {{ formatScore(row.average) }}
                  <em v-if="compared" class="delta">{{ signed(row.average, comparedAverage(q.id, row.id)) }}</em>
                </span>
              </div>
            </div>

            <template v-else>
              <ul v-if="q.summary.texts.length" class="text-answers">
                <li v-for="(text, i) in q.summary.texts" :key="i">{{ text }}</li>
              </ul>
              <p v-else class="empty">目前沒有回覆</p>
            </template>
          </div>
        </section>

        <div class="stacked-legend">
          <span v-for="tier in TIERS" :key="tier.label" class="legend-row">
            <span class="legend-dot" :class="tier.class" />
            {{ tier.label }}
          </span>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PartySurveyEditor from 'src/components/PartySurveyEditor.vue'
import { useNotificationJob } from 'src/composables/useNotificationJob'
import { SITE_URL } from 'src/config/app'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import {
  PARTY_YEAR,
  fetchPartySurvey,
  fetchPartySurveyResponses,
  fetchPartySurveyYears,
  savePartySurvey
} from 'src/services/partySurveyService'
import { lowestRows, summarizeSurvey } from 'src/utils/partySurvey'
import { canClearNotification, needsNotificationEnqueue } from 'src/utils/notificationProgress'

const TABS = [
  { key: 'results', label: '結果' },
  { key: 'questions', label: '題目設定' }
]
const TIERS = [
  { label: '4.2 分以上', class: 'tier-high-dot' },
  { label: '3.5–4.2 分', class: 'tier-mid-dot' },
  { label: '3.5 分以下', class: 'tier-low-dot' }
]

const auth = useAuthStore()
const toast = useToastStore()
const router = useRouter()

const SURVEY_URL = `${SITE_URL}${router.resolve({ name: 'party-survey' }).href}`

const loading = ref(true)
const busy = ref(false)
const tab = ref('results')
const editor = ref(null)

// this year's survey (questions and whether it is open)
const currentSurvey = ref(null)
const currentSections = computed(() => currentSurvey.value?.sections || [])
const isOpen = computed(() => currentSurvey.value?.open === true)

// years that have a survey, latest first
const years = ref([])
const year = ref(PARTY_YEAR)
const compareYear = ref(null)

// the selected year's questions and answers, and the compared year's answers
const sections = ref([])
const responses = ref([])
const responsesLoading = ref(false)
const compareResponses = ref([])

const summary = computed(() => summarizeSurvey(sections.value, responses.value))
// the compared year's answers read with the selected year's questions: a
// year copied from another keeps its question ids
const compared = computed(() => (compareYear.value !== null && compareResponses.value.length
  ? summarizeSurvey(sections.value, compareResponses.value)
  : null))
const lowest = computed(() => lowestRows(summary.value))

async function loadYears() {
  const [survey, list] = await Promise.all([fetchPartySurvey(PARTY_YEAR), fetchPartySurveyYears()])
  currentSurvey.value = survey
  years.value = list
}

onMounted(async () => {
  try {
    await loadYears()
    if (!years.value.includes(year.value) && years.value.length) year.value = years.value[0]
    await loadYear(year.value)
  } catch (error) {
    console.error('Party survey admin load error:', error)
    toast.show('載入問卷資料失敗')
  } finally {
    loading.value = false
  }
})

// a year's questions and answers; drops what came back for a year no longer selected
async function loadYear(selected) {
  responsesLoading.value = true
  try {
    const [survey, loaded] = await Promise.all([fetchPartySurvey(selected), fetchPartySurveyResponses(selected)])
    if (year.value !== selected) return
    sections.value = survey?.sections || []
    responses.value = loaded
  } catch (error) {
    console.error('Party survey responses error:', error)
    toast.show(`${selected} 年的回覆載入失敗`)
  } finally {
    if (year.value === selected) responsesLoading.value = false
  }
  // compare with the year before by default
  if (compareYear.value === null || compareYear.value === selected) {
    compareYear.value = years.value.find((item) => item < selected) ?? null
  }
}

watch(year, (selected) => loadYear(selected))

watch(compareYear, async (selected) => {
  compareResponses.value = []
  if (selected === null) return
  try {
    const loaded = await fetchPartySurveyResponses(selected)
    if (compareYear.value === selected) compareResponses.value = loaded
  } catch (error) {
    console.error('Party survey compare error:', error)
    toast.show(`${selected} 年的回覆載入失敗`)
  }
})

// ---- this year's survey ----

async function save(changes, message) {
  busy.value = true
  try {
    await savePartySurvey(PARTY_YEAR, { open: isOpen.value, sections: currentSections.value, ...changes }, auth.user.uid)
    await loadYears()
    if (year.value === PARTY_YEAR) await loadYear(PARTY_YEAR)
    toast.show(message)
  } catch (error) {
    console.error('Party survey save error:', error)
    toast.show('儲存失敗，請再試一次')
  } finally {
    busy.value = false
  }
}

function toggleOpen() {
  return save({ open: !isOpen.value }, isOpen.value ? `已關閉 ${PARTY_YEAR} 年問卷` : `已開放 ${PARTY_YEAR} 年問卷`)
}

function saveQuestions(next) {
  return save({ sections: next }, '題目已儲存')
}

async function copyFrom(source) {
  try {
    const survey = await fetchPartySurvey(source)
    editor.value?.load(survey?.sections || [])
    toast.show(`已帶入 ${source} 年的題目，修改後記得儲存`)
  } catch (error) {
    console.error('Party survey copy error:', error)
    toast.show(`${source} 年的題目載入失敗`)
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(SURVEY_URL)
    toast.show('已複製問卷連結')
  } catch {
    toast.show('無法複製，請手動選取連結')
  }
}

// ---- emailing the survey to buyers ----

// a job of its own, apart from the notices sent from /admin
const {
  sending: sendingMail,
  pendingJob: mailJob,
  notificationError: mailError,
  notificationProgress: mailProgress,
  setPendingJob: setMailJob,
  prepareNotification,
  runNotificationJob
} = useNotificationJob('party_survey')

// prepareOrderNotification refuses while this year's survey is closed
async function sendToBuyers() {
  let job
  try {
    job = await prepareNotification({ type: 'survey', school: 'all', year: PARTY_YEAR })
  } catch (error) {
    console.error('Prepare survey email error:', error)
    toast.show(error?.message ? `寄送失敗：${error.message}` : '寄送失敗，請稍後再試')
    return
  }

  if (!job.total) {
    toast.show('目前沒有可寄送的購票者')
    return
  }
  if (!window.confirm(`確定要寄送 ${PARTY_YEAR} 年舞會滿意度調查給 ${job.total} 位購票者嗎？此動作無法復原`)) return

  await runNotificationJob(job)
}

// ---- numbers ----

const formatScore = (value) => (value == null ? '—' : value.toFixed(1))
const formatPercent = (ratio) => (ratio == null ? '—' : `${Math.round(ratio * 100)}%`)

// "+0.3", or "—" when either year has no answer
function signed(value, before) {
  if (value == null || before == null) return '—'
  const change = Number((value - before).toFixed(1))
  return `${change > 0 ? '+' : change < 0 ? '−' : '±'}${Math.abs(change).toFixed(1)}`
}

function comparedAverage(questionId, rowId) {
  const question = compared.value?.sections.flatMap((section) => section.questions).find((q) => q.id === questionId)
  return question?.summary.rows.find((row) => row.id === rowId)?.average ?? null
}

function scoreToPercent(average) {
  return average == null ? 0 : Math.min(100, (average / 5) * 100)
}

// same bands as the system survey's results (SurveyAdminPage.vue)
function tierClass(average) {
  if (average == null) return ''
  if (average < 3.5) return 'tier-low'
  if (average < 4.2) return 'tier-mid'
  return 'tier-high'
}
</script>

<style scoped>
@import 'src/css/surveyadminpage.scss';

.stats {
  grid-template-columns: minmax(0, 260px);
}

.delta {
  display: block;
  margin-top: 6px;

  color: var(--lunar);
  font-size: 11px;
  font-style: normal;
  font-variant-numeric: tabular-nums;
}

.panel-note {
  margin: -6px 0 18px;

  color: var(--lunar);
  font-size: 12.5px;
  line-height: 1.7;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 0;

  color: var(--lunar);
  font-size: 13px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--lunar);
}

.status.open {
  color: var(--ember);
}

.status.open .status-dot {
  background: var(--ember);
}

.share-link {
  display: flex;
  align-items: center;
  gap: 12px;

  margin: 18px 0 14px;
  padding: 10px 10px 10px 14px;

  border: 1px dashed var(--line);
}

.share-link .mono {
  flex: 1;
  min-width: 0;

  color: var(--lunar);
  font-family: 'Manrope', monospace;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.mail-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;

  margin: 4px 0 14px;
}

.mail-row .btn-outline:disabled {
  opacity: .45;
  cursor: not-allowed;
}

.mail-row .btn-outline:disabled:hover {
  border-color: var(--line);
  background: transparent;
  color: var(--off-white);
}

.quick-nav {
  margin-top: 34px;
  margin-bottom: 28px;
}

.year-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;

  /* auto sides keep it in the page's column (surveyadminpage.scss) */
  margin: 34px auto 28px;
}

.year-row label {
  display: inline-flex;
  align-items: center;
  gap: 10px;

  color: var(--lunar);
  font-size: 13px;
}

.year-row select {
  min-height: 36px;
  padding: 0 10px;

  border: 1px solid var(--line);
  border-radius: 0;
  background: var(--surface);

  color: var(--off-white);
  font: inherit;
}

.lowest-list {
  margin: 0;
  padding: 0 0 0 20px;

  color: var(--lunar);
}

.lowest-list li {
  padding: 9px 0;

  border-bottom: 1px solid var(--line-soft);
}

.lowest-list li:last-child {
  border-bottom: 0;
}

.lowest-list span {
  color: var(--off-white);
  font-size: 14px;
}

.lowest-list strong {
  float: right;

  font-size: 14px;
}

.others {
  margin-top: 16px;

  color: var(--lunar);
  font-size: 13px;
}

.others summary {
  cursor: pointer;
}

.others .text-answers {
  margin-top: 12px;
}

/* bars in their score's tier colour (surveyadminpage.scss colours only the text) */
.bar-fill.tier-high {
  background: #c5d1c5;
}

.bar-fill.tier-low {
  background: #c97878;
}

/* the tier colours as legend dots */
.tier-high-dot {
  background: #c5d1c5;
}

.tier-mid-dot {
  background: var(--ember);
}

.tier-low-dot {
  background: #c97878;
}

@media (max-width: 680px) {
  .share-link {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
