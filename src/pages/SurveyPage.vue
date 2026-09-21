<template>
  <div class="survey-page">
    <div class="survey-card">
      <template v-if="!submitted">
        <p class="eyebrow">使用者回饋</p>
        <h1>幫我們把系統做得更好</h1>
        <p class="lead">
            親愛的使用者您好：<br />
            為使校慶紀念品訂購系統2.0更加完善，懇請您填寫此表單，以利後續系統之改進。<br />
            本表單所蒐集之資訊僅做為系統改善使用，敬請安心，懇請您能詳實填答。<br />
            如有任何疑問之處，懇請您不吝提供寶貴意見，謹致上最真誠的謝意。<br />
            再次感謝您的支持。<br />
        </p>

        <form class="survey-form" @submit.prevent="handleSubmit">
          <section class="survey-section">
            <h2>基本資料</h2>

            <div class="field">
              <label class="field-label">您的身分為何？</label>
              <div class="pill-group">
                <label v-for="opt in identityOptions" :key="opt" class="pill" :class="{ active: form.identity === opt }">
                  <input v-model="form.identity" type="radio" name="identity" :value="opt">
                  {{ opt }}
                </label>
              </div>
            </div>

            <div class="field">
              <label class="field-label">您是如何得知本系統的？（可複選）</label>
              <div class="pill-group">
                <label v-for="opt in channelOptions" :key="opt" class="pill" :class="{ active: form.channels.includes(opt) }">
                  <input v-model="form.channels" type="checkbox" :value="opt">
                  {{ opt }}
                </label>
              </div>
            </div>

            <div class="field">
              <label class="field-label">您主要使用什麼裝置操作本系統？</label>
              <div class="pill-group">
                <label v-for="opt in deviceOptions" :key="opt" class="pill" :class="{ active: form.device === opt }">
                  <input v-model="form.device" type="radio" name="device" :value="opt">
                  {{ opt }}
                </label>
              </div>
            </div>
          </section>

          <section v-for="section in scaleSections" :key="section.key" class="survey-section">
            <h2>{{ section.title }}</h2>
            <div v-for="q in section.questions" :key="q.id" class="scale-field">
              <p class="scale-question">{{ q.text }}</p>
              <div class="scale-row">
                <span class="scale-edge">非常不同意</span>
                <div class="scale-options">
                  <button
                    v-for="n in 5"
                    :key="n"
                    type="button"
                    class="scale-btn"
                    :class="{ active: form.scores[q.id] === n }"
                    :aria-pressed="form.scores[q.id] === n"
                    @click="form.scores[q.id] = n"
                  >{{ n }}</button>
                </div>
                <span class="scale-edge">非常同意</span>
              </div>
            </div>
          </section>

          <section class="survey-section">
            <h2>實際使用問題</h2>

            <div class="field">
              <label class="field-label">您在使用本系統時，是否曾遇到操作上的問題？</label>
              <div class="pill-group">
                <label v-for="opt in issueCountOptions" :key="opt" class="pill" :class="{ active: form.issueCount === opt }">
                  <input v-model="form.issueCount" type="radio" name="issueCount" :value="opt">
                  {{ opt }}
                </label>
              </div>
            </div>

            <div v-if="hasIssue" class="field">
              <label class="field-label">您遇到的問題主要發生在哪個部分？（可複選）</label>
              <div class="pill-group">
                <label v-for="opt in issueTypeOptions" :key="opt" class="pill" :class="{ active: form.issueTypes.includes(opt) }">
                  <input v-model="form.issueTypes" type="checkbox" :value="opt">
                  {{ opt }}
                </label>
              </div>
            </div>

            <div class="field">
              <label class="field-label">如果可以改善本系統的一個地方，您最希望改善什麼？（選填）</label>
              <textarea v-model="form.improvement" rows="3" placeholder="請告訴我們"></textarea>
            </div>

            <div class="field">
              <label class="field-label">其他建議或想對開發團隊說的話（選填）</label>
              <textarea v-model="form.suggestion" rows="3" placeholder="有什麼想說的都可以"></textarea>
            </div>
          </section>

          <button type="submit" class="primary-button" :disabled="submitting">
            {{ submitting ? '正在送出…' : '送出問卷' }}
          </button>
        </form>
      </template>

      <div v-else class="thanks-state">
        <div class="thanks-icon"><q-icon name="check" /></div>
        <p class="eyebrow">已收到</p>
        <h1>謝謝你的回饋</h1>
        <p class="lead">你的意見已經送出，我們會參考這些資料持續改善系統。</p>
        <router-link to="/" class="primary-button">回到首頁</router-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from 'src/boot/firebase'
import { useToastStore } from 'src/stores/toast'
import {
  IDENTITY_OPTIONS,
  CHANNEL_OPTIONS,
  DEVICE_OPTIONS,
  ISSUE_COUNT_OPTIONS,
  ISSUE_TYPE_OPTIONS,
  SCALE_SECTIONS
} from 'src/data/surveyQuestions.js'

const toast = useToastStore()

const identityOptions = IDENTITY_OPTIONS
const channelOptions = CHANNEL_OPTIONS
const deviceOptions = DEVICE_OPTIONS
const issueCountOptions = ISSUE_COUNT_OPTIONS
const issueTypeOptions = ISSUE_TYPE_OPTIONS
const scaleSections = SCALE_SECTIONS

const submitting = ref(false)
const submitted = ref(false)

const form = reactive({
  identity: '',
  channels: [],
  device: '',
  scores: {},
  issueCount: '',
  issueTypes: [],
  improvement: '',
  suggestion: ''
})

const hasIssue = computed(() => form.issueCount && form.issueCount !== '沒有遇到問題')

function validate() {
  if (!form.identity) return '請選擇您的身分'
  if (!form.channels.length) return '請選擇您是如何得知本系統的'
  if (!form.device) return '請選擇您主要使用的裝置'

  for (const section of scaleSections) {
    for (const q of section.questions) {
      if (!form.scores[q.id]) return '請完成所有評分題目'
    }
  }

  if (!form.issueCount) return '請選擇是否曾遇到操作上的問題'
  if (hasIssue.value && !form.issueTypes.length) return '請選擇問題主要發生在哪個部分'

  return ''
}

async function handleSubmit() {
  const error = validate()
  if (error) {
    toast.show(error)
    return
  }

  submitting.value = true
  try {
    await addDoc(collection(db, 'surveyResponses'), {
      identity: form.identity,
      channels: form.channels,
      device: form.device,
      scores: form.scores,
      issueCount: form.issueCount,
      issueTypes: hasIssue.value ? form.issueTypes : [],
      improvement: form.improvement.trim(),
      suggestion: form.suggestion.trim(),
      createdAt: serverTimestamp()
    })
    submitted.value = true
  } catch {
    toast.show('送出失敗，請再試一次。')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
@import 'src/css/surveypage.scss';
</style>