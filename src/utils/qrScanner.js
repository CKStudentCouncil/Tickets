// Reads QR codes from the device camera inside the page, so door staff don't
// need the phone's own scanner app.
import { acquireCamera, releaseCamera } from './camera.js'

const SCAN_INTERVAL_MS = 150
// The centre square the viewfinder shows is read, downscaled to at most this
// size: enough pixels for a QR held 20-30 cm away (phone cameras can't focus
// closer), small enough to decode quickly on older phones
const MAX_FRAME_SIZE = 800

// ZXing (WebAssembly, served with the site): as sure as jsQR on blurred,
// tilted, dim and inverted codes and about five times faster (17 ms against
// 94 ms a frame on a slow phone), and it looks for light-on-dark codes (an
// email app in dark mode) in the same pass. jsQR stays as the fallback when
// it can't load.
async function loadZxing() {
  const [{ readBarcodes, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('zxing-wasm/reader'),
    import('zxing-wasm/reader/zxing_reader.wasm?url')
  ])
  await prepareZXingModule({ overrides: { locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : path) }, fireImmediately: true })
  const options = { formats: ['QRCode'], tryInvert: true, maxNumberOfSymbols: 1 }
  return async (image) => (await readBarcodes(image, options))[0]?.text || ''
}

async function loadJsQr() {
  const { default: jsQR } = await import('jsqr')
  let invert = false
  return async ({ data, width, height }) => {
    // every other frame looks for light-on-dark codes. Inverted here: jsQR
    // 1.4's own 'onlyInvert' option throws
    invert = !invert
    if (invert) {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i]
        data[i + 1] = 255 - data[i + 1]
        data[i + 2] = 255 - data[i + 2]
      }
    }
    return jsQR(data, width, height, { inversionAttempts: 'dontInvert' })?.data || ''
  }
}

// Each frame: the centre square the viewfinder shows is drawn to a canvas
// and read by the browser's BarcodeDetector (when it has one) and by ZXing.
// ZXing always runs, so a BarcodeDetector that exists but finds nothing in
// camera frames (seen on iOS) can't stop scanning.
export async function createDecoder() {
  let read = null
  let engine = 'ZXing'
  try {
    read = await loadZxing()
  } catch (error) {
    console.warn('ZXing failed to load, using jsQR', error)
    read = await loadJsQr()
    engine = 'jsQR'
  }

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
        console.warn(`BarcodeDetector failed, using ${engine} only`, error)
        detector = null
      }
    }

    return read(context.getImageData(0, 0, size, size))
  }

  return { decode, name: () => (detector ? `BarcodeDetector + ${engine}` : engine) }
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
// with the camera error. The stream is shared (src/utils/camera.js): stop()
// lets it go, and it stays open a while for the next page.
export async function startQrScanner(video, onCode, { deviceId = '' } = {}) {
  const { stream } = await acquireCamera(deviceId)
  const [track] = stream.getVideoTracks()

  let stopped = false
  let timer = 0
  let decoder = null
  const stop = () => {
    if (stopped) return
    stopped = true
    clearTimeout(timer)
    if (video.srcObject === stream) video.srcObject = null
    releaseCamera()
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
