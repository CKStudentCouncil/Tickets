<template>
  <div
    v-if="!auth.isSuperAdmin"
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
      <p class="eyebrow">系統管理</p>
      <h1>路宣管理</h1>
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
          管理員在路宣現場收現金、交付紙本票券後登記；每筆都從「{{ ticketTypeName(savedProgram.ticketTypeId) || '未設定票種' }}」的庫存扣除，算已付款、已領票，購買者身分記為「路宣」
        </p>

        <div class="stats">
          <div class="stat"><strong class="num">{{ sales.length }}</strong><span>路宣訂單</span></div>
          <div class="stat"><strong class="num">{{ totals.tickets }}</strong><span>售出紙本票</span></div>
          <div class="stat"><strong class="num">NT$ {{ totals.amount.toLocaleString() }}</strong><span>現金收款</span></div>
          <div class="stat"><strong class="num">NT$ {{ today.amount.toLocaleString() }}</strong><span>今天收款（{{ today.tickets }} 張）</span></div>
        </div>
      </div>

      <div class="panel">
        <div class="notify-header">
          <h2>登記設定</h2>
          <div class="ticket-type-header-actions">
            <button type="button" class="btn" :disabled="savingProgram" @click="saveProgram">
              {{ savingProgram ? '儲存中...' : '儲存設定' }}
            </button>
          </div>
        </div>
        <p class="panel-copy">
          開放後，管理員可以在「路宣登記」登記；不受票種販售時段與每人限購限制，但不會超過票券總量；本校學生票須由學生自己登入購買，不能選
        </p>

        <div class="settings-grid">
          <label class="field toggle-field">
            <span>開放路宣登記</span>
            <span class="toggle">
              <input v-model="programForm.enabled" type="checkbox">
              {{ programForm.enabled ? '開放中' : '未開放' }}
            </span>
          </label>

          <label class="field">
            <span>販售票種</span>
            <select v-model="programForm.ticketTypeId" class="select-field">
              <option value="">請選擇票種</option>
              <option v-for="type in sellableTypes" :key="type.id" :value="type.id">
                {{ type.name }}（NT$ {{ Number(type.price || 0).toLocaleString() }}{{ type.unlimitedStock ? '・不限量' : `・總量 ${type.totalTicketQuantity || 0}` }}）
              </option>
            </select>
          </label>
        </div>
      </div>

      <div class="panel">
        <div class="notify-header">
          <h2>每日統計</h2>
        </div>
        <p class="panel-copy">依登記時間（台灣時間）分日</p>

        <p v-if="byDay.length === 0" class="empty">還沒有路宣銷售</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>筆數</th>
                <th>張數</th>
                <th>收款金額</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in byDay" :key="row.date">
                <td class="num">{{ row.date }}</td>
                <td class="num">{{ row.orders }}</td>
                <td class="num">{{ row.tickets }}</td>
                <td class="num">NT$ {{ row.amount.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="notify-header">
          <h2>各人收款</h2>
        </div>
        <p class="panel-copy">每筆登記都是登記人現場收的現金；對帳時依這裡的金額向各人收款</p>

        <p v-if="byPromoter.length === 0" class="empty">還沒有人登記</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>登記人</th>
                <th>Email</th>
                <th>筆數</th>
                <th>張數</th>
                <th>收款金額</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in byPromoter" :key="row.email">
                <td>{{ row.name }}</td>
                <td class="mono">{{ row.email }}</td>
                <td class="num">{{ row.orders }}</td>
                <td class="num">{{ row.tickets }}</td>
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
          刪除只用於修正登記錯誤：票會退回庫存，請登記人收回紙本票券或重新登記
        </p>

        <input v-model="searchTerm" type="search" class="search" placeholder="搜尋登記人或訂單編號">

        <p v-if="filteredSales.length === 0" class="empty">沒有登記紀錄</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>時間</th>
                <th>訂單編號</th>
                <th>張數</th>
                <th>金額</th>
                <th>登記人</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="sale in filteredSales" :key="sale.id">
                <td class="num">{{ formatDateTime(sale.createdAt) }}</td>
                <td class="mono">
                  <router-link :to="{ name: 'admin-order-detail', params: { id: sale.id } }">{{ sale.id }}</router-link>
                </td>
                <td class="num">{{ quantityOf(sale) }}</td>
                <td class="num">NT$ {{ amountOf(sale).toLocaleString() }}</td>
                <td>{{ sale.promoterName || sale.promoterEmail }}</td>
                <td>
                  <button type="button" class="btn-outline danger btn-small" :disabled="busyIds.has(sale.id)" @click="remove(sale)">
                    刪除
                  </button>
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
import { ELIGIBLE_IDENTITIES, fetchTicketTypes } from 'src/services/ticketTypeService'
import { deleteOrder } from 'src/services/orderService'
import { fetchAllStreetSales, fetchStreetProgram, saveStreetProgram } from 'src/services/streetSaleService'
import { formatDateTime, getTaiwanDateKey } from 'src/utils/datetime'

const auth = useAuthStore()
const toast = useToastStore()

const loading = ref(true)
const loadError = ref(false)
const ticketTypes = ref([])
const savedProgram = ref({ enabled: false, ticketTypeId: '' })
const programForm = ref({ enabled: false, ticketTypeId: '' })
const savingProgram = ref(false)
const sales = ref([])
const searchTerm = ref('')
// sales with a delete in flight
const busyIds = reactive(new Set())

const quantityOf = (sale) =>
  (Array.isArray(sale.items) ? sale.items : []).reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0)
const amountOf = (sale) => Number(sale.finalTotal) || 0
const ticketTypeName = (id) => ticketTypes.value.find((type) => type.id === id)?.name || ''

// 本校學生 tickets need the buyer's own school account (registerStreetSale refuses them)
const sellableTypes = computed(() =>
  ticketTypes.value.filter((type) => type.eligibleBuyerIdentity !== ELIGIBLE_IDENTITIES.CAMPUS_STUDENTS)
)

const sum = (list) => ({
  orders: list.length,
  tickets: list.reduce((n, sale) => n + quantityOf(sale), 0),
  amount: list.reduce((n, sale) => n + amountOf(sale), 0)
})

const totals = computed(() => sum(sales.value))
const today = computed(() => {
  const key = getTaiwanDateKey(new Date())
  return sum(sales.value.filter((sale) => getTaiwanDateKey(sale.createdAt) === key))
})

// newest day first, as the sales are
const byDay = computed(() => {
  const days = new Map()
  sales.value.forEach((sale) => {
    const date = getTaiwanDateKey(sale.createdAt) || '時間不明'
    days.set(date, [...(days.get(date) || []), sale])
  })
  return [...days].map(([date, list]) => ({ date, ...sum(list) }))
})

const byPromoter = computed(() => {
  const rows = new Map()
  // newest first, so the name shown is the latest one on their sales
  sales.value.forEach((sale) => {
    const email = sale.promoterEmail || ''
    const row = rows.get(email) || { email, name: sale.promoterName || email, list: [] }
    row.list.push(sale)
    rows.set(email, row)
  })
  return [...rows.values()]
    .map(({ email, name, list }) => ({ email, name, ...sum(list) }))
    .sort((a, b) => b.amount - a.amount || b.tickets - a.tickets)
})

const filteredSales = computed(() => {
  const q = searchTerm.value.trim().toLowerCase()
  if (!q) return sales.value
  return sales.value.filter((sale) =>
    [sale.id, sale.promoterName, sale.promoterEmail]
      .some((value) => String(value || '').toLowerCase().includes(q))
  )
})

async function load() {
  loading.value = true
  loadError.value = false

  try {
    const [types, program, all] = await Promise.all([fetchTicketTypes(), fetchStreetProgram(), fetchAllStreetSales()])
    ticketTypes.value = types
    savedProgram.value = program
    programForm.value = { ...program }
    sales.value = all
  } catch (error) {
    console.error('Load street sale stats error:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function saveProgram() {
  if (programForm.value.enabled && !programForm.value.ticketTypeId) {
    toast.show('開放登記前請先選擇販售票種')
    return
  }

  savingProgram.value = true
  try {
    const program = { ...programForm.value }
    await saveStreetProgram(program, auth.user.uid)
    savedProgram.value = program
    toast.show('登記設定已儲存')
  } catch (error) {
    console.error('Save street program error:', error)
    toast.show('儲存失敗，請稍後再試')
  } finally {
    savingProgram.value = false
  }
}

async function remove(sale) {
  const message = `確定要刪除 ${sale.promoterName || sale.promoterEmail} 登記的 ${quantityOf(sale)} 張（${sale.id}）嗎？票會退回庫存。`
  if (!window.confirm(message)) return

  busyIds.add(sale.id)
  try {
    // releaseOrderStock gives the tickets back to the stock
    await deleteOrder(sale.id)
    sales.value = sales.value.filter((s) => s.id !== sale.id)
    toast.show('已刪除，票已退回庫存')
  } catch (error) {
    console.error('Delete street sale error:', error)
    toast.show('刪除失敗，請稍後再試')
  } finally {
    busyIds.delete(sale.id)
  }
}

onMounted(() => {
  if (auth.isSuperAdmin) load()
  else loading.value = false
})
</script>

<style scoped>
@import 'src/css/managementpage.scss';
@import 'src/css/selleradminpage.scss';
</style>
