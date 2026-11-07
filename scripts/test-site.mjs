// `yarn test:site [學號]`: the whole site on this computer against local
// Firebase emulators, with test staff accounts and one order for each kind of
// ticket pickup. Nothing touches the live project, and everything is gone when
// it stops (Ctrl+C). Give your own 學號 to test with your own student card.
//
// Needs the Firebase CLI, Java, and `yarn --cwd functions install`.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PROJECT = 'demo-cksc-ticket'
const inside = process.argv[2] === '--inside'
const studentId = String(process.argv[inside ? 3 : 2] || '1130524').trim()

if (!/^\d{6,8}$/.test(studentId)) {
  console.error(`學號格式不對：${studentId}（例如 yarn test:site 1130524）`)
  process.exit(1)
}

function run(command, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd: ROOT, shell: true, stdio: 'inherit', env: { ...process.env, ...env } })
    child.on('exit', (code) => resolve(code ?? 0))
  })
}

if (!inside) {
  // The emulators stay up while the inner run (seed, then the dev server) lasts
  const inner = `node scripts/test-site.mjs --inside ${studentId}`
  process.exit(await run(`firebase emulators:exec --only auth,firestore,functions --project ${PROJECT} "${inner}"`))
}

const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')

initializeApp({ projectId: PROJECT })
const db = getFirestore()
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`

// A Google account in the auth emulator: it is listed when you sign in
async function googleAccount(sub, email, name) {
  const idToken = JSON.stringify({ sub, email, email_verified: true, name })
  const response = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestUri: 'http://localhost',
      postBody: `providerId=google.com&id_token=${encodeURIComponent(idToken)}`,
      returnSecureToken: true
    })
  })
  const body = await response.json()
  if (!body.localId) throw new Error(`could not create ${email}: ${JSON.stringify(body)}`)
  return body.localId
}

async function staff(sub, email, name, role) {
  const uid = await googleAccount(sub, email, name)
  await db.doc(`users/${uid}`).set({ email, name, role })
}

await staff('test-admin', 'admin@test.local', '測試管理員', 'admin')
await staff('test-manager', 'manager@test.local', '測試幹部', 'manager')

await db.doc('settings/ticketTypes').set({
  types: [
    { id: 'early', name: '早鳥票', price: 500, eligibleBuyerIdentity: 'campus_students' },
    { id: 'first', name: '一售票', price: 600, eligibleBuyerIdentity: 'campus_students' },
    { id: 'priority', name: '學生優先票', price: 650, eligibleBuyerIdentity: 'all' },
    { id: 'general', name: '一般票', price: 700, eligibleBuyerIdentity: 'all' }
  ]
})

const ck = (id) => `ck${id}@gl.ck.tp.edu.tw`
const otherId = studentId === '1139999' ? '1138888' : '1139999'
const item = (id, name, price, extra = {}) => ({ id, ticketTypeId: id, name, price, quantity: 1, ...extra })
const campus = (id, name) => ({ customerName: name, customerEmail: ck(id), school: '建國中學', class: '205', number: '12', buyerType: 'student' })
const ORDERS = [
  ['CKS20261107TESTAA', '早鳥票（你的學號）：要掃 QR + 學生證', campus(studentId, '測試學生'), [item('early', '早鳥票', 500)]],
  ['CKS20261107TESTAB', '一售票（你的學號）：要掃 QR + 學生證', campus(studentId, '測試學生'), [item('first', '一售票', 600)]],
  ['CKS20261107TESTAC', '學生優先票，建中學生：看學生證，可選擇掃描', campus(studentId, '測試學生'), [item('priority', '學生優先票', 650, { checkId: true })]],
  ['CKS20261107TESTAD', '學生優先票，外校學生：看學生證或酷課雲', { customerName: '外校學生', customerEmail: 'student@ms.hs.edu.tw', school: '師大附中', buyerType: 'student' }, [item('priority', '學生優先票', 650, { checkId: true })]],
  ['CKS20261107TESTAE', '一般票，社會人士：只掃 QR', { customerName: '社會人士', customerEmail: 'guest@example.com', school: '', buyerType: 'general' }, [item('general', '一般票', 700)]],
  ['CKS20261107TESTAF', `早鳥票，別人的學號 ${otherId}：掃你的學生證會顯示不符`, campus(otherId, '另一位學生'), [item('early', '早鳥票', 500)]],
  ['CKS20261107TESTAG', '早鳥票，尚未付款：掃 QR + 學生證就自動標記付款並領票（記得收款）', campus(studentId, '測試學生'), [item('early', '早鳥票', 500)], { paid: false }],
  ['CKS20261107TESTAH', '一般票，已經領過：顯示「已領票」', { customerName: '已領過的人', customerEmail: 'done@example.com', school: '', buyerType: 'general' }, [item('general', '一般票', 700)], { delivered: true }],
  ['CKS20261107TESTAJ', '公關票（免付款）：只掃 QR', { customerName: '貴賓', customerEmail: 'vip@example.com', school: '', buyerType: 'general', complimentary: true }, [item('general', '一般票', 0)], { paid: false }]
]

for (const [index, [id, , buyer, items, extra = {}]] of ORDERS.entries()) {
  await db.doc(`orders/${id}`).set({
    userId: 'test-buyer',
    ticketCode: `test-code-${index + 1}`,
    paid: true,
    delivered: false,
    finalTotal: items.reduce((sum, entry) => sum + entry.price, 0),
    createdAt: Timestamp.now(),
    ...buyer,
    items,
    ...extra
  })
}

console.log(`
──────────────── 本機測試站 ────────────────
資料只在這台電腦，關掉（Ctrl+C）就清空，不會碰到正式資料。

1. 網頁開好後按「登入」，在跳出的測試登入視窗選：
   測試管理員 admin@test.local（可以處理「沒帶 QR Code」、強制領票、標記付款）
   測試幹部   manager@test.local（一般幹部：這些按鈕會顯示「需管理員」）
2. 到 /admin/orders 打開任一筆訂單，畫面上的「訂單 QR Code」就是票券 QR：
   用手機拍下來（或開在另一個螢幕），再拿到電腦鏡頭前掃。
3. 到 /admin/scan：先掃 QR Code 或先掃你的學生證（學號 ${studentId}）都可以，
   掃到一樣會打勾、繼續等另一樣；兩樣都相符會自動領票，其他全部打勾後按一下領票（或按 Enter）。

測試訂單：
${ORDERS.map(([id, note]) => `  ${id}  ${note}`).join('\n')}

想重來：Ctrl+C 後再執行一次。
────────────────────────────────────────────
`)

process.exit(await run('npx quasar dev', { FIREBASE_EMULATORS: 'true' }))
