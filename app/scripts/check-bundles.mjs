#!/usr/bin/env node
// After `astro build`: checks that the public site's JavaScript never loads
// (or names) the staff pages or their libraries, and the other way round,
// by following every import from each page's scripts.
import { existsSync, readFileSync } from 'node:fs'

const dist = new URL('../dist/', import.meta.url)

// staff-only pages and libraries; the public bundle must not reach them
const STAFF_ONLY = ['AdminPage', 'ManagementPage', 'AccountPage', 'IntroManagementPage', 'PerformerManagementPage', 'ScanPage', 'SurveyAdminPage', 'jsQR', 'exceljs']
// public-only pages; the staff bundle must not reach them
const PUBLIC_ONLY = ['HomePage', 'ProductPage', 'OrdersPage', 'OrderSuccessPage', 'SurveyPage', 'IntroPage', 'PerformerPage', 'LoginPage']

// every JS file a page reaches through static and dynamic imports
function reachable(page) {
  const html = readFileSync(new URL(page, dist), 'utf8')
  const queue = [...html.matchAll(/(?:src|href)="(\/_astro\/[^"]+\.js)"/g)].map((m) => m[1])
  const seen = new Set()
  while (queue.length) {
    const file = queue.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const url = new URL(`.${file}`, dist)
    if (!existsSync(url)) continue
    const code = readFileSync(url, 'utf8')
    for (const m of code.matchAll(/["'`](?:\.\/|\/_astro\/)([\w.-]+\.js)["'`]/g)) queue.push(`/_astro/${m[1]}`)
  }
  return [...seen]
}

let failed = false
for (const [page, banned] of [['index.html', STAFF_ONLY], ['admin/index.html', PUBLIC_ONLY]]) {
  const files = reachable(page)
  const leaks = files.filter((file) => banned.some((name) => file.includes(`/${name}.`)))
  console.log(`${page}: ${files.length} scripts${leaks.length ? `, leaks: ${leaks.join(', ')}` : ', clean'}`)
  if (files.length === 0 || leaks.length) failed = true
}
process.exit(failed ? 1 : 0)
