// Smoke run of the whole site against local `wrangler dev`: browse, buy,
// see the order, and as staff list it and check it in. Screenshots go to
// test/e2e/screenshots/.
//
//   PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA yarn build
//   npx wrangler d1 migrations apply DB --local && node scripts/dev-seed.mjs
//   npx wrangler dev &   then   node test/e2e/smoke.mjs
// (needs `playwright`; it is not a dependency of the app)
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787'
const OUT = new URL('./screenshots', import.meta.url).pathname
fs.mkdirSync(OUT, { recursive: true })
const cookies = JSON.parse(fs.readFileSync(new URL('./.cookies.json', import.meta.url), 'utf8'))
// CHROMIUM_PATH: a Chromium other than Playwright's own download
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const errors = []

async function context(who) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, locale: 'zh-TW' })
  if (who) await ctx.addCookies([{ name: 'better-auth.session_token', value: cookies[who], url: BASE }])
  await ctx.addInitScript(() => localStorage.setItem('cksc.buyGuideSeen', '1'))
  return ctx
}
function watch(page, label) {
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`) })
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${label} ${r.status()} ${r.url()}`) })
}
const step = (name) => console.log('•', name)

// anonymous: home lists the ticket types
let ctx = await context(null)
let page = await ctx.newPage(); watch(page, 'anon')
await page.goto(BASE + '/')
await page.getByText('一階票').first().waitFor({ timeout: 15000 })
await page.screenshot({ path: `${OUT}/01-home.png`, fullPage: true })
step('home shows ticket types')
await page.goto(BASE + '/intro'); await page.waitForTimeout(800)
await page.goto(BASE + '/performer'); await page.waitForTimeout(800)
await page.goto(BASE + '/orders'); await page.waitForURL(/\/login/, { timeout: 10000 })
await page.screenshot({ path: `${OUT}/02-login.png`, fullPage: true })
step('orders sends anonymous visitors to login')
await ctx.close()

// buyer: checkout
ctx = await context('buyer')
page = await ctx.newPage(); watch(page, 'buyer')
await page.goto(BASE + '/product/open')
await page.locator('button.primary-button').filter({ hasText: /購買|訂購|購票/ }).first().click()
const form = page.locator('form.order-panel')
await form.waitFor()
await form.locator('select').first().selectOption('北一女中')
await form.locator('input[placeholder^="例：329"]').fill('101')
await form.locator('input[placeholder="例：01"]').fill('1')
await form.locator('input[autocomplete="name"]').fill('測試買家')
await form.locator('input[type="tel"]').fill('0912345678')
await form.locator('input[type="checkbox"]').check()
// the always-passing Turnstile test key solves itself
await page.waitForFunction(() => document.querySelector('input[name="cf-turnstile-response"]')?.value, null, { timeout: 20000 }).catch(() => step('(turnstile token not seen, continuing)'))
await page.screenshot({ path: `${OUT}/03-product-form.png`, fullPage: true })
await form.locator('button[type="submit"]').click()
await page.waitForURL(/order-success/, { timeout: 20000 })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/04-order-success.png`, fullPage: true })
const orderId = (await page.textContent('body')).match(/TFG\d{8}[A-HJ-NP-Z2-9]{6}/)?.[0]
step(`checkout created ${orderId}`)
await page.goto(BASE + '/orders')
await page.getByText(orderId).first().waitFor({ timeout: 10000 })
await page.screenshot({ path: `${OUT}/05-orders.png`, fullPage: true })
step('order appears in my orders')
await ctx.close()

// staff: dashboard, check-in through the ticket QR link, management pages
const me = await (await fetch(`${BASE}/api/orders/${orderId}`, { headers: { cookie: `better-auth.session_token=${cookies.admin}` } })).json()
ctx = await context('admin')
page = await ctx.newPage(); watch(page, 'admin')
await page.goto(BASE + '/admin')
await page.getByText(orderId).first().waitFor({ timeout: 15000 })
await page.screenshot({ path: `${OUT}/06-admin.png`, fullPage: true })
step('admin dashboard lists the order')
await page.goto(`${BASE}/admin/orders/${orderId}?c=${me.order.ticketCode}`)
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/07-admin-order.png`, fullPage: true })
const collect = page.locator('button').filter({ hasText: '標記已領票' }).first()
if (await collect.count()) {
  page.once('dialog', (d) => d.accept())
  await collect.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/08-checked-in.png`, fullPage: true })
}
const after = await (await fetch(`${BASE}/api/orders/${orderId}`, { headers: { cookie: `better-auth.session_token=${cookies.admin}` } })).json()
step(`delivered after check-in: ${after.order.delivered}`)
for (const path of ['/admin/management', '/admin/account', '/admin/intromanagement', '/admin/performer', '/admin/survey', '/admin/scan']) {
  await page.goto(BASE + path); await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/09${path.replace(/\//g, '-')}.png`, fullPage: true })
}
step('admin pages rendered')
await ctx.close()
await browser.close()
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors')
process.exit(errors.length ? 1 : 0)
