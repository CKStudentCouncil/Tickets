<template>
  <div class="static-page">
    <article class="content-card">
      <p class="eyebrow">關於CK Souvenir2.0</p>
      <h1>把校園記憶，變成能帶走的日常</h1>
      <p>此系統由建中班聯會 80 屆團隊製作，為建中整理一個簡單、安心的紀念品訂購方式。</p>
      <p>我們希望每一件校慶紀念品，不只是印著建中的物品，而是能讓你想起人、課堂、球場，或某個很平凡卻很重要的瞬間。</p>
      <p>然此系統仍於開發階段，尚有不足之處，希望各界能提供意見與建議，以利改進。</p>
      <p>如有友校有意願使用此系統，歡迎與開發者聯繫。</p>

      <section class="contact-section">
        <h2>需要協助嗎？</h2>
        <p>有訂購或商品問題，歡迎透過以下方式聯繫我們：</p>
        <ul>
          <li>開發者孫逢邦：<span class="mono">chris20090731@gmail.com</span></li>
          <li>開發者唐盛鈞：<span class="mono">08020jt@gmail.com</span></li>
          <li>建國中學班聯會：<span class="mono">ckhssc@gl.ck.tp.edu.tw</span></li>
          <li>建中班聯資訊股：<span class="mono">ckscitdivision@gmail.com</span></li>
        </ul>
      </section>

      <section class="team-section">
        <h2>開發團隊</h2>
        <div class="team-member">
          <p class="member-name">孫逢邦 Chris Sun</p>
          <ul>
            <li>建中班聯會 79-2 班代大會副議長</li>
            <li>建中班聯會 80-1 班聯會主席</li>
            <li>建中班聯會 80-2 班代大會議長</li>
          </ul>
        </div>
        <div class="team-member">
          <p class="member-name">唐盛鈞 Jim Tang</p>
          <ul>
            <li>建中班聯會 80-1 資訊股股長</li>
            <li>建中班聯會 80-2 資訊股執行</li>
          </ul>
        </div>
      </section>

      <div class="actions">
        <button type="button" class="primary-button" @click="openSurvey">分享使用心得</button>
        <a href="https://www.instagram.com/cksc.81st/" target="_blank" rel="noopener" class="ghost-button">
          <svg class="ig-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2.5" y="2.5" width="19" height="19" rx="5" stroke="currentColor" stroke-width="1.6"/>
            <circle cx="12" cy="12" r="4.4" stroke="currentColor" stroke-width="1.6"/>
            <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor"/>
          </svg>
          Follow Us on Instagram
        </a>
        <router-link to="/" class="secondary-button">回到首頁</router-link>
      </div>
    </article>
  </div>
</template>

<script setup>
function openSurvey() {
  window.open('/survey', '_blank')
}
</script>

<style scoped>
@import 'src/css/aboutpage.scss';
</style>