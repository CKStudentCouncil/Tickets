import * as functions from 'firebase-functions'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'

import { getBucket, HttpsError, assertRole } from './common.js'
import { REGION } from './constants.js'

const LINEUP_PREFIX = 'lineup/'
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
// Callable payloads are capped at 10 MB and base64 adds ~33%.
const MAX_UPLOAD_BYTES = 7 * 1024 * 1024
const MAX_IMAGE_WIDTH = 1600

function publicUrl(bucketName, storagePath, token) {
  return (
    `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/` +
    `${encodeURIComponent(storagePath)}?alt=media&token=${token}`
  )
}

export const uploadLineupImage = functions
  .region(REGION)
  .runWith({ memory: '512MB' })
  .https.onCall(async (data, context) => {
    await assertRole(context, 'super_admin')

    const itemId = String(data?.itemId || '')
    const contentType = String(data?.contentType || '')

    if (!/^[\w-]{1,100}$/.test(itemId)) {
      throw new HttpsError('invalid-argument', '項目 ID 無效')
    }

    if (!ALLOWED_TYPES.includes(contentType)) {
      throw new HttpsError('invalid-argument', '只允許 JPG、PNG 或 WEBP 圖片')
    }

    const input = Buffer.from(String(data?.fileData || ''), 'base64')

    if (input.length === 0 || input.length > MAX_UPLOAD_BYTES) {
      throw new HttpsError('invalid-argument', '圖片大小需介於 1 byte 與 7 MB 之間')
    }

    let output
    try {
      output = await sharp(input)
        .rotate()
        .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer()
    } catch {
      throw new HttpsError('invalid-argument', '無法讀取圖片檔案')
    }

    const storagePath = `${LINEUP_PREFIX}${itemId}/${Date.now()}.webp`
    const token = randomUUID()

    const bucket = getBucket()

    await bucket.file(storagePath).save(output, {
      resumable: false,
      metadata: {
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000',
        metadata: { firebaseStorageDownloadTokens: token }
      }
    })

    return { url: publicUrl(bucket.name, storagePath, token), storagePath }
  })

export const deleteLineupImage = functions
  .region(REGION)
  .https.onCall(async (data, context) => {
    await assertRole(context, 'super_admin')

    const storagePath = String(data?.storagePath || '')

    if (!storagePath.startsWith(LINEUP_PREFIX) || storagePath.includes('..')) {
      throw new HttpsError('invalid-argument', '圖片路徑無效')
    }

    await getBucket().file(storagePath).delete({ ignoreNotFound: true })

    return { deleted: true }
  })
