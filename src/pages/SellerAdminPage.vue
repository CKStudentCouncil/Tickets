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
          <div class="stat"><strong class="num">{{ deliveredCount }}</strong><span>已拿票張數</span></div>
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
          <template v-if="!auth.isSuperAdmin">只有系統管理員可以修改</template>
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
                <th>已拿票</th>
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
                <td class="num">{{ row.delivered }}</td>
                <td class="num">{{ row.paid }}</td>
                <td class="num">NT$ {{ row.amount.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="notify-header">
          <h2>登記紀錄</h2>
        </div>
        <p class="panel-copy">
          學弟拿票、交款後在這裡勾選；學弟不能退票；刪除只用於修正登記錯誤，票會退回庫
        </p>

        <input v-model="searchTerm" type="search" class="search" placeholder="搜尋姓名或 Email">

        <p v-if="filteredRegistrations.length === 0" class="empty">沒有登記紀錄</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>時間</th>
                <th>姓名</th>
                <th>Email</th>
                <th>張數</th>
                <th>金額</th>
                <th>已拿票</th>
                <th>已交款</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in filteredRegistrations" :key="item.id">
                <td class="num">{{ formatDateTime(item.createdAt) }}</td>
                <td>{{ item.sellerName }}</td>
                <td class="mono">{{ item.sellerEmail }}</td>
                <td class="num">{{ item.quantity }}</td>
                <td class="num">NT$ {{ amountOf(item).toLocaleString() }}</td>
                <td>
                  <input
                    type="checkbox"
                    :checked="item.delivered"
                    :disabled="busyIds.has(item.id)"
                    :aria-label="`${item.sellerName} 已拿票`"
                    @change="toggle(item, 'delivered', $event.target)"
                  >
                </td>
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
  addSellers,
  deleteRegistration,
  fetchAllRegistrations,
  fetchSellerProgram,
  fetchSellers,
  fetchSellerTotal,
  removeSeller,
  saveSellerProgram,
  setRegistrationFlag
} from 'src/services/sellerService'
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
const searchTerm = ref('')
// registrations with a write in flight
const busyIds = reactive(new Set())

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
const deliveredCount = computed(() =>
  registrations.value.filter((item) => item.delivered).reduce((sum, item) => sum + item.quantity, 0)
)
const paidAmount = computed(() =>
  registrations.value.filter((item) => item.paid).reduce((sum, item) => sum + amountOf(item), 0)
)
const unpaidAmount = computed(() =>
  registrations.value.filter((item) => !item.paid).reduce((sum, item) => sum + amountOf(item), 0)
)

const leaderboard = computed(() => {
  const rows = new Map()
  // newest first, so the name shown is the latest one the seller entered
  registrations.value.forEach((item) => {
    const row = rows.get(item.sellerEmail) || {
      email: item.sellerEmail,
      name: item.sellerName,
      quantity: 0,
      delivered: 0,
      paid: 0,
      amount: 0
    }
    row.quantity += item.quantity
    if (item.delivered) row.delivered += item.quantity
    if (item.paid) row.paid += item.quantity
    row.amount += amountOf(item)
    rows.set(item.sellerEmail, row)
  })
  return [...rows.values()].sort((a, b) => b.quantity - a.quantity)
})

const quantityBySeller = computed(() => new Map(leaderboard.value.map((row) => [row.email, row.quantity])))

const sortedSellers = computed(() => [...sellers.value].sort((a, b) => a.email.localeCompare(b.email)))

const filteredRegistrations = computed(() => {
  const q = searchTerm.value.trim().toLowerCase()
  if (!q) return registrations.value
  return registrations.value.filter(
    (item) => item.sellerName?.toLowerCase().includes(q) || item.sellerEmail?.toLowerCase().includes(q)
  )
})

async function load() {
  loading.value = true
  loadError.value = false

  try {
    const [types, program, totalCount, all, list] = await Promise.all([
      fetchTicketTypes(),
      fetchSellerProgram(),
      fetchSellerTotal(),
      fetchAllRegistrations(),
      fetchSellers()
    ])
    ticketTypes.value = types
    savedProgram.value = program
    programForm.value = { ...program }
    total.value = totalCount
    registrations.value = all
    sellers.value = list
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
