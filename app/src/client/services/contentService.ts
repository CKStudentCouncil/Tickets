// Party intro stories and lineup: scheduled public content. The public routes
// return only what is published (and, for stories, enabled).
import { client, unwrap } from 'src/api'
import { parseDate } from 'src/utils/datetime'

export const STORIES = 'partyStories'
export const LINEUP = 'partyLineup'

// "YYYY-MM-DDTHH:mm" (Taiwan time) from the admin form -> ISO string
export function toPublishTimestamp(inputValue: string) {
  const date = parseDate(inputValue)
  return date ? date.toISOString() : null
}

export async function fetchPublishedStories() {
  return (await unwrap(client.public.stories.$get())).items
}

export async function fetchPublishedLineup() {
  return (await unwrap(client.public.lineup.$get())).items
}

// Super admins read everything, drafts included
export async function fetchAllContent(collectionName: string) {
  return collectionName === STORIES
    ? (await unwrap(client.admin.content.stories.$get())).items
    : (await unwrap(client.admin.content.lineup.$get())).items
}

// Nothing to migrate: content imported from Firestore is already converted
export async function migrateLegacyContent(_collectionName: string, _items: unknown[]) {
  return 0
}

export function saveStory(id: string, story: { title: string; subtitle: string; content: string; publishAt: string; order: number; enabled: boolean }) {
  return unwrap(client.admin.content.stories[':id'].$put({ param: { id }, json: story }))
}

export function deleteStory(id: string) {
  return unwrap(client.admin.content.stories[':id'].$delete({ param: { id } }))
}

export function saveLineupItem(id: string, item: { type: string; name: string; title: string; content: string; publishAt: string; imageStoragePath: string }) {
  return unwrap(client.admin.content.lineup[':id'].$put({ param: { id }, json: item }))
}

export function deleteLineupItem(id: string) {
  return unwrap(client.admin.content.lineup[':id'].$delete({ param: { id } }))
}

// The browser resizes the image (sharp no longer runs on the server):
// at most 1600px wide, WebP at 85% quality, upright as the camera shot it.
export async function resizeLineupImage(file: File): Promise<{ contentType: string; base64: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, 1600 / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85))
  // Safari before 16 cannot encode WebP and falls back to PNG
  const out = blob && blob.type === 'image/webp' ? blob : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!out) throw new Error('圖片轉換失敗')
  const bytes = new Uint8Array(await out.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { contentType: out.type, base64: btoa(binary) }
}

export async function uploadLineupImage({ itemId, file }: { itemId: string; file: File }) {
  const { contentType, base64 } = await resizeLineupImage(file)
  return unwrap(client.admin.media.lineup[':itemId'].$post({ param: { itemId }, json: { filename: file.name, contentType, fileData: base64 } }))
}

export function deleteLineupImage(storagePath: string) {
  return unwrap(client.admin.media.$delete({ json: { storagePath } }))
}
