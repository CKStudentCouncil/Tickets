import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useAuthStore } from 'src/stores/auth'
import { useToastStore } from 'src/stores/toast'
import { createScanLink, deleteScanLink, setScanLinkNeed, watchScanLink } from 'src/services/scanLinkService'
import { isScanLinkExpired, isScanLinkId } from 'src/utils/scanLink'

// The computer side of 手機掃描、電腦處理 (/admin/scan/desk). A store, so the
// link keeps listening while staff look at other admin pages. Scans go to the
// desk page's check-in station (PickupStation.vue), which never leaves the
// page: the phone only scans, the computer shows what is still missing. The
// link is kept for this browser tab: a reload stays paired, and two tabs
// never both receive the same scan.
const STORAGE_KEY = 'cksc.scanDeskLink'
const RECENT_LIMIT = 20
// An order page is left for the desk when a ticket arrives. Anywhere else the
// computer only says so, so a scan never interrupts other admin work.
const DESK_ROUTE = 'admin-scan-desk'
const FOLLOW_ROUTES = ['admin-order-detail']

function savedLink() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function saveLink(linkId) {
  try {
    if (linkId) sessionStorage.setItem(STORAGE_KEY, linkId)
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export const useScanDeskStore = defineStore('scanDesk', () => {
  const auth = useAuthStore()
  const toast = useToastStore()

  const linkId = ref('')
  // the link document as last seen: ownerUid, ownerName, createdAt, phone, scan
  const link = ref(null)
  // idle | starting | ready | error (creating or listening failed)
  const status = ref('idle')
  // tickets received in this tab, newest first
  const recent = ref([])
  // what the desk's station still needs, as told to the phones:
  // { orderId, name, qr, card } or null
  const need = ref(null)
  // scans for the desk page to take (it may still be opening)
  const incoming = ref([])

  const active = computed(() => !!linkId.value)

  let router = null
  let unwatch = null
  // the scan already in the link when listening started; undefined until
  // the first snapshot, so a scan made before is never opened
  let lastScanId
  let startSequence = 0

  function stop() {
    startSequence++
    unwatch?.()
    unwatch = null
    linkId.value = ''
    link.value = null
    status.value = 'idle'
    recent.value = []
    need.value = null
    incoming.value = []
    saveLink('')
  }

  // The station says what it still needs (null: nothing, or it closed)
  function setNeed(value) {
    const next = value && (value.qr || value.card)
      ? { orderId: value.orderId, name: value.name || '', qr: !!value.qr, card: !!value.card }
      : null
    if (JSON.stringify(next) === JSON.stringify(need.value)) return
    need.value = next
    const id = linkId.value
    if (id) setScanLinkNeed(id, next).catch((error) => console.error('Failed to tell the phone what is needed', error))
  }

  // hands a scan to the desk page, opening it from an order page
  function open(entry) {
    incoming.value = [...incoming.value, entry]
    const name = router?.currentRoute.value.name
    if (router && name !== DESK_ROUTE) router.push({ name: DESK_ROUTE })
  }

  function receive(scan, phone) {
    const entry = {
      id: scan.id,
      orderId: scan.orderId,
      ticketCode: scan.ticketCode || '',
      studentId: scan.studentId || '',
      at: scan.at?.toDate?.() || new Date(),
      byName: phone?.name || ''
    }
    recent.value = [entry, ...recent.value.filter((item) => item.id !== entry.id)].slice(0, RECENT_LIMIT)

    const name = router?.currentRoute.value.name
    if (name === DESK_ROUTE || FOLLOW_ROUTES.includes(name)) open(entry)
    else toast.show(`手機傳來訂單 ${entry.orderId}；到「電腦接收」領票`, 5000)
  }

  function listen(id) {
    unwatch?.()
    lastScanId = undefined
    unwatch = watchScanLink(
      id,
      (data) => {
        if (id !== linkId.value) return
        // deleted from elsewhere (another tab, a super admin), or this tab
        // now belongs to someone else
        if (!data || (data.ownerUid && data.ownerUid !== auth.user?.uid)) {
          stop()
          return
        }
        link.value = data
        status.value = 'ready'

        const scanId = data.scan?.id || ''
        if (lastScanId === undefined) {
          lastScanId = scanId
          return
        }
        if (!scanId || scanId === lastScanId) return
        lastScanId = scanId
        receive(data.scan, data.phone)
      },
      (error) => {
        if (id !== linkId.value) return
        console.error('Scan link listener failed', error)
        status.value = 'error'
      }
    )
  }

  function use(id) {
    linkId.value = id
    link.value = null
    status.value = 'starting'
    saveLink(id)
    listen(id)
  }

  // Picks the listening back up after a reload (MainLayout.vue)
  function resume(routerInstance) {
    router = routerInstance
    if (linkId.value) return
    const saved = savedLink()
    if (isScanLinkId(saved)) use(saved)
  }

  async function create() {
    const sequence = ++startSequence
    status.value = 'starting'
    try {
      const id = await createScanLink({ uid: auth.user.uid, name: auth.displayName })
      if (sequence !== startSequence) {
        deleteScanLink(id).catch(() => {})
        return
      }
      recent.value = []
      use(id)
    } catch (error) {
      if (sequence !== startSequence) return
      console.error('Failed to create scan link', error)
      status.value = 'error'
    }
  }

  // The desk page: keep this tab's link, or make one
  async function start(routerInstance) {
    resume(routerInstance)
    if (!linkId.value && status.value !== 'starting') await create()
  }

  // Ends the pairing; phones paired with it go back to opening orders themselves
  async function end() {
    const id = linkId.value
    stop()
    if (id) await deleteScanLink(id).catch((error) => console.error('Failed to delete scan link', error))
  }

  // A new pairing QR code (the old one expired, or was seen by someone else)
  async function renew() {
    await end()
    await create()
  }

  // Listening failed (e.g. the network dropped for long): listen again, or
  // make a new link when this one could not be made
  function retry() {
    if (linkId.value) {
      status.value = 'starting'
      listen(linkId.value)
    } else {
      create()
    }
  }

  const expired = (now = new Date()) => isScanLinkExpired(link.value?.createdAt, now)

  // signed out, or another account signed in on this tab
  watch(
    () => auth.user?.uid,
    (uid) => {
      if (linkId.value && (!uid || (link.value && link.value.ownerUid !== uid))) stop()
    }
  )

  // the desk page takes the scans waiting for it, oldest first
  const takeIncoming = () => {
    const entries = incoming.value
    incoming.value = []
    return entries
  }

  return { linkId, link, status, recent, active, need, incoming, takeIncoming, start, resume, end, renew, retry, open, setNeed, expired }
})
