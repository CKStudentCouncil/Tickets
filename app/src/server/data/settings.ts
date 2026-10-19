import { SHOP_OPEN_AT } from '../domain/constants.js'
import { parseTaipeiDateTime } from '../domain/time.js'
import { ticketTypeFromRow, type TicketTypeRow } from './rows'

export async function getSetting<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row ? (JSON.parse(row.value) as T) : null
}

// The site's opening time (set on the management page), else the default
export async function getShopOpenAt(db: D1Database): Promise<Date> {
  const shop = await getSetting<{ openAt?: string | null }>(db, 'shop')
  return parseTaipeiDateTime(shop?.openAt) || SHOP_OPEN_AT
}

export async function listTicketTypeRows(db: D1Database) {
  const { results } = await db.prepare('SELECT id, sort, active, config, stock, sold FROM ticket_types WHERE active = 1 ORDER BY sort, id').all<TicketTypeRow>()
  return results
}

export async function listTicketTypes(db: D1Database) {
  return (await listTicketTypeRows(db)).map(ticketTypeFromRow)
}
