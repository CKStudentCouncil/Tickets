<template>
  <div class="product-page">
    <router-link to="/" class="back-link">‹ 回到商品系列</router-link>

    <div class="product-detail">
      <div class="image-wrap">
        <img
          :src="`/images/product-${config.imageId}.png`"
          :alt="config.title"
          loading="lazy"
        >
      </div>

      <section class="purchase-card">
        <p class="eyebrow">CKSC COLLECTION</p>
        <h1>{{ config.title }}</h1>
        <p class="price">
          <del v-if="config.orPrice" class="num">NT$ {{ config.orPrice }}</del>
          <span class="num">NT$ {{ config.price }}</span>
        </p>

        <p id="size-label" class="choose-label">選擇尺寸</p>
        <div class="size-options" role="radiogroup" aria-labelledby="size-label">
          <button
            v-for="item in config.sizeData"
            :key="item.size"
            type="button"
            role="radio"
            :aria-checked="selected === item.productId"
            :class="{ selected: selected === item.productId }"
            @click="selected = item.productId"
          >
            {{ item.size }}
          </button>
        </div>

        <button
          type="button"
          class="guide-link"
          aria-controls="size-guide"
          :aria-expanded="showGuide"
          @click="showGuide = !showGuide"
        >
          {{ showGuide ? '收起尺寸表' : '查看尺寸表' }}
        </button>

        <div v-if="showGuide" id="size-guide" class="size-guide">
          <table>
            <caption style="font-weight: 600">
              尺寸表（單位：cm）
            </caption>
            <thead>
              <tr>
                <th scope="col">尺寸</th>
                <th scope="col">衣長</th>
                <th scope="col">胸寬</th>
                <th scope="col">袖長</th>
                <th scope="col">肩寬</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in config.sizeData" :key="item.size" :class="{ current: selected === item.productId }">
                <th scope="row">{{ item.size }}</th>
                <td>{{ item.length }}</td>
                <td>{{ item.chest }}</td>
                <td>{{ item.sleeve }}</td>
                <td>{{ item.shoulder }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <button
          type="button"
          class="primary-button"
          :disabled="!selected"
          @click="add"
        >
          {{ selected ? '加入購物袋' : '請先選擇尺寸' }}
          <q-icon name="add_shopping_cart" />
        </button>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useCartStore } from 'src/stores/cart'
import { useToastStore } from 'src/stores/toast'

const props = defineProps({ config: { type: Object, required: true } })
const cart = useCartStore()
const toast = useToastStore()

const selected = ref('')
const showGuide = ref(false)

function add() {
  const product = props.config.variants.find((item) => item.id === selected.value)
  if (!product) {
    toast.show('找不到這個尺寸的商品，請重新選擇。')
    return
  }
  cart.addToCart(product)
  toast.show(`已將「${product.name}」加入購物袋。`)
}
</script>

<style scoped>
.product-page {
  max-width: 1120px;
  margin: auto;
  padding: 32px 24px 96px;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang TC', 'Noto Sans TC',
    'Microsoft JhengHei', 'Helvetica Neue', Arial, sans-serif;
  color: #1d1d1f;
}

.num {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Noto Sans TC', Arial, sans-serif;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}

.back-link {
  display: inline-block;
  margin-bottom: 24px;
  color: #6e6e73;
  font-size: .9rem;
  text-decoration: none;
}

.back-link:hover {
  text-decoration: underline;
}

.product-detail {
  display: grid;
  grid-template-columns: 1.1fr .9fr;
  gap: 72px;
  align-items: center;
}

.image-wrap {
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 28px;
  background: #ececee;
}

.image-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.purchase-panel {
  max-width: 430px;
}

.eyebrow {
  margin: 0 0 12px;
  color: #6e6e73;
  font-size: .72rem;
  font-weight: 700;
  letter-spacing: .12em;
}

h1 {
  margin: 0 0 14px;
  font-size: clamp(2.2rem, 4.6vw, 3.6rem);
  line-height: 1.2;
  letter-spacing: -.01em;
  font-weight: 700;
}

.price {
  margin: 0 0 28px;
  font-size: 1.25rem;
  font-weight: 650;
}

.price del {
  margin-right: 8px;
  color: #86868b;
  font-weight: 400;
}

.choose-label {
  margin-bottom: 10px;
  font-weight: 650;
}

.size-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.size-options button {
  min-width: 54px;
  padding: 11px;
  border: 1px solid #d2d2d7;
  border-radius: 10px;
  background: #fff;
  color: #1d1d1f;
  cursor: pointer;
  font: inherit;
  transition: border-color .15s ease, background .15s ease, color .15s ease;
}

.size-options button:hover {
  border-color: #1d1d1f;
}

.size-options button:focus-visible {
  outline: 2px solid #1d1d1f;
  outline-offset: 2px;
}

.size-options button.selected {
  border-color: #1d1d1f;
  background: #1d1d1f;
  color: #fff;
}

.guide-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: #06c;
  cursor: pointer;
  font: inherit;
  font-size: .88rem;
}

.guide-link:hover {
  text-decoration: underline;
}

.size-guide {
  margin: 14px 0;
  padding: 4px 14px;
  border-radius: 12px;
  background: #f5f5f7;
  font-size: .85rem;
  overflow-x: auto;
}

.size-guide table {
  width: 100%;
  border-collapse: collapse;
}

.size-guide th,
.size-guide td {
  padding: 10px 6px;
  text-align: center;
  white-space: nowrap;
}

.size-guide thead th {
  color: #6e6e73;
  font-size: .74rem;
  font-weight: 600;
}

.size-guide tbody th {
  color: #1d1d1f;
  font-weight: 700;
  text-align: left;
}

.size-guide tbody tr {
  border-top: 1px solid #e5e5e7;
}

.size-guide tbody td {
  color: #48484d;
  font-variant-numeric: tabular-nums;
}

.size-guide tbody tr.current {
  background: #fff;
}

.size-guide tbody tr.current th,
.size-guide tbody tr.current td {
  color: #1d1d1f;
  font-weight: 700;
}

.primary-button {
  width: 100%;
  margin-top: 26px;
  padding: 15px 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 999px;
  background: #1d1d1f;
  color: #fff;
  cursor: pointer;
  font: 600 1rem inherit;
  transition: opacity .15s ease;
}

.primary-button:hover:not(:disabled) {
  opacity: .88;
}

.primary-button:disabled {
  background: #d2d2d7;
  cursor: not-allowed;
}

.purchase-card {
  max-width: 420px;
  padding: 36px;
  border: 1px solid #e5e5e7;
  border-radius: 28px;
  background: #fff;
}

@media (max-width: 700px) {
  .product-page {
    padding: 20px 16px 56px;
  }

  .product-detail {
    grid-template-columns: 1fr;
    gap: 32px;
  }

  .image-wrap {
    border-radius: 20px;
  }
}
</style>