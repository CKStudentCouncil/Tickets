<template>
  <div class="stepper" role="group" :aria-label="label">
    <button type="button" :disabled="disabled || modelValue <= min" aria-label="減少一張" @click="emit('update:modelValue', clamp(modelValue - 1))">−</button>
    <input
      :value="modelValue"
      type="number"
      inputmode="numeric"
      :min="min"
      :max="max"
      step="1"
      :disabled="disabled"
      :aria-label="label"
      @input="onInput"
    >
    <button type="button" :disabled="disabled || modelValue >= max" aria-label="增加一張" @click="emit('update:modelValue', clamp(modelValue + 1))">+</button>
  </div>
</template>

<script setup>
// A whole number from min to max: the buttons step it, the field takes typing
const props = defineProps({
  modelValue: { type: Number, required: true },
  min: { type: Number, default: 1 },
  max: { type: Number, required: true },
  label: { type: String, default: '張數' },
  disabled: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue'])

const clamp = (value) => Math.min(props.max, Math.max(props.min, value))

// an empty or partial entry stays as typed; the form's own check refuses it
function onInput(event) {
  const value = Number(event.target.value)
  emit('update:modelValue', event.target.value === '' || !Number.isInteger(value) ? NaN : value)
}
</script>

<style scoped>
.stepper {
  display: inline-flex;
  align-items: stretch;
  height: 44px;
  border: 1px solid rgba(242, 240, 233, 0.38);
  background: #0d0f13;
}

.stepper button {
  width: 44px;
  border: 0;
  background: transparent;
  color: #f2f0e9;
  font: 500 18px 'Manrope', sans-serif;
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.stepper button:hover:not(:disabled) {
  background: rgba(228, 164, 104, 0.1);
  color: #e4a468;
}

.stepper button:disabled {
  color: rgba(242, 240, 233, 0.3);
  cursor: not-allowed;
}

.stepper button:focus-visible,
.stepper input:focus-visible {
  outline: 2px solid #e4a468;
  outline-offset: -2px;
}

.stepper input {
  width: 48px;
  border: 0;
  border-inline: 1px solid rgba(242, 240, 233, 0.14);
  background: transparent;
  color: #f2f0e9;
  font: 700 15px 'Manrope', sans-serif;
  font-variant-numeric: tabular-nums;
  text-align: center;
  appearance: textfield;
  -moz-appearance: textfield;
}

.stepper input::-webkit-outer-spin-button,
.stepper input::-webkit-inner-spin-button {
  margin: 0;
  -webkit-appearance: none;
}
</style>
