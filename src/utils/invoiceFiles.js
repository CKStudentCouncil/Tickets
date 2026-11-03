// Invoice photos and PDFs for 報帳 (ReimbursePage.vue), ready for
// submitReimbursement: a photo is redrawn as a JPEG at most MAX_SIDE pixels
// long, still sharp enough to read the amounts, so several fit in one call;
// a PDF goes as it is. A photo the browser cannot open (HEIC outside
// Safari) is refused with a message.

const MAX_SIDE = 2400
const JPEG_QUALITY = 0.85

export class InvoiceFileError extends Error {}

const baseName = (name) => String(name || '').replace(/\.[^.]+$/, '') || 'invoice'

async function toJpeg(file) {
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new InvoiceFileError(`無法讀取「${file.name}」，請改用 JPG、PNG 或 PDF`)
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  // a transparent PNG would otherwise turn black
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new InvoiceFileError(`無法處理「${file.name}」，請改用 JPG、PNG 或 PDF`)
  return blob
}

// { name, contentType, blob, size, previewUrl }; revoke previewUrl when done
export async function prepareInvoiceFile(file) {
  if (file.type === 'application/pdf') {
    return { name: file.name, contentType: 'application/pdf', blob: file, size: file.size, previewUrl: '' }
  }
  if (!file.type.startsWith('image/') && !/\.hei[cf]$/i.test(file.name)) {
    throw new InvoiceFileError(`「${file.name}」不是圖片或 PDF`)
  }

  const blob = await toJpeg(file)
  return {
    name: `${baseName(file.name)}.jpg`,
    contentType: 'image/jpeg',
    blob,
    size: blob.size,
    previewUrl: URL.createObjectURL(blob)
  }
}

// base64 without the data: prefix, as the callable takes it
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
