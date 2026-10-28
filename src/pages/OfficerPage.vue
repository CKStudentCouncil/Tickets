<template>
  <div class="seller-page officer-page">
    <header class="page-header">
      <div class="header-copy">
        <p class="eyebrow"><span /> CK PARTY NIGHT / GUEST TICKETS</p>
        <h1>公關票</h1>
        <p class="header-intro">在你的額度內發公關票：直接寄給對方，或產生一次性的邀請連結傳給對方領取</p>
      </div>
      <div class="account-chip">
        <span class="account-dot" aria-hidden="true" />
        <span>{{ auth.email }}</span>
      </div>
    </header>

    <div v-if="loading" class="empty-state" role="status">
      載入中…
    </div>

    <div v-else-if="!auth.isOfficer" class="empty-state">
      <h2>你不在幹部名單中</h2>
      <p>發公關票只開放給有額度的幹部；如果你應該有額度，請聯絡總副召把你的 Google 帳號加入名單，再重新整理這頁</p>
    </div>

    <div v-else-if="loadError" class="empty-state" role="alert">
      <h2>目前無法載入</h2>
      <p>連線可能暫時中斷，請重試</p>
      <button type="button" class="primary-button" @click="load">重新載入</button>
    </div>

    <template v-else>
      <section class="card goal-card" aria-labelledby="quota-title">
        <div class="goal-topline">
          <p class="section-label">01 / YOUR QUOTA</p>
          <p class="goal-status"><span /> {{ remaining > 0 ? 'AVAILABLE' : 'ALL USED' }}</p>
        </div>
        <div class="goal-head">
          <div>
            <h2 id="quota-title">你的額度<em>{{ officer.quota }}</em> 張</h2>
            <p class="muted">產生連結時就會先扣額度；撤銷還沒被領取的連結，額度會退回</p>
          </div>
          <p class="goal-numbers">
            <strong class="num">{{ remaining }}</strong>
            <span> 張可發</span>
          </p>
        </div>
        <div
          class="progress"
          role="progressbar"
          :aria-valuenow="officer.used || 0"
          aria-valuemin="0"
          :aria-valuemax="officer.quota"
          aria-label="已使用的額度"
        >
          <span :style="{ width: `${usedPercent}%` }" />
        </div>
        <div class="goal-footer">
          <p class="goal-note">已寄出 <span class="num">{{ sentCount }}</span> 張・連結保留 <span class="num">{{ heldCount }}</span> 張</p>
          <p class="mine"><strong class="num">{{ officer.used || 0 }}</strong> <span>已使用</span></p>
        </div>
      </section>

      <div class="action-grid">
        <section class="card registration-card" aria-labelledby="direct-title">
          <div class="card-heading">
            <p class="section-label">02 / SEND BY EMAIL</p>
            <span class="card-index">02</span>
          </div>
          <h2 id="direct-title">直接寄送</h2>

          <p v-if="remaining === 0" class="notice">額度已用完；撤銷未領取的連結，或請總副召調高額度</p>

          <form v-else class="register-form" @submit.prevent="sendDirect(false)">
            <label class="field">
              <span>姓名</span>
              <input v-model="form.name" type="text" maxlength="50" autocomplete="off" :disabled="sending" required>
            </label>
            <label class="field">
              <span>Email</span>
              <input
                v-model="form.email"
                type="email"
                maxlength="254"
                autocomplete="off"
                :disabled="sending"
                required
              >
            </label>
            <div class="field">
              <span>張數 <small>最多 {{ maxQuantity }} 張</small></span>
              <QuantityStepper v-model="form.quantity" :max="maxQuantity" :disabled="sending" />
            </div>

            <div v-if="duplicate" class="duplicate" role="alert">
              <p class="warning"><span aria-hidden="true">!</span> 這個 Email 已經收過公關票，再寄會多一筆，確定要寄嗎？</p>
              <div class="row-actions">
                <button type="button" class="primary-button" :disabled="sending" @click="sendDirect(true)">
                  <span>{{ sending ? '寄送中…' : '仍要寄出' }}</span>
                  <span aria-hidden="true">→</span>
                </button>
                <button type="button" class="secondary-button" :disabled="sending" @click="duplicate = false">取消</button>
              </div>
            </div>

            <p v-if="directError" class="error" role="alert">{{ directError }}</p>

            <button v-if="!duplicate" type="submit" class="primary-button" :disabled="sending || !formValid">
              <span>{{ sending ? '寄送中…' : `寄出 ${validQuantity(form.quantity) ? form.quantity : ''} 張公關票` }}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </section>

        <section class="card guide-card" aria-labelledby="invite-title">
          <div class="card-heading">
            <p class="section-label">03 / INVITE LINK</p>
            <span class="card-index">03</span>
          </div>
          <h2 id="invite-title">邀請連結</h2>
          <p class="muted">把連結傳給對方，對方用 Google 帳號登入、填上姓名就能領票，票會寄到他登入的 Email；每個連結只能用一次</p>

          <div v-if="createdInvite" class="new-link" role="status">
            <p class="new-link-label">新的連結・<span class="num">{{ createdInvite.quantity }}</span> 張</p>
            <p class="link-text mono">{{ inviteUrl(createdInvite.id) }}</p>
            <div class="row-actions">
              <button type="button" class="primary-button" @click="copyLink(createdInvite.id)">
                <span>複製連結</span>
                <span aria-hidden="true">⧉</span>
              </button>
              <button type="button" class="secondary-button" @click="createdInvite = null">完成</button>
            </div>
          </div>

          <p v-else-if="remaining === 0" class="notice">額度已用完</p>

          <form v-else class="register-form invite-form" @submit.prevent="createInvite">
            <div class="field">
              <span>張數 <small>最多 {{ maxQuantity }} 張</small></span>
              <QuantityStepper v-model="inviteQuantity" :max="maxQuantity" :disabled="creating" />
            </div>
            <p v-if="inviteError" class="error" role="alert">{{ inviteError }}</p>
            <button type="submit" class="primary-button" :disabled="creating || !validQuantity(inviteQuantity)">
              <span>{{ creating ? '產生中…' : '產生邀請連結' }}</span>
              <span aria-hidden="true">→</span>
            </button>
          </form>
        </section>
      </div>

      <section class="card" aria-labelledby="links-title">
        <div class="card-heading">
          <p class="section-label">04 / OPEN LINKS</p>
          <span class="card-index">04</span>
        </div>
        <h2 id="links-title">還沒被領取的連結</h2>
        <p v-if="openInvites.length === 0" class="muted">沒有未領取的連結</p>
        <ul v-else class="history">
          <li v-for="invite in openInvites" :key="invite.id">
            <div class="history-copy">
              <p class="history-main"><span class="num">{{ invite.quantity }}</span> 張</p>
              <p class="muted num">{{ formatDateTime(invite.createdAt) }} 產生</p>
              <p class="link-text mono">{{ inviteUrl(invite.id) }}</p>
            </div>
            <div class="badges">
              <button type="button" class="secondary-button" @click="copyLink(invite.id)">複製</button>
              <button
                type="button"
                class="secondary-button danger"
                :disabled="revokingIds.has(invite.id)"
                @click="revoke(invite)"
              >
                {{ revokingIds.has(invite.id) ? '撤銷中…' : '撤銷' }}
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section class="card" aria-labelledby="sent-title">
        <div class="card-heading">
          <p class="section-label">05 / SENT</p>
          <span class="card-index">05</span>
        </div>
        <h2 id="sent-title">已發出的公關票</h2>
        <p v-if="tickets.length === 0" class="muted">還沒有發出公關票</p>
        <ul v-else class="history">
          <li v-for="ticket in tickets" :key="ticket.id">
            <div class="history-copy">
              <p class="history-main">{{ ticket.customerName }}・<span class="num">{{ quantityOf(ticket) }}</span> 張</p>
              <p class="muted mono">{{ ticket.customerEmail }}</p>
              <p class="muted num">{{ formatDateTime(ticket.createdAt) }}・{{ ticket.inviteId ? '透過連結領取' : '直接寄送' }}</p>
            </div>
            <div class="badges">
              <span class="badge" :class="{ on: ticket.emailStatus === 'accepted' || ticket.emailStatus === 'sent' }">
                {{ EMAIL_STATUS[ticket.emailStatus] || '—' }}
              </span>
              <span class="badge" :class="{ on: ticket.delivered }">{{ ticket.delivered ? '已領票' : '未領票' }}</span>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import QuantityStepper from 'src/components/QuantityStepper.vue'
import { MAX_GUEST_TICKETS } from 'src/data/guests'
import {
  createOfficerInvite,
  fetchMyInvites,
  fetchMyOfficer,
  fetchMyOfficerTickets,
  inviteUrl,
  isOnOfficerList,
  quantityOf,
  remainingOf,
  revokeOfficerInvite,
  sendOfficerTicket
} from 'src/services/guestService'
import { createRequestId } from 'src/services/orderService'
import { formatDateTime } from 'src/utils/datetime'
import { EMAIL_STATUS } from 'src/utils/orderBackup'

const auth = useAuthStore()
const toast = useToastStore()

const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/

const emptyForm = () => ({ name: '', email: '', quantity: 1 })

const loading = ref(true)
const loadError = ref(false)
const officer = ref({ quota: 0, used: 0 })
const invites = ref([])
const tickets = ref([])

const form = ref(emptyForm())
const sending = ref(false)
const directError = ref('')
// the email already has a 公關票: sending again waits for a second yes
const duplicate = ref(false)

const inviteQuantity = ref(1)
const creating = ref(false)
const inviteError = ref('')
// the link just made, shown until the officer copies it and moves on
const createdInvite = ref(null)
const revokingIds = reactive(new Set())

const remaining = computed(() => remainingOf(officer.value))
const maxQuantity = computed(() => Math.max(1, Math.min(MAX_GUEST_TICKETS, remaining.value)))
const usedPercent = computed(() =>
  officer.value.quota > 0 ? Math.min(100, ((officer.value.used || 0) / officer.value.quota) * 100) : 0
)
const openInvites = computed(() => invites.value.filter((invite) => invite.status === 'open'))
const heldCount = computed(() => openInvites.value.reduce((sum, invite) => sum + (Number(invite.quantity) || 0), 0))
const sentCount = computed(() => tickets.value.reduce((sum, ticket) => sum + quantityOf(ticket), 0))

// never above what is left, even when the stepper's floor of 1 is
const validQuantity = (quantity) =>
  Number.isInteger(quantity) && quantity >= 1 && quantity <= Math.min(MAX_GUEST_TICKETS, remaining.value)

const formValid = computed(
  () => form.value.name.trim() !== '' && EMAIL_PATTERN.test(form.value.email.trim()) && validQuantity(form.value.quantity)
)

// another email or name is another question
watch(() => [form.value.name, form.value.email], () => { duplicate.value = false })

async function load() {
  loadError.value = false
  try {
    const [mine, myInvites, myTickets] = await Promise.all([
      fetchMyOfficer(auth.email),
      fetchMyInvites(auth.email),
      fetchMyOfficerTickets(auth.email)
    ])
    if (!mine) {
      // taken off the list meanwhile
      await auth.refresh()
      return
    }
    officer.value = mine
    invites.value = myInvites
    tickets.value = myTickets
  } catch (error) {
    console.error('Load officer page error:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// definite refusals, explained by the server's message (over the quota,
// not on the list, bad input)
const REFUSALS = [
  'functions/invalid-argument',
  'functions/permission-denied',
  'functions/failed-precondition',
  'functions/already-exists',
  'functions/not-found'
]

// The call whose outcome is unknown (the response was lost). Making the
// same call again reuses its requestId, so the server returns that ticket
// or link instead of making a second one.
const pending = {}
function requestIdFor(kind, input) {
  const key = JSON.stringify(input)
  if (pending[kind]?.key !== key) pending[kind] = { key, requestId: createRequestId() }
  return pending[kind].requestId
}

async function sendDirect(allowDuplicate) {
  if (!formValid.value || sending.value) return

  sending.value = true
  directError.value = ''
  const input = {
    name: form.value.name.trim(),
    email: form.value.email.trim().toLowerCase(),
    quantity: form.value.quantity,
    allowDuplicate
  }

  try {
    const { id } = await sendOfficerTicket({ ...input, requestId: requestIdFor('send', input) })
    pending.send = null
    duplicate.value = false
    form.value = emptyForm()
    toast.show(`已寄出公關票 ${id}，邀請信約一分鐘內寄到`, 6000)
    await load()
  } catch (error) {
    console.error('Send officer ticket error:', error)
    if (REFUSALS.includes(error?.code)) {
      // nothing was created: the next try is a new send
      pending.send = null
      if (error.code === 'functions/already-exists' && error.details?.duplicate) duplicate.value = true
      else directError.value = error.message
      if (error.code === 'functions/failed-precondition') await load()
    } else {
      directError.value = '寄送失敗，請稍後再試（再按一次不會重複寄送）'
    }
  } finally {
    sending.value = false
  }
}

async function createInvite() {
  if (!validQuantity(inviteQuantity.value) || creating.value) return

  creating.value = true
  inviteError.value = ''
  const input = { quantity: inviteQuantity.value }

  try {
    const { id } = await createOfficerInvite({ ...input, requestId: requestIdFor('invite', input) })
    pending.invite = null
    createdInvite.value = { id, quantity: input.quantity }
    inviteQuantity.value = 1
    await load()
  } catch (error) {
    console.error('Create officer invite error:', error)
    if (REFUSALS.includes(error?.code)) {
      pending.invite = null
      inviteError.value = error.message
      if (error.code === 'functions/failed-precondition') await load()
    } else {
      inviteError.value = '產生失敗，請稍後再試（再按一次不會重複產生）'
    }
  } finally {
    creating.value = false
  }
}

async function revoke(invite) {
  if (!window.confirm(`確定要撤銷這個 ${invite.quantity} 張的連結嗎？撤銷後連結就不能用了，額度會退回`)) return

  revokingIds.add(invite.id)
  try {
    await revokeOfficerInvite(invite.id)
    if (createdInvite.value?.id === invite.id) createdInvite.value = null
    toast.show('已撤銷連結，額度已退回')
  } catch (error) {
    console.error('Revoke officer invite error:', error)
    toast.show(REFUSALS.includes(error?.code) ? error.message : '撤銷失敗，請稍後再試')
  } finally {
    revokingIds.delete(invite.id)
    await load()
  }
}

async function copyLink(id) {
  try {
    await navigator.clipboard.writeText(inviteUrl(id))
    toast.show('已複製連結')
  } catch {
    toast.show('無法複製，請手動複製連結')
  }
}

onMounted(async () => {
  // the look at sign-in may have failed, or the officer was added since
  if (!auth.isOfficer && (await isOnOfficerList(auth.email))) await auth.refresh()

  if (auth.isOfficer) load()
  else loading.value = false
})
</script>

<style scoped>
@import 'src/css/sellerpage.scss';
@import 'src/css/officerpage.scss';
</style>
