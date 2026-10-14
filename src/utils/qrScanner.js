// Reads QR codes from the device camera inside the page, so door staff don't
// need the phone's own scanner app. Uses the browser's BarcodeDetector where
// it reads QR codes (Chrome on Android) and the jsQR decoder elsewhere (iOS).

const SCAN_INTERVAL_MS = 150
// jsQR gets a downscaled frame: a ticket QR fills the view, and smaller
// frames keep decoding fast on older phones
const MAX_FRAME_SIZE = 640

async function createDecoder() {
  if (typeof window.BarcodeDetector === 'function') {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats()
      if (formats.includes('qr_code')) {
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        return async (video) => (await detector.detect(video))[0]?.rawValue || ''
      }
    } catch {
      // fall back to jsQR
    }
  }

  const { default: jsQR } = await import('jsqr')
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  return (video) => {
    const scale = Math.min(1, MAX_FRAME_SIZE / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    return jsQR(data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' })?.data || ''
  }
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

// Starts the camera on `video` and calls onCode(text) for every QR read.
// Resolves to a stop() function; rejects with the camera error.
export async function startQrScanner(video, onCode) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('getUserMedia unavailable'), { name: 'NotSupportedError' })
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' } }
  })

  let stopped = false
  let timer = 0
  const stop = () => {
    stopped = true
    clearTimeout(timer)
    stream.getTracks().forEach((track) => track.stop())
    if (video.srcObject === stream) video.srcObject = null
  }

  try {
    video.srcObject = stream
    await video.play()
    const decode = await createDecoder()

    const tick = async () => {
      if (stopped) return
      if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth) {
        try {
          const text = await decode(video)
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

  return stop
}
