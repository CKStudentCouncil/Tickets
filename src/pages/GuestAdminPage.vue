<template>
  <div class="admin-page">
    <div class="page-heading">
      <br />
      <p class="eyebrow">後台管理</p>
      <h1>公關票</h1>
      <p class="page-intro">
        幫幹部設定公關票額度，幹部在自己的頁面直接寄票或產生邀請連結；每張公關票附 QR Code 的邀請信約一分鐘內寄出，不佔票券庫存、不會收到繳費通知
      </p>
    </div>

    <p v-if="loading" class="empty">載入中...</p>

    <div v-else-if="loadError" class="panel">
      <p class="empty">資料載入失敗，請檢查網路後重試</p>
      <button type="button" class="btn" @click="load()">重新載入</button>
    </div>

    <template v-else>
      <section class="panel" aria-labelledby="officers-title">
        <div class="notify-header">
          <h2 id="officers-title">幹部額度</h2>
          <div class="ticket-type-header-actions">
            <button type="button" class="btn-outline" :disabled="refreshing" @click="load(false)">
              {{ refreshing ? '更新中...' : '重新整理' }}
            </button>
          </div>
        </div>
        <p class="panel-copy">
          幹部用這裡填的 Google 帳號登入，就能在「發公關票」頁面用自己的額度發票；產生邀請連結時會先扣額度，撤銷未領取的連結或刪除公關票會退回
        </p>

        <div class="share-link">
          <span class="mono">{{ OFFICER_PAGE_URL }}</span>
          <button type="button" class="btn-outline" @click="copyText(OFFICER_PAGE_URL, '已複製幹部頁面連結')">複製幹部頁面連結</button>
        </div>

        <p class="ledger-summary">
          <span><strong class="num">{{ officers.length }}</strong> 位幹部</span>
          <span>總額度 <strong class="num">{{ quotaTotal }}</strong> 張</span>
          <span>已使用 <strong class="num">{{ usedTotal }}</strong> 張</span>
          <span>連結保留 <strong class="num">{{ heldTotal }}</strong> 張</span>
        </p>

        <form class="send-form officer-form" @submit.prevent="submitOfficer">
          <div class="form-grid">
            <label class="field">
              <span>Email（Google 帳號）</span>
              <input v-model="newOfficer.email" type="email" maxlength="254" autocomplete="off" :disabled="adding" required>
            </label>
            <label class="field">
              <span>姓名</span>
              <input v-model="newOfficer.name" type="text" maxlength="50" autocomplete="off" :disabled="adding" required>
            </label>
            <label class="field">
              <span>額度（張）</span>
              <input
                v-model.number="newOfficer.quota"
                type="number"
                inputmode="numeric"
                min="0"
                :max="MAX_OFFICER_QUOTA"
                step="1"
                :disabled="adding"
                required
              >
            </label>
          </div>
          <p v-if="officerTaken" class="warning">這個 Email 已經在名單中，請直接修改它的額度</p>
          <p v-if="addError" class="error" role="alert">{{ addError }}</p>
          <button type="submit" class="btn" :disabled="adding || !newOfficerValid">
            {{ adding ? '新增中...' : '新增幹部' }}
          </button>
        </form>

        <input
          v-if="officers.length > 5"
          v-model="officerSearch"
          type="search"
          class="search"
          aria-label="搜尋幹部"
          placeholder="搜尋姓名或 Email"
        >

        <p v-if="officers.length === 0" class="empty">還沒有幹部；新增後他們就能發公關票</p>
        <p v-else-if="shownOfficers.length === 0" class="empty">沒有符合的幹部</p>
        <ul v-else class="guest-list">
          <li
            v-for="item in shownOfficers"
            :key="item.id"
            class="guest-row"
            :class="{ open: editingId === item.id }"
          >
            <div class="guest-who">
              <p class="guest-name">{{ item.name || '（未填姓名）' }}</p>
              <p class="guest-email mono">{{ item.email }}</p>
            </div>
            <p class="guest-time quota-line">
              已用 <strong class="num">{{ item.used || 0 }}</strong> / <span class="num">{{ item.quota }}</span> 張
              <span v-if="heldBy(item.email)" class="held">（連結保留 <span class="num">{{ heldBy(item.email) }}</span>）</span>
              <br>剩 <strong class="num">{{ remainingOf(item) }}</strong> 張
            </p>
            <div class="guest-actions">
              <button
                type="button"
                class="btn"
                :aria-expanded="editingId === item.id"
                :aria-controls="`edit-${item.id}`"
                :disabled="busyIds.has(item.id)"
                @click="toggleEdit(item)"
              >
                修改
              </button>
              <button
                type="button"
                class="btn-outline danger"
                :disabled="busyIds.has(item.id)"
                @click="removeOfficer(item)"
              >
                刪除
              </button>
            </div>

            <form v-if="editingId === item.id" :id="`edit-${item.id}`" class="send-step" @submit.prevent="saveOfficer(item)">
              <div class="form-grid">
                <label class="field">
                  <span>姓名</span>
                  <input v-model="editForm.name" type="text" maxlength="50" :disabled="busyIds.has(item.id)" required>
                </label>
                <label class="field">
                  <span>額度（張，至少 {{ item.used || 0 }}）</span>
                  <input
                    v-model.number="editForm.quota"
                    type="number"
                    inputmode="numeric"
                    :min="item.used || 0"
                    :max="MAX_OFFICER_QUOTA"
                    step="1"
                    :disabled="busyIds.has(item.id)"
                    required
                  >
                </label>
              </div>
              <p v-if="editError" class="error" role="alert">{{ editError }}</p>
              <div class="send-step-actions">
                <button type="submit" class="btn" :disabled="busyIds.has(item.id) || !editValid(item)">
                  {{ busyIds.has(item.id) ? '儲存中...' : '儲存' }}
                </button>
                <button type="button" class="btn-outline" :disabled="busyIds.has(item.id)" @click="editingId = null">取消</button>
              </div>
            </form>
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
        <p class="panel-copy">以班聯會名義寄出，不佔任何幹部的額度：填好姓名與 Email，確認後寄出</p>

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
          <span><strong class="num">{{ shownTickets.length }}</strong> 人</span>
          <span><strong class="num">{{ ticketCount }}</strong> 張</span>
          <span>已領 <strong class="num">{{ deliveredCount }}</strong> 張</span>
        </p>
        <p class="panel-copy">
          公關票也在後台訂單列表裡（學校欄為「公關票」），可在那裡補寄邀請信或刪除；刪除後票券失效，張數退回發出的幹部
        </p>

        <label class="field source-filter">
          <span>發出者</span>
          <select v-model="sourceFilter" class="select-field">
            <option value="">全部</option>
            <option value="council">班聯會直接寄送</option>
            <option v-for="item in officers" :key="item.id" :value="item.email">{{ item.name || item.email }}</option>
          </select>
        </label>

        <p v-if="shownTickets.length === 0" class="empty">還沒有寄出公關票</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>發出者</th>
                <th>張數</th>
                <th>領票</th>
                <th>邀請信</th>
                <th>票券編號</th>
                <th>Email</th>
                <th>建立時間</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ticket in shownTickets" :key="ticket.id">
                <td class="strong">{{ ticket.customerName }}</td>
                <td>{{ guestSourceText(ticket) }}<span v-if="ticket.inviteId" class="via">・連結</span></td>
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
import { useToastStore } from 'src/stores/toast'
import QuantityStepper from 'src/components/QuantityStepper.vue'
import { SITE_URL } from 'src/config/app'
import { MAX_GUEST_TICKETS, MAX_OFFICER_QUOTA, guestSourceText } from 'src/data/guests'
import {
  addOfficer,
  deleteOfficer,
  fetchAllInvites,
  fetchGuestTickets,
  fetchOfficers,
  quantityOf,
  remainingOf,
  sendGuestInvitation,
  updateOfficer
} from 'src/services/guestService'
import { createRequestId } from 'src/services/orderService'
import { formatDateTime } from 'src/utils/datetime'
import { EMAIL_STATUS } from 'src/utils/orderBackup'

const toast = useToastStore()

const OFFICER_PAGE_URL = `${SITE_URL}/officer`
const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/

const emptyForm = () => ({ name: '', email: '', quantity: 1 })
const emptyOfficer = () => ({ email: '', name: '', quota: 10 })

const loading = ref(true)
const refreshing = ref(false)
const loadError = ref(false)
const officers = ref([])
const invites = ref([])
const tickets = ref([])
const officerSearch = ref('')
const sourceFilter = ref('')

const newOfficer = ref(emptyOfficer())
const adding = ref(false)
const addError = ref('')

// the officer whose name and quota are being changed
const editingId = ref(null)
const editForm = ref({ name: '', quota: 0 })
const editError = ref('')
// officers being saved or deleted
const busyIds = reactive(new Set())

// sending by name and email outside any quota; it waits for a second look
// (directReview) before it goes out
const directOpen = ref(false)
const form = ref(emptyForm())
const directReview = ref(false)
const directError = ref('')
const sending = ref(false)

const validQuota = (quota, min = 0) => Number.isInteger(quota) && quota >= min && quota <= MAX_OFFICER_QUOTA

const normalizedNewEmail = computed(() => newOfficer.value.email.trim().toLowerCase())
const officerTaken = computed(() => officers.value.some((item) => item.id === normalizedNewEmail.value))
const newOfficerValid = computed(
  () =>
    EMAIL_PATTERN.test(normalizedNewEmail.value) &&
    newOfficer.value.name.trim() !== '' &&
    validQuota(newOfficer.value.quota) &&
    !officerTaken.value
)
const editValid = (item) => editForm.value.name.trim() !== '' && validQuota(editForm.value.quota, item.used || 0)

const openInvites = computed(() => invites.value.filter((invite) => invite.status === 'open'))
const heldBy = (email) =>
  openInvites.value.filter((invite) => invite.officerEmail === email).reduce((sum, invite) => sum + (Number(invite.quantity) || 0), 0)
const quotaTotal = computed(() => officers.value.reduce((sum, item) => sum + (Number(item.quota) || 0), 0))
const usedTotal = computed(() => officers.value.reduce((sum, item) => sum + (Number(item.used) || 0), 0))
const heldTotal = computed(() => openInvites.value.reduce((sum, invite) => sum + (Number(invite.quantity) || 0), 0))

const shownOfficers = computed(() => {
  const q = officerSearch.value.trim().toLowerCase()
  return q ? officers.value.filter((item) => [item.name, item.email].some((value) => String(value || '').toLowerCase().includes(q))) : officers.value
})

const ticketFor = (email) => {
  const address = String(email || '').trim().toLowerCase()
  return address ? tickets.value.find((ticket) => ticket.customerEmail === address) || null : null
}
const earlierTicket = computed(() => ticketFor(form.value.email))

const formValid = computed(() => {
  const { name, email, quantity } = form.value
  return (
    name.trim() !== '' &&
    EMAIL_PATTERN.test(email.trim()) &&
    Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_GUEST_TICKETS
  )
})

const shownTickets = computed(() => {
  if (!sourceFilter.value) return tickets.value
  if (sourceFilter.value === 'council') return tickets.value.filter((ticket) => !ticket.officerEmail)
  return tickets.value.filter((ticket) => ticket.officerEmail === sourceFilter.value)
})
const ticketCount = computed(() => shownTickets.value.reduce((sum, ticket) => sum + quantityOf(ticket), 0))
const deliveredCount = computed(() =>
  shownTickets.value.filter((ticket) => ticket.delivered).reduce((sum, ticket) => sum + quantityOf(ticket), 0)
)

// any change to the details asks for another look
watch(form, () => { directReview.value = false }, { deep: true })

// `showLoading` false keeps the page up while the lists refresh
async function load(showLoading = true) {
  if (showLoading) loading.value = true
  else refreshing.value = true
  loadError.value = false

  try {
    const [officerList, inviteList, sent] = await Promise.all([fetchOfficers(), fetchAllInvites(), fetchGuestTickets()])
    officers.value = officerList
    invites.value = inviteList
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

async function submitOfficer() {
  if (!newOfficerValid.value || adding.value) return

  adding.value = true
  addError.value = ''
  try {
    await addOfficer({
      email: normalizedNewEmail.value,
      name: newOfficer.value.name.trim(),
      quota: newOfficer.value.quota
    })
    toast.show(`已新增幹部 ${newOfficer.value.name.trim()}`)
    newOfficer.value = emptyOfficer()
    await load(false)
  } catch (error) {
    console.error('Add officer error:', error)
    // the rules refuse a second create of the same email
    addError.value = error?.code === 'permission-denied' ? '新增失敗：這個 Email 可能已經在名單中，請重新整理' : '新增失敗，請稍後再試'
  } finally {
    adding.value = false
  }
}

function toggleEdit(item) {
  if (editingId.value === item.id) {
    editingId.value = null
    return
  }
  editingId.value = item.id
  editForm.value = { name: item.name || '', quota: Number(item.quota) || 0 }
  editError.value = ''
}

async function saveOfficer(item) {
  if (!editValid(item) || busyIds.has(item.id)) return

  busyIds.add(item.id)
  editError.value = ''
  try {
    await updateOfficer(item.id, { name: editForm.value.name.trim(), quota: editForm.value.quota })
    editingId.value = null
    toast.show('已更新幹部額度')
    await load(false)
  } catch (error) {
    console.error('Update officer error:', error)
    // the rules refuse a quota below what the officer has used meanwhile
    editError.value = error?.code === 'permission-denied' ? '儲存失敗：額度不能低於已使用的張數，請重新整理後再試' : '儲存失敗，請稍後再試'
  } finally {
    busyIds.delete(item.id)
  }
}

async function removeOfficer(item) {
  const held = heldBy(item.email)
  const note = `已寄出的公關票仍然有效${held ? `；未領取的 ${held} 張連結會失效` : ''}`
  if (!window.confirm(`確定要把 ${item.name || item.email} 移出幹部名單嗎？${note}`)) return

  busyIds.add(item.id)
  try {
    await deleteOfficer(item.id)
    officers.value = officers.value.filter((officer) => officer.id !== item.id)
    if (editingId.value === item.id) editingId.value = null
    toast.show('已移出幹部名單')
  } catch (error) {
    console.error('Delete officer error:', error)
    toast.show('刪除失敗，請稍後再試')
  } finally {
    busyIds.delete(item.id)
  }
}

// The send whose outcome is unknown (the response was lost). Sending the
// same again reuses its requestId, so the server returns that ticket
// instead of creating a second one.
let pending = null

// definite refusals, explained by the server's message
const REFUSALS = ['functions/invalid-argument', 'functions/permission-denied', 'functions/failed-precondition']

function reviewDirect() {
  if (!formValid.value || sending.value) return
  directError.value = ''
  directReview.value = true
}

async function sendDirect() {
  if (!formValid.value || sending.value) return

  sending.value = true
  directError.value = ''
  const input = {
    name: form.value.name.trim(),
    email: form.value.email.trim().toLowerCase(),
    quantity: form.value.quantity
  }
  const key = JSON.stringify(input)
  if (pending?.key !== key) pending = { key, requestId: createRequestId() }

  try {
    const { id } = await sendGuestInvitation({ ...input, requestId: pending.requestId })
    pending = null
    form.value = emptyForm()
    toast.show(`已建立公關票 ${id}，邀請信約一分鐘內寄出`, 6000)
    await load(false)
  } catch (error) {
    console.error('Send guest invitation error:', error)
    if (REFUSALS.includes(error?.code)) {
      // nothing was created: the next try is a new send
      pending = null
      directError.value = error.message
    } else {
      directError.value = '寄送失敗，請稍後再試（再按一次不會重複寄送）'
    }
  } finally {
    sending.value = false
  }
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text)
    toast.show(message)
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
