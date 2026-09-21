<template>
  <div class="product-page">
    <router-link to="/" class="back-link">‹ 回到商品系列</router-link>
    <section class="intro">
      <p class="eyebrow">CKSC COLLECTION</p>
      <h1>{{ config.title }}</h1>
      <p class="price num">NT$ {{ config.price }}</p>
      <p>選擇想要的款式</p>
    </section>
    <div class="variant-grid">
      <article v-for="product in config.variants" :key="product.id" class="variant-card">
        <div class="variant-image"><img :src="`/images/product-${product.id}.png`" :alt="product.name"></div>
        <h2>{{ product.name }}</h2>
        <button type="button" @click="add(product)">加入購物袋</button>
      </article>
    </div>
  </div>
</template>

<script setup>
import { useCartStore } from 'src/stores/cart'
import { useToastStore } from 'src/stores/toast'

defineProps({ config: { type: Object, required: true } })
const cart = useCartStore()
const toast = useToastStore()

function add(product) {
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
  margin-bottom: 48px;
  color: #6e6e73;
  font-size: .9rem;
  text-decoration: none;
}

.intro { max-width: 550px; margin-bottom: 40px; }

.eyebrow {
  margin: 0 0 12px;
  color: #6e6e73;
  font-size: .72rem;
  font-weight: 700;
  letter-spacing: .12em;
}

h1 {
  margin: 0 0 12px;
  font-size: clamp(2.2rem, 5.2vw, 3.8rem);
  line-height: 1.15;
  letter-spacing: -.01em;
  font-weight: 700;
}

.price { font-size: 1.2rem; font-weight: 650; }

.intro > p:last-child {
  color: #6e6e73;
  line-height: 1.6;
}

.variant-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.variant-card {
  padding: 16px;
  border: 1px solid #e5e5e7;
  border-radius: 20px;
  background: #fff;
}

.variant-image {
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 14px;
  background: #f5f5f7;
}

.variant-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.variant-card h2 {
  margin: 15px 0 12px;
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0;
}

.variant-card button {
  width: 100%;
  padding: 12px;
  border: 0;
  border-radius: 999px;
  background: #1d1d1f;
  color: #fff;
  cursor: pointer;
  font: 600 .9rem inherit;
  letter-spacing: .01em;
}

@media (max-width: 600px) {
  .product-page { padding: 20px 16px 56px; }
  .back-link { margin-bottom: 28px; }
  .variant-grid { grid-template-columns: 1fr; }
}
</style>