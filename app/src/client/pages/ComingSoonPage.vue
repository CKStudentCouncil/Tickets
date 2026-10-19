<template>
  <div class="coming-soon">
    <div class="hero-content">
        <div class="title-lockup">
          <p class="title-lockup-sub">2026 · CK PARTY NIGHT</p>
          <h1 class="title-lockup-brand">COMING SOON</h1>
        </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useShopStore } from 'src/stores/shop'
import { safeRedirect } from 'src/utils/redirect'

const route = useRoute()
const router = useRouter()
const shop = useShopStore()

onMounted(() => shop.init())

// Let waiting visitors in as soon as the shop opens (at the set time, or
// when a super admin opens it now) without them having to reload, back to
// the page they asked for. Once only: the navigation may take a while.
let leaving = false

watch(
  () => shop.ready && shop.isOpenNow,
  (open) => {
    if (!open || leaving) return
    leaving = true
    router.replace(safeRedirect(route.query.redirect, '/'))
  },
  { immediate: true }
)
</script>

<style scoped>
.hero-content {
  position: relative;
  z-index: 6;
  width: min(100%, 70rem);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(18px, 3.4svh, 36px);
  text-align: center;
  padding-inline: clamp(12px, 4vw, 24px);
}

.title-lockup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(12px, 2.2vh, 24px);
}

.title-lockup-sub {
  margin: 0;
  max-width: 100%;
  font-size: clamp(0.58rem, 1.2vw, 0.9rem);
  font-weight: 400;
  letter-spacing: clamp(0.28em, 0.8vw, 0.8em);
  text-indent: clamp(0.28em, 0.8vw, 0.8em);
  line-height: 1;
  color: var(--lunar);
  overflow-wrap: anywhere;
  text-shadow: 0 3px 20px rgba(0, 0, 0, 0.45);
}

.title-lockup-brand {
  margin: 0;
  max-width: 100%;
  font-family: 'Manrope', sans-serif;
  font-size: clamp(1.65rem, 8vw, 4.5rem);
  font-weight: 400;
  letter-spacing: clamp(0.14em, 0.5vw, 0.5em);
  text-indent: clamp(0.14em, 0.5vw, 0.5em);
  line-height: 1;
  color: var(--off-white);
  overflow-wrap: anywhere;
  text-shadow: 0 3px 30px rgba(0, 0, 0, 0.55);
}

.coming-soon {
  width: 100%;
  min-height: 100svh;
  min-height: 100dvh;
  padding: calc(24px + env(safe-area-inset-top, 0px))
    max(12px, env(safe-area-inset-right, 0px))
    calc(24px + env(safe-area-inset-bottom, 0px))
    max(12px, env(safe-area-inset-left, 0px));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 35%, rgba(228, 164, 104, 0.08), transparent 60%),
    #050608;
  text-align: center;
  font-family: 'Manrope', 'Noto Sans TC', sans-serif;
  color: #f2f0e9;
}

@media (max-height: 480px) {
  .coming-soon {
    padding-block: calc(12px + env(safe-area-inset-top, 0px))
      calc(12px + env(safe-area-inset-bottom, 0px));
  }

  .title-lockup {
    gap: 10px;
  }
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
