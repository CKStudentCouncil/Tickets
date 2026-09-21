<template>
  <div class="storefront">
    <section class="hero">
      <p class="eyebrow eyebrow-en">Keep Your Memories Alive</p>
      <h1 class="text-bold">把青春的片刻<br>留在身邊</h1>
      <p class="hero-copy">為駝客設計的紀念品系列，讓那些在校園裡發生的故事，陪你走得更遠</p>
      <a href="#collection" class="primary-link">探索商品 <q-icon name="south_east" /></a>
    </section>

    <!--<section class="offers" style="margin-top: -40px;">
      <div class="section-heading">
        <p class="eyebrow">精選組合</p>
        <h2 class="text-bold">最適合的組合優惠</h2>
        <p>結帳時，我們會自動為你套用最合適的組合優惠</p>
      </div>
      <div class="offer-grid">
        <article v-for="combo in comboDeals" :key="combo.id" class="offer-card">
          <p class="offer-label">{{ combo.name }}</p>
          <h3 class="text-bold">現省 <span class="num">NT$ {{ combo.showdiscount }}</span></h3>
          <p>{{ combo.items.map((no) => products.find((product) => product.no === no)?.category).filter(Boolean).join(' · ') }}</p>
          <span class="offer-price">
            <span class="num">NT$ {{ combo.comboPrice }}</span>
            <del class="num">NT$ {{ combo.originalPrice }}</del>
          </span>
        </article>
      </div>
    </section>-->

    <section id="collection" class="collection">
      <div class="section-heading">
        <p class="eyebrow">商品系列</p>
        <h2 class="text-bold">挑一件屬於你的紀念</h2>
      </div>
      <div class="product-grid">
        <router-link
          v-for="product in products"
          :key="product.id"
          :to="`/product/${product.textid}`"
          class="product-card"
        >
          <div class="product-image"><img :src="`/images/product-${product.textid}.png`" :alt="product.name" loading="lazy"></div>
          <div class="product-meta"><div><p class="product-category">{{ product.category }}</p><h3>{{ product.name }}</h3></div><q-icon name="arrow_forward" /></div>
          <p class="price">
            <del v-if="product.orPrice && product.orPrice !== product.price" class="num">NT$ {{ product.orPrice }}</del>
            <span class="num">NT$ {{ product.price }}</span>
          </p>
        </router-link>
      </div>
    </section>
  </div>
</template>

<script setup>
import { comboDeals, products } from 'src/data/catalog'
</script>

<style scoped>
@import 'src/css/homepage.scss';
</style>