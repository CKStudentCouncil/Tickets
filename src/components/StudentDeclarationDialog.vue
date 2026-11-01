<template>
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <div class="declaration" role="document" aria-labelledby="declaration-title">
      <p class="declaration-kicker">STUDENT DECLARATION</p>
      <h2 id="declaration-title">學生身分切結書</h2>
      <p class="declaration-lead">本人因故無法以學校帳號完成學生驗證，特此切結：</p>
      <ol class="declaration-body">
        <li>本人目前為在學學生。</li>
        <li>本人了解領票時須出示本人學生證（背面須有本學期註冊章）或酷課雲學生證明。查驗不符者，主辦單位得拒絕交付票券，相關款項依銷售條款辦理。</li>
        <li>如有虛偽切結，本人願自負相關責任。</li>
      </ol>
      <label class="declaration-consent">
        <input v-model="agreed" type="checkbox">
        <span>我已閱讀並同意以上切結內容</span>
      </label>
      <div class="declaration-actions">
        <button type="button" class="secondary-button" @click="emit('update:modelValue', false)">取消</button>
        <button type="button" class="primary-button" :disabled="!agreed" @click="agree">同意並購買</button>
      </div>
    </div>
  </q-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

// 學生身分切結書: lets a buyer without a usable school account buy a type
// sold to students first; createOrder takes it as `studentDeclared` and the
// student ID is checked at pickup
const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'agree'])

const agreed = ref(false)

// every opening starts unticked
watch(() => props.modelValue, (open) => {
  if (open) agreed.value = false
})

function agree() {
  if (!agreed.value) return
  emit('update:modelValue', false)
  emit('agree')
}
</script>

<style scoped>
.declaration {
  --surface: #0d1015;
  --surface-soft: #11151b;
  --lunar: #9aa3ac;
  --off-white: #f2f0e9;
  --ember: #e4a468;
  --line: rgba(242, 240, 233, .14);

  width: min(100vw - 32px, 460px);
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
  margin: 0 0 10px;
  color: var(--off-white);
  font-size: 14px;
  line-height: 1.8;
}

.declaration-body {
  margin: 0;
  padding-left: 1.4em;
  color: var(--lunar);
  font-size: 14px;
  line-height: 1.8;
}

.declaration-body li + li {
  margin-top: 6px;
}

.declaration-consent {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 20px 0;
  font-size: 14px;
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

.declaration-actions {
  display: flex;
  justify-content: space-between;
  gap: 10px;
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
  opacity: .45;
  cursor: not-allowed;
}
</style>
