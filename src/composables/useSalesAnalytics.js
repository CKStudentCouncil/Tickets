import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { EVENT_DATE } from 'src/config/app'
import { useNow } from 'src/composables/useNow'
import { useShopStore } from 'src/stores/shop'
import { useToastStore } from 'src/stores/toast'
import { subscribeAllOrders } from 'src/services/orderService'
import { fetchTicketTypes } from 'src/services/ticketTypeService'
import { fetchArchiveRows, fetchSalesArchives, fetchUnfinishedPurge, importSalesArchive } from 'src/services/archiveService'
import { fetchSurveyResponses } from 'src/services/surveyService'
import {
  archivedSale,
  buildReport,
  channelShares,
  currentSale,
  rowsFromArchive,
  saleRowOf,
  taipeiDate,
  taipeiDayStart
} from 'src/utils/salesAnalytics'
import { readSalesWorkbook, sheetsOf } from 'src/utils/salesImport'
import { parseDate } from 'src/utils/datetime'

const DAY_MS = 24 * 60 * 60 * 1000

// /super_admin/analytics: this year's orders, live, against an earlier
// year's sale from salesArchives (written when orders are purged, or
// imported from an earlier year's Excel export).
export function useSalesAnalytics() {
  const shop = useShopStore()
  const toast = useToastStore()
  // the sale's days move on with the clock
  const now = useNow(60_000)
  shop.init()
  const firstTicketSaleAt = ref(null)
  fetchTicketTypes()
    .then((types) => {
      firstTicketSaleAt.value = types
        .map((type) => parseDate(type.salesStartTime))
        .filter(Boolean)
        .sort((a, b) => a - b)[0] || null
    })
    .catch((error) => console.error('Sales report ticket types error:', error))

  const loading = ref(true)
  const liveError = ref(false)
  const updatedAt = ref(null)
  // replaced whole on every snapshot, so a few thousand orders are not made deeply reactive
  const rows = shallowRef([])

  const unsubscribe = subscribeAllOrders({
    onData: ({ orders, fromCache }) => {
      rows.value = orders.map(saleRowOf)
      loading.value = false
      if (!fromCache) {
        updatedAt.value = new Date()
        liveError.value = false
      }
    },
    onError: (error) => {
      console.error('Sales report orders error:', error)
      liveError.value = true
      loading.value = false
    }
  })
  onScopeDispose(unsubscribe)

  /* ---------- the year compared with ---------- */

  // 'full': the earlier year's whole sale; 'same': up to the same day and time of it
  const basis = ref('full')
  const archives = ref([])
  const compareYear = ref(null)
  const archiveLoading = ref(false)
  const previousRows = shallowRef(null)
  // a purge that stopped halfway: its orders are archived and still live
  const unfinishedPurge = ref(null)

  const current = computed(() => currentSale({
    openAt: firstTicketSaleAt.value || shop.openAt,
    eventDate: EVENT_DATE.replaceAll('/', '-'),
    now: now.value.getTime(),
    rows: rows.value
  }))

  // only the latest load may set the rows or end the loading state, so a
  // slower earlier one (or a cleared comparison) never leaves it stuck
  let rowsLoad = 0
  async function loadPreviousRows(year) {
    const load = ++rowsLoad
    previousRows.value = null
    archiveLoading.value = year !== null
    if (year === null) return
    try {
      const archive = archives.value.find((item) => item.year === year)
      const loaded = rowsFromArchive(await fetchArchiveRows(year), archive?.byTicketType)
      if (load === rowsLoad) previousRows.value = loaded
    } catch (error) {
      console.error('Sales report archive error:', error)
      if (load === rowsLoad) toast.show(`${year} 年的資料載入失敗`)
    } finally {
      if (load === rowsLoad) archiveLoading.value = false
    }
  }
  watch(compareYear, loadPreviousRows)

  // `select` picks that year; otherwise the latest year before this one
  async function loadArchives(select) {
    try {
      const [summaries, purge] = await Promise.all([fetchSalesArchives(), fetchUnfinishedPurge()])
      archives.value = summaries
        .filter((item) => item.openDate && item.closeDate)
        .map((item) => ({ ...item, year: Number(item.year ?? item.id) }))
        .sort((a, b) => b.year - a.year)
      unfinishedPurge.value = purge
      const earlier = archives.value.find((item) => item.year < current.value.year) || archives.value[0]
      const year = select ?? compareYear.value ?? earlier?.year ?? null
      if (year === compareYear.value) await loadPreviousRows(year)
      else compareYear.value = year
    } catch (error) {
      console.error('Sales report archives error:', error)
      toast.show('往年資料載入失敗')
    }
  }
  loadArchives()

  const previous = computed(() => {
    const archive = archives.value.find((item) => item.year === compareYear.value)
    return archive && previousRows.value ? archivedSale(archive, previousRows.value) : null
  })

  const report = computed(() => buildReport({
    current: current.value,
    previous: previous.value,
    basis: basis.value,
    now: now.value.getTime()
  }))

  // 得知管道 from the user survey; null until read
  const survey = shallowRef(null)
  fetchSurveyResponses()
    .then((responses) => { survey.value = channelShares(responses) })
    .catch((error) => console.error('Sales report survey error:', error))

  /* ---------- 匯入往年資料 ---------- */

  const importDraft = ref({ openDate: '', closeDate: '' })
  const importParsed = shallowRef(null)
  const importing = ref(false)

  async function readImportFile(file) {
    importParsed.value = null
    try {
      const ExcelJS = (await import('exceljs')).default
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await file.arrayBuffer())
      const parsed = readSalesWorkbook(sheetsOf(workbook))
      if (!parsed.error) importDraft.value = { openDate: taipeiDate(parsed.firstAt), closeDate: taipeiDate(parsed.lastAt) }
      importParsed.value = parsed
    } catch (error) {
      console.error('Sales import read error:', error)
      importParsed.value = { error: '檔案無法讀取，請選擇 .xlsx 格式的訂單 Excel' }
    }
  }

  // what the import would store, checked against the archived years
  const importSummary = computed(() => {
    const parsed = importParsed.value
    if (!parsed) return null
    if (parsed.error) return { year: null, orderCount: 0, revenue: 0, outside: 0, skipped: 0, replaces: false, error: parsed.error }

    const { openDate, closeDate } = importDraft.value
    const start = taipeiDayStart(openDate)
    const end = taipeiDayStart(closeDate)
    const year = start === null ? null : Number(openDate.slice(0, 4))
    const existing = archives.value.find((item) => item.year === year)
    let error = ''
    if (start === null || end === null || end < start) error = '請確認開賣日與結束日'
    else if (existing && existing.source !== 'import') error = `${year} 年已有清除訂單時封存的資料，不能用匯入取代`

    return {
      year,
      orderCount: parsed.rows.length,
      revenue: parsed.rows.reduce((sum, row) => sum + row.v, 0),
      outside: error ? 0 : parsed.rows.filter((row) => row.t < start || row.t >= end + DAY_MS).length,
      skipped: parsed.skipped,
      replaces: Boolean(existing),
      error
    }
  })

  function cancelImport() {
    importParsed.value = null
    importDraft.value = { openDate: '', closeDate: '' }
  }

  async function confirmImport() {
    if (!importSummary.value || importSummary.value.error || importing.value) return false
    importing.value = true
    try {
      const result = await importSalesArchive({
        openDate: importDraft.value.openDate,
        closeDate: importDraft.value.closeDate,
        rows: importParsed.value.rows,
        names: importParsed.value.names
      })
      toast.show(`已匯入 ${result.year} 年的 ${result.orderCount} 筆訂單`)
      cancelImport()
      await loadArchives(result.year)
      return true
    } catch (error) {
      console.error('Sales import error:', error)
      toast.show(error?.message || '匯入失敗，請再試一次')
      return false
    } finally {
      importing.value = false
    }
  }

  return {
    now, loading, liveError, updatedAt,
    basis, archives, compareYear, archiveLoading, unfinishedPurge,
    current, previous, report, survey,
    importDraft, importSummary, importing, readImportFile, cancelImport, confirmImport
  }
}
