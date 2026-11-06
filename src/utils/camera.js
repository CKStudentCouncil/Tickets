// One camera stream shared by the check-in pages (/admin/scan and the order
// page's scanner). Going from one page to the other keeps it open, so the
// camera is there at once and browsers that ask for permission every time it
// opens (Firefox) ask only once. It closes a short while after the last page
// lets it go.
const KEEP_OPEN_MS = 20000

let current = null // { stream, deviceId }
let users = 0
let closeTimer = 0
let opening = null

const live = (stream) => stream?.getVideoTracks().some((track) => track.readyState === 'live')

function closeNow() {
  clearTimeout(closeTimer)
  current?.stream.getTracks().forEach((track) => track.stop())
  current = null
}

async function open(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('getUserMedia unavailable'), { name: 'NotSupportedError' })
  }
  // A high resolution keeps a QR code or a card held far enough away to be
  // in focus readable; the browser picks the closest size the camera offers
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  })
  const [track] = stream.getVideoTracks()
  // Chrome on Android can be asked to keep refocusing; Safari focuses itself
  if (track?.getCapabilities?.().focusMode?.includes('continuous')) {
    track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {})
  }
  return { stream, deviceId: track?.getSettings?.().deviceId || deviceId }
}

// Resolves to { stream, deviceId }: the open stream when it is live and from
// `deviceId` (or no camera was asked for), else a new one. Each call must be
// matched by one releaseCamera().
export async function acquireCamera(deviceId = '') {
  users++
  clearTimeout(closeTimer)
  try {
    while (opening) await opening.catch(() => {})
    if (current && live(current.stream) && (!deviceId || deviceId === current.deviceId)) return current
    closeNow()
    const pending = open(deviceId)
    opening = pending
    try {
      current = await pending
    } finally {
      if (opening === pending) opening = null
    }
    return current
  } catch (error) {
    users = Math.max(0, users - 1)
    throw error
  }
}

export function releaseCamera() {
  users = Math.max(0, users - 1)
  if (users) return
  clearTimeout(closeTimer)
  closeTimer = setTimeout(closeNow, KEEP_OPEN_MS)
}

// Another camera was picked: the open one must close first, as phones open
// one at a time
export function closeCamera() {
  closeNow()
}
