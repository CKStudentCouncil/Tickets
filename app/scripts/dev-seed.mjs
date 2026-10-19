#!/usr/bin/env node
// Fills the local D1 (wrangler dev) with two ticket types, an open shop and
// two signed-in accounts, and writes their session cookies to
// test/e2e/.cookies.json for the smoke test. Local only.
import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)
const secret = readFileSync(new URL('.dev.vars', root), 'utf8').match(/^BETTER_AUTH_SECRET=(.*)$/m)?.[1]?.trim()
if (!secret) throw new Error('BETTER_AUTH_SECRET missing from .dev.vars')

const now = Date.now()
const H = 3600e3
const iso = (offset) => new Date(now + offset).toISOString()
const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const types = [
  { id: 'open', name: '一階票', price: 900, eligibleBuyerIdentity: 'all_users', salesStartTime: iso(-H), salesEndTime: iso(48 * H), totalTicketQuantity: 100, purchaseLimitPerPerson: 4 },
  { id: 'campus', name: '早鳥票', price: 700, eligibleBuyerIdentity: 'campus_students', salesStartTime: iso(-H), salesEndTime: iso(48 * H), unlimitedStock: true, purchaseLimitPerPerson: 2 }
]
const accounts = [
  { id: 'dev-buyer', email: 'buyer@example.com', role: null, staffName: null },
  { id: 'dev-admin', email: 'admin@example.com', role: 'super_admin', staffName: '王管理' }
]

let sql = `DELETE FROM session WHERE userId IN (SELECT id FROM user WHERE id LIKE 'dev-%' OR email IN ('buyer@example.com', 'admin@example.com'));
DELETE FROM user WHERE id LIKE 'dev-%' OR email IN ('buyer@example.com', 'admin@example.com');\n`
types.forEach((t, i) => {
  sql += `INSERT OR REPLACE INTO ticket_types (id, sort, active, config, stock, sold, updated_at) VALUES (${q(t.id)}, ${i}, 1, ${q(JSON.stringify(t))}, ${t.unlimitedStock ? 'NULL' : t.totalTicketQuantity}, 0, ${now});\n`
})
sql += `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('shop', ${q(JSON.stringify({ openAt: iso(-H) }))}, ${now});\n`
const cookies = {}
for (const a of accounts) {
  const token = `dev-token-${a.id}`
  sql += `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, role, staffName) VALUES (${q(a.id)}, ${q(a.id)}, ${q(a.email)}, 1, ${q(iso(0))}, ${q(iso(0))}, ${q(a.role)}, ${q(a.staffName)});\n`
  sql += `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (${q(`s-${a.id}`)}, ${q(iso(24 * H))}, ${q(token)}, ${q(iso(0))}, ${q(iso(0))}, ${q(a.id)});\n`
  cookies[a.role ? 'admin' : 'buyer'] = encodeURIComponent(`${token}.${createHmac('sha256', secret).update(token).digest('base64')}`)
}

const file = join(mkdtempSync(join(tmpdir(), 'dev-seed-')), 'seed.sql')
writeFileSync(file, sql)
execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--file', file], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] })
writeFileSync(new URL('test/e2e/.cookies.json', root), JSON.stringify(cookies, null, 2))
console.log('seeded; cookies in test/e2e/.cookies.json')
