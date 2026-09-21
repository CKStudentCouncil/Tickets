<template>
  <div class="success-page">
    <div class="success-card">
      <div class="success-icon"><q-icon name="check" /></div>
      <p class="eyebrow">訂單已成立</p>
      <h1 class="text-bold">Thank you</h1>
      <p class="lead">
        我們已收到你的訂單，接下來會依照以下資訊為你準備
        <br />
        目前僅提供現場付款，還請注意建中班聯或友校班聯會、代聯會或學生會相關公告
      </p>
      <div v-if="orderId" class="order-id">訂單編號<strong class="mono">#{{ orderId }}</strong></div>
      <div v-if="order" class="order-summary">
        <div class="summary-row">
          <span class="summary-label">姓名</span>
          <span>{{ order.customerName }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Email</span>
          <span class="mono">{{ order.customerEmail }}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">應付金額</span>
          <strong class="num">NT$ {{ order.finalTotal }}</strong>
        </div>
      </div>
      <p v-if="order" class="email-note">
        訂單確認信將寄送到上方信箱，幾分鐘內沒收到的話，記得檢查一下垃圾郵件匣
      </p>
      <router-link to="/orders" class="primary-button">查看我的訂單</router-link>
      <a href="https://souvenir.cksc.tw/survey" target="_blank" rel="noopener" class="feedback-button">填寫意見反饋</a>
      <router-link to="/" class="secondary-link">繼續探索</router-link>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { fetchOrderById } from 'src/services/orderService'

const route = useRoute()
const orderId = ref(route.query.id || '')
const order = ref(null)

onMounted(async () => {
  if (orderId.value) order.value = await fetchOrderById(orderId.value)
})
</script>

<style scoped>
@import 'src/css/ordersuccesspage.scss';
</style>