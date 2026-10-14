// Reads QR codes from the device camera inside the page, so door staff don't
// need the phone's own scanner app.

const SCAN_INTERVAL_MS = 150
// jsQR reads the centre square the viewfinder shows, downscaled to at most
// this size: enough pixels for a QR held 20-30 cm away (phone cameras can't
// focus closer), small enough to decode quickly on older phones
const MAX_FRAME_SIZE = 800

// Each frame: the centre square the viewfinder shows is drawn to a canvas
// and read by the browser's BarcodeDetector (when it has one) and by jsQR.
// jsQR always runs, so a BarcodeDetector that exists but finds nothing in
// camera frames (seen on iOS) can't stop scanning.
async function createDecoder() {
  const { default: jsQR } = await import('jsqr')

  let detector = null
  if (typeof window.BarcodeDetector === 'function') {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats()
      if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] })
    } catch {
      detector = null
    }
  }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  let invert = false

  const decode = async (video) => {
    const side = Math.min(video.videoWidth, video.videoHeight)
    const size = Math.min(side, MAX_FRAME_SIZE)
    canvas.width = canvas.height = size
    context.drawImage(
      video,
      (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side,
      0, 0, size, size
    )

    if (detector) {
      try {
        const [code] = await detector.detect(canvas)
        if (code?.rawValue) return code.rawValue
      } catch (error) {
        console.warn('BarcodeDetector failed, using jsQR only', error)
        detector = null
      }
    }

    const { data } = context.getImageData(0, 0, size, size)
    // every other frame looks for light-on-dark codes (e.g. an email app in
    // dark mode inverting the image) without doubling the work per frame.
    // Inverted here: jsQR 1.4's own 'onlyInvert' option throws.
    invert = !invert
    if (invert) {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i]
        data[i + 1] = 255 - data[i + 1]
        data[i + 2] = 255 - data[i + 2]
      }
    }
    return jsQR(data, size, size, { inversionAttempts: 'dontInvert' })?.data || ''
  }

  return { decode, name: () => (detector ? 'BarcodeDetector + jsQR' : 'jsQR') }
}

export function cameraErrorMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '沒有相機權限。請在瀏覽器設定中允許此網站使用相機，再重新開啟相機。'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return '找不到可用的相機。'
    case 'NotReadableError':
    case 'AbortError':
      return '相機正被其他 App 使用，請關閉後再重新開啟相機。'
    case 'NotSupportedError':
      return '此瀏覽器無法開啟相機，請改用 Safari 或 Chrome 開啟本頁。'
    default:
      return '無法開啟相機，請重新開啟相機或改用手動輸入訂單編號。'
  }
}

// Cameras staff can switch between (labels are known once access is
// granted). Front cameras are left out when the labels say which they are.
export async function listCameras() {
  const devices = (await navigator.mediaDevices.enumerateDevices())
    .filter((device) => device.kind === 'videoinput' && device.deviceId)
  const back = devices.filter((device) => !/front|前/i.test(device.label))
  return back.length ? back : devices
}

// Starts the camera on `video` (the back camera, or `deviceId`) and calls
// onCode(text) for every QR read. Resolves to { stop, deviceId }; rejects
// with the camera error.
export async function startQrScanner(video, onCode, { deviceId = '' } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('getUserMedia unavailable'), { name: 'NotSupportedError' })
  }

  // A high resolution keeps a QR held far enough away to be in focus
  // readable; the browser picks the closest size the camera offers
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

  let stopped = false
  let timer = 0
  let decoder = null
  const stop = () => {
    stopped = true
    clearTimeout(timer)
    stream.getTracks().forEach((track) => track.stop())
    if (video.srcObject === stream) video.srcObject = null
  }

  try {
    video.srcObject = stream
    await video.play()
    decoder = await createDecoder()

    const tick = async () => {
      if (stopped) return
      if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth) {
        try {
          const text = await decoder.decode(video)
          if (text && !stopped) onCode(text)
        } catch (error) {
          console.error('QR decode failed', error)
        }
      }
      if (!stopped) timer = setTimeout(tick, SCAN_INTERVAL_MS)
    }
    tick()
  } catch (error) {
    stop()
    throw error
  }

  const settings = track?.getSettings?.() || {}
  return {
    stop,
    deviceId: settings.deviceId || deviceId,
    // shown under the viewfinder, to tell what the phone is actually using
    info: () => `${track?.label || '相機'} · ${video.videoWidth}×${video.videoHeight} · ${decoder.name()}`
  }
}
