import { createMiddleware } from 'hono/factory'
import { createAuth, rankOf, ROLE_RANK, type Auth, type Role } from './auth'
import type { Env } from './env'
import { ApiError } from './errors'

export interface SessionUser {
  id: string
  email: string
  emailVerified: boolean
  name: string
  image: string | null
  role: Role | null
  staffName: string | null
}

export interface AppEnv {
  Bindings: Env
  Variables: { auth: Auth; user: SessionUser | null }
}

// One Better Auth instance per isolate and environment
const auths = new WeakMap<object, Auth>()
export function authFor(env: Env) {
  let auth = auths.get(env.DB)
  if (!auth) auths.set(env.DB, (auth = createAuth(env)))
  return auth
}

export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  const auth = authFor(c.env)
  c.set('auth', auth)
  // The cookies getSession sets (the session cache, a renewed session) go
  // back to the browser, so the next requests skip the D1 lookup
  const result = await auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true }).catch(() => null)
  for (const cookie of result?.headers.getSetCookie() ?? []) c.header('set-cookie', cookie, { append: true })
  const session = result?.response
  const u = session?.user as (Record<string, unknown> & { id: string }) | undefined
  c.set('user', u ? {
    id: u.id,
    email: String(u.email || '').toLowerCase(),
    emailVerified: u.emailVerified === true,
    name: String(u.name || ''),
    image: (u.image as string) || null,
    role: null,
    staffName: (u.staffName as string) || null
  } : null)
  await next()
})

export function currentUser(c: { get(key: 'user'): SessionUser | null }) {
  const user = c.get('user')
  if (!user) throw new ApiError('unauthenticated', '請先登入')
  return user
}

// The role is read from the database on every staff request (not from the
// cached session), so revoking a role takes effect at once.
export async function staffRole(db: D1Database, userId: string) {
  const row = await db.prepare('SELECT role, staffName FROM user WHERE id = ?').bind(userId).first<{ role: string | null; staffName: string | null }>()
  return { rank: rankOf(row?.role), role: (row?.role ?? null) as Role | null, staffName: row?.staffName ?? null }
}

export const requireRole = (minRole: Role) => createMiddleware<AppEnv>(async (c, next) => {
  const user = currentUser(c)
  const { rank, role, staffName } = await staffRole(c.env.DB, user.id)
  if (rank < ROLE_RANK[minRole]) throw new ApiError('permission-denied', '權限不足')
  c.set('user', { ...user, role, staffName })
  await next()
})

// Name recorded on check-ins: the admin-assigned staff name, else the Google name
export function actorName(user: SessionUser) {
  for (const candidate of [user.staffName, user.name]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 100)
  }
  return user.id
}
