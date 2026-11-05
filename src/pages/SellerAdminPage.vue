<template>
  <div
    v-if="!auth.isAdmin"
    class="state-screen"
  >
    <h2>權限不足</h2>
    <button
      type="button"
      class="btn"
      @click="$router.push('/')"
    >
      回到首頁
    </button>
  </div>

  <div
    v-else
    class="admin-page"
  >
    <div class="page-heading">
      <br />
      <p class="eyebrow">後台管理</p>
      <h1>學弟賣票</h1>
    </div>

    <p v-if="loading" class="empty">載入中...</p>

    <div v-else-if="loadError" class="panel">
      <p class="empty">資料載入失敗，請檢查網路後重試</p>
      <button type="button" class="btn" @click="load">重新載入</button>
    </div>

    <template v-else>
      <div class="panel">
        <div class="notify-header">
          <h2>總覽</h2>
          <div class="ticket-type-header-actions">
            <button type="button" class="btn-outline" :disabled="loading" @click="load">重新整理</button>
          </div>
        </div>
        <p class="panel-copy">
          學弟登記的票會直接從「{{ ticketTypeName(savedProgram.ticketTypeId) || '未設定票種' }}」的庫存扣除，前台剩餘數量會跟著減少
        </p>

        <div class="progress" role="progressbar" :aria-valuenow="total" aria-valuemin="0" :aria-valuemax="savedProgram.goal" aria-label="共同目標進度">
          <span :style="{ width: `${goalPercent}%` }" />
        </div>

        <div class="stats">
          <div class="stat"><strong class="num">{{ total }} / {{ savedProgram.goal }}</strong><span>已登記 / 目標</span></div>
          <div class="stat"><strong class="num">{{ leaderboard.length }}</strong><span>有登記的人數</span></div>
          <div class="stat"><strong class="num">{{ pickedUpCount }}</strong><span>已領票張數</span></div>
          <div class="stat"><strong class="num">{{ Math.max(0, total - pickedUpCount) }}</strong><span>尚未領票張數</span></div>
          <div class="stat"><strong class="num">NT$ {{ paidAmount.toLocaleString() }}</strong><span>已交款金額</span></div>
          <div class="stat"><strong class="num">NT$ {{ unpaidAmount.toLocaleString() }}</strong><span>尚未交款金額</span></div>
        </div>
      </div>

      <div class="panel">
        <div class="notify-header">
          <h2>登記設定</h2>
          <div v-if="auth.isSuperAdmin" class="ticket-type-header-actions">
            <button type="button" class="btn" :disabled="savingProgram" @click="saveProgram">
              {{ savingProgram ? '儲存中...' : '儲存設定' }}
            </button>
          </div>
        </div>
        <p class="panel-copy">
          開放後，名單上的學弟登入就會在選單看到「登記賣票」；登記不受票種販售時段與每人限購限制，但不會超過票券總量
          <template v-if="!auth.isSuperAdmin">只有舞會總副召可以修改</template>
        </p>

        <div class="settings-grid">
          <label class="field toggle-field">
            <span>開放登記</span>
            <span class="toggle">
              <input v-model="programForm.enabled" type="checkbox" :disabled="!auth.isSuperAdmin">
              {{ programForm.enabled ? '開放中' : '未開放' }}
            </span>
          </label>

          <label class="field">
            <span>扣除票種（二售）</span>
            <select v-model="programForm.ticketTypeId" class="select-field" :disabled="!auth.isSuperAdmin">
              <option value="">請選擇票種</option>
              <option v-for="type in ticketTypes" :key="type.id" :value="type.id">
                {{ type.name }}{{ type.unlimitedStock ? '（不限量）' : `（總量 ${type.totalTicketQuantity || 0}）` }}
              </option>
            </select>
          </label>

          <label class="field">
            <span>共同目標（張）</span>
            <input v-model.number="programForm.goal" type="number" min="0" step="1" :disabled="!auth.isSuperAdmin">
          </label>
        </div>
      </div>

      <div class="panel">
        <div class="notify-header">
          <h2>業績排行</h2>
        </div>
        <p class="panel-copy">依登記張數排序；金額以登記當時的票價計算</p>

        <p v-if="leaderboard.length === 0" class="empty">還沒有人登記</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>姓名</th>
                <th>Email</th>
                <th>登記張數</th>
                <th>已領票</th>
                <th>已交款</th>
                <th>應交金額</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in leaderboard" :key="row.email">
                <td class="num">{{ index + 1 }}</td>
                <td>{{ row.name }}</td>
                <td class="mono">{{ row.email }}</td>
                <td class="num">{{ row.quantity }}</td>
                <td class="num">{{ row.pickedUp }}</td>
                <td class="num">{{ row.paid }}</td>
                <td class="num">NT$ {{ row.amount.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="notify-header">
          <h2>登記與領票</h2>
        </div>
        <p class="panel-copy">
          每位學弟一列。學弟來拿票時在「這次領」填張數後按記錄，已領張數會自動累加；按「明細」可以看每筆登記與領票紀錄：
          登記張數可以直接修改（多的從庫存扣、少的退回庫存），交款後勾選已交款；學弟不能退票，刪除登記只用於修正錯誤，票會全部退回庫存；領票記錯就刪掉那一筆再重記
        </p>

        <input v-model="searchTerm" type="search" class="search" placeholder="搜尋姓名或 Email">

        <p v-if="filteredRows.length === 0" class="empty">{{ leaderboard.length === 0 ? '還沒有人登記' : '沒有符合的學弟' }}</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>Email</th>
                <th>登記張數</th>
                <th>已領</th>
                <th>待領</th>
                <th>應交金額</th>
                <th>這次領</th>
                <th>明細</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in filteredRows" :key="row.email">
                <tr>
                  <td>
                    {{ row.name }}
                    <span v-if="row.legacyDelivered && row.pickedUp === 0" class="legacy-tag" title="改版前在登記紀錄勾過「已拿票」的張數，請補記實際領票">
                      舊紀錄勾過已拿票 {{ row.legacyDelivered }} 張
                    </span>
                  </td>
                  <td class="mono">{{ row.email }}</td>
                  <td class="num">{{ row.quantity }}</td>
                  <td class="num">{{ row.pickedUp }}</td>
                  <td class="num" :class="{ over: row.quantity - row.pickedUp < 0 }">{{ row.quantity - row.pickedUp }}</td>
                  <td class="num">NT$ {{ row.amount.toLocaleString() }}</td>
                  <td>
                    <form class="inline-form" @submit.prevent="recordPickup(row)">
                      <input
                        v-model.number="pickupInputs[row.email]"
                        type="number"
                        inputmode="numeric"
                        min="1"
                        :max="MAX_SELLER_TICKETS"
                        step="1"
                        class="qty-input"
                        :aria-label="`${row.name} 這次領的張數`"
                        :disabled="busyPickups.has(row.email)"
                      >
                      <button type="submit" class="btn btn-small" :disabled="busyPickups.has(row.email) || !pickupInputs[row.email]">
                        記錄
                      </button>
                    </form>
                  </td>
                  <td>
                    <button type="button" class="btn-outline btn-small" @click="toggleExpanded(row.email)">
                      {{ expanded.has(row.email) ? '收起' : `登記 ${row.registrations.length}・領票 ${row.pickups.length}` }}
                    </button>
                  </td>
                </tr>
                <tr v-if="expanded.has(row.email)" class="detail-row">
                  <td colspan="8">
                    <div class="detail-grid">
                      <div>
                        <h3 class="detail-title">登記紀錄</h3>
                        <p v-if="row.registrations.length === 0" class="muted-note">沒有登記紀錄（已被刪除）</p>
                        <table v-else class="detail-table">
                          <thead>
                            <tr>
                              <th>時間</th>
                              <th>張數</th>
                              <th>金額</th>
                              <th>已交款</th>
                              <th>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr v-for="item in row.registrations" :key="item.id">
                              <td class="num">{{ formatDateTime(item.createdAt) }}</td>
                              <td class="num">
                                <form v-if="editingId === item.id" class="inline-form" @submit.prevent="saveQuantity(item)">
                                  <input
                                    v-model.number="editQuantity"
                                    type="number"
                                    inputmode="numeric"
                                    min="1"
                                    :max="MAX_SELLER_TICKETS"
                                    step="1"
                                    class="qty-input"
                                    :aria-label="`${item.sellerName} 的登記張數`"
                                    :disabled="busyIds.has(item.id)"
                                  >
                                  <button type="submit" class="btn btn-small" :disabled="busyIds.has(item.id)">
                                    {{ busyIds.has(item.id) ? '儲存中...' : '儲存' }}
                                  </button>
                                  <button type="button" class="btn-outline btn-small" :disabled="busyIds.has(item.id)" @click="editingId = ''">取消</button>
                                </form>
                                <span v-else class="qty-cell">
                                  {{ item.quantity }}
                                  <span
                                    v-if="Number.isInteger(item.registeredQuantity) && item.registeredQuantity !== item.quantity"
                                    class="muted-note"
                                    :title="`學弟原本登記 ${item.registeredQuantity} 張`"
                                  >（原 {{ item.registeredQuantity }}）</span>
                                  <button type="button" class="btn-outline btn-small" :disabled="busyIds.has(item.id)" @click="startEdit(item)">修改</button>
                                </span>
                              </td>
                              <td class="num">NT$ {{ amountOf(item).toLocaleString() }}</td>
                              <td>
                                <input
                                  type="checkbox"
                                  :checked="item.paid"
                                  :disabled="busyIds.has(item.id)"
                                  :aria-label="`${item.sellerName} 已交款`"
                                  @change="toggle(item, 'paid', $event.target)"
                                >
                              </td>
                              <td>
                                <button type="button" class="btn-outline danger btn-small" :disabled="busyIds.has(item.id)" @click="remove(item)">
                                  刪除
                                </button>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div>
                        <h3 class="detail-title">領票紀錄</h3>
                        <p v-if="row.pickups.length === 0" class="muted-note">還沒有領票</p>
                        <ul v-else class="pickup-list">
                          <li v-for="pickup in row.pickups" :key="pickup.id">
                            <span class="num">{{ formatDateTime(pickup.createdAt) }}</span>
                            <strong class="num">{{ pickup.quantity }} 張</strong>
                            <button
                              type="button"
                              class="btn-outline danger btn-small"
                              :disabled="busyPickups.has(pickup.id)"
                              @click="removePickup(row, pickup)"
                            >
                              刪除
                            </button>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="notify-header">
          <h2>賣票名單</h2>
        </div>
        <p class="panel-copy">
          只有名單上的 Google 帳號可以登記賣票；學弟加入名單後需重新登入才會看到「登記賣票」
        </p>

        <div v-if="auth.isSuperAdmin" class="add-sellers">
          <label class="field">
            <span>新增學弟（一行一位：Email，或「Email,姓名」）</span>
            <textarea
              v-model="newSellersText"
              rows="5"
              placeholder="s1100001@gl.ck.tp.edu.tw,王小明&#10;s1100002@gl.ck.tp.edu.tw"
            />
          </label>
          <p v-if="newSellersError" class="error">{{ newSellersError }}</p>
          <button type="button" class="btn" :disabled="addingSellers || !newSellersText.trim()" @click="submitSellers">
            {{ addingSellers ? '新增中...' : '加入名單' }}
          </button>
        </div>

        <p v-if="sellers.length === 0" class="empty">名單是空的</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>姓名</th>
                <th>登記張數</th>
                <th v-if="auth.isSuperAdmin">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="seller in sortedSellers" :key="seller.id">
                <td class="mono">{{ seller.email }}</td>
                <td>{{ seller.name || '—' }}</td>
                <td class="num">{{ quantityBySeller.get(seller.email) || 0 }}</td>
                <td v-if="auth.isSuperAdmin">
                  <button type="button" class="btn-outline danger btn-small" @click="dropSeller(seller)">移出名單</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { fetchTicketTypes } from 'src/services/ticketTypeService'
import {
  addPickup,
  addSellers,
  deletePickup,
  deleteRegistration,
  fetchAllPickups,
  fetchAllRegistrations,
  fetchSellerProgram,
  fetchSellers,
  fetchSellerTotal,
  removeSeller,
  saveSellerProgram,
  setRegistrationFlag,
  updateRegistrationQuantity
} from 'src/services/sellerService'
import { MAX_SELLER_TICKETS } from 'src/data/sellerGuide'
import { formatDateTime } from 'src/utils/datetime'

const auth = useAuthStore()
const toast = useToastStore()

const loading = ref(true)
const loadError = ref(false)
const ticketTypes = ref([])
const savedProgram = ref({ enabled: false, ticketTypeId: '', goal: 0 })
const programForm = ref({ enabled: false, ticketTypeId: '', goal: 0 })
const savingProgram = ref(false)
const total = ref(0)
const registrations = ref([])
const sellers = ref([])
const pickups = ref([])
const searchTerm = ref('')
// registrations with a write in flight
const busyIds = reactive(new Set())
// sellers (by email) and pickups (by id) with a write in flight
const busyPickups = reactive(new Set())
// what the admin typed in 這次領, by seller email
const pickupInputs = reactive({})
// sellers whose pickups are shown
const expanded = reactive(new Set())
// the registration whose quantity is being edited
const editingId = ref('')
const editQuantity = ref(0)

const newSellersText = ref('')
const newSellersError = ref('')
const addingSellers = ref(false)

// no '/': the email is the seller's document id
const EMAIL_PATTERN = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/

const amountOf = (item) => (Number(item.price) || 0) * (Number(item.quantity) || 0)
const ticketTypeName = (id) => ticketTypes.value.find((type) => type.id === id)?.name || ''

const goalPercent = computed(() =>
  savedProgram.value.goal > 0 ? Math.min(100, (total.value / savedProgram.value.goal) * 100) : 0
)
const pickedUpCount = computed(() => pickups.value.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0))
const paidAmount = computed(() =>
  registrations.value.filter((item) => item.paid).reduce((sum, item) => sum + amountOf(item), 0)
)
const unpaidAmount = computed(() =>
  registrations.value.filter((item) => !item.paid).reduce((sum, item) => sum + amountOf(item), 0)
)

const leaderboard = computed(() => {
  const rows = new Map()
  const names = new Map(sellers.value.map((seller) => [seller.email, seller.name]))
  const rowOf = (email, name) => rows.get(email) || rows.set(email, {
    email,
    name: name || names.get(email) || email,
    quantity: 0,
    pickedUp: 0,
    pickups: [],
    registrations: [],
    legacyDelivered: 0,
    paid: 0,
    amount: 0
  }).get(email)

  // newest first, so the name shown is the latest one the seller entered
  registrations.value.forEach((item) => {
    const row = rowOf(item.sellerEmail, item.sellerName)
    row.quantity += item.quantity
    row.registrations.push(item)
    // ticked on the registration before pickups were counted
    if (item.delivered) row.legacyDelivered += item.quantity
    if (item.paid) row.paid += item.quantity
    row.amount += amountOf(item)
  })
  // a seller whose registration was deleted still shows what they picked up
  pickups.value.forEach((pickup) => {
    const row = rowOf(pickup.sellerEmail)
    row.pickedUp += Number(pickup.quantity) || 0
    row.pickups.push(pickup)
  })
  return [...rows.values()].sort((a, b) => b.quantity - a.quantity)
})

const quantityBySeller = computed(() => new Map(leaderboard.value.map((row) => [row.email, row.quantity])))

const sortedSellers = computed(() => [...sellers.value].sort((a, b) => a.email.localeCompare(b.email)))

// a seller matches by the name on the list or on any registration
const filteredRows = computed(() => {
  const q = searchTerm.value.trim().toLowerCase()
  if (!q) return leaderboard.value
  return leaderboard.value.filter(
    (row) =>
      row.name.toLowerCase().includes(q) ||
      row.email.toLowerCase().includes(q) ||
      row.registrations.some((item) => item.sellerName?.toLowerCase().includes(q))
  )
})

async function load() {
  loading.value = true
  loadError.value = false

  try {
    const [types, program, totalCount, all, list, allPickups] = await Promise.all([
      fetchTicketTypes(),
      fetchSellerProgram(),
      fetchSellerTotal(),
      fetchAllRegistrations(),
      fetchSellers(),
      fetchAllPickups()
    ])
    ticketTypes.value = types
    savedProgram.value = program
    programForm.value = { ...program }
    total.value = totalCount
    registrations.value = all
    sellers.value = list
    pickups.value = allPickups
    editingId.value = ''
  } catch (error) {
    console.error('Load seller admin error:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function saveProgram() {
  const goal = Number(programForm.value.goal)
  if (!Number.isInteger(goal) || goal < 0) {
    toast.show('目標張數必須是 0 以上的整數')
    return
  }
  if (programForm.value.enabled && !programForm.value.ticketTypeId) {
    toast.show('開放登記前請先選擇要扣除的票種')
    return
  }

  savingProgram.value = true
  try {
    const program = { ...programForm.value, goal }
    await saveSellerProgram(program, auth.user.uid)
    savedProgram.value = program
    toast.show('登記設定已儲存')
  } catch (error) {
    console.error('Save seller program error:', error)
    toast.show('儲存失敗，請稍後再試')
  } finally {
    savingProgram.value = false
  }
}

async function toggle(item, key, checkbox) {
  const value = checkbox.checked
  busyIds.add(item.id)
  try {
    await setRegistrationFlag(item.id, key, value, auth.user.uid)
    item[key] = value
  } catch (error) {
    console.error('Update seller registration error:', error)
    // the box must show what is saved
    checkbox.checked = item[key] === true
    toast.show('更新失敗，請稍後再試')
  } finally {
    busyIds.delete(item.id)
  }
}

function startEdit(item) {
  editingId.value = item.id
  editQuantity.value = item.quantity
}

// the server's message says why (not enough left, changed meanwhile, bad input)
const QUANTITY_REFUSALS = [
  'functions/invalid-argument',
  'functions/failed-precondition',
  'functions/resource-exhausted',
  'functions/not-found',
  'functions/permission-denied',
  'functions/aborted'
]

async function saveQuantity(item) {
  const quantity = Number(editQuantity.value)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_SELLER_TICKETS) {
    toast.show(`張數必須是 1 到 ${MAX_SELLER_TICKETS} 的整數；要整筆取消請用刪除`)
    return
  }
  if (quantity === item.quantity) {
    editingId.value = ''
    return
  }

  const delta = quantity - item.quantity
  const change = delta > 0 ? `多扣 ${delta} 張庫存` : `退回 ${-delta} 張到庫存`
  if (!window.confirm(`確定把 ${item.sellerName} 這筆登記從 ${item.quantity} 張改成 ${quantity} 張嗎？會${change}。`)) return

  busyIds.add(item.id)
  try {
    await updateRegistrationQuantity(item.id, quantity, item.quantity)
    if (!Number.isInteger(item.registeredQuantity)) item.registeredQuantity = item.quantity
    item.quantity = quantity
    total.value = Math.max(0, total.value + delta)
    editingId.value = ''
    toast.show(`已改成 ${quantity} 張`)
  } catch (error) {
    console.error('Update seller registration quantity error:', error)
    // someone else changed it: show what is saved now
    const saved = error?.details?.quantity
    if (Number.isInteger(saved)) {
      total.value = Math.max(0, total.value + saved - item.quantity)
      item.quantity = saved
      editQuantity.value = saved
    }
    toast.show(QUANTITY_REFUSALS.includes(error?.code) && error.message ? error.message : '修改失敗，請重新整理後確認張數')
  } finally {
    busyIds.delete(item.id)
  }
}

function toggleExpanded(email) {
  if (expanded.has(email)) expanded.delete(email)
  else expanded.add(email)
}

async function recordPickup(row) {
  const quantity = Number(pickupInputs[row.email])
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_SELLER_TICKETS) {
    toast.show(`張數必須是 1 到 ${MAX_SELLER_TICKETS} 的整數`)
    return
  }
  const remaining = row.quantity - row.pickedUp
  if (quantity > remaining &&
    !window.confirm(`${row.name} 只剩 ${Math.max(0, remaining)} 張待領，這次記 ${quantity} 張會超過登記張數，確定嗎？`)) return

  busyPickups.add(row.email)
  try {
    const pickup = await addPickup(row.email, quantity, auth.user.uid)
    pickups.value = [pickup, ...pickups.value]
    delete pickupInputs[row.email]
    toast.show(`已記錄 ${row.name} 領 ${quantity} 張，共領 ${row.pickedUp + quantity} 張`)
  } catch (error) {
    console.error('Record seller pickup error:', error)
    toast.show('記錄失敗，請稍後再試')
  } finally {
    busyPickups.delete(row.email)
  }
}

async function removePickup(row, pickup) {
  if (!window.confirm(`確定要刪除 ${row.name} 在 ${formatDateTime(pickup.createdAt)} 領 ${pickup.quantity} 張的紀錄嗎？`)) return

  busyPickups.add(pickup.id)
  try {
    await deletePickup(pickup.id)
    pickups.value = pickups.value.filter((p) => p.id !== pickup.id)
    toast.show('已刪除領票紀錄')
  } catch (error) {
    console.error('Delete seller pickup error:', error)
    toast.show('刪除失敗，請稍後再試')
  } finally {
    busyPickups.delete(pickup.id)
  }
}

async function remove(item) {
  if (!window.confirm(`確定要刪除 ${item.sellerName} 登記的 ${item.quantity} 張嗎？這些票會退回庫存。`)) return

  busyIds.add(item.id)
  try {
    await deleteRegistration(item.id)
    registrations.value = registrations.value.filter((r) => r.id !== item.id)
    // releaseSellerStock lowers the stored total shortly
    total.value = Math.max(0, total.value - item.quantity)
    toast.show('已刪除登記，票已退回庫存')
  } catch (error) {
    console.error('Delete seller registration error:', error)
    toast.show('刪除失敗，請稍後再試')
  } finally {
    busyIds.delete(item.id)
  }
}

function parseSellerLines(text) {
  const entries = new Map()
  const invalid = []

  text.split('\n').map((line) => line.trim()).filter(Boolean).forEach((line) => {
    const [rawEmail, ...rest] = line.split(/[,，\t]/)
    const email = rawEmail.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(email)) {
      invalid.push(line)
      return
    }
    entries.set(email, { email, name: rest.join(' ').trim().slice(0, 50) })
  })

  return { entries: [...entries.values()], invalid }
}

async function submitSellers() {
  newSellersError.value = ''
  const { entries, invalid } = parseSellerLines(newSellersText.value)

  if (invalid.length > 0) {
    newSellersError.value = `這些行的 Email 格式不正確：${invalid.join('、')}`
    return
  }
  if (entries.length === 0) return

  addingSellers.value = true
  try {
    await addSellers(entries)
    const added = new Set(entries.map((entry) => entry.email))
    sellers.value = [
      ...sellers.value.filter((seller) => !added.has(seller.email)),
      ...entries.map((entry) => ({ ...entry, id: entry.email }))
    ]
    newSellersText.value = ''
    toast.show(`已將 ${entries.length} 位加入名單`)
  } catch (error) {
    console.error('Add sellers error:', error)
    newSellersError.value = '加入名單失敗，請稍後再試'
  } finally {
    addingSellers.value = false
  }
}

async function dropSeller(seller) {
  if (!window.confirm(`確定要把 ${seller.email} 移出名單嗎？已登記的紀錄會保留。`)) return

  try {
    await removeSeller(seller.email)
    sellers.value = sellers.value.filter((s) => s.id !== seller.id)
    toast.show('已移出名單')
  } catch (error) {
    console.error('Remove seller error:', error)
    toast.show('移出失敗，請稍後再試')
  }
}

onMounted(() => {
  if (auth.isAdmin) load()
  else loading.value = false
})
</script>

<style scoped>
@import 'src/css/managementpage.scss';
@import 'src/css/selleradminpage.scss';
</style>
