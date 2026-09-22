<template>
  <div class="success-page">
    <div class="success-card">
      <div class="success-icon">
        <q-icon name="check" />
      </div>

      <p class="eyebrow">購票成功</p>

      <h1 class="text-bold">Thank you</h1>

      <p class="lead">
        我們已收到你的購票訂單，請妥善保存訂單資訊。
        <br />
        付款及取票方式請依建中班聯會、友校班聯會、代聯會或學生會相關公告辦理。
      </p>

      <div v-if="orderId" class="order-id">
        訂單編號
        <strong class="mono">#{{ orderId }}</strong>
      </div>

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
        訂單確認信將寄送至上方信箱。
        <br />
        若幾分鐘內仍未收到，請先確認垃圾郵件匣。
      </p>

      <div class="actions">
        <router-link to="/orders" class="primary-button">
          查看我的訂單
        </router-link>

        <router-link to="/survey" class="feedback-button">
          填寫購票體驗問卷
        </router-link>

        <router-link to="/" class="secondary-link">
          回到首頁
        </router-link>
      </div>
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
  if (orderId.value) {
    order.value = await fetchOrderById(orderId.value)
  }
})
</script>

<style scoped>
@import 'src/css/ordersuccesspage.scss';
</style>
