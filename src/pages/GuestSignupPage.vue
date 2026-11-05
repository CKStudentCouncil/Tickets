<template>
  <div class="guest-page">
    <header class="page-header">
      <p class="eyebrow"><span /> CK PARTY NIGHT / GUEST LIST</p>
      <h1>公關票<em>登記</em></h1>
      <p class="header-intro">填上姓名登記公關票；班聯會審核通過後，公關票會寄到你登入的 Email</p>
    </header>

    <div v-if="loading" class="empty-state" role="status">
      載入中…
    </div>

    <div v-else-if="loadError" class="empty-state" role="alert">
      <h2>目前無法載入</h2>
      <p>連線可能暫時中斷，請重試</p>
      <button type="button" class="primary-button" @click="load()">重新載入</button>
    </div>

    <div v-else-if="!link" class="empty-state">
      <h2>這個登記連結無效</h2>
      <p>連結可能在複製時少了幾個字；請向給你連結的人確認</p>
    </div>

    <div v-else-if="!signup && !link.open" class="empty-state">
      <h2>這個連結已經停止登記</h2>
      <p>如有疑問，請向給你連結的人確認</p>
    </div>

    <div v-else class="guest-layout">
      <!-- the ticket as the invitation email will show it -->
      <section class="stub" :class="status === 'sent' ? 'sent' : 'new'" aria-label="公關票預覽">
        <div class="stub-head">
          <p class="stub-kind">COSMOS <span>公關票</span></p>
          <span class="stage-pill"><span aria-hidden="true" />{{ STAGE[status] }}</span>
        </div>
        <p class="stub-name" :class="{ empty: !shownName }">{{ shownName || '你的姓名' }}</p>
        <p class="stub-relation">{{ link.title }}・<span class="num">{{ link.quantity }}</span> 張</p>
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
        <section v-if="signup" class="status-card" aria-labelledby="status-title" role="status">
          <h2 id="status-title">{{ STATUS_TITLE[status] }}</h2>
          <p v-if="status === 'pending'" class="muted">
            班聯會審核通過後，公關票會寄到 <strong class="email">{{ auth.email }}</strong>；{{ link.open ? '審核前都可以在下面修改登記資料' : '這個連結已停止登記，但你的登記仍會審核' }}
          </p>
          <p v-else-if="status === 'approved'" class="muted">
            公關票即將寄到 <strong class="email">{{ auth.email }}</strong>，請留意信箱（也可能在垃圾郵件匣）
          </p>
          <p v-else-if="status === 'sent'" class="muted">
            邀請信已寄到 <strong class="email">{{ auth.email }}</strong>，請到信箱查看（也可能在垃圾郵件匣）；請依信中說明出示 QR Code 兌換紙本票券；開賣後也能在「已購門票」看到這張票
          </p>
          <p v-else class="muted">如有疑問，請向給你連結的人確認</p>
        </section>

        <form v-if="canEdit" class="guest-form" aria-labelledby="form-title" @submit.prevent="submit">
          <h2 id="form-title">{{ signup ? '修改登記資料' : '登記公關票' }}</h2>

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

          <label class="field">
            <span>屆數與幹位</span>
            <input
              v-model="note"
              type="text"
              :maxlength="MAX_SIGNUP_NOTE"
              autocomplete="off"
              placeholder="例：80 主席"
              aria-describedby="note-hint"
            >
            <small id="note-hint" class="hint">讓審核的人知道你是誰</small>
          </label>

          <div class="field">
            <span>Email</span>
            <p class="readonly-value">{{ auth.email }}</p>
            <small class="hint">公關票會寄到你登入的 Google 帳號；要改用其他 Email，請登出後用那個帳號登入再打開這個連結</small>
          </div>

          <p v-if="submitError" class="error" role="alert">{{ submitError }}</p>

          <div class="form-actions">
            <button type="submit" class="primary-button" :disabled="submitting || !canSubmit">
              <span>{{ submitting ? '送出中…' : signup ? '更新登記資料' : '送出登記' }}</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { EVENT_DATE, EVENT_VENUE } from 'src/config/app'
import { LINK_ID_PATTERN, MAX_SIGNUP_NOTE } from 'src/data/guests'
import { fetchMySignup, fetchSignupLink, submitGuestSignup } from 'src/services/guestService'

const auth = useAuthStore()
const toast = useToastStore()
const route = useRoute()

// vue-router keeps this page when only the id changes (another /join link)
const linkId = computed(() => String(route.params.id || ''))

// the stub's pill and the status card's heading, by the sign-up's status
// ('none' before signing up)
const STAGE = { none: '尚未登記', pending: '審核中', approved: '已核准', sent: '已寄出', rejected: '未通過' }
const STATUS_TITLE = { pending: '已收到你的登記', approved: '審核通過', sent: '公關票已寄出', rejected: '這次沒有通過審核' }

const loading = ref(true)
const loadError = ref(false)
// guestSignupLinks/{id}, or null when the link is unknown
const link = ref(null)
// this account's sign-up on it, or null before signing up
const signup = ref(null)
const name = ref(auth.user?.displayName || '')
const note = ref('')
const submitting = ref(false)
const submitError = ref('')

const status = computed(() => signup.value?.status || 'none')
// while it waits for review, and only while the link takes sign-ups
const canEdit = computed(() => link.value?.open === true && (!signup.value || signup.value.status === 'pending'))
const shownName = computed(() => (canEdit.value ? name.value.trim() : signup.value?.name || ''))
const unchanged = computed(
  () => Boolean(signup.value) && name.value.trim() === signup.value.name && note.value.trim() === (signup.value.note || '')
)
const canSubmit = computed(() => name.value.trim() !== '' && !unchanged.value)

// `quiet` keeps the page up while it reloads after a sign-up. What comes back
// for a link the page has since left is dropped.
async function load({ quiet = false } = {}) {
  const id = linkId.value
  if (!quiet) loading.value = true
  loadError.value = false

  try {
    if (!LINK_ID_PATTERN.test(id)) {
      link.value = null
      return
    }
    const [found, mine] = await Promise.all([fetchSignupLink(id), fetchMySignup(id, auth.user.uid)])
    if (id !== linkId.value) return
    link.value = found
    signup.value = mine
    if (mine) {
      name.value = mine.name || ''
      note.value = mine.note || ''
    }
  } catch (error) {
    console.error('Load sign-up link error:', error)
    if (!quiet && id === linkId.value) loadError.value = true
  } finally {
    if (id === linkId.value) loading.value = false
  }
}

// another link: start over, as on a first visit
watch(linkId, () => {
  link.value = null
  signup.value = null
  name.value = auth.user?.displayName || ''
  note.value = ''
  submitError.value = ''
  load()
})

// definite refusals, explained by the server's message (closed, already
// reviewed, bad input)
const REFUSALS = ['functions/invalid-argument', 'functions/failed-precondition']

async function submit() {
  if (!canSubmit.value || submitting.value) return

  const updating = Boolean(signup.value)
  submitting.value = true
  submitError.value = ''
  try {
    await submitGuestSignup({ linkId: linkId.value, name: name.value.trim(), note: note.value.trim() })
    toast.show(updating ? '已更新登記資料' : '已送出登記，審核通過後會寄出公關票', 6000)
    await load({ quiet: true })
  } catch (error) {
    console.error('Submit sign-up error:', error)
    if (error?.code === 'functions/not-found') {
      link.value = null
    } else if (REFUSALS.includes(error?.code)) {
      await load({ quiet: true })
      submitError.value = error.message
    } else {
      // signing up again from this account changes the same sign-up
      submitError.value = '送出失敗，請稍後再試（再按一次不會重複登記）'
    }
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
@import 'src/css/guestpage.scss';
</style>
