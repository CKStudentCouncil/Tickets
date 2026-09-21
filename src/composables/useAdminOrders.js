import { ref, computed, watch } from 'vue'
import { saveAs } from 'file-saver'
import * as XLSX from 'xlsx'
import { schools } from 'src/data/catalog'
import { debounce } from 'src/utils/debounce'
import { useAuthStore } from 'src/stores/auth'
import {
  fetchAllOrders,
  updateOrderDelivery,
  updateOrderPayment,
  deleteOrderById,
  formatOrderDate,
  parseOrderDate
} from 'src/services/orderService'

export function useAdminOrders({ showToast, displayName }) {
  const authStore = useAuthStore()
  const orders = ref([])
  const deliveredOrders = ref([])
  const loading = ref(true)
  const activeTab = ref('all')
  const selectedSchool = ref('all')
  const customerSearchInput = ref('')
  const debouncedCustomerSearch = ref('')

  const applyDebouncedSearch = debounce((val) => {
    debouncedCustomerSearch.value = val.trim().toLowerCase()
  }, 300)

  watch(customerSearchInput, (val) => applyDebouncedSearch(val))

  function calculateStatistics(ordersList) {
    const counts = {}
    const costs = {}
    const combos = {}
    let revenue = 0
    let discountTotal = 0

    ordersList.forEach((order) => {
      discountTotal += Number(order.totalDiscount || 0)
      order.items.forEach((item) => {
        counts[item.name] = (counts[item.name] || 0) + item.quantity
        const subtotal = (Number(item.price) || 0) * (Number(item.quantity) || 0)
        costs[item.name] = (costs[item.name] || 0) + subtotal
        revenue += subtotal
      })
      ;(order.appliedCombos || []).forEach((combo) => {
        combos[combo.name] = (combos[combo.name] || 0) + combo.applicableCount
      })
    })

    return {
      productCounts: counts,
      productCosts: costs,
      comboCounts: combos,
      totalDiscount: discountTotal,
      totalRevenue: revenue - discountTotal
    }
  }

  function calculateDeliveryStats(ordersList) {
    const stats = {}
    ordersList
      .filter((o) => o.delivered)
      .forEach((order) => {
        if (order.deliveryUpdatedByName) {
          const updater = order.deliveryUpdatedByName
          if (!stats[updater]) stats[updater] = { count: 0, totalAmount: 0 }
          stats[updater].count += 1
          stats[updater].totalAmount += Number(order.finalTotal || 0)
        }
      })
    return stats
  }

  function filterOrdersBySchool(ordersList) {
    if (selectedSchool.value === 'all') return ordersList
    return ordersList.filter((order) => order.school === selectedSchool.value)
  }

  function matchesCustomerSearch(order) {
    const q = debouncedCustomerSearch.value
    if (!q) return true
    const name = (order.customerName || '').toLowerCase()
    const email = (order.customerEmail || '').toLowerCase()
    return name.includes(q) || email.includes(q)
  }

  const baseOrders = computed(() =>
    activeTab.value === 'delivered' ? deliveredOrders.value : orders.value
  )

  const currentOrders = computed(() =>
    filterOrdersBySchool(baseOrders.value).filter(matchesCustomerSearch)
  )

  const deliveredTabCount = computed(() => {
    const schoolFiltered = filterOrdersBySchool(deliveredOrders.value)
    return schoolFiltered.filter(matchesCustomerSearch).length
  })

  const currentStats = computed(() => calculateStatistics(currentOrders.value))

  function setActiveTab(tab) {
    activeTab.value = tab
  }

  async function fetchOrders() {
    try {
      loading.value = true
      const allOrders = await fetchAllOrders()
      orders.value = allOrders
      deliveredOrders.value = allOrders.filter((order) => order.delivered)
    } catch (err) {
      console.error(err)
      showToast('獲取訂單失敗')
    } finally {
      loading.value = false
    }
  }

  async function updateDeliveryStatus(orderId, delivered) {
    try {
      const patch = await updateOrderDelivery(orderId, delivered, {
        deliveryUpdatedBy: displayName.value,
        deliveryUpdatedByName: displayName.value || authStore.user?.email || '管理員'
      })

      orders.value = orders.value.map((order) =>
        order.id === orderId ? { ...order, ...patch } : order
      )
      deliveredOrders.value = orders.value.filter((o) => o.delivered)
      showToast(delivered ? '已標記為已交貨' : '已標記為未交貨')
    } catch (err) {
      showToast('更新失敗：' + err.message)
    }
  }

  async function updatePaymentStatus(orderId, paid) {
    try {
      const patch = await updateOrderPayment(orderId, paid, {
        paymentUpdatedBy: displayName.value,
        paymentUpdatedByName: displayName.value || authStore.user?.email || '管理員'
      })

      orders.value = orders.value.map((order) =>
        order.id === orderId ? { ...order, ...patch } : order
      )
      deliveredOrders.value = orders.value.filter((o) => o.delivered)
      showToast(paid ? '已標記為已付款' : '已標記為未付款')
    } catch (err) {
      showToast('更新失敗：' + err.message)
    }
  }

  async function deleteOrder(orderId) {
    await deleteOrderById(orderId)
    orders.value = orders.value.filter((o) => o.id !== orderId)
    deliveredOrders.value = deliveredOrders.value.filter((o) => o.id !== orderId)
    showToast('訂單已刪除')
  }

  function exportToExcel(onlyDelivered = false) {
    const base = onlyDelivered ? deliveredOrders.value : orders.value
    const exportOrders = filterOrdersBySchool(base).filter(matchesCustomerSearch)
    const exportStats = calculateStatistics(exportOrders)
    const summaryData = []

    // School and Class Summary
    const schoolClassCount = {}
    exportOrders.forEach((order) => {
      if (order.school && order.class) {
        const key = `${order.school} - ${order.class}`
        schoolClassCount[key] = (schoolClassCount[key] || 0) + 1
      }
    })

    Object.entries(exportStats.productCounts).forEach(([name, total]) => {
      summaryData.push({
        項目名稱: name,
        總數量: total,
        總金額: exportStats.productCosts[name] || 0,
        類型: '商品'
      })
    })

    Object.entries(exportStats.comboCounts).forEach(([comboName, count]) => {
      const comboInstances = exportOrders
        .flatMap((o) => o.appliedCombos || [])
        .filter((c) => c.name === comboName)
      const comboDiscountTotal = comboInstances.reduce(
        (sum, combo) => sum + (combo.totalDiscount || 0),
        0
      )
      summaryData.push({
        項目名稱: comboName,
        總數量: count,
        總金額: -comboDiscountTotal,
        類型: '套餐'
      })
    })

    summaryData.push({})
    summaryData.push({ 項目名稱: '折扣總額', 總數量: '-', 總金額: exportStats.totalDiscount })
    summaryData.push({ 項目名稱: '總營收', 總數量: '-', 總金額: exportStats.totalRevenue })

    if (onlyDelivered) {
      const filteredDeliveryStats = calculateDeliveryStats(exportOrders)
      if (Object.keys(filteredDeliveryStats).length > 0) {
        summaryData.push({})
        summaryData.push({ 項目名稱: '=== 交貨人員統計 ===', 總數量: '', 總金額: '' })
        Object.entries(filteredDeliveryStats).forEach(([updater, stats]) => {
          summaryData.push({
            項目名稱: `${updater} (交貨員)`,
            總數量: `${stats.count} 筆訂單`,
            總金額: `NT$ ${stats.totalAmount}`,
            類型: '交貨統計'
          })
        })
      }
    }

    const orderRows = []
    const merges = []
    let currentRow = 1

    exportOrders.forEach((order) => {
      const createdAt = formatOrderDate(order.createdAt)
      const deliveryTime = formatOrderDate(order.deliveryUpdatedAt)
      const startRow = currentRow
      const endRow = currentRow + order.items.length - 1

      if (order.items.length > 1) {
        Array.from({ length: 15 }, (_, i) => i).forEach((colIndex) => {
          merges.push({ s: { r: startRow, c: colIndex }, e: { r: endRow, c: colIndex } })
        })
      }

      order.items.forEach((item, itemIndex) => {
        orderRows.push({
          訂單ID: itemIndex === 0 ? order.id : '',
          建立時間: itemIndex === 0 ? createdAt : '',
          訂單原價: itemIndex === 0 ? order.originalTotal : '',
          組合包:
            itemIndex === 0
              ? order.appliedCombos?.map((c) => `${c.name} x ${c.applicableCount}`).join(', ') || ''
              : '',
          折扣金額: itemIndex === 0 ? order.totalDiscount : '',
          訂單總金額: itemIndex === 0 ? order.finalTotal : '',
          交貨狀態: itemIndex === 0 ? (order.delivered ? '已交貨' : '未交貨') : '',
          付款狀態: itemIndex === 0 ? (order.paid ? '已付款' : '未付款') : '',
          交貨更新時間: itemIndex === 0 ? deliveryTime : '',
          付款更新時間: itemIndex === 0 ? formatOrderDate(order.paymentUpdatedAt) : '',
          更新者: itemIndex === 0 ? order.deliveryUpdatedByName || '' : '',
          客戶姓名: itemIndex === 0 ? order.customerName || '' : '',
          電話: itemIndex === 0 ? order.customerPhone || '' : '',
          Email: itemIndex === 0 ? order.customerEmail || '' : '',
          學校: itemIndex === 0 ? order.school || '' : '',
          班級: itemIndex === 0 ? order.class || '' : '',
          座號: itemIndex === 0 ? order.number || '' : '',
          商品名稱: item.name,
          數量: item.quantity,
          單價: item.price,
          小計: (Number(item.price) || 0) * (Number(item.quantity) || 0)
        })
        currentRow++
      })
    })

    // Build school-class-item matrix
    const schoolData = {}
    const allItems = new Set()

    exportOrders.forEach((order) => {
      if (!order.school) return
      if (!schoolData[order.school]) {
        schoolData[order.school] = {}
      }
      const classKey = order.class || '(無班級)'
      if (!schoolData[order.school][classKey]) {
        schoolData[order.school][classKey] = {}
      }
      order.items.forEach((item) => {
        allItems.add(item.name)
        schoolData[order.school][classKey][item.name] = (schoolData[order.school][classKey][item.name] || 0) + item.quantity
      })
    })

    const productSheet = XLSX.utils.json_to_sheet(summaryData)
    const ordersSheet = XLSX.utils.json_to_sheet(orderRows)
    if (merges.length > 0) ordersSheet['!merges'] = merges

    const workbook = XLSX.utils.book_new()
    const schoolPrefix = selectedSchool.value !== 'all' ? `${selectedSchool.value}_` : ''
    const sheetPrefix = onlyDelivered ? '已交貨' : '全部'
    XLSX.utils.book_append_sheet(workbook, productSheet, `${sheetPrefix}商品統計`)
    XLSX.utils.book_append_sheet(workbook, ordersSheet, `${sheetPrefix}訂單明細`)

    // Add per-school sheets
    const sortedItems = Array.from(allItems).sort()
    if (sortedItems.length > 0) {
      Object.entries(schoolData).forEach(([schoolName, classData]) => {
        const schoolSheetData = []
        const sortedClasses = Object.keys(classData).sort()

        // Calculate totals
        const totals = { 班級: '合計' }
        sortedItems.forEach((item) => {
          totals[item] = 0
          sortedClasses.forEach((classKey) => {
            totals[item] += classData[classKey][item] || 0
          })
        })
        schoolSheetData.push(totals)

        sortedClasses.forEach((classKey) => {
          const row = { 班級: classKey }
          sortedItems.forEach((item) => {
            row[item] = classData[classKey][item] || 0
          })
          schoolSheetData.push(row)
        })

        const schoolSheet = XLSX.utils.json_to_sheet(schoolSheetData)
        const sanitizedSchoolName = schoolName.replace(/[\/\\?*:[\]]/g, '').slice(0, 31)
        XLSX.utils.book_append_sheet(workbook, schoolSheet, sanitizedSchoolName)
      })
    }

    const filename = `${schoolPrefix}${onlyDelivered ? '已交貨' : ''}訂單統計_${new Date().toISOString().slice(0, 10)}.xlsx`
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    saveAs(new Blob([excelBuffer], { type: 'application/octet-stream' }), filename)
    showToast('Excel 已匯出')
  }

  function formatDate(ts) {
    return formatOrderDate(ts)
  }

  return {
    schools,
    orders,
    loading,
    activeTab,
    selectedSchool,
    customerSearchInput,
    debouncedCustomerSearch,
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
    formatDate,
    parseOrderDate
  }
}
