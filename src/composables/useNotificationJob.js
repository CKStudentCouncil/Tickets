import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { httpsCallable } from 'firebase/functions'
import { functions } from 'src/boot/firebase'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { shouldPollNotification } from 'src/utils/notificationProgress'

const prepareOrderNotification = httpsCallable(functions, 'prepareOrderNotification')
const sendOrderNotification = httpsCallable(functions, 'sendOrderNotification')
const getOrderNotificationStatus = httpsCallable(functions, 'getOrderNotificationStatus')

// A bulk email to buyers (functions/lib/notifications.js): prepare saves the
// recipients as a job, runNotificationJob puts it in the mail queue, and
// progress is polled until the queue is done.
//
// Progress is remembered per staff account and per `key`, so each page keeps
// its own job. Delivery continues on the server after the page closes, and
// reopening only polls the existing job.
export function useNotificationJob(key = '') {
  const auth = useAuthStore()
  const toast = useToastStore()
  const storageKey = `cksc_notification_job_${key ? `${key}_` : ''}${auth.user?.uid || 'anonymous'}`

  function loadPendingJob() {
    try {
      const job = JSON.parse(localStorage.getItem(storageKey) || 'null')
      return job?.jobId ? job : null
    } catch {
      return null
    }
  }

  const sending = ref(false)
  const pendingJob = ref(loadPendingJob())
  const notificationError = ref('')
  let pollTimer
  let disposed = false
  let polling = false

  // SES acceptance does not establish inbox delivery.
  const notificationProgress = computed(() => {
    const job = pendingJob.value
    if (!job) return ''
    const labels = {
      ready: '尚未加入寄送佇列', queued: '已排入佇列', sending: '寄送中',
      partial: '寄送中', done: '處理完成', failed: '部分寄送失敗', uncertain: '部分寄送結果待查'
    }
    let text = `${labels[job.status] || '等待確認'}：郵件服務已接受 ${job.acceptedCount ?? job.sentCount ?? 0} / ${job.total || 0} 封`
    if (job.pendingCount) text += `，待處理 ${job.pendingCount} 封`
    if (job.pendingEnqueueCount) text += `，尚有 ${job.pendingEnqueueCount} 位收件者未加入佇列，請按「繼續加入寄送佇列」`
    if (job.failedCount) text += `，失敗 ${job.failedCount} 封`
    if (job.uncertainCount) text += `，結果待查 ${job.uncertainCount} 封，請先查核寄送紀錄再決定是否補寄`
    return text
  })

  function schedulePoll() {
    clearTimeout(pollTimer)
    if (!disposed && shouldPollNotification(pendingJob.value)) {
      pollTimer = setTimeout(pollNotificationStatus, 5000)
    }
  }

  async function pollNotificationStatus() {
    const jobId = pendingJob.value?.jobId
    if (!jobId || polling || disposed) return
    polling = true
    notificationError.value = ''
    try {
      const result = (await getOrderNotificationStatus({ jobId })).data
      if (!disposed && pendingJob.value?.jobId === jobId) setPendingJob(result)
    } catch (error) {
      if (!disposed) notificationError.value = error?.message || '寄送進度載入失敗，請重試。'
    } finally {
      polling = false
      schedulePoll()
    }
  }

  onMounted(() => { if (pendingJob.value) pollNotificationStatus() })
  onBeforeUnmount(() => {
    disposed = true
    clearTimeout(pollTimer)
  })

  function setPendingJob(job) {
    const previous = pendingJob.value?.jobId === job?.jobId ? pendingJob.value : null
    pendingJob.value = job ? {
      jobId: job.jobId, status: job.status, sentCount: job.sentCount,
      acceptedCount: job.acceptedCount, total: job.total, failedCount: job.failedCount,
      uncertainCount: job.uncertainCount, pendingCount: job.pendingCount,
      pendingEnqueueCount: job.pendingEnqueueCount,
      enqueueUnconfirmed: job.enqueueUnconfirmed ?? previous?.enqueueUnconfirmed ?? false
    } : null
    if (!job) clearTimeout(pollTimer)

    try {
      if (job) localStorage.setItem(storageKey, JSON.stringify(pendingJob.value))
      else localStorage.removeItem(storageKey)
    } catch {
      // storage unavailable (private mode); the job still resumes this session
    }
  }

  // The server saves the recipient list as a job; nothing is sent yet.
  // Returns { jobId, total, ... }, total 0 when nobody needs the email.
  async function prepareNotification(payload) {
    sending.value = true
    try {
      return (await prepareOrderNotification(payload)).data
    } finally {
      sending.value = false
    }
  }

  // One short, idempotent call enqueues the saved recipient job. Progress is
  // polled separately and delivery continues when this page is closed.
  async function runNotificationJob(job) {
    if (sending.value) return
    setPendingJob({ ...job, enqueueUnconfirmed: true })
    sending.value = true
    notificationError.value = ''
    try {
      const result = (await sendOrderNotification({ jobId: job.jobId })).data
      setPendingJob({ ...result, enqueueUnconfirmed: false })
      toast.show('通知已加入寄送佇列，可稍後查看進度。')
      schedulePoll()
    } catch (error) {
      console.error('Queue notification error:', error)
      notificationError.value = error?.message || '佇列狀態尚未確認，請檢查進度後再試。'
      // A lost acknowledgement must not start a second recipient job.
      await pollNotificationStatus()
    } finally {
      sending.value = false
    }
  }

  return {
    sending,
    pendingJob,
    notificationError,
    notificationProgress,
    pollNotificationStatus,
    setPendingJob,
    prepareNotification,
    runNotificationJob
  }
}
