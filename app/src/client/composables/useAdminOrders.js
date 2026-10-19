import { ref, computed, watch, onScopeDispose } from 'vue'
import { SCHOOLS } from 'src/data/schools'
import { formatDateTime } from 'src/utils/datetime'
import {
  fetchAllOrders,
  fetchOrderSearchPage,
  subscribeOrderPage,
  fetchOrderSummary,
  updateOrderPayment,
  deleteOrder as deleteOrderDoc
} from 'src/services/orderService'

function itemSubtotal(item) {
  return (Number(item.price) || 0) * (Number(item.quantity) || 0)
}

function calculateStatistics(ordersList) {
  const productCounts = {}
  const productCosts = {}
  let bookedAmount = 0
  let paidAmount = 0
  let ticketCount = 0

  ordersList.forEach((order) => {
    ;(order.items || []).forEach((item) => {
      productCounts[item.name] = (productCounts[item.name] || 0) + Number(item.quantity || 0)
      productCosts[item.name] = (productCosts[item.name] || 0) + itemSubtotal(item)
      ticketCount += Number(item.quantity || 0)
    })
    bookedAmount += Number(order.finalTotal || 0)
    if (order.paid) paidAmount += Number(order.finalTotal || 0)
  })

  return { productCounts, productCosts, bookedAmount, paidAmount, ticketCount }
}

function calculateDeliveryStats(ordersList) {
  const stats = {}

  ordersList
    .filter((order) => order.delivered && order.deliveryUpdatedByName)
    .forEach((order) => {
      const updater = order.deliveryUpdatedByName
      if (!stats[updater]) stats[updater] = { count: 0, totalAmount: 0 }
      stats[updater].count += 1
      stats[updater].totalAmount += Number(order.finalTotal || 0)
    })

  return stats
}

function appendJsonWorksheet(workbook, sheetName, rows, merges = []) {
  const worksheet = workbook.addWorksheet(sheetName)
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]

  if (headers.length > 0) {
    worksheet.columns = headers.map((header) => ({ header, key: header }))
    rows.forEach((row) => {
      worksheet.addRow(Object.fromEntries(headers.map((header) => [header, row[header] ?? ''])))
    })
  }

  // row/column indexes are 0-based over the data rows; +2 skips the header row
  merges.forEach(({ fromRow, toRow, column }) => {
    worksheet.mergeCells(fromRow + 2, column + 1, toRow + 2, column + 1)
  })

  return worksheet
}

function buildOrderRows(exportOrders) {
  const rows = []
  const merges = []

  exportOrders.forEach((order) => {
    const orderColumns = {
      訂單ID: order.id,
      建立時間: formatDateTime(order.createdAt),
      訂單總金額: order.finalTotal,
      領票狀態: order.delivered ? '已領票' : '未領票',
      付款狀態: order.paid ? '已付款' : '未付款',
      領票更新時間: formatDateTime(order.deliveryUpdatedAt),
      付款更新時間: formatDateTime(order.paymentUpdatedAt),
      更新者: order.deliveryUpdatedByName || '',
      客戶姓名: order.customerName || '',
      電話: order.customerPhone || '',
      Email: order.customerEmail || '',
      學校: order.school || '',
      班級: order.class || '',
      座號: order.number || '',
      辦公室: order.office || ''
    }
    const blankOrderColumns = Object.fromEntries(Object.keys(orderColumns).map((key) => [key, '']))
    const items = order.items || []
    const fromRow = rows.length

    items.forEach((item, index) => {
      rows.push({
        ...(index === 0 ? orderColumns : blankOrderColumns),
        票種名稱: item.name,
        數量: item.quantity,
        單價: item.price,
        小計: itemSubtotal(item)
      })
    })

    // one merged cell per order-level column when the order has several items
    if (items.length > 1) {
      Object.keys(orderColumns).forEach((_, column) => {
        merges.push({ fromRow, toRow: rows.length - 1, column })
      })
    }
  })

  return { rows, merges }
}

function buildSchoolSheets(exportOrders) {
  const schoolData = {}
  const allItems = new Set()

  exportOrders.forEach((order) => {
    if (!order.school) return
    const classKey = order.class || '(無班級)'
    schoolData[order.school] ??= {}
    schoolData[order.school][classKey] ??= {}

    ;(order.items || []).forEach((item) => {
      allItems.add(item.name)
      const classData = schoolData[order.school][classKey]
      classData[item.name] = (classData[item.name] || 0) + Number(item.quantity || 0)
    })
  })

  const sortedItems = [...allItems].sort()
  if (!sortedItems.length) return []

  return Object.entries(schoolData).map(([schoolName, classData]) => {
    const sortedClasses = Object.keys(classData).sort()
    const totals = { 班級: '合計' }

    sortedItems.forEach((item) => {
      totals[item] = sortedClasses.reduce((sum, classKey) => sum + (classData[classKey][item] || 0), 0)
    })

    const rows = sortedClasses.map((classKey) => ({
      班級: classKey,
      ...Object.fromEntries(sortedItems.map((item) => [item, classData[classKey][item] || 0]))
    }))

    return {
      // Excel sheet names: max 31 chars, no []:*?/\
      name: schoolName.replace(/[/\\?*:[\]]/g, '').slice(0, 31),
      rows: [totals, ...rows]
    }
  })
}

export function useAdminOrders({ showToast }) {
  const orders = ref([])
  const loading = ref(true)
  const loadError = ref('')
  const fromCache = ref(false)
  const activeTab = ref('all')
  const selectedSchool = ref('all')
  const customerSearchInput = ref('')
  const emailFilter = ref('all')
  const debouncedCustomerSearch = ref('')
  const pageNumber = ref(1)
  const hasNext = ref(false)
  const pendingPaymentIds = ref(new Set())
  const exporting = ref(false)
  const summary = ref(null)
  const summaryError = ref('')
  const summaryLoading = ref(false)
  const summaryUpdatedAt = ref(null)
  let unsubscribe = null
  let displayedQueryKey = ''
  let pageCursor = null
  let cursors = [null]
  let started = false
  let pageSequence = 0
  let summarySequence = 0
  let summaryFilterKey = ''
  let summaryTimer
  let searchTimer
  let searchController = null

  const filters = computed(() => ({
    school: selectedSchool.value,
    emailStatus: emailFilter.value,
    ...(activeTab.value === 'delivered' ? { delivered: true } : {})
  }))

  watch(customerSearchInput, (val) => {
    clearTimeout(searchTimer)
    // Clearing search immediately returns to the live list.
    if (!val.trim()) debouncedCustomerSearch.value = ''
    else searchTimer = setTimeout(() => {
      debouncedCustomerSearch.value = val.normalize('NFKC').trim().toLowerCase()
    }, 400)
  })
  const isSearching = computed(() => Boolean(debouncedCustomerSearch.value))
  const currentOrders = computed(() => orders.value)
  const currentStats = computed(() => calculateStatistics(currentOrders.value))

  async function refreshSummary() {
    const sequence = ++summarySequence
    summaryLoading.value = true
    summaryError.value = ''
    try {
      const result = await fetchOrderSummary(filters.value)
      if (sequence === summarySequence) {
        summary.value = result
        summaryUpdatedAt.value = new Date()
      }
    } catch (error) {
      if (sequence === summarySequence) {
        summaryError.value = '總覽載入失敗，請重試。'
        console.error(error)
      }
    } finally {
      if (sequence === summarySequence) summaryLoading.value = false
    }
  }

  function scheduleSummary() {
    clearTimeout(summaryTimer)
    summaryTimer = setTimeout(refreshSummary, 400)
  }

  function fetchOrders({ reset = false } = {}) {
    started = true
    const filterKey = JSON.stringify(filters.value)
    const summaryFiltersChanged = summaryFilterKey !== filterKey
    if (summaryFiltersChanged) {
      summaryFilterKey = filterKey
      summary.value = null
      summaryUpdatedAt.value = null
      ++summarySequence
      clearTimeout(summaryTimer)
    }
    if (reset) {
      pageNumber.value = 1
      cursors = [null]
    }
    unsubscribe?.()
    unsubscribe = null
    searchController?.abort()
    searchController = null
    const sequence = ++pageSequence
    const queryKey = JSON.stringify({
      filters: filters.value, search: debouncedCustomerSearch.value, page: pageNumber.value
    })
    if (displayedQueryKey && displayedQueryKey !== queryKey) orders.value = []
    loading.value = true
    loadError.value = ''
    hasNext.value = false
    if (isSearching.value) {
      const controller = new AbortController()
      searchController = controller
      fromCache.value = false
      fetchOrderSearchPage({
        filters: filters.value,
        searchText: debouncedCustomerSearch.value,
        cursor: cursors[pageNumber.value - 1],
        signal: controller.signal
      }).then((result) => {
        if (sequence !== pageSequence) return
        orders.value = result.orders
        displayedQueryKey = queryKey
        pageCursor = result.cursor
        hasNext.value = result.hasNext
      }).catch((error) => {
        if (sequence !== pageSequence || controller.signal.aborted) return
        loadError.value = '訂單搜尋失敗，請重試。'
        console.error(error)
      }).finally(() => {
        if (sequence === pageSequence) loading.value = false
      })
      if (summaryFiltersChanged) refreshSummary()
      return
    }
    unsubscribe = subscribeOrderPage({
      filters: filters.value,
      cursor: cursors[pageNumber.value - 1],
      onData: (result) => {
        if (sequence !== pageSequence) return
        if (!result.fromCache || result.orders.length || displayedQueryKey !== queryKey) {
          orders.value = result.orders
          displayedQueryKey = queryKey
        }
        pageCursor = result.cursor
        hasNext.value = result.hasNext
        fromCache.value = result.fromCache
        loading.value = false
        loadError.value = ''
        if (!result.fromCache) scheduleSummary()
      },
      onError: (error) => {
        if (sequence !== pageSequence) return
        loading.value = false
        loadError.value = '訂單載入失敗，請重試。'
        console.error(error)
      }
    })
    refreshSummary()
  }

  watch([filters, debouncedCustomerSearch], () => { if (started) fetchOrders({ reset: true }) })
  onScopeDispose(() => {
    unsubscribe?.()
    searchController?.abort()
    clearTimeout(searchTimer)
    clearTimeout(summaryTimer)
    ++pageSequence
    ++summarySequence
  })

  function nextPage() {
    if (loading.value || !hasNext.value || !pageCursor) return
    cursors[pageNumber.value] = pageCursor
    pageNumber.value += 1
    fetchOrders()
  }

  function previousPage() {
    if (loading.value || pageNumber.value === 1) return
    pageNumber.value -= 1
    fetchOrders()
  }

  function patchOrder(orderId, patch) {
    orders.value = orders.value.map((order) => order.id === orderId ? { ...order, ...patch } : order)
  }

  async function updatePaymentStatus(orderId, paid) {
    const order = orders.value.find((item) => item.id === orderId)
    if (!order || pendingPaymentIds.value.has(orderId) || Boolean(order.paid) === paid) return
    if (!window.confirm(`確定將訂單 ${orderId} 標記為${paid ? '已付款' : '未付款'}嗎？`)) return
    pendingPaymentIds.value = new Set([...pendingPaymentIds.value, orderId])
    try {
      patchOrder(orderId, await updateOrderPayment(orderId, paid, Boolean(order.paid)))
      showToast(paid ? '已標記為已付款' : '已標記為未付款')
      refreshSummary()
    } catch (error) {
      if (typeof error?.details?.paid === 'boolean') patchOrder(orderId, error.details)
      showToast(error?.message || '付款狀態更新失敗，請重試。')
    } finally {
      pendingPaymentIds.value = new Set([...pendingPaymentIds.value].filter((id) => id !== orderId))
    }
  }

  async function deleteOrder(orderId) {
    await deleteOrderDoc(orderId)
    orders.value = orders.value.filter((order) => order.id !== orderId)
    refreshSummary()
    showToast('訂單已刪除')
  }

  async function exportToExcel() {
    if (exporting.value) return
    exporting.value = true
    // Freeze filters before awaiting imports/reads. The export and dashboard
    // summary cover these filters; the search keyword only narrows the list.
    const exportFilters = { ...filters.value }
    const onlyDelivered = exportFilters.delivered === true
    try {
      const [exportOrders, excelModule, saverModule] = await Promise.all([
        fetchAllOrders(exportFilters), import('exceljs'), import('file-saver')
      ])
      const ExcelJS = excelModule.default
      const saveAs = saverModule.saveAs || saverModule.default.saveAs || saverModule.default
      const stats = calculateStatistics(exportOrders)
      const summaryRows = Object.entries(stats.productCounts).map(([name, total]) => ({
        項目名稱: name, 總數量: total, 訂單金額: stats.productCosts[name] || 0
      }))
      summaryRows.push({},
        { 項目名稱: '訂單應收金額', 訂單金額: stats.bookedAmount },
        { 項目名稱: '已收款金額', 訂單金額: stats.paidAmount })
      const deliveryStats = onlyDelivered ? calculateDeliveryStats(exportOrders) : {}
      if (Object.keys(deliveryStats).length) {
        summaryRows.push({}, { 項目名稱: '領票人員統計' })
        Object.entries(deliveryStats).forEach(([updater, { count, totalAmount }]) => {
          summaryRows.push({ 項目名稱: updater, 總數量: `${count} 筆訂單`, 訂單金額: totalAmount })
        })
      }
      const sheetPrefix = onlyDelivered ? '已領票' : '全部'
      const { rows, merges } = buildOrderRows(exportOrders)
      const workbook = new ExcelJS.Workbook()
      appendJsonWorksheet(workbook, `${sheetPrefix}票券統計`, summaryRows)
      appendJsonWorksheet(workbook, `${sheetPrefix}訂單明細`, rows, merges)
      buildSchoolSheets(exportOrders).forEach(({ name, rows: schoolRows }) => {
        appendJsonWorksheet(workbook, name, schoolRows)
      })
      const schoolPrefix = exportFilters.school !== 'all' ? `${exportFilters.school}_` : ''
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date())
      const filename = `${schoolPrefix}${onlyDelivered ? '已領票' : ''}訂單統計_${date}.xlsx`
      const excelBuffer = await workbook.xlsx.writeBuffer()
      saveAs(new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename)
      showToast('Excel 已匯出')
    } catch (error) {
      console.error(error)
      showToast('匯出失敗，請重試。')
    } finally {
      exporting.value = false
    }
  }

  return {
    schools: SCHOOLS, orders, loading, loadError, fromCache, activeTab,
    selectedSchool, customerSearchInput, searchQuery: debouncedCustomerSearch,
    isSearching, emailFilter, patchOrder, currentOrders,
    currentStats, summary, summaryError, summaryLoading, summaryUpdatedAt, pageNumber, hasNext,
    pendingPaymentIds, exporting, nextPage, previousPage, refreshSummary,
    setActiveTab: (tab) => { activeTab.value = tab }, fetchOrders,
    updatePaymentStatus, deleteOrder, exportToExcel, calculateDeliveryStats,
    formatDate: formatDateTime
  }
}
