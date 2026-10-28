<template>
  <div class="guest-page">
    <header class="page-header">
      <p class="eyebrow"><span /> CK PARTY NIGHT / GUEST LIST</p>
      <h1>公關票<em>邀請</em></h1>
      <p class="header-intro">有人邀請你參加建中舞會！填上姓名就能領取公關票，票會寄到你登入的 Email</p>
    </header>

    <div v-if="loading" class="empty-state" role="status">
      載入中…
    </div>

    <div v-else-if="loadError" class="empty-state" role="alert">
      <h2>目前無法載入</h2>
      <p>連線可能暫時中斷，請重試</p>
      <button type="button" class="primary-button" @click="load">重新載入</button>
    </div>

    <div v-else-if="!invite" class="empty-state">
      <h2>這個邀請連結無效或已失效</h2>
      <p>連結可能已被撤銷，或複製時少了幾個字；請向邀請你的人確認</p>
    </div>

    <div v-else-if="takenByOther" class="empty-state">
      <h2>這個邀請連結已經被領取</h2>
      <p>每個連結只能領一次；如果不是你領的，請向邀請你的人確認</p>
    </div>

    <div v-else class="guest-layout">
      <!-- the ticket as the invitation email will show it -->
      <section class="stub" :class="claimed ? 'sent' : 'new'" aria-label="公關票預覽">
        <div class="stub-head">
          <p class="stub-kind">COSMOS <span>公關票</span></p>
          <span class="stage-pill"><span aria-hidden="true" />{{ claimed ? '已領取' : '尚未領取' }}</span>
        </div>
        <p class="stub-name" :class="{ empty: !shownName }">{{ shownName || '你的姓名' }}</p>
        <p class="stub-relation">{{ inviterText }}・<span class="num">{{ invite.quantity }}</span> 張</p>
        <p class="stub-email">{{ auth.email }}</p>
        <div class="stub-tear" aria-hidden="true" />
        <dl class="stub-event">
          <div>
            <dt>DATE</dt>
            <dd><time :datetime="EVENT_DATE.replaceAll('/', '-')">{{ EVENT_DATE.replaceAll('/', '.') }}</time></dd>
          </div>
          <div>
            <dt>VENUE</dt>
            <dd>{{ EVENT_VENUE }}</dd>
          </div>
        </dl>
      </section>

      <div class="guest-main">
        <section v-if="claimed" class="status-card" aria-labelledby="status-title">
          <h2 id="status-title">已領取公關票</h2>
          <p class="muted">
            邀請信會寄到 <strong class="email">{{ auth.email }}</strong>，請到信箱查看（也可能在垃圾郵件匣）；請依信中說明出示 QR Code 兌換紙本票券。開賣後也能在「已購門票」看到這張票
          </p>
        </section>

        <form v-else class="guest-form" aria-labelledby="form-title" @submit.prevent="claim">
          <h2 id="form-title">領取公關票</h2>

          <label class="field">
            <span>姓名</span>
            <input
              v-model="name"
              type="text"
              maxlength="50"
              autocomplete="name"
              aria-describedby="name-hint"
              required
            >
            <small id="name-hint" class="hint">務必填寫本名，入場時將查驗身分</small>
          </label>

          <div class="field">
            <span>Email</span>
            <p class="readonly-value">{{ auth.email }}</p>
            <small class="hint">公關票會寄到你登入的 Google 帳號；要改用其他 Email，請登出後用那個帳號登入再打開這個連結</small>
          </div>

          <p v-if="claimError" class="error" role="alert">{{ claimError }}</p>

          <div class="form-actions">
            <button type="submit" class="primary-button" :disabled="claiming || !name.trim()">
              <span>{{ claiming ? '領取中…' : `領取 ${invite.quantity} 張公關票` }}</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { EVENT_DATE, EVENT_VENUE } from 'src/config/app'
import { claimOfficerInvite, fetchInvite } from 'src/services/guestService'

const auth = useAuthStore()
const toast = useToastStore()
const route = useRoute()

const inviteId = String(route.params.id || '')

const loading = ref(true)
const loadError = ref(false)
// officerInvites/{id}, or null when the link is unknown
const invite = ref(null)
const name = ref(auth.user?.displayName || '')
const claiming = ref(false)
const claimError = ref('')

const claimed = computed(() => invite.value?.status === 'claimed' && invite.value.claimedByUid === auth.user?.uid)
const takenByOther = computed(() => invite.value?.status === 'claimed' && invite.value.claimedByUid !== auth.user?.uid)
const shownName = computed(() => name.value.trim())
const inviterText = computed(() => (invite.value?.officerName ? `${invite.value.officerName} 邀請` : '班聯會邀請'))

async function load() {
  loading.value = true
  loadError.value = false

  try {
    invite.value = /^[A-Za-z0-9_-]{24}$/.test(inviteId) ? await fetchInvite(inviteId) : null
  } catch (error) {
    console.error('Load invite error:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// definite refusals, explained by the server's message (claimed by someone
// else, revoked, bad input)
const REFUSALS = ['functions/invalid-argument', 'functions/failed-precondition', 'functions/not-found']

async function claim() {
  if (!name.value.trim() || claiming.value) return

  claiming.value = true
  claimError.value = ''
  try {
    await claimOfficerInvite(inviteId, name.value.trim())
    toast.show('已領取公關票，邀請信約一分鐘內寄到', 6000)
    await load()
  } catch (error) {
    console.error('Claim invite error:', error)
    if (REFUSALS.includes(error?.code)) {
      await load()
      claimError.value = error.message
    } else {
      // claiming again from this account returns the same ticket
      claimError.value = '領取失敗，請稍後再試（再按一次不會重複領取）'
    }
  } finally {
    claiming.value = false
  }
}

onMounted(load)
</script>

<style scoped>
@import 'src/css/guestpage.scss';
</style>
