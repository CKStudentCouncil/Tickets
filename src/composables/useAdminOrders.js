import { ref, computed, watch } from 'vue'
import { saveAs } from 'file-saver'
import ExcelJS from 'exceljs'
import { SCHOOLS } from 'src/data/schools'
import { debounce } from 'src/utils/debounce'
import { formatDateTime } from 'src/utils/datetime'
import { useAuthStore } from 'src/stores/auth'
import {
  fetchAllOrders,
  updateOrderDelivery,
  updateOrderPayment,
  deleteOrder as deleteOrderDoc
} from 'src/services/orderService'

function itemSubtotal(item) {
  return (Number(item.price) || 0) * (Number(item.quantity) || 0)
}

function calculateStatistics(ordersList) {
  const productCounts = {}
  const productCosts = {}
  let totalRevenue = 0

  ordersList.forEach((order) => {
    ;(order.items || []).forEach((item) => {
      productCounts[item.name] = (productCounts[item.name] || 0) + Number(item.quantity || 0)
      productCosts[item.name] = (productCosts[item.name] || 0) + itemSubtotal(item)
    })
    totalRevenue += Number(order.finalTotal || 0)
  })

  return { productCounts, productCosts, totalRevenue }
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
  const authStore = useAuthStore()
  const orders = ref([])
  const loading = ref(true)
  const activeTab = ref('all')
  const selectedSchool = ref('all')
  const customerSearchInput = ref('')
  const debouncedCustomerSearch = ref('')

  const applyDebouncedSearch = debounce((val) => {
    debouncedCustomerSearch.value = val.trim().toLowerCase()
  }, 300)

  watch(customerSearchInput, (val) => applyDebouncedSearch(val))

  const deliveredOrders = computed(() => orders.value.filter((order) => order.delivered))

  function filterOrders(ordersList) {
    const q = debouncedCustomerSearch.value

    return ordersList.filter((order) => {
      if (selectedSchool.value !== 'all' && order.school !== selectedSchool.value) return false
      if (!q) return true
      return (
        (order.customerName || '').toLowerCase().includes(q) ||
        (order.customerEmail || '').toLowerCase().includes(q) ||
        (order.customerPhone || '').includes(q)
      )
    })
  }

  const currentOrders = computed(() =>
    filterOrders(activeTab.value === 'delivered' ? deliveredOrders.value : orders.value)
  )

  const deliveredTabCount = computed(() => filterOrders(deliveredOrders.value).length)

  const currentStats = computed(() => calculateStatistics(currentOrders.value))

  function setActiveTab(tab) {
    activeTab.value = tab
  }

  function patchOrder(orderId, patch) {
    orders.value = orders.value.map((order) =>
      order.id === orderId ? { ...order, ...patch } : order
    )
  }

  async function fetchOrders() {
    try {
      loading.value = true
      orders.value = await fetchAllOrders()
    } catch (err) {
      console.error(err)
      showToast('獲取訂單失敗')
    } finally {
      loading.value = false
    }
  }

  async function updateDeliveryStatus(orderId, delivered) {
    try {
      patchOrder(orderId, await updateOrderDelivery(orderId, delivered, authStore.displayName))
      showToast(delivered ? '已標記為已領票' : '已標記為未領票')
    } catch (err) {
      showToast('更新失敗：' + err.message)
    }
  }

  async function updatePaymentStatus(orderId, paid) {
    try {
      patchOrder(orderId, await updateOrderPayment(orderId, paid, authStore.displayName))
      showToast(paid ? '已標記為已付款' : '已標記為未付款')
    } catch (err) {
      showToast('更新失敗：' + err.message)
    }
  }

  async function deleteOrder(orderId) {
    await deleteOrderDoc(orderId)
    orders.value = orders.value.filter((order) => order.id !== orderId)
    showToast('訂單已刪除')
  }

  async function exportToExcel(onlyDelivered = false) {
    const exportOrders = filterOrders(onlyDelivered ? deliveredOrders.value : orders.value)
    const stats = calculateStatistics(exportOrders)

    const summaryRows = Object.entries(stats.productCounts).map(([name, total]) => ({
      項目名稱: name,
      總數量: total,
      總金額: stats.productCosts[name] || 0
    }))

    summaryRows.push({}, { 項目名稱: '總營收', 總數量: '-', 總金額: stats.totalRevenue })

    const deliveryStats = onlyDelivered ? calculateDeliveryStats(exportOrders) : {}
    if (Object.keys(deliveryStats).length > 0) {
      summaryRows.push({}, { 項目名稱: '=== 領票人員統計 ===' })
      Object.entries(deliveryStats).forEach(([updater, { count, totalAmount }]) => {
        summaryRows.push({
          項目名稱: `${updater} (工作人員)`,
          總數量: `${count} 筆訂單`,
          總金額: `NT$ ${totalAmount}`
        })
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

    const schoolPrefix = selectedSchool.value !== 'all' ? `${selectedSchool.value}_` : ''
    const filename = `${schoolPrefix}${onlyDelivered ? '已領票' : ''}訂單統計_${new Date().toISOString().slice(0, 10)}.xlsx`
    const excelBuffer = await workbook.xlsx.writeBuffer()

    saveAs(
      new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }),
      filename
    )
    showToast('Excel 已匯出')
  }

  return {
    schools: SCHOOLS,
    orders,
    loading,
    activeTab,
    selectedSchool,
    customerSearchInput,
    currentOrders,
    deliveredTabCount,
    currentStats,
    setActiveTab,
    fetchOrders,
    updateDeliveryStatus,
    updatePaymentStatus,
    deleteOrder,
    exportToExcel,
    calculateDeliveryStats,
    formatDate: formatDateTime
  }
}
