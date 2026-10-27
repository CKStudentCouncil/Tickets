<template>
  <div class="survey-page">
    <div class="survey-card">
      <p v-if="state === 'loading'" class="lead">載入中...</p>

      <template v-else-if="state === 'closed' || state === 'error'">
        <p class="eyebrow">{{ PARTY_YEAR }} 舞會滿意度調查</p>
        <h1>{{ state === 'error' ? '問卷載入失敗' : '問卷目前沒有開放' }}</h1>
        <p class="lead">
          {{ state === 'error' ? '請重新整理頁面再試一次' : '滿意度調查會在舞會結束後開放填寫，敬請期待' }}
        </p>
        <router-link to="/" class="primary-button">回到首頁</router-link>
      </template>

      <template v-else-if="state === 'open'">
        <p class="eyebrow">{{ PARTY_YEAR }} 舞會滿意度調查</p>
        <h1>這次的舞會，玩得開心嗎？</h1>
        <p class="lead">
          謝謝你參加 {{ PARTY_YEAR }} 年的建中舞會！<br />
          花幾分鐘告訴我們你的感受，你的回饋會成為明年舞會規劃的參考；<br />
          問卷不記名，資料僅用於活動檢討與改善
        </p>

        <form class="survey-form" @submit.prevent="handleSubmit">
          <section v-for="section in sections" :key="section.id" class="survey-section">
            <h2>{{ section.title }}</h2>

            <div v-for="q in section.questions" :id="`q-${q.id}`" :key="q.id" class="field">
              <template v-if="q.type === 'single' || q.type === 'multiple'">
                <p class="field-label">
                  {{ q.title }}{{ q.type === 'multiple' ? '（可複選）' : '' }}{{ q.required ? '' : '（選填）' }}
                </p>
                <div class="pill-group">
                  <label
                    v-for="opt in choicesOf(q)"
                    :key="opt.value"
                    class="pill"
                    :class="{ active: isPicked(q, opt.value) }"
                  >
                    <input
                      v-if="q.type === 'single'"
                      v-model="answers[q.id]"
                      type="radio"
                      :name="q.id"
                      :value="opt.value"
                    >
                    <input v-else v-model="answers[q.id]" type="checkbox" :value="opt.value">
                    {{ opt.label }}
                  </label>
                </div>
                <input
                  v-if="isPicked(q, OTHER)"
                  v-model="others[q.id]"
                  class="other-input"
                  type="text"
                  :maxlength="LIMITS.other"
                  placeholder="請填寫"
                  :aria-label="`${q.title}：其他`"
                >
              </template>

              <template v-else-if="q.type === 'scale'">
                <p v-if="q.title" class="field-label">{{ q.title }}{{ q.required ? '' : '（選填）' }}</p>
                <div v-for="row in q.rows" :key="row.id" class="scale-field">
                  <p class="scale-question">{{ row.text }}</p>
                  <div class="scale-row">
                    <span class="scale-edge" :data-high="q.highLabel">{{ q.lowLabel }}</span>
                    <div class="scale-options" role="group" :aria-label="row.text">
                      <button
                        v-for="n in 5"
                        :key="n"
                        type="button"
                        class="scale-btn"
                        :class="{ active: answers[q.id][row.id] === n }"
                        :aria-pressed="answers[q.id][row.id] === n"
                        @click="answers[q.id][row.id] = n"
                      >{{ n }}</button>
                    </div>
                    <span class="scale-edge">{{ q.highLabel }}</span>
                  </div>
                </div>
              </template>

              <template v-else>
                <label class="field-label" :for="`a-${q.id}`">{{ q.title }}{{ q.required ? '' : '（選填）' }}</label>
                <textarea
                  :id="`a-${q.id}`"
                  v-model="answers[q.id]"
                  rows="3"
                  :maxlength="LIMITS.text"
                  placeholder="請告訴我們"
                ></textarea>
              </template>
            </div>
          </section>

          <button type="submit" class="primary-button" :disabled="submitting">
            {{ submitting ? '正在送出…' : '送出問卷' }}
          </button>
        </form>
      </template>

      <div v-else class="thanks-state">
        <div class="thanks-icon"><q-icon name="check" /></div>
        <p class="eyebrow">{{ state === 'done' ? '已填寫過' : '已收到' }}</p>
        <h1>謝謝你的回饋</h1>
        <p class="lead">
          {{ state === 'done' ? `這台裝置已經送出過 ${PARTY_YEAR} 年的問卷` : '你的意見已經送出，我們會用來把明年的舞會辦得更好' }}
        </p>
        <router-link to="/" class="primary-button">回到首頁</router-link>
        <button v-if="state === 'done'" type="button" class="text-button" @click="startOver">替其他人再填一份</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useToastStore } from 'src/stores/toast'
import { PARTY_YEAR, fetchPartySurvey, submitPartySurveyAnswers } from 'src/services/partySurveyService'
import { LIMITS } from 'src/data/partySurveyQuestions.js'
import { firstMissing, questionsOf } from 'src/utils/partySurvey'

// the 其他 choice; what was typed replaces it when sending
const OTHER = '\u0000other'
// set once this device has answered this year's survey
const DONE_KEY = `cksc.partySurvey.${PARTY_YEAR}`

const toast = useToastStore()

// loading → open | closed | error; open → submitted; done: answered before on this device
const state = ref('loading')
const submitting = ref(false)
const sections = ref([])
const answers = reactive({})
const others = reactive({})

function startOver() {
  questionsOf(sections.value).forEach((q) => {
    answers[q.id] = q.type === 'multiple' ? [] : q.type === 'scale' ? {} : ''
    others[q.id] = ''
  })
  state.value = 'open'
}

function answeredBefore() {
  try {
    return localStorage.getItem(DONE_KEY) === '1'
  } catch {
    return false
  }
}

fetchPartySurvey(PARTY_YEAR)
  .then((survey) => {
    if (!survey?.open || !survey.sections?.length) {
      state.value = 'closed'
      return
    }
    sections.value = survey.sections
    startOver()
    if (answeredBefore()) state.value = 'done'
  })
  .catch((error) => {
    console.error('Party survey load error:', error)
    state.value = 'error'
  })

const choicesOf = (q) => [
  ...q.options.map((option) => ({ value: option, label: option })),
  ...(q.allowOther ? [{ value: OTHER, label: '其他' }] : [])
]

const isPicked = (q, value) => (q.type === 'multiple' ? answers[q.id].includes(value) : answers[q.id] === value)

// the answers as sent: 其他 replaced by what was typed, or left out when blank
function sheet() {
  const result = {}
  questionsOf(sections.value).forEach((q) => {
    const value = answers[q.id]
    const typed = (others[q.id] || '').trim()
    if (q.type === 'single') result[q.id] = value === OTHER ? typed : value
    else if (q.type === 'multiple') result[q.id] = value.map((item) => (item === OTHER ? typed : item)).filter(Boolean)
    else if (q.type === 'scale') result[q.id] = { ...value }
    else result[q.id] = value.trim()
  })
  return result
}

function show(question) {
  document.getElementById(`q-${question.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function handleSubmit() {
  const blankOther = questionsOf(sections.value).find((q) => isPicked(q, OTHER) && !(others[q.id] || '').trim())
  if (blankOther) {
    toast.show(`請填寫「${blankOther.title}」的其他內容`)
    show(blankOther)
    return
  }
  const result = sheet()
  const missing = firstMissing(sections.value, result)
  if (missing) {
    toast.show(`尚未回答「${missing.question.title || missing.section.title}」`)
    show(missing.question)
    return
  }

  submitting.value = true
  try {
    await submitPartySurveyAnswers(PARTY_YEAR, result)
    try {
      localStorage.setItem(DONE_KEY, '1')
    } catch {
      // private browsing: nothing to remember it in
    }
    state.value = 'submitted'
    window.scrollTo({ top: 0 })
  } catch (error) {
    console.error('Party survey submit error:', error)
    // the function names what it refused (e.g. 問卷目前沒有開放)
    const known = ['functions/invalid-argument', 'functions/failed-precondition', 'functions/unauthenticated'].includes(error?.code)
    toast.show(known ? error.message : '送出失敗，請再試一次')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
@import 'src/css/surveypage.scss';

.other-input {
  width: 100%;
  margin-top: 12px;
  padding: 11px 14px;

  border: 1px solid var(--line);
  border-radius: 0;
  background: rgba(255, 255, 255, .018);

  color: var(--off-white);
  font: inherit;
  font-size: 14px;
}

.other-input:focus {
  border-color: var(--ember);
  outline: none;
}

.text-button {
  display: block;
  margin: 18px auto 0;
  padding: 6px 10px;

  border: 0;
  background: none;

  color: var(--lunar);
  font: inherit;
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 3px;

  cursor: pointer;
}

@media (max-width: 700px) {
  /* each scale names its own top end (surveypage.scss says 非常同意) */
  .scale-edge:first-child::after {
    content: ' → ' attr(data-high);
  }
}
</style>
