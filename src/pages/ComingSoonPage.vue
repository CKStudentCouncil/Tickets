<template>
  <div class="coming-soon">
    <p class="eyebrow">2026 CK Party Night</p>
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
  background:
    radial-gradient(circle at 50% 35%, rgba(228, 164, 104, 0.08), transparent 60%),
    #050608;
  text-align: center;
  font-family: 'Manrope', 'Noto Sans TC', sans-serif;
  color: #f2f0e9;
}

.eyebrow {
  margin: 0 0 12px;
  color: #e4a468;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.28em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 12px;
  font-family: 'Noto Sans TC', 'Manrope', sans-serif;
  font-size: clamp(2.4rem, 6.4vw, 4.4rem);
  line-height: 1.15;
  letter-spacing: 0.01em;
  font-weight: 800;
  color: #f2f0e9;
}

.coming-soon-copy {
  margin: 0 0 22px;
  color: rgba(242, 240, 233, 0.55);
  line-height: 1.6;
  font-size: 13.5px;
}

.back-link {
  color: #e4a468;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-decoration: none;
  border-bottom: 1px solid rgba(228, 164, 104, 0.4);
  padding-bottom: 3px;
  transition: border-color .3s ease;
}
.back-link:hover { border-color: #e4a468; }
</style>