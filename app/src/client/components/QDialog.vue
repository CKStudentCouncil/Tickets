<template>
  <Teleport to="body">
    <Transition name="q-dialog">
      <div v-if="modelValue" class="q-dialog-backdrop" @click.self="dismiss" @keydown.esc="dismiss">
        <div ref="panel" class="q-dialog-panel" role="dialog" aria-modal="true" tabindex="-1" v-bind="$attrs">
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
// Stand-in for Quasar's q-dialog: v-model, persistent and the hide event,
// which is all the pages use
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  persistent: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'hide', 'show'])
const panel = ref(null)
let opener = null

function dismiss() {
  if (!props.persistent) emit('update:modelValue', false)
}

function onKey(event) {
  if (event.key === 'Escape') dismiss()
}

watch(() => props.modelValue, async (open, wasOpen) => {
  if (open) {
    opener = document.activeElement
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    await nextTick()
    panel.value?.focus()
    emit('show')
  } else if (wasOpen) {
    document.removeEventListener('keydown', onKey)
    document.body.style.overflow = ''
    opener?.focus?.()
    emit('hide')
  }
}, { immediate: true })

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<style>
.q-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 6000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.6);
  overflow-y: auto;
}

.q-dialog-panel {
  max-width: 100%;
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  outline: none;
}

.q-dialog-enter-active,
.q-dialog-leave-active {
  transition: opacity 0.2s ease;
}

.q-dialog-enter-active .q-dialog-panel,
.q-dialog-leave-active .q-dialog-panel {
  transition: transform 0.2s ease;
}

.q-dialog-enter-from,
.q-dialog-leave-to {
  opacity: 0;
}

.q-dialog-enter-from .q-dialog-panel,
.q-dialog-leave-to .q-dialog-panel {
  transform: scale(0.96);
}
</style>
