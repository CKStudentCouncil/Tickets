<template>
  <div class="admin-page">
    <div class="page-heading">
      <br />
      <p class="eyebrow">後台管理</p>
      <h1>公關票</h1>
      <p class="page-intro">
        每張公關票附 QR Code 的邀請信約一分鐘內寄出；不佔票券庫存、不會收到繳費通知
      </p>
    </div>

    <p v-if="loading" class="empty">載入中...</p>

    <div v-else-if="loadError" class="panel">
      <p class="empty">資料載入失敗，請檢查網路後重試</p>
      <button type="button" class="btn" @click="load()">重新載入</button>
    </div>

    <template v-else>
      <section class="panel" aria-labelledby="queue-title">
        <div class="notify-header">
          <h2 id="queue-title">登記名單</h2>
          <div class="ticket-type-header-actions">
            <button type="button" class="btn-outline" :disabled="refreshing" @click="load(false)">
              {{ refreshing ? '更新中...' : '重新整理' }}
            </button>
          </div>
        </div>
        <p class="panel-copy">
          把登記連結傳給受邀者，他們用 Google 帳號登入後留下姓名與身分；公關票會寄到他們登入的 Email，開賣後也能在「已購門票」看到
        </p>

        <div class="share-link">
          <span class="mono">{{ GUEST_FORM_URL }}</span>
          <button type="button" class="btn-outline" @click="copyFormLink">複製登記連結</button>
        </div>

        <div class="queue-tools">
          <div class="segmented" role="group" aria-label="顯示的登記">
            <button
              v-for="option in VIEWS"
              :key="option.value"
              type="button"
              :class="{ active: view === option.value }"
              :aria-pressed="view === option.value"
              @click="view = option.value"
            >
              {{ option.label }} <span class="num">{{ option.value === 'waiting' ? waitingCount : registrations.length }}</span>
            </button>
          </div>
          <input
            v-model="searchTerm"
            type="search"
            class="search"
            aria-label="搜尋登記"
            placeholder="搜尋姓名、Email、屆數幹位或親友"
          >
        </div>

        <p v-if="shownRegistrations.length === 0" class="empty">{{ emptyText }}</p>
        <ul v-else class="guest-list">
          <li
            v-for="item in shownRegistrations"
            :key="item.id"
            class="guest-row"
            :class="{ open: openId === item.id }"
          >
            <div class="guest-who">
              <p class="guest-name">{{ item.name }}</p>
              <p class="guest-relation">{{ guestRelationText(item) }}</p>
              <p class="guest-email mono">{{ item.email }}</p>
            </div>
            <p class="guest-time"><span class="num">{{ formatDateTime(item.createdAt) }}</span> 登記</p>
            <div class="guest-actions">
              <router-link
                v-if="isInvited(item)"
                :to="{ name: 'admin-order-detail', params: { id: item.orderId } }"
                class="sent-link"
              >
                已寄出・查看票券
              </router-link>
              <button
                v-else
                type="button"
                class="btn"
                :aria-expanded="openId === item.id"
                :aria-controls="`send-${item.id}`"
                :disabled="sending || busyIds.has(item.id)"
                @click="toggleSend(item)"
              >
                寄送
              </button>
              <button
                type="button"
                class="btn-outline danger"
                :disabled="busyIds.has(item.id) || (sending && openId === item.id)"
                @click="removeRegistration(item)"
              >
                刪除
              </button>
            </div>

            <div v-if="openId === item.id" :id="`send-${item.id}`" class="send-step">
              <div class="send-step-main">
                <span class="step-label">張數</span>
                <QuantityStepper v-model="rowQuantity" :max="MAX_GUEST_TICKETS" :disabled="sending" />
                <p class="send-to">寄到 <span class="mono">{{ item.email }}</span></p>
              </div>
              <p v-if="ticketFor(item.email)" class="warning">
                這個 Email 已經收過公關票（<span class="mono">{{ ticketFor(item.email).id }}</span>），再寄會多一筆
              </p>
              <p v-if="rowError" class="error" role="alert">{{ rowError }}</p>
              <div class="send-step-actions">
                <button
                  type="button"
                  class="btn"
                  :disabled="sending || !validQuantity(rowQuantity)"
                  @click="sendToRegistration(item)"
                >
                  {{ sending ? '寄送中...' : sendLabel(rowQuantity) }}
                </button>
                <button type="button" class="btn-outline" :disabled="sending" @click="openId = null">取消</button>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <section class="panel" aria-labelledby="direct-title">
        <div class="notify-header">
          <h2 id="direct-title">直接寄送</h2>
          <div class="ticket-type-header-actions">
            <button
              type="button"
              class="btn-outline"
              :aria-expanded="directOpen"
              aria-controls="direct-form"
              @click="directOpen = !directOpen"
            >
              {{ directOpen ? '收起' : '填寫收件人' }}
            </button>
          </div>
        </div>
        <p class="panel-copy">寄給沒有登記的人：填好姓名、Email 與身分，確認後寄出</p>

        <form v-if="directOpen" id="direct-form" class="send-form" @submit.prevent="reviewDirect">
          <div class="form-grid">
            <label class="field">
              <span>姓名</span>
              <input v-model="form.name" type="text" maxlength="50" :disabled="directReview" required>
            </label>
            <label class="field">
              <span>Email</span>
              <input
                v-model="form.email"
                type="email"
                maxlength="254"
                autocomplete="off"
                :disabled="directReview"
                required
              >
            </label>
            <fieldset class="field">
              <legend>身分</legend>
              <div class="segmented">
                <label
                  v-for="option in GUEST_RELATIONS"
                  :key="option.value"
                  class="segmented-option"
                  :class="{ active: form.relation === option.value }"
                >
                  <input
                    v-model="form.relation"
                    type="radio"
                    name="direct-relation"
                    :value="option.value"
                    :disabled="directReview"
                    required
                  >
                  {{ option.label }}
                </label>
              </div>
            </fieldset>
            <label class="field">
              <span>{{ relationOption?.detail || '屆數及幹位／誰的親友及稱謂' }}</span>
              <input
                v-model="form.relationDetail"
                type="text"
                maxlength="50"
                :placeholder="relationOption?.placeholder || '先選擇身分'"
                :disabled="directReview || !relationOption"
                required
              >
            </label>
            <div class="field">
              <span>張數</span>
              <QuantityStepper v-model="form.quantity" :max="MAX_GUEST_TICKETS" :disabled="directReview" />
            </div>
          </div>

          <p v-if="earlierTicket" class="warning">
            這個 Email 已經收過公關票（<span class="mono">{{ earlierTicket.id }}</span>），再寄會多一筆
          </p>
          <p v-if="directError" class="error" role="alert">{{ directError }}</p>

          <div v-if="directReview" class="review" role="status">
            <p>
              寄出 <strong class="num">{{ form.quantity }}</strong> 張公關票給 <strong>{{ form.name.trim() }}</strong>
              （<span class="mono">{{ form.email.trim().toLowerCase() }}</span>）
            </p>
            <div class="send-step-actions">
              <button type="button" class="btn" :disabled="sending" @click="sendDirect">
                {{ sending ? '寄送中...' : '確認寄出' }}
              </button>
              <button type="button" class="btn-outline" :disabled="sending" @click="directReview = false">返回修改</button>
            </div>
          </div>
          <button v-else type="submit" class="btn" :disabled="sending || !formValid">寄送公關票</button>
        </form>
      </section>

      <section class="panel" aria-labelledby="ledger-title">
        <div class="notify-header">
          <h2 id="ledger-title">已寄出的公關票</h2>
        </div>
        <p class="ledger-summary">
          <span><strong class="num">{{ tickets.length }}</strong> 人</span>
          <span><strong class="num">{{ ticketCount }}</strong> 張</span>
          <span>已領 <strong class="num">{{ deliveredCount }}</strong> 張</span>
        </p>
        <p class="panel-copy">
          公關票也在後台訂單列表裡（學校欄為「公關票」），可在那裡補寄邀請信或刪除；刪除後票券失效，登記者可以再寄一次
        </p>

        <p v-if="tickets.length === 0" class="empty">還沒有寄出公關票</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>身分</th>
                <th>張數</th>
                <th>領票</th>
                <th>邀請信</th>
                <th>票券編號</th>
                <th>Email</th>
                <th>建立時間</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ticket in tickets" :key="ticket.id">
                <td class="strong">{{ ticket.customerName }}</td>
                <td>{{ guestRelationText(ticket.guest) }}</td>
                <td class="num">{{ quantityOf(ticket) }}</td>
                <td>
                  <span class="status" :class="{ on: ticket.delivered }">{{ ticket.delivered ? '已領票' : '未領票' }}</span>
                </td>
                <td>{{ EMAIL_STATUS[ticket.emailStatus] || '—' }}</td>
                <td class="mono">
                  <router-link :to="{ name: 'admin-order-detail', params: { id: ticket.id } }">{{ ticket.id }}</router-link>
                </td>
                <td class="mono">{{ ticket.customerEmail }}</td>
                <td class="num">{{ formatDateTime(ticket.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useToastStore } from 'src/stores/toast'
import QuantityStepper from 'src/components/QuantityStepper.vue'
import { SITE_URL } from 'src/config/app'
import { GUEST_RELATIONS, MAX_GUEST_TICKETS, guestRelationText } from 'src/data/guests'
import {
  deleteGuestRegistration,
  fetchGuestRegistrations,
  fetchGuestTickets,
  sendGuestInvitation
} from 'src/services/guestService'
import { createRequestId } from 'src/services/orderService'
import { formatDateTime } from 'src/utils/datetime'
import { EMAIL_STATUS } from 'src/utils/orderBackup'

const toast = useToastStore()
const router = useRouter()

// from the route, whose path is kept unguessable
const GUEST_FORM_URL = `${SITE_URL}${router.resolve({ name: 'guest' }).href}`
const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/

const VIEWS = [
  { value: 'waiting', label: '待寄送' },
  { value: 'all', label: '全部' }
]

const emptyForm = () => ({ name: '', email: '', relation: '', relationDetail: '', quantity: 1 })

const loading = ref(true)
const refreshing = ref(false)
const loadError = ref(false)
const registrations = ref([])
const tickets = ref([])
const view = ref('waiting')
const searchTerm = ref('')
// registrations being deleted
const busyIds = reactive(new Set())
const sending = ref(false)

// the registration whose send step is open, and how many tickets it gets
const openId = ref(null)
const rowQuantity = ref(1)
const rowError = ref('')

// sending by name and email, to someone who did not register; it waits
// for a second look (directReview) before it goes out
const directOpen = ref(false)
const form = ref(emptyForm())
const directReview = ref(false)
const directError = ref('')

const quantityOf = (ticket) =>
  (Array.isArray(ticket.items) ? ticket.items : []).reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0)

const validQuantity = (quantity) => Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_GUEST_TICKETS
const sendLabel = (quantity) => (Number.isInteger(quantity) ? `寄出 ${quantity} 張公關票` : '寄出公關票')

const relationOption = computed(() => GUEST_RELATIONS.find((option) => option.value === form.value.relation) || null)

const ticketIds = computed(() => new Set(tickets.value.map((ticket) => ticket.id)))
// a registration whose ticket was deleted may be sent one again
const isInvited = (registration) => Boolean(registration.orderId && ticketIds.value.has(registration.orderId))

const ticketFor = (email) => {
  const address = String(email || '').trim().toLowerCase()
  return address ? tickets.value.find((ticket) => ticket.customerEmail === address) || null : null
}
const earlierTicket = computed(() => ticketFor(form.value.email))

const formValid = computed(() => {
  const { name, email, relationDetail, quantity } = form.value
  return (
    name.trim() !== '' &&
    EMAIL_PATTERN.test(email.trim()) &&
    relationOption.value !== null &&
    relationDetail.trim() !== '' &&
    validQuantity(quantity)
  )
})

const ticketCount = computed(() => tickets.value.reduce((sum, ticket) => sum + quantityOf(ticket), 0))
const deliveredCount = computed(() =>
  tickets.value.filter((ticket) => ticket.delivered).reduce((sum, ticket) => sum + quantityOf(ticket), 0)
)
const waitingCount = computed(() => registrations.value.filter((item) => !isInvited(item)).length)

const shownRegistrations = computed(() => {
  const q = searchTerm.value.trim().toLowerCase()
  return registrations.value.filter(
    (item) =>
      (view.value === 'all' || !isInvited(item)) &&
      (!q || [item.name, item.email, item.relationDetail].some((value) => String(value || '').toLowerCase().includes(q)))
  )
})

const emptyText = computed(() => {
  if (registrations.value.length === 0) return '還沒有人登記；把登記連結傳給受邀者後，登記會出現在這裡'
  if (searchTerm.value.trim()) return '沒有符合的登記'
  return '登記的人都已寄出公關票'
})

// any change to the details asks for another look
watch(form, () => { directReview.value = false }, { deep: true })

// `showLoading` false keeps the page up while the lists refresh
async function load(showLoading = true) {
  if (showLoading) loading.value = true
  else refreshing.value = true
  loadError.value = false

  try {
    const [registered, sent] = await Promise.all([fetchGuestRegistrations(), fetchGuestTickets()])
    registrations.value = registered
    tickets.value = sent
  } catch (error) {
    console.error('Load guests error:', error)
    if (showLoading) loadError.value = true
    else toast.show('重新整理失敗，請稍後再試')
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

function toggleSend(item) {
  if (openId.value === item.id) {
    openId.value = null
    return
  }
  openId.value = item.id
  rowQuantity.value = 1
  rowError.value = ''
}

// The send whose outcome is unknown (the response was lost). Sending the
// same again reuses its requestId, so the server returns that ticket
// instead of creating a second one.
let pending = null

// definite refusals, explained by the server's message
const REFUSALS = [
  'functions/invalid-argument',
  'functions/permission-denied',
  'functions/already-exists',
  'functions/not-found',
  'functions/failed-precondition'
]

// true once the ticket exists; `setError` shows a failure where the send began
async function send(input, setError) {
  sending.value = true
  setError('')
  const key = JSON.stringify(input)
  if (pending?.key !== key) pending = { key, requestId: createRequestId() }

  try {
    const { id } = await sendGuestInvitation({ ...input, requestId: pending.requestId })
    pending = null
    toast.show(`已建立公關票 ${id}，邀請信約一分鐘內寄出`, 6000)
    await load(false)
    return true
  } catch (error) {
    console.error('Send guest invitation error:', error)
    if (REFUSALS.includes(error?.code)) {
      // nothing was created: the next try is a new send
      pending = null
      setError(error.message)
    } else {
      setError('寄送失敗，請稍後再試（再按一次不會重複寄送）')
    }
    return false
  } finally {
    sending.value = false
  }
}

async function sendToRegistration(item) {
  if (sending.value || !validQuantity(rowQuantity.value)) return

  const input = { registrationId: item.id, quantity: rowQuantity.value }
  if (await send(input, (message) => { rowError.value = message })) openId.value = null
}

function reviewDirect() {
  if (!formValid.value || sending.value) return
  directError.value = ''
  directReview.value = true
}

async function sendDirect() {
  if (!formValid.value || sending.value) return

  const { name, email, relation, relationDetail, quantity } = form.value
  const input = {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    relation,
    relationDetail: relationDetail.trim(),
    quantity
  }
  if (await send(input, (message) => { directError.value = message })) form.value = emptyForm()
}

async function removeRegistration(item) {
  const note = isInvited(item) ? '已寄出的公關票仍然有效' : ''
  if (!window.confirm(`確定要刪除 ${item.name}（${item.email}）的登記嗎？${note}`)) return

  busyIds.add(item.id)
  try {
    await deleteGuestRegistration(item.id)
    registrations.value = registrations.value.filter((r) => r.id !== item.id)
    if (openId.value === item.id) openId.value = null
    toast.show('已刪除登記')
  } catch (error) {
    console.error('Delete guest registration error:', error)
    toast.show('刪除失敗，請稍後再試')
  } finally {
    busyIds.delete(item.id)
  }
}

async function copyFormLink() {
  try {
    await navigator.clipboard.writeText(GUEST_FORM_URL)
    toast.show('已複製登記連結')
  } catch {
    toast.show('無法複製，請手動複製連結')
  }
}

onMounted(load)
</script>

<style scoped>
@import 'src/css/managementpage.scss';
@import 'src/css/selleradminpage.scss';
@import 'src/css/guestadminpage.scss';
</style>
