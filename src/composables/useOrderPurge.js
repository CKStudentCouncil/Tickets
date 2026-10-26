import { computed, onScopeDispose, ref, watch } from 'vue'
import { PURGE_CONFIRM_PHRASE } from 'src/config/app'
import { countAllOrders, createRequestId, fetchEveryOrder } from 'src/services/orderService'
import { fetchUnfinishedPurge, purgeOrders, subscribePurge } from 'src/services/archiveService'
import { backupFileName, buildOrderBackup } from 'src/utils/orderBackup'

// The call may have stopped while the server keeps purging (functions/lib/
// orderPurge.js): follow its progress rather than report a failure
const MAY_STILL_RUN = ['functions/deadline-exceeded', 'functions/unavailable', 'functions/internal']

async function downloadBackup(orders, exportedBy) {
  const [excelModule, saverModule] = await Promise.all([import('exceljs'), import('file-saver')])
  const ExcelJS = excelModule.default
  const saveAs = saverModule.saveAs || saverModule.default.saveAs || saverModule.default
  const exportedAt = new Date()
  const workbook = new ExcelJS.Workbook()
  workbook.created = exportedAt

  buildOrderBackup(orders, { exportedAt, exportedBy }).forEach(({ name, columns, rows }) => {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.columns = columns
    sheet.addRows(rows)
    sheet.getRow(1).font = { bold: true }
  })

  const buffer = await workbook.xlsx.writeBuffer()
  if (!buffer?.byteLength) throw new Error('empty workbook')
  saveAs(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    backupFileName(orders.length, exportedAt))
}

// 清除所有訂單 on /admin (super admins): this browser downloads the Excel
// backup of every order, then purgeOrders archives exactly those orders to
// salesArchives, deletes them with their stock release and writes
// systemLogs. Nothing is deleted unless the backup and the archive succeed.
export function useOrderPurge({ showToast, staffName }) {
  const open = ref(false)
  const phase = ref('confirm') // confirm | running | done | failed
  const typed = ref('')
  const orderCount = ref(null)
  const countError = ref('')
  // a run from an earlier visit that did not finish
  const unfinished = ref(null)
  const resuming = ref(false)
  const backup = ref({ status: 'pending', loaded: 0, message: '' })
  // orderPurges/{purgeId}, live
  const run = ref(null)
  const calling = ref(false)
  // the call ended without an outcome; the run's progress still arrives
  const waiting = ref(false)
  const error = ref('')
  const remaining = ref(null)
  let purgeId = null
  let unsubscribe = null

  const phraseMatches = computed(() => typed.value.trim() === PURGE_CONFIRM_PHRASE)
  // the dialog stays open while this browser is backing up or waiting for the call
  const busy = computed(() => calling.value || backup.value.status === 'running')

  const stages = computed(() => {
    const job = run.value
    const stage = job?.stage
    const total = job?.total || 0
    const failed = (key) => phase.value === 'failed' && job?.error?.stage === key
    const share = (n) => (total ? Math.min(1, n / total) : 0)

    return [
      {
        key: 'backup',
        label: '下載 Excel 完整備份',
        status: backup.value.status,
        detail: backup.value.message,
        progress: backup.value.status === 'running' && orderCount.value
          ? Math.min(1, backup.value.loaded / orderCount.value)
          : null
      },
      {
        key: 'archive',
        label: '封存到 Firestore（salesArchives）',
        status: !job ? 'pending' : stage !== 'archive' ? 'done' : failed('archive') ? 'failed' : 'running',
        detail: job ? `已封存 ${job.archivedCount || 0} / ${total} 筆` : '',
        progress: stage === 'archive' && !failed('archive') ? share(job.archiveCursor || 0) : null
      },
      {
        key: 'delete',
        label: '刪除訂單，退回庫存與購買額度',
        status: !job || stage === 'archive' ? 'pending' : stage === 'done' ? 'done' : failed('delete') ? 'failed' : 'running',
        detail: job && stage !== 'archive' ? `已刪除 ${job.deletedCount || 0} / ${total} 筆` : '',
        progress: stage === 'delete' && !failed('delete') ? share(job.deleteCursor || 0) : null
      },
      {
        key: 'log',
        label: '寫入系統紀錄',
        status: stage === 'done' ? 'done' : 'pending',
        detail: stage === 'done' ? `systemLogs/purge_${job.purgeId}` : '',
        progress: null
      }
    ]
  })

  function stopFollowing() {
    unsubscribe?.()
    unsubscribe = null
  }

  function follow(id) {
    stopFollowing()
    unsubscribe = subscribePurge(id, {
      onData: (job) => {
        if (!job) return
        run.value = job
        // while a call is open its outcome decides; otherwise the run does
        if (phase.value !== 'running' || calling.value) return
        if (job.stage === 'done') finish()
        else if (job.error) fail(job.error.message)
      },
      onError: (followError) => console.error('Purge progress error:', followError)
    })
  }

  // a toast as each server stage completes
  watch(() => run.value?.stage, (stage, before) => {
    if (!before || before === stage || phase.value !== 'running') return
    if (stage === 'delete') showToast(`已封存 ${run.value.archivedCount || 0} 筆訂單`)
    if (stage === 'done') showToast(`已刪除 ${run.value.deletedCount || 0} 筆訂單`)
  })

  async function refreshCount() {
    orderCount.value = null
    countError.value = ''
    try {
      orderCount.value = await countAllOrders()
    } catch (countFailure) {
      console.error(countFailure)
      countError.value = '無法取得目前的訂單數量'
    }
  }

  async function checkUnfinished() {
    try {
      unfinished.value = await fetchUnfinishedPurge()
    } catch (lookupError) {
      console.error('Unfinished purge lookup error:', lookupError)
    }
  }

  function reset() {
    stopFollowing()
    phase.value = 'confirm'
    typed.value = ''
    error.value = ''
    waiting.value = false
    remaining.value = null
    run.value = null
    backup.value = { status: 'pending', loaded: 0, message: '' }
  }

  function openPurge() {
    reset()
    resuming.value = false
    purgeId = null
    open.value = true
    refreshCount()
  }

  // continues the earlier run, with the order list it was started with
  function openResume() {
    if (!unfinished.value) return
    reset()
    resuming.value = true
    purgeId = unfinished.value.purgeId
    run.value = unfinished.value
    backup.value = { status: 'done', loaded: 0, message: '已在開始這次清除時下載' }
    open.value = true
    follow(purgeId)
  }

  function close() {
    if (busy.value) return
    open.value = false
    stopFollowing()
    // a run left behind shows up on the page to resume
    if (phase.value !== 'done' && run.value) checkUnfinished()
  }

  async function finish() {
    phase.value = 'done'
    error.value = ''
    waiting.value = false
    unfinished.value = null
    stopFollowing()
    try {
      // orders placed after the backup are not purged
      remaining.value = await countAllOrders()
    } catch {
      remaining.value = null
    }
  }

  function fail(message) {
    phase.value = 'failed'
    waiting.value = false
    error.value = message || '清除失敗，請重試'
    showToast(error.value)
  }

  async function callServer({ orderIds } = {}) {
    phase.value = 'running'
    error.value = ''
    waiting.value = false
    if (run.value) run.value = { ...run.value, error: null }
    follow(purgeId)
    calling.value = true
    try {
      const progress = await purgeOrders({ purgeId, confirm: typed.value.trim(), orderIds })
      calling.value = false
      run.value = { ...run.value, ...progress }
      // another call holds the run: follow() reports how it ends
      if (progress.running) waiting.value = true
      else await finish()
    } catch (callError) {
      calling.value = false
      if (MAY_STILL_RUN.includes(callError?.code)) {
        waiting.value = true
        error.value = '與伺服器的連線中斷，清除可能仍在進行，進度會自動更新；若停止不動，請按「繼續清除」'
        return
      }
      if (callError?.details?.stage) run.value = { ...run.value, ...callError.details }
      fail(callError?.message)
    }
  }

  async function start() {
    if (!phraseMatches.value || busy.value) return
    if (resuming.value) return callServer()

    // 1. the backup, in this browser; nothing is deleted if it fails
    purgeId = createRequestId()
    phase.value = 'running'
    error.value = ''
    backup.value = { status: 'running', loaded: 0, message: '讀取所有訂單中…' }
    let orders
    try {
      orders = await fetchEveryOrder({
        onProgress: (loaded) => { backup.value = { ...backup.value, loaded, message: `已讀取 ${loaded} 筆訂單…` } }
      })
      if (!orders.length) {
        reset()
        error.value = '目前沒有任何訂單，不需要清除'
        return
      }
      backup.value = { ...backup.value, message: `產生 ${orders.length} 筆訂單的 Excel…` }
      await downloadBackup(orders, staffName())
    } catch (backupError) {
      console.error('Purge backup error:', backupError)
      backup.value = { ...backup.value, status: 'failed', message: 'Excel 備份失敗' }
      fail('Excel 備份失敗，已停止清除，沒有刪除任何訂單；請重試')
      return
    }
    backup.value = { status: 'done', loaded: orders.length, message: `已下載 ${orders.length} 筆訂單的備份` }
    showToast('Excel 備份已下載')

    // 2–4. archive, delete and log on the server, for exactly these orders
    await callServer({ orderIds: orders.map((order) => order.id) })
  }

  // after a failure: a failed backup starts over, a stopped run resumes
  function retry() {
    if (busy.value) return
    if (run.value) {
      resuming.value = true
      callServer()
    } else {
      backup.value = { status: 'pending', loaded: 0, message: '' }
      phase.value = 'confirm'
      error.value = ''
    }
  }

  onScopeDispose(stopFollowing)

  return {
    PURGE_CONFIRM_PHRASE,
    open, phase, typed, phraseMatches, busy, orderCount, countError, unfinished, resuming,
    stages, run, waiting, error, remaining,
    checkUnfinished, openPurge, openResume, close, start, retry
  }
}
