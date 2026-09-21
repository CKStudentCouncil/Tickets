<template>
  <div class="product-page">
    <router-link to="/" class="back-button" aria-label="回到商品系列">
      <q-icon name="arrow_back" size="18px" />
    </router-link>

    <div class="product-detail">
      <div class="image-frame">
        <img :src="`/images/product-${config.imageId}.png`" :alt="config.product.name">
      </div>

      <section class="purchase-card">
        <p class="eyebrow eyebrow-en">CKSC Collection</p>
        <h1>{{ config.product.name }}</h1>

        <div class="price-row">
          <span class="price num">NT$ {{ config.price }}</span>
          <del v-if="!config.hideOrPrice" class="price-original num">NT$ {{ config.orPrice }}</del>
        </div>

        <div class="divider" />

        <p class="description">一份小小的紀念，裝進校園裡最值得記得的片段</p>

        <button type="button" class="primary-button" @click="add">
          加入購物袋
          <q-icon name="add_shopping_cart" size="18px" />
        </button>
      </section>
    </div>
  </div>
</template>

<script setup>
import { useCartStore } from 'src/stores/cart'
import { useToastStore } from 'src/stores/toast'

const props = defineProps({ config: { type: Object, required: true } })
const cart = useCartStore()
const toast = useToastStore()

function add() {
  cart.addToCart(props.config.product)
  toast.show(`已將「${props.config.product.name}」加入購物袋。`)
}
</script>

<style scoped>
.product-page {
  position: relative;
  max-width: 1120px;
  margin: auto;
  padding: 90px 24px 96px;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang TC', 'Noto Sans TC',
    'Microsoft JhengHei', 'Helvetica Neue', Arial, sans-serif;
  color: #1d1d1f;
}

.num {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Noto Sans TC', Arial, sans-serif;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}

.back-button {
  position: absolute;
  top: 32px;
  left: 24px;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid #e5e5e7;
  border-radius: 50%;
  background: #fff;
  color: #1d1d1f;
  text-decoration: none;
}

.back-button:hover { background: #f5f5f7; }

.product-detail {
  display: grid;
  grid-template-columns: 1.05fr .95fr;
  gap: 56px;
  align-items: center;
}

.image-frame {
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 32px;
  background: #ececee;
  box-shadow: 0 24px 60px rgba(0, 0, 0, .08);
}

.image-frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.purchase-card {
  max-width: 420px;
  padding: 36px;
  border: 1px solid #e5e5e7;
  border-radius: 28px;
  background: #fff;
}

.eyebrow {
  margin: 0 0 12px;
  color: #6e6e73;
  font-size: .72rem;
  font-weight: 700;
  letter-spacing: .06em;
}

.eyebrow-en {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', Arial, sans-serif;
  letter-spacing: .12em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 18px;
  font-size: clamp(1.9rem, 4vw, 2.8rem);
  line-height: 1.2;
  letter-spacing: -.01em;
  font-weight: 700;
}

.price-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 24px;
}

.price {
  font-size: 1.4rem;
  font-weight: 700;
}

.price-original {
  color: #a1a1a6;
  font-size: .95rem;
  font-weight: 400;
}

.divider {
  height: 1px;
  margin: 0 0 24px;
  background: #ececee;
}

.description {
  margin: 0 0 28px;
  color: #6e6e73;
  line-height: 1.65;
}

.primary-button {
  width: 100%;
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
}

.primary-button:hover { background: #333336; }

.reassurance {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 16px 0 0;
  color: #86868b;
  font-size: .8rem;
  text-align: center;
}

@media (max-width: 760px) {
  .product-page { padding: 76px 16px 56px; }
  .product-detail { grid-template-columns: 1fr; gap: 28px; }
  .image-frame { border-radius: 24px; }
  .purchase-card { max-width: 100%; padding: 28px; }
}
</style>