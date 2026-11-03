<template>
  <q-dialog :model-value="modelValue" persistent @update:model-value="emit('update:modelValue', $event)">
    <div class="declaration" role="document" aria-labelledby="declaration-title">
      <p class="declaration-kicker">STUDENT DECLARATION</p>
      <h2 id="declaration-title">學生身分購票切結書</h2>

      <p class="declaration-lead">
        本人因故無法以學生專用電子信箱（.edu.tw 網域）完成線上身分驗證，特聲明並簽署切結書如下：
      </p>

      <div class="declaration-form">
        <div class="form-group">
          <label for="declaration-name">切結人姓名 *</label>
          <input id="declaration-name" v-model="formData.name" type="text" placeholder="請輸入真實姓名" required />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="declaration-school">就讀學校 *</label>
            <input id="declaration-school" v-model="formData.school" type="text" placeholder="例：國立台灣大學" required />
          </div>
          <div class="form-group">
            <label for="declaration-student-id">學號 *</label>
            <input id="declaration-student-id" v-model="formData.studentId" type="text" placeholder="請輸入學號" required />
          </div>
        </div>

        <div class="form-group">
          <label for="declaration-reason">無法使用 .edu.tw 信箱之原因 *</label>
          <select id="declaration-reason" v-model="formData.reason" required>
            <option value="" disabled>請選擇原因</option>
            <option value="school_no_edu">學校未提供 .edu.tw 電子信箱</option>
            <option value="email_disabled">信箱尚未開通或無法正常收信</option>
            <option value="freshman">應屆錄取生/轉學生尚無校園信箱</option>
            <option value="other">其他原因</option>
          </select>
        </div>
      </div>

      <ol class="declaration-body">
        <li>
          <strong>學籍資格：</strong>本人目前確為我國教育部認可之大專院校或高級中等學校（或其他同等學力之學校）在學學生，並同意於主辦單位要求時出具合法學籍證明正本。
        </li>
        <li>
          <strong>取票與領票查驗：</strong>本人了解並同意於領票時，須主動出示本人有效之學生證正本或其他學校核發之合法學籍證明正本。若無法出示或身分不符，主辦單位得拒絕交付票券，相關款項依銷售條款辦理。
        </li>
        <li>
          <strong>驗票與入場查驗：</strong>本人了解入場時工作人員得隨機抽驗身分，本人須出示前述學籍證明正本。若發現身分不符或轉售予非學生身分者，主辦單位得拒絕其入場；相關款項依銷售條款辦理。
        </li>
        <li>
          <strong>法律責任：</strong>如本人有虛偽不實切結或變造身分證明之情事，願負擔相關法律責任（包含但不限於刑法偽造文書罪及詐欺罪）。
        </li>
        <li>
          <strong>個資蒐集同意：</strong>本人同意主辦單位得於辦理本活動驗證學生身分之必要範圍內，蒐集、處理及利用本人所提供之個人資料，並同意依銷售條款及使用者條款辦理相關事宜。
        </li>
      </ol>

      <label class="declaration-consent">
        <input v-model="agreed" type="checkbox" />
        <span>我已詳閱、充分理解並完全同意以上所有切結內容與相關責任條款。</span>
      </label>

      <p class="time-stamp">
        簽署時間：{{ new Date().toLocaleString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}
      </p>

      <div class="declaration-actions">
        <button type="button" class="secondary-button" @click="closeDialog">取消</button>
        <button
          type="button"
          class="primary-button"
          :disabled="!isFormValid"
          @click="agree"
        >
          同意切結並購買
        </button>
      </div>
    </div>
  </q-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'agree'])

const agreed = ref(false)
const formData = reactive({
  name: '',
  school: '',
  studentId: '',
  reason: ''
})

const isFormValid = computed(() => {
  return (
    agreed.value &&
    formData.name.trim() !== '' &&
    formData.school.trim() !== '' &&
    formData.studentId.trim() !== '' &&
    formData.reason !== ''
  )
})

watch(() => props.modelValue, (open) => {
  if (open) {
    agreed.value = false
    formData.name = ''
    formData.school = ''
    formData.studentId = ''
    formData.reason = ''
  }
})

function closeDialog() {
  emit('update:modelValue', false)
}

function agree() {
  if (!isFormValid.value) return
  emit('update:modelValue', false)
  emit('agree', { ...formData, signedAt: new Date().toISOString() })
}
</script>

<style scoped>
.declaration {
  --surface: #0d1015;
  --surface-soft: #161b22;
  --lunar: #9aa3ac;
  --off-white: #f2f0e9;
  --ember: #e4a468;
  --line: rgba(242, 240, 233, .14);

  width: min(100vw - 32px, 520px);
  max-height: 90vh;
  overflow-y: auto;
  padding: 28px 24px 24px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--off-white);
  font-family: 'Manrope', 'Noto Sans TC', sans-serif;
}

.declaration-kicker {
  margin: 0 0 10px;
  color: var(--ember);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: .2em;
}

.declaration h2 {
  margin: 0 0 14px;
  font-family: 'Noto Sans TC', 'Manrope', sans-serif;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.4;
}

.declaration-lead {
  margin: 0 0 16px;
  color: var(--off-white);
  font-size: 13.5px;
  line-height: 1.7;
}

.declaration-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--surface-soft);
}

.form-row {
  display: flex;
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 6px;
}

.form-group label {
  color: var(--lunar);
  font-size: 12px;
}

.form-group input,
.form-group select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 2px;
  background: var(--surface);
  color: var(--off-white);
  font-size: 13px;
  outline: none;
}

.form-group input:focus,
.form-group select:focus {
  border-color: var(--ember);
}

.declaration-body {
  margin: 0;
  padding-left: 1.2em;
  color: var(--lunar);
  font-size: 13px;
  line-height: 1.7;
}

.declaration-body li + li {
  margin-top: 10px;
}

.declaration-body strong {
  color: var(--off-white);
}

.declaration-consent {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 20px 0;
  color: var(--off-white);
  font-size: 13px;
  line-height: 1.6;
  cursor: pointer;
}

.declaration-consent input {
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
  flex: none;
  accent-color: var(--ember);
}

.time-stamp {
  margin: 0 0 16px;
  color: var(--lunar);
  font-size: 12px;
}

.declaration-actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.secondary-button,
.primary-button {
  min-height: 42px;
  padding: 0 20px;
  border: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  color: var(--off-white);
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: all .2s ease;
}

.secondary-button:hover {
  border-color: rgba(242, 240, 233, .35);
  background: var(--surface-soft);
}

.primary-button {
  border-color: var(--ember);
  background: var(--ember);
  color: #111;
  font-weight: 700;
}

.primary-button:disabled {
  opacity: .4;
  cursor: not-allowed;
}

/* phones: school and student ID on their own lines */
@media (max-width: 420px) {
  .form-row {
    flex-direction: column;
  }
}
</style>
