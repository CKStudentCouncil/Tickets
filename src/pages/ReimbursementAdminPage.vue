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
      <h1>{{ pastYear ? `${viewYear} 年報帳` : '報帳管理' }}</h1>
    </div>

    <p v-if="pastYear" class="year-note" role="status">
      正在查看 {{ viewYear }} 年：訂單是清除所有訂單時封存的資料，學弟賣票是當年登記的
      <router-link :to="{ name: 'super-admin-history' }">歷年資料</router-link>
      <router-link :to="{ name: 'super-admin-reimbursements' }">回到 {{ PARTY_YEAR }} 年</router-link>
    </p>

    <p v-if="loading" class="empty">載入中...</p>

    <div v-else-if="loadError" class="panel">
      <p class="empty">資料載入失敗，請檢查網路後重試</p>
      <button type="button" class="btn" @click="load">重新載入</button>
    </div>

    <template v-else>
      <div class="panel">
        <div class="notify-header">
          <h2>{{ viewYear }} 舞會利潤</h2>
          <div class="ticket-type-header-actions">
            <button type="button" class="btn-outline" :disabled="loading" @click="load">重新整理</button>
          </div>
        </div>
        <p class="panel-copy">
          收入是所有訂單（含路宣；公關票為 NT$0）與學弟賣票的金額，支出是核准的報帳；「目前」只算已收到的款項與已核准、已撥款的報帳，「預估」假設每筆訂單都收到款、待審核的報帳全數核准
        </p>

        <div class="stats">
          <div class="stat">
            <strong class="num" :class="{ negative: profit.profit.realized < 0 }">{{ money(profit.profit.realized) }}</strong>
            <span>目前利潤</span>
          </div>
          <div class="stat">
            <strong class="num" :class="{ negative: profit.profit.projected < 0 }">{{ money(profit.profit.projected) }}</strong>
            <span>預估利潤</span>
          </div>
          <div class="stat"><strong class="num">{{ money(profit.income.realized) }}</strong><span>已收款收入</span></div>
          <div class="stat"><strong class="num">{{ money(profit.expenses.realized) }}</strong><span>報帳支出（已核准）</span></div>
        </div>

        <div class="table-wrap profit-table">
          <table>
            <thead>
              <tr>
                <th>項目</th>
                <th>目前</th>
                <th>預估</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>訂單收入</td>
                <td class="num">{{ money(profit.orders.realized) }}</td>
                <td class="num">{{ money(profit.orders.projected) }}</td>
              </tr>
              <tr>
                <td>學弟賣票收入</td>
                <td class="num">{{ money(profit.sellers.realized) }}</td>
                <td class="num">{{ money(profit.sellers.projected) }}</td>
              </tr>
              <tr class="subtotal">
                <td>收入合計</td>
                <td class="num">{{ money(profit.income.realized) }}</td>
                <td class="num">{{ money(profit.income.projected) }}</td>
              </tr>
              <tr>
                <td>報帳支出</td>
                <td class="num">{{ money(-profit.expenses.realized) }}</td>
                <td class="num">{{ money(-profit.expenses.projected) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">利潤</th>
                <td class="num" :class="{ negative: profit.profit.realized < 0 }">{{ money(profit.profit.realized) }}</td>
                <td class="num" :class="{ negative: profit.profit.projected < 0 }">{{ money(profit.profit.projected) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="notify-header">
          <h2>收支表</h2>
          <div class="ticket-type-header-actions">
            <div class="basis-toggle" role="group" aria-label="收支表依據">
              <button
                v-for="(basis, key) in STATEMENT_BASES"
                :key="key"
                type="button"
                class="btn-outline"
                :class="{ active: statementBasis === key }"
                :aria-pressed="statementBasis === key"
                @click="statementBasis = key"
              >
                {{ basis.label }}
              </button>
            </div>
            <button type="button" class="btn-outline" :disabled="exporting" @click="exportExcel">下載 Excel</button>
            <button type="button" class="btn-outline" :disabled="exporting" @click="exportPdf">下載 PDF</button>
          </div>
        </div>
        <p class="panel-copy">
          依班聯會總預算表的格式列出；「{{ STATEMENT_BASES[statementBasis].label }}」算的是{{ STATEMENT_BASES[statementBasis].detail }}
        </p>

        <div ref="statementSheet" class="statement-sheet">
          <div class="sheet-title">
            <p>{{ STATEMENT_ORGANIZATION }}</p>
            <h3>{{ statementTitle }}</h3>
            <p class="sheet-basis">{{ statementBasisLine }}</p>
          </div>
          <div class="table-wrap">
            <table class="statement">
              <colgroup>
                <col v-for="code in 4" :key="code" class="code-col">
                <col class="name-col">
                <col class="amount-col">
                <col class="amount-col">
                <col class="note-col">
              </colgroup>
              <thead>
                <tr>
                  <th colspan="5">預算科目</th>
                  <th colspan="2">單位：新臺幣（元）</th>
                  <th rowspan="2">附註</th>
                </tr>
                <tr>
                  <th>款</th>
                  <th>項</th>
                  <th>目</th>
                  <th>節</th>
                  <th>名稱</th>
                  <th>收入</th>
                  <th>支出</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in statement.rows" :key="index" :class="[`kind-${row.kind}`, `level-${levelOf(row)}`]">
                  <td v-for="(code, column) in row.codes" :key="column" class="code num">{{ code }}</td>
                  <td class="name">{{ row.name }}</td>
                  <td v-if="row.kind === 'balance'" colspan="2" class="amount num" :class="{ negative: row.income < 0 }">
                    {{ figure(row.income) }}
                  </td>
                  <template v-else>
                    <td class="amount num">{{ figure(row.income) }}</td>
                    <td class="amount num">{{ figure(row.expense) }}</td>
                  </template>
                  <td class="note">{{ row.note }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="notify-header">
          <h2>報帳總覽</h2>
        </div>
        <p class="panel-copy">核准表示這筆算進舞會支出；把錢交給報帳人後改為「已撥款」</p>

        <div class="stats">
          <div v-for="status in REIMBURSEMENT_STATUSES" :key="status" class="stat">
            <strong class="num">NT$ {{ totals.amounts[status].toLocaleString() }}</strong>
            <span>{{ REIMBURSEMENT_STATUS_LABELS[status] }}（{{ totals.counts[status] }} 筆）</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="notify-header">
          <h2>各人報帳</h2>
        </div>
        <p class="panel-copy">依報帳時填的姓名分人；「待撥款」是已核准、還沒把錢交給他的金額</p>

        <p v-if="byReimburser.length === 0" class="empty">還沒有人報帳</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>筆數</th>
                <th>待審核</th>
                <th>待撥款</th>
                <th>已撥款</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in byReimburser" :key="row.name">
                <td>{{ row.name }}</td>
                <td class="num">{{ row.claims }}</td>
                <td class="num">NT$ {{ row.pending.toLocaleString() }}</td>
                <td class="num" :class="{ owed: row.owed > 0 }">NT$ {{ row.owed.toLocaleString() }}</td>
                <td class="num">NT$ {{ row.paid.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <div class="notify-header">
          <h2>報帳紀錄</h2>
        </div>
        <p class="panel-copy">
          在「狀態」改為核准、撥款或退回；刪除只用於清掉重複或測試的報帳，它的發票會移到雲端硬碟的垃圾桶；發票存在 {{ INVOICE_DRIVE_OWNER }} 雲端硬碟的「{{ INVOICE_FOLDER }}」資料夾，有連結的人都能開啟
        </p>

        <div class="filters">
          <input v-model="searchTerm" type="search" class="search" placeholder="搜尋姓名、用途或申請人">
          <select v-model="statusFilter" class="select-field status-filter" aria-label="依狀態篩選">
            <option value="all">全部狀態</option>
            <option v-for="status in REIMBURSEMENT_STATUSES" :key="status" :value="status">
              {{ REIMBURSEMENT_STATUS_LABELS[status] }}
            </option>
          </select>
        </div>

        <p v-if="filteredClaims.length === 0" class="empty">沒有報帳紀錄</p>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>時間</th>
                <th>姓名</th>
                <th>金額</th>
                <th>科目</th>
                <th>用途</th>
                <th>發票</th>
                <th>申請人</th>
                <th>狀態</th>
                <th>審核</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="claim in filteredClaims" :key="claim.id">
                <td class="num">{{ formatDateTime(claim.createdAt) }}</td>
                <td>{{ claim.name }}</td>
                <td class="num">NT$ {{ claimAmount(claim).toLocaleString() }}</td>
                <td>
                  <select
                    class="select-field status-select"
                    :value="REIMBURSEMENT_CATEGORIES.includes(claim.category) ? claim.category : ''"
                    :disabled="busyIds.has(claim.id)"
                    :aria-label="`${claim.name} NT$ ${claimAmount(claim)} 的科目`"
                    @change="changeCategory(claim, $event.target)"
                  >
                    <option v-if="!REIMBURSEMENT_CATEGORIES.includes(claim.category)" value="" disabled>{{ UNCATEGORIZED }}</option>
                    <option v-for="category in REIMBURSEMENT_CATEGORIES" :key="category" :value="category">{{ category }}</option>
                  </select>
                </td>
                <td class="note-cell">{{ claim.note || '—' }}</td>
                <td class="invoice-cell">
                  <template v-if="claim.invoices?.length">
                    <a
                      v-for="(invoice, index) in claim.invoices"
                      :key="invoice.fileId"
                      :href="invoice.url"
                      :title="invoice.name"
                      target="_blank"
                      rel="noopener"
                    >
                      發票 {{ index + 1 }}
                    </a>
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="mono">{{ claim.submitterEmail }}</td>
                <td>
                  <select
                    class="select-field status-select"
                    :class="`status-${claim.status}`"
                    :value="claim.status"
                    :disabled="busyIds.has(claim.id)"
                    :aria-label="`${claim.name} NT$ ${claimAmount(claim)} 的狀態`"
                    @change="changeStatus(claim, $event.target)"
                  >
                    <option v-for="status in REIMBURSEMENT_STATUSES" :key="status" :value="status">
                      {{ REIMBURSEMENT_STATUS_LABELS[status] }}
                    </option>
                  </select>
                </td>
                <td class="reviewed">
                  <template v-if="claim.reviewedByName">
                    {{ claim.reviewedByName }}<br><span class="num">{{ formatDateTime(claim.reviewedAt) }}</span>
                  </template>
                  <template v-else>—</template>
                </td>
                <td>
                  <!-- a past year's claims are records: deleting one would trash its invoices -->
                  <button
                    v-if="!pastYear"
                    type="button"
                    class="btn-outline danger btn-small"
                    :disabled="busyIds.has(claim.id)"
                    @click="remove(claim)"
                  >
                    刪除
                  </button>
                  <template v-else>—</template>
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
import { useRoute } from 'vue-router'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import {
  INVOICE_DRIVE_OWNER,
  REIMBURSEMENT_CATEGORIES,
  REIMBURSEMENT_STATUSES,
  REIMBURSEMENT_STATUS_LABELS,
  UNCATEGORIZED
} from 'src/data/reimbursements'
import { fetchEveryOrder } from 'src/services/orderService'
import { fetchYearOrders } from 'src/services/archiveService'
import { taiwanYearOf, yearFromQuery } from 'src/utils/historyData'
import { fetchAllRegistrations } from 'src/services/sellerService'
import { PARTY_YEAR } from 'src/services/partySurveyService'
import {
  deleteReimbursement,
  fetchReimbursements,
  setReimbursementCategory,
  setReimbursementStatus
} from 'src/services/reimbursementService'
import { calculateProfit, claimAmount, groupByReimburser, summarizeReimbursements } from 'src/utils/reimbursements'
import { STATEMENT_BASES, buildStatement, summarizeOrders } from 'src/utils/partyStatement'
import { statementWorkbook } from 'src/utils/statementExcel'
import { downloadElementAsPdf } from 'src/utils/pdf'
import { formatDateTime, getTaiwanDateKey } from 'src/utils/datetime'

const auth = useAuthStore()
const toast = useToastStore()

// ?year= (from 歷年資料) shows an earlier party: its claims, the orders
// 清除所有訂單 archived and the 學弟賣票 registered that year. The page is
// remade when the address changes.
const viewYear = yearFromQuery(useRoute().query.year) ?? PARTY_YEAR
const pastYear = viewYear !== PARTY_YEAR

const loading = ref(true)
const loadError = ref(false)
const claims = ref([])
// every order, one read each, for the 收支表's ticket types
const orders = ref([])
const registrations = ref([])
const searchTerm = ref('')
const statusFilter = ref('all')
// claims with a status change or delete in flight
const busyIds = reactive(new Set())

// made by submitReimbursement (FOLDER_NAME in functions/lib/reimbursements.js)
const INVOICE_FOLDER = `CK Party Night 報帳發票 ${viewYear}`

const money = (amount) => `${amount < 0 ? '−' : ''}NT$ ${Math.abs(amount).toLocaleString()}`

const profit = computed(() => calculateProfit({
  orderSummary: summarizeOrders(orders.value),
  registrations: registrations.value,
  claims: claims.value
}))

/* ---------- 收支表 (utils/partyStatement.js) ---------- */

const STATEMENT_ORGANIZATION = '臺北市立建國高級中學班聯會'
const statementTitle = `${viewYear} CK Party Night 收支表`
const statementBasis = ref('realized')
const statementSheet = ref(null)
const exporting = ref(false)
// when the figures were loaded, printed on the exports
const loadedAt = ref(new Date())

const statement = computed(() => buildStatement({
  orders: orders.value,
  registrations: registrations.value,
  claims: claims.value,
  basis: statementBasis.value
}))
const statementBasisLine = computed(() => {
  const basis = STATEMENT_BASES[statementBasis.value]
  return `依據：${basis.label}（${basis.detail}）・資料時間 ${formatDateTime(loadedAt.value)}`
})

// 款 0, 項 1, 目 2, 節 3; the 合計 and 結餘 rows have none
const levelOf = (row) => row.codes.findIndex((code) => code !== '')
// as the 總預算表 prints amounts: no currency, blank where none
const figure = (amount) => (amount === null ? '' : `${amount < 0 ? '−' : ''}${Math.abs(amount).toLocaleString()}`)
const exportName = (extension) =>
  `${viewYear}舞會收支表_${STATEMENT_BASES[statementBasis.value].label}_${getTaiwanDateKey(loadedAt.value)}.${extension}`

async function exportExcel() {
  exporting.value = true
  try {
    const [excelModule, saverModule] = await Promise.all([import('exceljs'), import('file-saver')])
    const saveAs = saverModule.saveAs || saverModule.default.saveAs || saverModule.default
    const workbook = statementWorkbook(excelModule.default, statement.value, {
      organization: STATEMENT_ORGANIZATION,
      title: statementTitle,
      basisLine: statementBasisLine.value
    })
    const buffer = await workbook.xlsx.writeBuffer()
    saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), exportName('xlsx'))
  } catch (error) {
    console.error('Export statement Excel error:', error)
    toast.show('Excel 下載失敗，請稍後再試')
  } finally {
    exporting.value = false
  }
}

// The table with its titles, on white (.pdf-export in reimbursementadminpage.scss)
async function exportPdf() {
  exporting.value = true
  try {
    await downloadElementAsPdf(statementSheet.value, exportName('pdf'))
  } catch (error) {
    console.error('Export statement PDF error:', error)
    toast.show('PDF 下載失敗，請稍後再試')
  } finally {
    exporting.value = false
  }
}
const totals = computed(() => summarizeReimbursements(claims.value))
const byReimburser = computed(() => groupByReimburser(claims.value))

const filteredClaims = computed(() => {
  const q = searchTerm.value.trim().toLowerCase()
  return claims.value.filter((claim) =>
    (statusFilter.value === 'all' || claim.status === statusFilter.value) &&
    (!q || [claim.name, claim.note, claim.submitterEmail]
      .some((value) => String(value || '').toLowerCase().includes(q)))
  )
})

async function load() {
  loading.value = true
  loadError.value = false

  try {
    const [all, everyOrder, sellerRegistrations] = await Promise.all([
      fetchReimbursements(viewYear),
      pastYear ? fetchYearOrders(viewYear) : fetchEveryOrder(),
      fetchAllRegistrations()
    ])
    claims.value = all
    orders.value = everyOrder
    registrations.value = pastYear
      ? sellerRegistrations.filter((registration) => taiwanYearOf(registration.createdAt) === viewYear)
      : sellerRegistrations
    loadedAt.value = new Date()
  } catch (error) {
    console.error('Load reimbursements error:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function changeStatus(claim, select) {
  const status = select.value
  const label = REIMBURSEMENT_STATUS_LABELS[status]

  busyIds.add(claim.id)
  try {
    await setReimbursementStatus(claim.id, status, { uid: auth.user.uid, name: auth.displayName })
    Object.assign(claim, { status, reviewedByName: auth.displayName, reviewedAt: new Date() })
    toast.show(`${claim.name} 的 NT$ ${claimAmount(claim).toLocaleString()} 已改為「${label}」`)
  } catch (error) {
    console.error('Update reimbursement status error:', error)
    select.value = claim.status
    toast.show('更新失敗，請稍後再試')
  } finally {
    busyIds.delete(claim.id)
  }
}

async function changeCategory(claim, select) {
  const category = select.value

  busyIds.add(claim.id)
  try {
    await setReimbursementCategory(claim.id, category)
    claim.category = category
    toast.show(`${claim.name} 的 NT$ ${claimAmount(claim).toLocaleString()} 改列「${category}」`)
  } catch (error) {
    console.error('Update reimbursement category error:', error)
    select.value = REIMBURSEMENT_CATEGORIES.includes(claim.category) ? claim.category : ''
    toast.show('更新失敗，請稍後再試')
  } finally {
    busyIds.delete(claim.id)
  }
}

async function remove(claim) {
  const message = `確定要刪除「${claim.name}」的報帳 NT$ ${claimAmount(claim).toLocaleString()} 嗎？刪除後無法復原`
  if (!window.confirm(message)) return

  busyIds.add(claim.id)
  try {
    await deleteReimbursement(claim.id)
    claims.value = claims.value.filter((item) => item.id !== claim.id)
    toast.show('已刪除')
  } catch (error) {
    console.error('Delete reimbursement error:', error)
    toast.show('刪除失敗，請稍後再試')
  } finally {
    busyIds.delete(claim.id)
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
@import 'src/css/reimbursementadminpage.scss';
</style>
