import { onBeforeUnmount, ref } from 'vue'
import { joinScanLink, sendScan, watchScanLink } from 'src/services/scanLinkService'
import { isScanLinkExpired, isScanLinkId } from 'src/utils/scanLink'

// The phone side of 手機掃描、電腦處理 (/admin/scan): while paired with a
// computer's scan link, the tickets this phone reads are sent there instead
// of opened here. The pairing is kept for this browser tab, so a reload or
// a trip to another page stays paired. `getPhone()` gives { uid, name };
// `onEnded(message)` is called when the computer ends or the link expires.
const STORAGE_KEY = 'cksc.scanRemoteLink'
// what the computer asks for is dropped after this long, in case its tab
// closed without clearing it
const NEED_MAX_AGE_MS = 15 * 60 * 1000

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

function currentNeed(value) {
  if (!value?.orderId || (!value.qr && !value.card)) return null
  const at = value.at?.toDate?.()
  if (at && Date.now() - at.getTime() > NEED_MAX_AGE_MS) return null
  return { orderId: value.orderId, name: value.name || '', qr: value.qr === true, card: value.card === true, done: ['qr', 'card'].includes(value.done) ? value.done : '' }
}

// The link is gone or no longer takes scans (the rules deny the write)
export function isScanLinkClosed(error) {
  return error?.code === 'permission-denied' || error?.code === 'not-found'
}

export function useScanRemote({ getPhone, onEnded }) {
  // '' = not paired: this phone opens the orders it scans itself
  const linkId = ref('')
  const ownerName = ref('')
  // what the order open on the computer still needs:
  // { orderId, name, qr, card } (scanLinkService.js), or null
  const need = ref(null)

  let unwatch = null
  let pairSequence = 0

  function leave() {
    pairSequence++
    unwatch?.()
    unwatch = null
    linkId.value = ''
    ownerName.value = ''
    need.value = null
    saveLink('')
  }

  function watchLink(id) {
    unwatch?.()
    unwatch = watchScanLink(
      id,
      (link) => {
        if (id !== linkId.value) return
        if (!link) {
          leave()
          onEnded('電腦已結束連線，掃到的票券會在這支手機上開啟')
        } else if (isScanLinkExpired(link.createdAt)) {
          leave()
          onEnded('配對已過期，請在電腦上重新產生 QR Code 再掃一次')
        } else {
          ownerName.value = link.ownerName || ''
          need.value = currentNeed(link.need)
        }
      },
      (error) => console.error('Scan link listener failed', error)
    )
  }

  function use(id) {
    linkId.value = id
    ownerName.value = ''
    saveLink(id)
    watchLink(id)
  }

  // Throws when the link is gone or expired (isScanLinkClosed) or offline
  async function pair(id) {
    const sequence = ++pairSequence
    await joinScanLink(id, getPhone())
    if (sequence !== pairSequence) return false
    use(id)
    return true
  }

  // The pairing this tab had before a reload; dropped by the listener if the
  // computer has ended it meanwhile
  function restore() {
    const id = savedLink()
    if (isScanLinkId(id) && !linkId.value) use(id)
  }

  function send(ticket) {
    return sendScan(linkId.value, getPhone(), ticket)
  }

  // the pairing itself stays (sessionStorage); only the listener stops
  onBeforeUnmount(() => {
    unwatch?.()
    unwatch = null
  })

  return { linkId, ownerName, need, pair, restore, leave, send }
}
