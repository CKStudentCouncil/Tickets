<template>
  <div class="editor">
    <p v-if="responseCount" class="editor-warning">
      {{ year }} 年已經有 {{ responseCount }} 份回覆；新增題目不影響統計，但修改或刪除已有的題目、選項，舊回覆會對不上
    </p>

    <div v-if="!draft.length" class="panel editor-empty">
      <h2>{{ year }} 年還沒有題目</h2>
      <p class="panel-note">從預設題目或往年的題目開始，再依今年的活動修改；複製往年的題目可以和那一年比較</p>
      <div class="editor-actions">
        <button type="button" class="btn-outline" @click="load(defaultSections())">使用預設題目</button>
        <button v-for="source in copyYears" :key="source" type="button" class="btn-outline" @click="emit('copy', source)">
          複製 {{ source }} 年的題目
        </button>
        <button type="button" class="btn-outline" @click="draft.push(newSection())">從空白開始</button>
      </div>
    </div>

    <article v-for="(section, s) in draft" :key="section.id" class="panel editor-section">
      <div class="line">
        <input
          v-model="section.title"
          class="text-input section-title"
          :maxlength="LIMITS.title"
          placeholder="區塊標題，例如：綜合評分"
          :aria-label="`第 ${s + 1} 個區塊的標題`"
        >
        <div class="tools">
          <button type="button" :disabled="s === 0" aria-label="區塊上移" @click="move(draft, s, -1)">↑</button>
          <button type="button" :disabled="s === draft.length - 1" aria-label="區塊下移" @click="move(draft, s, 1)">↓</button>
          <button type="button" @click="remove(draft, s, `區塊「${section.title || s + 1}」和裡面的題目`)">刪除區塊</button>
        </div>
      </div>

      <div v-for="(q, i) in section.questions" :key="q.id" class="question">
        <div class="line">
          <span class="question-number num">{{ i + 1 }}</span>
          <select v-model="q.type" class="type-select" :aria-label="`第 ${i + 1} 題的類型`">
            <option v-for="type in QUESTION_TYPES" :key="type.key" :value="type.key">{{ type.label }}</option>
          </select>
          <input
            v-model="q.title"
            class="text-input"
            :maxlength="LIMITS.title"
            :placeholder="q.type === 'scale' ? '說明（可留空）' : '題目'"
            :aria-label="`第 ${i + 1} 題的題目`"
          >
          <label class="check"><input v-model="q.required" type="checkbox"> 必填</label>
          <div class="tools">
            <button type="button" :disabled="i === 0" aria-label="題目上移" @click="move(section.questions, i, -1)">↑</button>
            <button type="button" :disabled="i === section.questions.length - 1" aria-label="題目下移" @click="move(section.questions, i, 1)">↓</button>
            <button type="button" @click="remove(section.questions, i, `第 ${i + 1} 題`)">刪除</button>
          </div>
        </div>

        <div v-if="q.type === 'single' || q.type === 'multiple'" class="details">
          <label class="detail">
            <span>選項，一行一個</span>
            <textarea v-model="q.optionsText" rows="4" placeholder="是&#10;否"></textarea>
          </label>
          <label class="check"><input v-model="q.allowOther" type="checkbox"> 加上「其他」，讓填答者自己填寫</label>
        </div>

        <div v-else-if="q.type === 'scale'" class="details">
          <label class="detail">
            <span>評分項目，一行一個，每項 1–5 分</span>
            <textarea v-model="q.rowsText" rows="5" placeholder="舞臺燈光&#10;舞臺音響"></textarea>
          </label>
          <div class="labels">
            <label class="detail"><span>1 分</span><input v-model="q.lowLabel" class="text-input" :maxlength="LIMITS.label"></label>
            <label class="detail"><span>5 分</span><input v-model="q.highLabel" class="text-input" :maxlength="LIMITS.label"></label>
          </div>
        </div>
      </div>

      <div class="add-row">
        <span>新增題目</span>
        <button
          v-for="type in QUESTION_TYPES"
          :key="type.key"
          type="button"
          class="btn-outline btn-small"
          @click="section.questions.push(toDraftQuestion(newQuestion(type.key)))"
        >
          {{ type.label }}
        </button>
      </div>
    </article>

    <div v-if="draft.length" class="editor-footer">
      <button type="button" class="btn-outline" @click="draft.push(newSection())">新增區塊</button>
      <span class="spacer" />
      <button v-if="dirty" type="button" class="text-button" :disabled="saving" @click="load(sections)">放棄修改</button>
      <button type="button" class="btn-outline save" :disabled="!dirty || saving" @click="save">
        {{ saving ? '儲存中...' : dirty ? '儲存題目' : '已儲存' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { LIMITS, QUESTION_TYPES, defaultSections } from 'src/data/partySurveyQuestions.js'
import { linesOf, newQuestion, newSection, problemOf, rowsFromLines } from 'src/utils/partySurvey'
import { useToastStore } from 'src/stores/toast'

// A year's questions as super admins edit them: options and rating rows as one
// line each, saved through the parent (it also holds whether the year is open).
const props = defineProps({
  year: { type: Number, required: true },
  // the saved questions, [] when there are none
  sections: { type: Array, required: true },
  responseCount: { type: Number, default: 0 },
  // earlier years whose questions can be copied
  copyYears: { type: Array, default: () => [] },
  saving: { type: Boolean, default: false }
})
const emit = defineEmits(['save', 'copy'])

const toast = useToastStore()

const toDraftQuestion = (q) => ({
  ...q,
  allowOther: q.allowOther ?? false,
  rows: q.rows || [],
  lowLabel: q.lowLabel ?? '非常不滿意',
  highLabel: q.highLabel ?? '非常滿意',
  optionsText: (q.options || []).join('\n'),
  rowsText: (q.rows || []).map((row) => row.text).join('\n')
})

const toDraft = (sections) => sections.map((section) => ({
  ...section,
  questions: section.questions.map(toDraftQuestion)
}))

// the draft as stored: only the fields of each question's type
const fromDraft = (draft) => draft.map((section) => ({
  id: section.id,
  title: section.title.trim(),
  questions: section.questions.map((q) => {
    const base = { id: q.id, type: q.type, title: q.title.trim(), required: q.required }
    if (q.type === 'single' || q.type === 'multiple') return { ...base, options: linesOf(q.optionsText), allowOther: q.allowOther }
    if (q.type === 'scale') {
      return { ...base, rows: rowsFromLines(q.rowsText, q.rows), lowLabel: q.lowLabel.trim(), highLabel: q.highLabel.trim() }
    }
    return base
  })
}))

const draft = ref(toDraft(props.sections))
watch(() => props.sections, (sections) => { draft.value = toDraft(sections) })

const dirty = computed(() => JSON.stringify(fromDraft(draft.value)) !== JSON.stringify(props.sections))

// starts the draft from other questions (defaults, another year's, or the saved ones)
function load(sections) {
  draft.value = toDraft(JSON.parse(JSON.stringify(sections)))
}
defineExpose({ load })

function move(list, i, step) {
  const [item] = list.splice(i, 1)
  list.splice(i + step, 0, item)
}

function remove(list, i, what) {
  if (window.confirm(`確定要刪除${what}嗎？`)) list.splice(i, 1)
}

function save() {
  const sections = fromDraft(draft.value)
  const problem = problemOf(sections)
  if (problem) {
    toast.show(problem)
    return
  }
  emit('save', sections)
}
</script>

<style scoped>
/* the panels and buttons of the page it sits in (scoped styles stop at a component) */
@import 'src/css/surveyadminpage.scss';

.panel-note {
  margin: -6px 0 18px;

  color: var(--lunar);
  font-size: 12.5px;
  line-height: 1.7;
}

.editor-warning {
  margin: 0 0 22px;
  padding: 12px 16px;

  border: 1px solid rgba(228, 164, 104, .4);

  color: var(--ember);
  font-size: 13px;
  line-height: 1.7;
}

.editor-actions,
.add-row,
.editor-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.text-input,
.type-select,
textarea {
  min-height: 38px;
  padding: 8px 12px;

  border: 1px solid var(--line);
  border-radius: 0;
  background: var(--surface);

  color: var(--off-white);
  font: inherit;
  font-size: 14px;
}

.text-input:focus,
.type-select:focus,
textarea:focus {
  border-color: var(--ember);
  outline: none;
}

.line .text-input {
  flex: 1 1 240px;
  min-width: 0;
}

.section-title {
  font-size: 16px;
  font-weight: 700;
}

textarea {
  width: 100%;
  resize: vertical;
  line-height: 1.6;
}

.tools {
  display: flex;
  gap: 4px;
}

.tools button,
.text-button {
  min-height: 34px;
  padding: 0 10px;

  border: 1px solid var(--line-soft);
  background: transparent;

  color: var(--lunar);
  font: inherit;
  font-size: 12px;

  cursor: pointer;
}

.tools button:hover:not(:disabled) {
  border-color: var(--ember);
  color: var(--ember);
}

.tools button:disabled {
  opacity: .35;
  cursor: default;
}

.question {
  margin-top: 18px;
  padding: 18px 0 0;

  border-top: 1px solid var(--line-soft);
}

.question-number {
  width: 22px;

  color: var(--lunar);
  font-size: 12px;
  text-align: right;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;

  color: var(--lunar);
  font-size: 13px;
  white-space: nowrap;
}

.details {
  display: grid;
  gap: 10px;

  margin: 12px 0 0 32px;
}

.detail {
  display: grid;
  gap: 6px;

  color: var(--lunar);
  font-size: 12px;
}

.labels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.add-row {
  margin-top: 22px;
  padding-top: 16px;

  border-top: 1px dashed var(--line-soft);

  color: var(--lunar);
  font-size: 12px;
}

.editor-footer {
  position: sticky;
  bottom: 0;
  z-index: 2;

  padding: 14px 0;

  border-top: 1px solid var(--line);
  background: var(--void);
}

.spacer {
  flex: 1;
}

.save:not(:disabled) {
  border-color: var(--ember);
  color: var(--ember);
}

@media (max-width: 680px) {
  .details {
    margin-left: 0;
  }

  .labels {
    grid-template-columns: 1fr;
  }
}
</style>
