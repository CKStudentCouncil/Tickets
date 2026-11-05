// 手機掃描、電腦處理: a computer at the check-in desk (/admin/scan/desk)
// shows its scan link as a pairing QR code. A phone that scans it on
// /admin/scan sends the tickets it reads to that computer, which opens them.
// See src/services/scanLinkService.js and scanLinks in firestore.rules.

// A Firestore auto id (doc(collection(...)).id): random, so only someone who
// saw the pairing QR code knows it
export const SCAN_LINK_ID_PATTERN = /^[A-Za-z0-9]{20}$/

// Links stop taking scans this long after they were made; keep in sync with
// scanLinks in firestore.rules
export const SCAN_LINK_HOURS = 12

const SCAN_PATH = '/admin/scan'

export function isScanLinkId(value) {
  return typeof value === 'string' && SCAN_LINK_ID_PATTERN.test(value)
}

// What the pairing QR code holds. Scanned with the phone's camera app it
// opens /admin/scan already paired, so `origin` is the site the computer is on.
export function getScanLinkUrl(linkId, origin) {
  return `${origin}${SCAN_PATH}?link=${encodeURIComponent(linkId)}`
}

// Reads a scanned pairing QR code back into its link id; null for anything
// else (ticket QR codes included). Only links to one of `origins` count.
export function parseScanLinkQr(text, origins) {
  let url
  try {
    url = new URL(String(text || '').trim())
  } catch {
    return null
  }
  if (!origins.includes(url.origin)) return null
  if (url.pathname.replace(/\/$/, '') !== SCAN_PATH) return null

  const linkId = url.searchParams.get('link') || ''
  return isScanLinkId(linkId) ? linkId : null
}

// `createdAt` is a Date (or a Firestore Timestamp); a link still being
// created (no time yet) is not expired
export function isScanLinkExpired(createdAt, now = new Date()) {
  const created = typeof createdAt?.toDate === 'function' ? createdAt.toDate() : createdAt
  if (!(created instanceof Date) || Number.isNaN(created.getTime())) return false
  return now.getTime() >= created.getTime() + SCAN_LINK_HOURS * 60 * 60 * 1000
}

// The scanner reads the QR code in view several times a second. A code
// counts as a new scan only after it has been out of view for `gapMs`, so a
// ticket held up is sent once, and shown again a moment later it is sent
// again.
export function createRepeatFilter(gapMs, now = () => Date.now()) {
  let lastText = ''
  let lastSeen = -Infinity

  return {
    isNew(text) {
      const time = now()
      const repeated = text === lastText && time - lastSeen < gapMs
      lastText = text
      lastSeen = time
      return !repeated
    }
  }
}
