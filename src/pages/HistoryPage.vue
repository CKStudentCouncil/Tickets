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
      <h1>歷年資料</h1>
    </div>

    <p v-if="loading" class="empty">載入中...</p>

    <div v-else-if="loadError" class="panel">
      <p class="empty">資料載入失敗，請檢查網路後重試</p>
      <button type="button" class="btn" @click="load">重新載入</button>
    </div>

    <template v-else>
      <div class="panel">
        <div class="notify-header">
          <h2>下載歷年資料</h2>
          <div class="ticket-type-header-actions">
            <button type="button" class="btn-outline" :disabled="downloading !== null" @click="load">重新整理</button>
            <button type="button" class="btn" :disabled="downloading !== null || !years.length" @click="download(null)">
              {{ downloading === ALL ? '下載中…' : '下載全部年份 Excel' }}
            </button>
          </div>
        </div>
        <p class="panel-copy intro-copy">
          每一年的訂單、購票系統問卷、舞會滿意度調查、報帳與學弟賣票，格式和「清除所有訂單」時下載的備份相同；訂單是清除時封存的完整資料，還沒清除的訂單不在這裡；問卷與學弟賣票依填寫、登記的年份分年；報帳發票是 {{ INVOICE_DRIVE_OWNER }} 雲端硬碟的連結，有連結的人都能開啟；「銷售報表」與「收支表」開啟那一年的報表，可再按「匯出 PDF」、「下載 PDF」下載
        </p>
        <p v-if="downloading === ALL" class="download-progress all-progress" role="status">{{ progress }}</p>
        <p v-if="!years.length" class="empty">還沒有任何資料</p>
      </div>

      <section v-if="years.length > 1" class="panel compare" aria-labelledby="history-compare">
        <div class="notify-header">
          <h2 id="history-compare">歷年比較</h2>
        </div>
        <p class="panel-copy intro-copy">
          訂單金額與銷售的圖只算清除訂單時封存或匯入的年份，還沒清除的訂單不算；每張圖都可以按「看表格」看數字
        </p>

        <YearComparison :years="years" :records="records" />
      </section>

      <section
        v-for="item in years"
        :key="item.year"
        class="panel"
        :aria-labelledby="`history-${item.year}`"
      >
        <div class="notify-header">
          <h2 :id="`history-${item.year}`" class="num">{{ item.year }} 年</h2>
          <div class="ticket-type-header-actions">
            <router-link
              v-if="item.archive"
              class="btn-outline"
              :to="{ name: 'super-admin-analytics', query: { year: String(item.year) } }"
            >
              銷售報表
            </router-link>
            <router-link class="btn-outline" :to="{ name: 'super-admin-reimbursements', query: { year: String(item.year) } }">
              收支表
            </router-link>
            <button type="button" class="btn-outline" :disabled="downloading !== null" @click="download(item.year)">
              {{ downloading === item.year ? '下載中…' : '下載 Excel' }}
            </button>
          </div>
        </div>
        <p v-if="downloading === item.year" class="download-progress" role="status">{{ progress }}</p>

        <div class="stats">
          <div class="stat">
            <strong class="num">{{ orderFigure(item) }}</strong>
            <span>{{ orderLabel(item) }}</span>
          </div>
          <div class="stat">
            <strong class="num">{{ item.archive ? money(item.archive.revenue) : '—' }}</strong>
            <span>訂單金額</span>
          </div>
          <div class="stat">
            <strong class="num">{{ item.surveyResponses }}</strong>
            <span>購票系統問卷</span>
          </div>
          <div class="stat">
            <strong class="num">{{ item.partySurveyResponses ?? '—' }}</strong>
            <span>舞會滿意度調查</span>
          </div>
          <div class="stat">
            <strong class="num">{{ item.reimbursements }}</strong>
            <span>報帳（{{ item.invoices }} 個發票檔案）</span>
          </div>
          <div class="stat">
            <strong class="num">{{ money(item.spent) }}</strong>
            <span>報帳支出（已核准）</span>
          </div>
          <div class="stat">
            <strong class="num">{{ item.sellers }}</strong>
            <span>學弟賣票名單（當年加入）</span>
          </div>
          <div class="stat">
            <strong class="num">{{ item.sellerRegistrations }}</strong>
            <span>學弟賣票登記</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, shallowRef } from 'vue'
import YearComparison from 'src/components/analytics/YearComparison.vue'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { INVOICE_DRIVE_OWNER } from 'src/data/reimbursements'
import { countArchivedOrders, fetchArchiveRows, fetchArchivedOrders, fetchSalesArchives } from 'src/services/archiveService'
import {
  countPartySurveyResponses,
  fetchEveryPartySurvey,
  fetchPartySurveyResponses
} from 'src/services/partySurveyService'
import { fetchEveryReimbursement } from 'src/services/reimbursementService'
import { fetchAllRegistrations, fetchSellers } from 'src/services/sellerService'
import { fetchSurveyResponses } from 'src/services/surveyService'
import { buildOrderBackup } from 'src/utils/orderBackup'
import { downloadWorkbook } from 'src/utils/backupDownload'
import { archiveNamesOf, historyFileName, historyYears, recordsOf } from 'src/utils/historyData'

const ALL = 'all'
const DESCRIPTION = '從歷年資料頁下載；訂單是清除所有訂單時封存的完整資料，問卷與學弟賣票依填寫、登記的年份，報帳依舞會年度'

const auth = useAuthStore()
const toast = useToastStore()

const loading = ref(true)
const loadError = ref(false)
// what each year holds; the orders and survey answers are read on download
const records = shallowRef(null)
// the year being downloaded (ALL for every year) and how far it got
const downloading = ref(null)
const progress = ref('')

const years = computed(() => (records.value ? historyYears(records.value) : []))

const money = (amount) => `NT$ ${amount.toLocaleString()}`

function orderFigure(item) {
  if (item.archive?.source === 'import') return item.archive.orderCount
  return item.archivedOrders || '—'
}

function orderLabel(item) {
  if (item.archive?.source === 'import') {
    return item.archivedOrders ? `匯入的銷售資料（另有 ${item.archivedOrders} 筆封存訂單）` : '匯入的銷售資料（無購買者資料）'
  }
  return '封存訂單'
}

// { [year]: count(year) }
async function countsOf(yearList, count) {
  return Object.fromEntries(await Promise.all(yearList.map(async (year) => [year, await count(year)])))
}

const yearsOf = (docs) => docs.map((item) => Number(item.id)).filter(Number.isInteger)

async function load() {
  loading.value = true
  loadError.value = false

  try {
    const [archives, partySurveys, surveyResponses, reimbursements, sellers, sellerRegistrations] = await Promise.all([
      fetchSalesArchives(),
      fetchEveryPartySurvey(),
      fetchSurveyResponses(),
      fetchEveryReimbursement(),
      fetchSellers(),
      fetchAllRegistrations()
    ])
    const [archivedCounts, partySurveyCounts] = await Promise.all([
      countsOf(yearsOf(archives), countArchivedOrders),
      countsOf(yearsOf(partySurveys), countPartySurveyResponses)
    ])
    records.value = {
      archives,
      archivedCounts,
      partySurveys,
      partySurveyCounts,
      surveyResponses,
      reimbursements,
      sellers,
      sellerRegistrations
    }
  } catch (error) {
    console.error('Load history error:', error)
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// One year's Excel, or every year's (year null)
async function download(year) {
  if (downloading.value !== null || !records.value) return
  downloading.value = year ?? ALL
  progress.value = '讀取中…'
  const data = records.value
  const inScope = (item) => year === null || Number(item.id) === year

  try {
    const orders = []
    const importedSales = []
    for (const archive of data.archives.filter(inScope)) {
      const archiveYear = Number(archive.id)
      if (!Number.isInteger(archiveYear)) continue
      orders.push(...await fetchArchivedOrders(archiveYear, {
        onProgress: (loaded) => { progress.value = `已讀取 ${archiveYear} 年 ${loaded} 筆訂單…` }
      }))
      if (archive.source === 'import') {
        importedSales.push({ year: archiveYear, rows: await fetchArchiveRows(archiveYear), names: archiveNamesOf(archive) })
      }
    }

    progress.value = '讀取舞會滿意度調查…'
    const partySurveys = await Promise.all(data.partySurveys.filter(inScope).map(async (survey) => ({
      year: Number(survey.id),
      survey,
      responses: await fetchPartySurveyResponses(survey.id)
    })))

    progress.value = '產生 Excel…'
    const exportedAt = new Date()
    const sheets = buildOrderBackup(orders, {
      ...recordsOf(data, year),
      partySurveys,
      importedSales,
      exportedAt,
      exportedBy: auth.displayName,
      scope: year === null ? '全部年份' : `${year} 年`,
      description: DESCRIPTION
    })
    await downloadWorkbook(sheets, historyFileName(year, exportedAt), { createdAt: exportedAt })
    toast.show(`${year === null ? '全部年份' : `${year} 年`}的資料已下載`)
  } catch (error) {
    console.error('History download error:', error)
    toast.show('下載失敗，請稍後再試')
  } finally {
    downloading.value = null
    progress.value = ''
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

.intro-copy { margin-bottom: 0; }
.compare .intro-copy { margin-bottom: 20px; }

a.btn-outline {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
}
.download-progress.all-progress { margin: 14px 0 0; }

.download-progress {
  margin: -14px 0 18px;
  font-size: 13px;
  color: var(--ember);
}
</style>
