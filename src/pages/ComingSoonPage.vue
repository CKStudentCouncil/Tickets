<template>
  <div class="coming-soon">
    <div class="hero-content">
        <div class="title-lockup">
          <p class="title-lockup-sub">2026 · CK PARTY NIGHT</p><br />
          <h1 class="title-lockup-brand">COMING SOON</h1>
        </div>
    </div>
  </div>
</template>

<style scoped>
.hero-content {
  position: relative;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(22px, 3.4vh, 36px);
  text-align: center;
  padding: 0 24px;
}

.title-lockup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(12px, 2.2vh, 24px);
}

.title-lockup-sub {
  margin: 0;
  font-size: clamp(0.65rem, 1.2vw, 0.9rem);
  font-weight: 400;
  letter-spacing: 0.8em;
  text-indent: 0.8em;
  line-height: 1;
  color: var(--lunar);
  white-space: nowrap;
  text-shadow: 0 3px 20px rgba(0, 0, 0, 0.45);
}

.title-lockup-brand {
  margin: 0;
  font-family: 'Manrope', sans-serif;
  font-size: clamp(2rem, 5vw, 4.5rem);
  font-weight: 400;
  letter-spacing: 0.5em;
  text-indent: 0.5em;
  line-height: 1;
  color: var(--off-white);
  white-space: nowrap;
  text-shadow: 0 3px 30px rgba(0, 0, 0, 0.55);
}

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