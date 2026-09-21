<template>
  <div class="coming-soon">
    <p class="eyebrow">CK Souvenir</p>
    <h1>Coming Soon</h1>
  </div>
</template>

<style scoped>
.coming-soon {
  min-height: calc(100vh - 56px);
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 50% 35%, #fff, #f5f5f7 65%);
  text-align: center;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang TC', 'Noto Sans TC',
    'Microsoft JhengHei', 'Helvetica Neue', Arial, sans-serif;
  color: #1d1d1f;
}

.eyebrow {
  margin: 0 0 12px;
  color: #6e6e73;
  font-size: .72rem;
  font-weight: 700;
  letter-spacing: .06em;
}

h1 {
  margin: 0 0 12px;
  font-size: clamp(2.4rem, 6.4vw, 4.4rem);
  line-height: 1.15;
  letter-spacing: -.01em;
  font-weight: 700;
}

.coming-soon > p:last-of-type {
  color: #6e6e73;
  line-height: 1.6;
}

.back-link {
  margin-top: 18px;
  color: #06c;
  text-decoration: none;
}
</style>