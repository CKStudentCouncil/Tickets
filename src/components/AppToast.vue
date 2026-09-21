<template>
  <transition name="toast">
    <div
      v-if="toast.visible"
      class="app-toast"
    >
      <span class="toast-message">{{ toast.message }}</span>
      <span
        v-if="toast.count > 1"
        class="toast-count num"
      >{{ toast.count }}</span>
    </div>
  </transition>
</template>

<script setup>
import { useToastStore } from 'src/stores/toast'

const toast = useToastStore()
</script>

<style scoped>
/*
  排版與視覺統一原則（與其他頁面共用同一套邏輯）：
  1. 字體堆疊涵蓋中英文，避免中文落回系統預設字體造成字重不一致。
  2. 顏色改用系統一致的 #1d1d1f（純黑背景會偏生硬），而非半透明黑，
     視覺上與其他卡片、按鈕的深色元素一致。
  3. 數字（count）用 .num 包起來，套用 tabular-nums，避免字寬跳動。
  4. 進場/退場加上輕微上滑＋淡出，取代原本的瞬間顯示/消失。
*/

.app-toast {
  position: fixed;
  left: 50%;
  bottom: 32px;
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 20px;
  border-radius: 999px;
  background: #1d1d1f;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang TC', 'Noto Sans TC',
    'Microsoft JhengHei', 'Helvetica Neue', Arial, sans-serif;
  font-size: .88rem;
  line-height: 1.5;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
  transform: translateX(-50%);
}

.toast-message { white-space: pre-line; }

.toast-count {
  flex-shrink: 0;
  min-width: 20px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, .16);
  color: #fff;
  font-size: .75rem;
  font-weight: 700;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity .2s ease, transform .2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

@media (max-width: 480px) {
  .app-toast {
    max-width: calc(100vw - 32px);
    padding: 11px 16px;
    font-size: .85rem;
  }
}
</style>