<template>

  <div v-if="loading" class="state">載入中...</div>

  <div v-else class="survey-admin-page">
    <div class="header-row">
      <h1>問卷結果</h1>
      <button type="button" class="btn-outline" @click="$router.push('/admin')">返回後台</button>
    </div>

    <nav v-if="responses.length" class="quick-nav">
      <button
        v-for="s in navSections"
        :key="s.id"
        type="button"
        class="quick-nav-btn"
        :class="{ 'quick-nav-btn--active': activeSection === s.id }"
        @click="activeSection = s.id"
      >
        {{ s.label }}
      </button>
    </nav>

    <section v-show="isVisible('overview')" class="section-group">
      <div class="stats">
        <div class="stat-card">
          <strong class="num">{{ responses.length }}</strong>
          <span>回收份數</span>
        </div>
        <div v-for="section in scaleSections" :key="section.key" class="stat-card">
          <strong class="num" :class="tierClass(averages[section.key])">{{ averages[section.key] }}</strong>
          <span>{{ section.title }}平均</span>
        </div>
        <div class="stat-card">
          <strong class="num">{{ issueRate }}%</strong>
          <span>曾遇到操作問題</span>
        </div>
      </div>

      <div class="panel">
        <h2>四大構面平均分數</h2>
        <div v-if="responses.length" class="bar-list">
          <div v-for="section in scaleSections" :key="section.key" class="bar-row">
            <span class="bar-label">{{ section.title }}</span>
            <div class="bar-track">
              <div
                class="bar-fill"
                :class="tierClass(averages[section.key])"
                :style="{ width: scoreToPercent(averages[section.key]) + '%' }"
              ></div>
            </div>
            <span class="bar-count num">{{ averages[section.key] }}</span>
          </div>
        </div>
        <p v-else class="empty">目前沒有資料</p>
      </div>
    </section>

    <section v-show="isVisible('question-detail')" class="section-group">
      <p class="eyebrow">細部數據</p>

      <div class="panel">
        <div class="header-row header-row--tight">
          <h2>各題詳細數據</h2>
          <button type="button" class="btn-outline btn-small" @click="questionDetailOpen = !questionDetailOpen">
            {{ questionDetailOpen ? '收合' : '展開' }}
          </button>
        </div>

        <div v-if="responses.length && questionDetailOpen" class="question-detail">
          <div v-for="section in questionStats" :key="section.key" class="question-section">
            <h3 class="question-section-title">{{ section.title }}</h3>

            <div v-for="q in section.questions" :key="q.id" class="question-row">
              <div class="question-row-head">
                <span class="question-text">{{ q.text }}</span>
                <span class="question-avg num" :class="tierClass(q.average)">{{ q.average }}</span>
              </div>

              <div class="bar-track question-bar-track">
                <div
                  class="bar-fill"
                  :class="tierClass(q.average)"
                  :style="{ width: scoreToPercent(q.average) + '%' }"
                ></div>
              </div>

              <div class="stacked-track question-stacked-track">
                <div
                  v-for="score in [1, 2, 3, 4, 5]"
                  :key="score"
                  class="stacked-segment"
                  :class="'score-' + score"
                  :style="{ width: segmentPercent(q.dist, score) + '%' }"
                  :title="`${score} 分：${q.dist[score]} 次`"
                ></div>
              </div>

              <div class="question-count-row">
                <span v-for="score in [1, 2, 3, 4, 5]" :key="score" class="question-count">
                  <span class="legend-dot" :class="'score-' + score"></span>{{ score }} 分：{{ q.dist[score] }}
                </span>
                <span class="question-count question-count--n">n = {{ q.count }}</span>
              </div>
            </div>
          </div>
        </div>
        <p v-else-if="!responses.length" class="empty">目前沒有資料</p>
        <p v-else class="empty">點擊「展開」查看每題詳細數據</p>
      </div>

      <div class="panel">
        <h2>各構面評分分布</h2>
        <div v-if="responses.length" class="stacked-list">
          <div v-for="dist in scoreDistributions" :key="dist.key" class="stacked-row">
            <span class="stacked-label">{{ dist.title }}</span>
            <div class="stacked-track">
              <div
                v-for="score in [1, 2, 3, 4, 5]"
                :key="score"
                class="stacked-segment"
                :class="'score-' + score"
                :style="{ width: segmentPercent(dist.dist, score) + '%' }"
                :title="`${score} 分：${dist.dist[score]} 次`"
              ></div>
            </div>
          </div>
        </div>
        <div class="stacked-legend">
          <span v-for="score in [1, 2, 3, 4, 5]" :key="score" class="legend-row">
            <span class="legend-dot" :class="'score-' + score"></span>{{ score }} 分
          </span>
        </div>
        <p v-if="!responses.length" class="empty">目前沒有資料</p>
      </div>
    </section>

    <section v-show="isVisible('satisfaction')" class="section-group">
      <p class="eyebrow">滿意度與趨勢</p>

      <div class="panel">
        <h2>是否曾遇到操作問題</h2>
        <div v-if="responses.length" class="donut-row">
          <svg viewBox="0 0 100 100" class="donut">
            <circle class="donut-track" cx="50" cy="50" r="40" />
            <circle
              class="donut-value"
              cx="50" cy="50" r="40"
              :style="{ strokeDasharray: donutCircumference, strokeDashoffset: donutOffset }"
            />
            <text x="50" y="46" text-anchor="middle" class="donut-number">{{ issueRate }}%</text>
            <text x="50" y="64" text-anchor="middle" class="donut-caption">曾遇到問題</text>
          </svg>
          <div class="donut-legend">
            <div class="legend-row"><span class="legend-dot issue"></span>曾遇到問題 <strong class="num">{{ issueRespondentCount }}</strong> 份</div>
            <div class="legend-row"><span class="legend-dot no-issue"></span>沒遇到問題 <strong class="num">{{ responses.length - issueRespondentCount }}</strong> 份</div>
          </div>
        </div>
        <p v-else class="empty">目前沒有資料</p>
      </div>

      <div class="panel">
        <h2>每日回覆趨勢</h2>
        <svg
          v-if="trendPoints.length >= 2"
          viewBox="0 0 600 180"
          preserveAspectRatio="none"
          class="trend-chart"
        >
          <polygon :points="trendAreaPoints" class="trend-area" />
          <polyline :points="trendLinePoints" class="trend-line" />
          <circle v-for="p in trendPoints" :key="p.date" :cx="p.x" :cy="p.y" r="3" class="trend-dot" />
        </svg>
        <div v-if="trendPoints.length >= 2" class="trend-axis">
          <span>{{ trendPoints[0].dateLabel }}</span>
          <span>{{ trendPoints[trendPoints.length - 1].dateLabel }}</span>
        </div>
        <p v-else class="empty">回覆的日期分布太少，暫時不足以畫出趨勢圖</p>
      </div>

      <div class="panel" v-if="Object.keys(issueTypeDist).length">
        <h2>問題主要發生的部分</h2>
        <div class="bar-list">
          <div v-for="(count, label) in issueTypeDist" :key="label" class="bar-row">
            <span class="bar-label">{{ label }}</span>
            <div class="bar-track"><div class="bar-fill" :style="{ width: pct(count, issueRespondentCount) + '%' }"></div></div>
            <span class="bar-count num">{{ count }}</span>
          </div>
        </div>
      </div>
    </section>

    <section v-show="isVisible('demographics')" class="section-group">
      <p class="eyebrow">基本資訊</p>

      <div class="panel">
        <div class="tab-row">
          <button
            v-for="t in demoTabs"
            :key="t.key"
            type="button"
            class="tab-btn"
            :class="{ 'tab-btn--active': activeDemoTab === t.key }"
            @click="activeDemoTab = t.key"
          >
            {{ t.label }}
          </button>
        </div>

        <div v-if="Object.keys(activeDemoDist).length" class="bar-list">
          <div v-for="(count, label) in activeDemoDist" :key="label" class="bar-row">
            <span class="bar-label">{{ label }}</span>
            <div class="bar-track"><div class="bar-fill" :style="{ width: pct(count, responses.length) + '%' }"></div></div>
            <span class="bar-count num">{{ count }}</span>
          </div>
        </div>
        <p v-else class="empty">目前沒有資料</p>
      </div>
    </section>

    <section v-show="isVisible('text-feedback')" class="section-group">
      <p class="eyebrow">文字回饋</p>

      <div class="panel">
        <h2>最希望改善的地方</h2>
        <ul v-if="improvementAnswers.length" class="text-answers">
          <li v-for="(t, i) in improvementAnswers" :key="i">{{ t }}</li>
        </ul>
        <p v-else class="empty">目前沒有回覆</p>
      </div>

      <div class="panel">
        <h2>其他建議</h2>
        <ul v-if="suggestionAnswers.length" class="text-answers">
          <li v-for="(t, i) in suggestionAnswers" :key="i">{{ t }}</li>
        </ul>
        <p v-else class="empty">目前沒有回覆</p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { collection, getDocs } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { USE_MOCK_ORDERS, MOCK_ALLOW_ADMIN_WITHOUT_AUTH } from 'src/config/app'
import { SCALE_SECTIONS } from 'src/data/surveyQuestions.js'

const auth = useAuthStore()
const toast = useToastStore()
const canAccessAdmin = computed(
  () => auth.isManager || (USE_MOCK_ORDERS && MOCK_ALLOW_ADMIN_WITHOUT_AUTH)
)

const scaleSections = SCALE_SECTIONS
const responses = ref([])
const loading = ref(true)
const questionDetailOpen = ref(false)

const navSections = [
  { id: 'all', label: '全部' },
  { id: 'overview', label: '總覽' },
  { id: 'question-detail', label: '細部數據' },
  { id: 'satisfaction', label: '滿意度與趨勢' },
  { id: 'demographics', label: '基本資訊' },
  { id: 'text-feedback', label: '文字回饋' }
]
const activeSection = ref('all')
function isVisible(id) {
  return activeSection.value === 'all' || activeSection.value === id
}

onMounted(async () => {
  if (!canAccessAdmin.value) {
    loading.value = false
    return
  }
  try {
    const snapshot = await getDocs(collection(db, 'surveyResponses'))
    responses.value = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch {
    toast.show('載入問卷資料失敗')
  } finally {
    loading.value = false
  }
})

const averages = computed(() => {
  const result = {}
  for (const section of scaleSections) {
    let sum = 0
    let count = 0
    for (const res of responses.value) {
      for (const q of section.questions) {
        const v = res.scores?.[q.id]
        if (v) {
          sum += v
          count++
        }
      }
    }
    result[section.key] = count ? (sum / count).toFixed(1) : '—'
  }
  return result
})

function scoreToPercent(avg) {
  const n = Number(avg)
  if (!n) return 0
  return Math.min(100, (n / 5) * 100)
}

function tierClass(avg) {
  const n = Number(avg)
  if (!n) return ''
  if (n < 3.5) return 'tier-low'
  if (n < 4.2) return 'tier-mid'
  return 'tier-high'
}

const issueRespondentCount = computed(
  () => responses.value.filter((r) => r.issueCount && r.issueCount !== '沒有遇到問題').length
)

const issueRate = computed(() => {
  if (!responses.value.length) return 0
  return Math.round((issueRespondentCount.value / responses.value.length) * 100)
})

const donutCircumference = 2 * Math.PI * 40
const donutOffset = computed(() => donutCircumference * (1 - issueRate.value / 100))

function countBy(list, key) {
  const dist = {}
  for (const item of list) {
    const v = item[key]
    if (Array.isArray(v)) {
      for (const opt of v) dist[opt] = (dist[opt] || 0) + 1
    } else if (v) {
      dist[v] = (dist[v] || 0) + 1
    }
  }
  return dist
}

const identityDist = computed(() => countBy(responses.value, 'identity'))
const channelDist = computed(() => countBy(responses.value, 'channels'))
const deviceDist = computed(() => countBy(responses.value, 'device'))
const issueTypeDist = computed(() => countBy(responses.value, 'issueTypes'))

const demoTabs = [
  { key: 'identity', label: '身分別' },
  { key: 'channel', label: '得知管道' },
  { key: 'device', label: '裝置分布' }
]
const activeDemoTab = ref('identity')
const activeDemoDist = computed(() => {
  if (activeDemoTab.value === 'channel') return channelDist.value
  if (activeDemoTab.value === 'device') return deviceDist.value
  return identityDist.value
})

function scoreDistribution(section) {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const res of responses.value) {
    for (const q of section.questions) {
      const v = res.scores?.[q.id]
      if (v >= 1 && v <= 5) dist[v]++
    }
  }
  return dist
}

const scoreDistributions = computed(() =>
  scaleSections.map((section) => ({
    key: section.key,
    title: section.title,
    dist: scoreDistribution(section)
  }))
)

function questionScoreStats(question) {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let sum = 0
  let count = 0
  for (const res of responses.value) {
    const v = res.scores?.[question.id]
    if (v >= 1 && v <= 5) {
      dist[v]++
      sum += v
      count++
    }
  }
  return {
    id: question.id,
    text: question.text,
    dist,
    count,
    average: count ? (sum / count).toFixed(1) : '—'
  }
}

const questionStats = computed(() =>
  scaleSections.map((section) => ({
    key: section.key,
    title: section.title,
    questions: section.questions.map(questionScoreStats)
  }))
)

const attentionQuestions = computed(() => {
  const all = questionStats.value.flatMap((section) =>
    section.questions
      .filter((q) => q.count > 0)
      .map((q) => ({ ...q, sectionTitle: section.title }))
  )
  return all.sort((a, b) => Number(a.average) - Number(b.average)).slice(0, 3)
})

function segmentPercent(dist, score) {
  const total = Object.values(dist).reduce((a, b) => a + b, 0)
  return total ? (dist[score] / total) * 100 : 0
}

function toDateKey(createdAt) {
  if (!createdAt) return null
  const d = createdAt.toDate ? createdAt.toDate() : new Date(createdAt)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

const responsesByDate = computed(() => {
  const map = {}
  for (const r of responses.value) {
    const key = toDateKey(r.createdAt)
    if (!key) continue
    map[key] = (map[key] || 0) + 1
  }
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
})

const trendPoints = computed(() => {
  const entries = responsesByDate.value
  if (entries.length < 2) return []

  const width = 600
  const height = 180
  const padding = 20
  const maxCount = Math.max(...entries.map(([, c]) => c), 1)
  const stepX = (width - padding * 2) / (entries.length - 1)

  return entries.map(([date, count], i) => {
    const x = padding + i * stepX
    const y = height - padding - (count / maxCount) * (height - padding * 2)
    const [, m, d] = date.split('-')
    return { date, count, x, y, dateLabel: `${m}/${d}` }
  })
})

const trendLinePoints = computed(() => trendPoints.value.map((p) => `${p.x},${p.y}`).join(' '))

const trendAreaPoints = computed(() => {
  const pts = trendPoints.value
  if (!pts.length) return ''
  const bottom = 160
  return `${trendLinePoints.value} ${pts[pts.length - 1].x},${bottom} ${pts[0].x},${bottom}`
})

const improvementAnswers = computed(() => responses.value.map((r) => r.improvement).filter(Boolean))
const suggestionAnswers = computed(() => responses.value.map((r) => r.suggestion).filter(Boolean))

function pct(count, total) {
  return total ? Math.round((count / total) * 100) : 0
}
</script>

<style scoped>
@import 'src/css/surveyadminpage.scss';
</style>