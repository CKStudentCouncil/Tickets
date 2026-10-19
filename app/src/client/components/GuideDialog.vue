<template>
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" @hide="emit('hide')">
    <div class="guide" aria-labelledby="guide-title">
      <p class="guide-count">{{ label }} · {{ step + 1 }} / {{ steps.length }}</p>
      <h2 id="guide-title">{{ steps[step].title }}</h2>
      <ul class="guide-body">
        <li v-for="line in steps[step].lines" :key="line">{{ line }}</li>
      </ul>
      <div class="guide-dots" aria-hidden="true">
        <span v-for="(item, index) in steps" :key="item.title" :class="{ active: index === step }" />
      </div>
      <div class="guide-actions">
        <button v-if="step > 0" type="button" class="secondary-button" @click="step--">上一步</button>
        <button v-else type="button" class="secondary-button" @click="close">略過</button>
        <button type="button" class="primary-button" @click="next">
          {{ step === steps.length - 1 ? finishLabel : '下一步' }}
        </button>
      </div>
    </div>
  </q-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

// Step-by-step guide shown in a dialog; steps are [{ title, lines: [] }]
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  steps: { type: Array, required: true },
  label: { type: String, default: '使用教學' },
  finishLabel: { type: String, default: '完成' }
})
const emit = defineEmits(['update:modelValue', 'hide'])

const step = ref(0)

// every opening starts from the first step
watch(() => props.modelValue, (open) => {
  if (open) step.value = 0
})

function close() {
  emit('update:modelValue', false)
}

function next() {
  if (step.value < props.steps.length - 1) step.value++
  else close()
}
</script>

<style scoped>
.guide {
  --surface: #0d1015;
  --surface-soft: #11151b;
  --lunar: #9aa3ac;
  --off-white: #f2f0e9;
  --ember: #e4a468;
  --line: rgba(242, 240, 233, .14);

  width: min(100vw - 32px, 440px);
  padding: 28px 24px 24px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--off-white);
  font-family: 'Manrope', 'Noto Sans TC', sans-serif;
}

.guide-count {
  margin: 0 0 10px;
  color: var(--ember);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: .2em;
}

.guide h2 {
  margin: 0 0 14px;
  font-family: 'Noto Sans TC', 'Manrope', sans-serif;
  font-size: 22px;
  font-weight: 800;
  line-height: 1.4;
}

.guide-body {
  min-height: 132px;
  margin: 0;
  padding-left: 1.2em;
  color: var(--lunar);
  font-size: 14px;
  line-height: 1.8;
}

.guide-body li + li {
  margin-top: 6px;
}

.guide-dots {
  display: flex;
  gap: 6px;
  margin: 20px 0;
}

.guide-dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--line);
}

.guide-dots span.active {
  background: var(--ember);
}

.guide-actions {
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
</style>
