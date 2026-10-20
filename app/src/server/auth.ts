// Sign-in: Google accounts through Better Auth, stored in D1 (user, session,
// account, verification tables; migrations/0001_auth.sql). Staff roles live
// on the user row and come only from an invite (staff_invites).
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import type { Env } from './env'

export const ROLE_RANK = { manager: 1, admin: 2, super_admin: 3 } as const
export type Role = keyof typeof ROLE_RANK
export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && Object.hasOwn(ROLE_RANK, value)
export const rankOf = (role: unknown) => (isRole(role) ? ROLE_RANK[role] : 0)

// An invited staff member gets the invite's role and name when they sign in
// with a verified email, and the invite is consumed in the same batch so it
// can never be used twice. Runs on every new session, so a buyer account
// invited later becomes staff on its next sign-in.
export async function activateInvite(db: D1Database, userId: string) {
  await db.batch([
    db.prepare(
      `UPDATE user SET role = i.role, staffName = i.name
       FROM staff_invites AS i
       WHERE user.id = ?1 AND user.emailVerified = 1 AND i.email = lower(user.email)`
    ).bind(userId),
    db.prepare(
      `DELETE FROM staff_invites
       WHERE email = (SELECT lower(email) FROM user WHERE id = ?1 AND emailVerified = 1 AND role = staff_invites.role)`
    ).bind(userId)
  ])
}

export function authOptions(env: Pick<Env, 'DB' | 'SITE_URL' | 'BETTER_AUTH_SECRET' | 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>) {
  return {
    baseURL: env.SITE_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: 'select_account'
      }
    },
    user: {
      additionalFields: {
        role: { type: 'string', required: false, input: false },
        staffName: { type: 'string', required: false, input: false }
      }
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      // Requests within an hour of the last page load skip the session lookup
      // in D1, so buyers waiting on the shop page check out without it. A
      // session revoked elsewhere stays usable for up to that hour; roles are
      // always read fresh.
      cookieCache: { enabled: true, maxAge: 60 * 60 }
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await activateInvite(env.DB, session.userId)
          }
        }
      }
    }
  } satisfies BetterAuthOptions
}

export const createAuth = (env: Env) => betterAuth(authOptions(env))
export type Auth = ReturnType<typeof createAuth>
