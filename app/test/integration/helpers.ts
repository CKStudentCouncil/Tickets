import { env } from 'cloudflare:workers'
import { api } from '../../src/server/app'
import { authFor } from '../../src/server/context'
import type { Role } from '../../src/server/auth'
import { invalidateCheckoutGate } from '../../src/server/checkoutGate'

export const HOUR = 60 * 60 * 1000
export const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()
export const db = env.DB

export const TICKET_TYPES: Record<string, any>[] = [
  { id: 'open', name: '一階票', price: 900, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 100, purchaseLimitPerPerson: 4 },
  { id: 'small', name: '限量票', price: 500, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), totalTicketQuantity: 5, unlimited: true, purchaseLimitPerPerson: null },
  { id: 'campus', name: '校內票', price: 700, eligibleBuyerIdentity: 'campus_students', salesStartTime: iso(-HOUR), salesEndTime: iso(HOUR), unlimitedStock: true, purchaseLimitPerPerson: 2 },
  { id: 'future', name: '二階票', price: 1200, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(HOUR), salesEndTime: iso(2 * HOUR), totalTicketQuantity: 0, purchaseLimitPerPerson: null }
]

export interface Account {
  uid: string
  email: string
  cookie: string
}

async function signCookie(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
  return encodeURIComponent(`${value}.${btoa(String.fromCharCode(...sig))}`)
}

const accounts = new Map<string, Account>()

// A Google account signed in to the site (created on first use)
export async function as(email: string, { verified = true, role }: { verified?: boolean; role?: Role } = {}): Promise<Account> {
  const key = email.toLowerCase()
  let account = accounts.get(key)
  if (account) {
    await db.prepare('UPDATE user SET emailVerified = ? WHERE id = ?').bind(verified ? 1 : 0, account.uid).run()
    // a test may have signed this account out everywhere
    const live = await db.prepare('SELECT 1 FROM session WHERE userId = ?').bind(account.uid).first()
    if (!live) {
      const session = await (await authFor(env).$context).internalAdapter.createSession(account.uid)
      account.cookie = `better-auth.session_token=${await signCookie(session.token, env.BETTER_AUTH_SECRET)}`
    }
  } else {
    const ctx = await authFor(env).$context
    const user = await ctx.internalAdapter.createUser({ email, name: email.split('@')[0], emailVerified: verified }, { method: 'oauth', oauth: { providerId: 'google' } })
    const session = await ctx.internalAdapter.createSession(user.id)
    account = { uid: user.id, email, cookie: `better-auth.session_token=${await signCookie(session.token, env.BETTER_AUTH_SECRET)}` }
    accounts.set(key, account)
  }
  if (role !== undefined) await db.prepare('UPDATE user SET role = ? WHERE id = ?').bind(role, account.uid).run()
  return account
}

export const anonymous: Account = { uid: '', email: '', cookie: '' }

export interface ApiResult<T = any> {
  status: number
  body: T
}

export async function call<T = any>(account: Account, method: string, path: string, json?: unknown): Promise<ApiResult<T>> {
  const res = await api.request(`http://localhost/api${path}`, {
    method,
    headers: { ...(account.cookie ? { cookie: account.cookie } : {}), ...(json !== undefined ? { 'content-type': 'application/json' } : {}), origin: 'http://localhost' },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {})
  }, env)
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

// Throws the API error (with code / details) like the old callables did
export async function ok<T = any>(promise: Promise<ApiResult<T>>): Promise<T> {
  const { status, body } = await promise
  if (status >= 400) throw Object.assign(new Error((body as any)?.message), body)
  return body
}

export const buyer = (extra: Record<string, unknown> = {}) => ({
  customerName: '測試', customerPhone: '0900000000', school: '北一女中', class: '101', number: '1', ...extra
})

export const order = (items: { id: string; quantity: number }[], extra?: Record<string, unknown>) => ({ orderPayload: { ...buyer(extra), items } })

export const createOrder = (payload: Record<string, unknown>, account: Account) => ok<{ status: number; id: string }>(call(account, 'POST', '/orders', payload))

export async function setTypes(changes: Record<string, Record<string, unknown>> = {}, types = TICKET_TYPES) {
  const list = types.map((type) => (changes[type.id] ? { ...type, ...changes[type.id] } : type))
  const now = Date.now()
  await db.batch(list.map((type, i) =>
    db.prepare(
      `INSERT INTO ticket_types (id, sort, active, config, stock, sold, updated_at) VALUES (?1, ?2, 1, ?3, ?4, 0, ?5)
       ON CONFLICT (id) DO UPDATE SET config = excluded.config, stock = excluded.stock, active = 1`
    ).bind(type.id, i, JSON.stringify(type), (type as any).unlimitedStock ? null : Number(type.totalTicketQuantity) || 0, now)
  ))
  await invalidateCheckoutGate(env)
}

export async function setShopOpenAt(date: Date | string) {
  await db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('shop', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
    .bind(JSON.stringify({ openAt: typeof date === 'string' ? date : date.toISOString() }), Date.now()).run()
}

export const soldOf = async (id: string) => (await db.prepare('SELECT sold FROM ticket_types WHERE id = ?').bind(id).first<number>('sold')) ?? 0

export async function countOrdersOf(ticketTypeId: string) {
  return (await db.prepare(
    `SELECT coalesce(sum(i.quantity), 0) AS n FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.ticket_type_id = ? AND o.deleted_at IS NULL`
  ).bind(ticketTypeId).first<number>('n')) ?? 0
}

export async function resetData() {
  await db.batch(['orders', 'order_items', 'order_history', 'order_requests', 'buyer_purchases', 'ticket_types', 'settings',
    'mail_jobs', 'notification_jobs', 'notification_batches', 'turnstile_passes', 'staff_invites', 'party_stories', 'party_lineup', 'survey_responses']
    .map((table) => db.prepare(`DELETE FROM ${table}`)))
  await db.prepare(`UPDATE mail_control SET next_send_at = 0`).run()
  await db.prepare(`UPDATE user SET role = NULL, staffName = NULL`).run()
  // the tests write stock and sales directly
  await invalidateCheckoutGate(env)
}

export async function rejects(promise: Promise<unknown>, expected: { code: string; checkoutRejected?: boolean }) {
  try {
    await promise
  } catch (error: any) {
    if (error.code !== expected.code) throw new Error(`expected ${expected.code}, got ${error.code}: ${error.message}`)
    if ('checkoutRejected' in expected && (error.details?.checkoutRejected === true) !== expected.checkoutRejected) {
      throw new Error(`expected checkoutRejected ${expected.checkoutRejected}`)
    }
    return error
  }
  throw new Error(`expected ${expected.code}, but it succeeded`)
}
