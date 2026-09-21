<template>
  <ProductSized
    v-if="config?.type === 'sized'"
    :config="config"
  />
  <ProductSimple
    v-else-if="config?.type === 'simple'"
    :config="config"
  />
  <ProductMulti
    v-else-if="config?.type === 'multi'"
    :config="config"
  />
  <div
    v-else
    class="not-found"
  >
    <svg class="not-found-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path
        d="M8 24a4 4 0 0 1 4-4h40a4 4 0 0 1 4 4v3a5 5 0 0 0 0 10v3a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4v-3a5 5 0 0 0 0-10v-3Z"
        stroke="#c7c7cc" stroke-width="2" stroke-linejoin="round"
      />
      <path d="M24 32h16" stroke="#c7c7cc" stroke-width="2" stroke-linecap="round" />
    </svg>
    <p class="eyebrow">商品頁面</p>
    <h2>找不到這項商品</h2>
    <p class="not-found-copy">可能是連結有誤，或商品已下架</p>
    <button
      type="button"
      class="home-btn"
      @click="$router.push('/')"
    >
      回首頁
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { productPageConfigs } from 'src/data/catalog'
import ProductSized from 'components/products/ProductSized.vue'
import ProductSimple from 'components/products/ProductSimple.vue'
import ProductMulti from 'components/products/ProductMulti.vue'

const route = useRoute()
const config = computed(() => productPageConfigs[route.params.id])
</script>

<style scoped>
.not-found {
  min-height: 100vh;
  padding: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang TC', 'Noto Sans TC',
    'Microsoft JhengHei', 'Helvetica Neue', Arial, sans-serif;
  color: #1d1d1f;
}

.not-found-icon {
  width: 52px;
  height: 52px;
  margin-bottom: 14px;
}

.eyebrow {
  margin: 0 0 8px;
  color: #6e6e73;
  font-size: .72rem;
  font-weight: 700;
  letter-spacing: .08em;
}

.not-found h2 {
  margin: 0 0 6px;
  font-size: 1.3rem;
  font-weight: 650;
  letter-spacing: 0;
}

.not-found-copy {
  margin: 0 0 22px;
  color: #6e6e73;
  line-height: 1.6;
}

.home-btn {
  padding: 12px 28px;
  border: 0;
  border-radius: 999px;
  background: #1d1d1f;
  color: #fff;
  font-weight: 600;
  letter-spacing: .01em;
  cursor: pointer;
  transition: opacity .15s ease;
}

.home-btn:hover { opacity: .88; }
</style>