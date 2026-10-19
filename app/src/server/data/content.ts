import { iso } from './rows'

export interface StoryRow {
  id: string
  title: string
  subtitle: string
  content: string
  publish_at: number
  sort: number
  enabled: number
  updated_at: number
  updated_by_uid: string | null
}

export interface LineupRow {
  id: string
  type: string
  name: string
  title: string
  content: string
  publish_at: number
  image_key: string | null
  created_at: number
  updated_at: number
}

export const storyFromRow = (row: StoryRow) => ({
  id: row.id,
  title: row.title,
  subtitle: row.subtitle,
  content: row.content,
  publishAt: iso(row.publish_at),
  order: row.sort,
  enabled: row.enabled === 1,
  updatedAt: iso(row.updated_at)
})

export const mediaUrl = (key: string | null) => (key ? `/media/${key}` : '')

export const lineupFromRow = (row: LineupRow) => ({
  id: row.id,
  type: row.type,
  name: row.name,
  title: row.title,
  content: row.content,
  publishAt: iso(row.publish_at),
  imageUrl: mediaUrl(row.image_key),
  imageStoragePath: row.image_key || '',
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
})
