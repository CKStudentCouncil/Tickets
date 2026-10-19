import { env } from 'cloudflare:workers'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { beforeAll, expect, it } from 'vitest'

const db = env.DB

const options = {
  baseURL: 'http://localhost',
  basePath: '/api/auth',
  secret: 'spike-secret-spike-secret-spike-secret',
  database: db,
  socialProviders: { google: { clientId: 'client-id', clientSecret: 'client-secret', prompt: 'select_account' } },
  user: { additionalFields: { role: { type: 'string', required: false, input: false } } },
  databaseHooks: {
    user: {
      create: {
        // An invited staff member gets their role on first sign-in; the
        // invite is consumed in the same batch so it can never be reused.
        after: async (user) => {
          const email = user.email.toLowerCase()
          const [, consumed] = await db.batch([
            db.prepare('UPDATE user SET role = (SELECT role FROM staff_invites WHERE email = ?1) WHERE id = ?2 AND ?3 = 1 AND EXISTS (SELECT 1 FROM staff_invites WHERE email = ?1)')
              .bind(email, user.id, user.emailVerified ? 1 : 0),
            db.prepare('DELETE FROM staff_invites WHERE email = ? AND ? = 1').bind(email, user.emailVerified ? 1 : 0)
          ])
          return void consumed
        }
      }
    }
  }
} satisfies BetterAuthOptions

const auth = betterAuth(options)
// how a first Google sign-in provisions the user
const GOOGLE = { method: 'oauth', oauth: { providerId: 'google' } } as const

beforeAll(async () => {
  const { runMigrations, compileMigrations } = await getMigrations(options)
  expect(await compileMigrations()).toMatch(/create table "user"/)
  await runMigrations()
})

it('starts a Google sign-in with the school hosted-domain hint', async () => {
  const res = await auth.handler(new Request('http://localhost/api/auth/sign-in/social', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({ provider: 'google', callbackURL: '/orders', additionalParams: { hd: 'gl.ck.tp.edu.tw' } })
  }))
  expect(res.status).toBe(200)
  const { url } = (await res.json()) as { url: string }
  const authorize = new URL(url)
  expect(authorize.origin).toBe('https://accounts.google.com')
  expect(authorize.searchParams.get('client_id')).toBe('client-id')
  expect(authorize.searchParams.get('hd')).toBe('gl.ck.tp.edu.tw')
  expect(authorize.searchParams.get('prompt')).toBe('select_account')
  expect(authorize.searchParams.get('redirect_uri')).toBe('http://localhost/api/auth/callback/google')
  expect(res.headers.get('set-cookie')).toMatch(/better-auth\.state=/)
})

it('activates a staff invite on first sign-in and consumes it', async () => {
  await db.prepare("INSERT INTO staff_invites (email, role, name) VALUES ('staff@gl.ck.tp.edu.tw', 'manager', '王小明')").run()
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({ email: 'Staff@gl.ck.tp.edu.tw', name: 'Staff', emailVerified: true }, GOOGLE)

  expect(await db.prepare('SELECT role FROM user WHERE id = ?').bind(user.id).first('role')).toBe('manager')
  expect(await db.prepare('SELECT count(*) AS n FROM staff_invites').first('n')).toBe(0)
})

it('gives an ordinary buyer no role', async () => {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({ email: 'buyer@gmail.com', name: 'Buyer', emailVerified: true }, GOOGLE)
  expect(await db.prepare('SELECT role FROM user WHERE id = ?').bind(user.id).first('role')).toBeNull()
})

it('reads the session of a signed-in user from the cookie', async () => {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({ email: 'reader@gmail.com', name: 'Reader', emailVerified: true }, GOOGLE)
  const session = await ctx.internalAdapter.createSession(user.id)
  const signed = await signCookie(session.token, options.secret)
  const result = await auth.api.getSession({ headers: new Headers({ cookie: `better-auth.session_token=${signed}` }) })
  expect(result?.user.email).toBe('reader@gmail.com')
})

async function signCookie(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
  return encodeURIComponent(`${value}.${btoa(String.fromCharCode(...sig))}`)
}
