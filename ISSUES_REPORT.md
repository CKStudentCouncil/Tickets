# 上線前修正（程式碼審查）處理結果

對應 `上線前修正（程式碼審查） › Issues.csv` 的 PARTY-1 ～ PARTY-13。

**狀態說明**
- ✅ **Done**：已修正，並有測試或程式碼追查佐證
- 🟡 **Done，另有待決事項**：程式碼部分已修正，剩下的項目需要負責人決定
- 🚀 **需部署**：修正在程式碼裡，要部署到 `cksc-ticket` 才會生效

**驗證方式**（修正都在目前的 working tree，尚未 commit）

| 測試 | 指令 | 結果 |
|---|---|---|
| Functions 單元測試 | `cd functions && npm test` | 33 / 33 通過 |
| Firestore rules（emulator） | `npm run test:rules` | 24 / 24 通過 |
| createOrder 交易（emulator） | `cd functions && npm run test:emulator` | 10 / 10 通過 |
| 前端 production build | `npx quasar build` | 成功 |

另外有 11 個獨立的 AI 審查 agent 逐條對照各 issue 的「修法」與「驗收」；其提出的後續問題也已一併修正（見各 issue 的「審查後補強」）。其中 PARTY-12、PARTY-13 的審查 agent 因用量上限中斷，這兩條改由人工逐條核對，並以測試驗證。

---

## 總覽

| Issue | 優先 | 標題 | 結果 |
|---|---|---|---|
| PARTY-1 | Urgent | 任何登入者都能把自己升成 super_admin | ✅ 🚀 |
| PARTY-2 | Urgent | 訂單集合公開可讀、可直接寫入 | ✅ 🚀 |
| PARTY-3 | Urgent | createOrder 完全信任前端金額與狀態 | ✅ 🚀 |
| PARTY-4 | Urgent | 票種資料四個來源對不上 | ✅ |
| PARTY-5 | Urgent | 超賣與限購競態、每筆訂單全表掃描 | ✅ 🚀 |
| PARTY-6 | Urgent | 部署設定指向錯誤專案 | ✅（部署本身需負責人執行） |
| PARTY-7 | High | pendingUsers 權限與管理錯誤 | ✅ 🚀 |
| PARTY-8 | High | manager 登入被導首頁、掃碼被擋 | ✅ |
| PARTY-9 | High | 連結與 QR Code 指向 souvenir.cksc.tw | 🟡（正式主機待定） |
| PARTY-10 | High | 數量驗證不足、校內票與限購可繞過 | 🟡（身分驗證政策待定） |
| PARTY-11 | High | 確認信 UTC；老師辦公室欄位沒送出 | ✅ |
| PARTY-12 | Low | 清理遺留程式碼與 repo 雜項 | ✅（檔案刪除需負責人執行） |
| PARTY-13 | Urgent | nodemailer 10 不支援 aws-sdk v2 SES | ✅ 🚀 |

---

## PARTY-1　任何登入者都能把自己升成 super_admin — ✅ Done

**做法**：沒有改用 Cloud Function 開通帳號，改由 Firestore rules 在伺服器端做同樣的檢查（`firestore.rules` 的 `users` / `pendingUsers`）。
- 本人只有在符合下列條件時，才能建立 `users/{uid}`：
  - 存在邀請 `pendingUsers/{小寫 email}`
  - token 的 `email_verified == true`
  - `role` 和 `name` 必須與邀請相同
  - 欄位限定白名單
  - 同一個 batch 內必須刪除該邀請（`!existsAfter`），所以邀請只能用一次
- 本人更新自己的文件時，只能改 `email / displayName / photoURL / updatedAt`，改不到 `role`。
- super admin 寫入 `role` 時，也只能是三種工作人員角色之一。
- 開通流程改為單一 `writeBatch`（`src/pages/AdminLoginPage.vue`）。

**驗收**
- 一般帳號在 console 寫入 `role` 會被拒絕 ✅（rules 測試）
- 受邀帳號可以正常開通 ✅（rules 測試）
- 另外有 rules 測試涵蓋：大小寫不同的 Gmail 可開通；多加欄位、冒名、盜用別人的邀請都被拒絕。

**審查後補強**
- 邀請的 `name` 必須一致
- super admin 只能寫入工作人員角色
- 前後端角色判斷都改用 `Object.hasOwn`，防止 `toString` 等 prototype key 被當成角色

**待辦（負責人）**
- 部署 rules。
- 舊規則期間任何人都能自封角色，部署後請檢查 `users` 裡有沒有未經邀請卻有角色的帳號。
- 第一位 super admin 要手動在 console 建立（README 已寫明步驟）。

## PARTY-2　訂單集合公開可讀、可直接寫入 — ✅ Done

**Rules**
- `orders`：`allow create: if false`，只有 Cloud Function 能寫入。
- `allow read: if isManager()`。
- 直接寫 Firestore 已不可能，因此也無法藉此觸發 `sendOrderQRCode` 寄信。

**訪客查單**
- `createOrder` 會產生 48 位 hex 的 `accessToken`（192-bit 隨機）。
- 瀏覽器保存 `{id, token}`；透過新的 callable `getOrders` 查單，token 以 `timingSafeEqual` 比對。
- 回傳採欄位白名單：不含 token、工作人員姓名或 `userId`。

**審查後補強**
- 確認信加入「查看我的訂單」私人連結 `/orders/{id}?t={token}`。換裝置或清除瀏覽器資料後，點連結即可找回訂單。

**驗收**
- 未登入時 list / get orders 被拒 ✅（rules 測試）
- 未登入直接 addDoc 被拒 ✅（rules 測試）
- 訪客仍能在「我的訂單」看到自己的訂單 ✅（emulator 測試：token 正確可查、錯誤不可查）

**建議（未做）**：開啟 Firebase App Check（reCAPTCHA Enterprise），防止腳本大量建立訂單。這需要在 Console 設定，建議開賣前處理。

## PARTY-3　createOrder 完全信任前端送來的金額與狀態 — ✅ Done

**白名單**（`functions/lib/orderValidation.js` 的 `sanitizeOrderInput`）
- 只接受 `items (ticketTypeId + quantity)` 以及：
  - `customerName` / `customerEmail` / `customerPhone`
  - `school` / `class` / `number` / `office`
- 所有字串都有長度上限。
- email 需符合格式。
- 學校必須在清單內，並以 `Object.hasOwn` 判斷。

**伺服器決定的欄位**
- 單價、名稱依 `settings/ticketTypes` 決定；`originalTotal` / `finalTotal` 由伺服器計算。
- `paid` 與 `delivered` 一律寫入 `false`。
- `userId` 取自 `context.auth?.uid`。

**公關品訂單**：購物車與公關品流程已整個移除（死碼，沒有任何地方能加入購物車），因此不需要另外做 admin callable。若之後需要贈票，應新增 `assertRole(context, 'admin')` 的獨立 callable。

**驗收**：竄改 payload 的 `price` / `finalTotal` / `paid` / `delivered` / `userId` / `isAdminOrder` 都不影響寫入結果 ✅（emulator 測試與單元測試）。

## PARTY-4　票種資料有四個來源且互相對不上 — ✅ Done

**單一來源**
- 首頁、票種頁、後台票種管理、`createOrder` 全部讀 `settings/ticketTypes`（前端透過 `src/services/ticketTypeService.js`）。
- `productPageConfigs`、`catalog.js` 已不再使用。

**價格**
- 票種有 `price` 欄位，由伺服器採用。
- 儲存票價為 0 的票種時，會要求確認是否免費販售。

**時間**
- 新儲存的時間帶 `+08:00`，例如 `2026-11-05T12:00:00+08:00`。
- 舊的無時區字串，前後端都視為台灣時間。
- 單元測試確認前後端解析結果一致。

**票種 id（與原建議不同）**：仍使用隨機 UUID，沒有改成固定 id。原本的問題是各處 id 格式不一致；現在所有地方讀的是同一份設定，UUID 已不會造成錯位。
- 注意：刪除後重建同名票種會得到新 id，已售數量從 0 重新計算。
- 若希望使用可讀 id，可改為「可編輯、儲存後鎖定的 slug」。

**審查後補強**
- 票券總量欄位標示「0 = 不限量」
- `crypto.randomUUID` 在非 HTTPS 環境下改用備援方式產生 id

**驗收**
- 首頁 → 票種頁 → 送出，金額正確 ✅（emulator 測試）
- 後台修改販售時間、總量、限購後，伺服器會照新設定擋單 ✅（emulator 測試與單元測試）
- 仍建議在 staging 實際點過一次。

## PARTY-5　超賣與限購有競態條件 — ✅ Done

**交易設計**：`createOrder` 用單一 `runTransaction`（最多重試 10 次），讀取以下文件：
- `settings/ticketTypes`
- `orderCounters/{日期}`
- `buyerPurchases/{sha256(email)}`
- `ticketSales/{票種}`

在同一個交易內完成：檢查 → 遞增計數 → 建立訂單 → 遞增訂單序號。不再掃描整個 `orders`。

**刪單退回名額**：新增 `releaseOrderStock` trigger（訂單刪除時觸發），扣回 `ticketSales` 和 `buyerPurchases`。
- 以 `stockReleases/{orderId}` 標記，確保只扣一次。
- 失敗時會自動重試（`failurePolicy`）。
- 只處理有 `stockCounted: true` 的訂單，避免舊測試訂單把計數扣成負數。

**驗收：用腳本同時送出 N 筆請求**（emulator 實測）
- 25 筆同時搶 5 張票：**剛好成功 5 筆**，其餘都回 `resource-exhausted`。
- 同一人同時送 10 筆、限購 4 張：**剛好成功 4 筆**。
- 刪單後名額退回，重複觸發也不會重複退回。

**注意**：同一天所有訂單共用一個序號文件，開賣尖峰的吞吐量有上限。建議開賣前用 staging 以 200～500 筆併發壓測一次。

## PARTY-6　Firebase 部署設定指向錯誤專案 — ✅ Done

- `.firebaserc` 預設專案已是 `cksc-ticket`。
- `firebase.json` 的 functions predeploy 改為執行單元測試（`npm test`），不再是不存在的 `npm run lint`。
- `firebase.json` 指向的 `firestore.rules` 已存在，並有 24 個 rules 測試。
- 失效的 `functions/.eslintrc.js` 列入刪除清單（見 PARTY-12）；根目錄 package.json 裡無法執行的 `lint` script 已移除。
- **審查後補強**：Functions runtime 從 **Node 20 升到 Node 22**。Node 20 將於 2026-10-30 停止支援，早於 11-05 開賣，屆時會無法部署修正。

**待辦（負責人）**
- 部署：`firebase deploy -P cksc-ticket --only firestore:rules,functions`。
- 部署後到 Console 確認生效的 rules 與檔案一致。
- `firestore.rules`、`functions/lib/`、`tests/` 目前是 untracked，請一併 commit。

## PARTY-7　pendingUsers 的權限與管理錯誤 — ✅ Done

**Rules**
- 只有 super admin 能 list、建立、修改邀請。
- 受邀者只能讀自己那一筆，且 email 必須已驗證。
- 受邀者只能在開通帳號的同一個 batch 內刪除自己的邀請，無法刪除別人的。

**邀請改以小寫 email 當文件 id**：rules 會強制 id 為小寫。

**帳號管理頁**（`src/pages/AccountPage.vue`）
- 改角色、刪除時，依 `user.pending` 決定操作 `users` 或 `pendingUsers`。
- 「全部刪除」會保留所有 super admin，並分批 commit（每批 450 筆）。rules 測試確認一個 batch 刪 40 筆可以成功。

**待辦（負責人）**：舊版以隨機 id 建立的邀請無法再開通。請在 Console 刪除這些邀請後重新邀請。

## PARTY-8　manager 登入後被導到首頁、掃 QR Code 被擋 — ✅ Done

**決定**：現場驗票與領票由 manager 負責。這和 `OrderDetailPage` 原本的設計一致；若負責人不同意，可以改回。

**修正**
- `/admin/orders/:id` 移除 `requiresAdmin`。
- rules 允許 manager 修改領票狀態；付款狀態仍只限 admin。
- 登入後預設跳到 `/admin`（原本的 `/scan` 並不存在），並支援 `redirect` 參數，已排除站外網址。
- auth store 新增 `refresh()`，開通後重新讀取角色；另加上載入序號，避免舊的讀取結果覆蓋新的。
- 已登入的人開啟登入頁時，直接導向 `redirect` 目標，掃碼後不會遺失訂單頁。
- 掃碼直接開啟訂單頁時，按「返回」會回到後台，而不是首頁。

## PARTY-9　連結與 QR Code 指向 souvenir.cksc.tw — 🟡 Done，正式主機待定

- 網域抽成常數：前端 `src/config/app.js` 與 functions `lib/constants.js` 各一處 `SITE_URL`，由單元測試確認兩者一致。
- QR Code（信件與網站）、問卷連結、確認信連結全部改為 `https://tickets.cksc.tw`；站內連結改用 router。
- LINE 內建瀏覽器的舊外部連結已移除，改為提示「請用 Safari / Chrome 開啟」。
- 頁尾「建中校慶紀念品 → souvenir.cksc.tw」是刻意保留的外部連結。
- `quasar.config.js` 的 `publicPath` 目前是 `/`，沒有 `/Tickets/` 子路徑。

**待決定**：GitHub Pages（`.github/workflows/deploy.yml`）和 Firebase Hosting 兩套設定都還在，正式網域 `tickets.cksc.tw` 要用哪一個？確定後刪除另一套，並把網域加到 Firebase Auth 的授權網域。

## PARTY-10　下單驗證不足 — 🟡 Done，政策待定

**數量**：每個品項都檢查 `Number.isInteger(q) && q > 0`，單筆最多 20 張。前端表單上限同步為 `min(限購, 20)`。
- `[{qty: 5}, {qty: -3}]` 被拒 ✅（單元測試）
- `0.5` 被拒 ✅（單元測試）
- `0` 被拒 ✅（單元測試）
- 超量被拒 ✅（單元測試）

**校內票資格／每人限購**：前端表單在校內票時只列出六校。但訪客不需登入，伺服器仍無法驗證身分，也無法防止換 email 重複購買。這項限制已寫進 README（Ticket Eligibility and Purchase Limits）。

**待決定**：請擇一。
- **A. 現場查驗學生證**：需在銷售條款加一條「校內票限六校在學學生，入場查驗，每人限購以本人為準」。目前 `SalesPolicyPage.vue` 還是紀念品系統的條款，本來就需要重寫。
- **B. 限定學校 Google 帳號登入後才能買校內票**：需另外開發。

## PARTY-11　確認信時間 UTC；建中老師辦公室欄位 — ✅ Done

1. 確認信時間使用 `timeZone: 'Asia/Taipei'`。單元測試確認 04:30 UTC 顯示為 12:30。
2. 辦公室欄位：
   - 購票表單選「建中老師」時顯示辦公室欄位並會送出。
   - 伺服器只保留老師的辦公室，並清除非六校身分的班級、座號。
   - 確認信、訂單詳情頁、列印收據、後台訂單卡片、Excel 匯出都會顯示辦公室。

**可選**：辦公室目前是選填；若要改成必填，前後端各加一行檢查即可。

## PARTY-12　清理紀念品系統遺留程式碼與 repo 雜項 — ✅ Done（檔案刪除需負責人執行）

**已刪除（程式碼層級）**
- `orderService` 裡的 `generateOrderId`、`SCHOOL_IDENTITIES`、`normalizeOrderPayload`
- mock 模式
- 套餐與贈品邏輯
- 未使用的 boot 檔
- 被註解掉的舊功能

**`ticketTypeService.js`**：已改寫，現在是票種的唯一來源。

**小錯誤**
- `updateOrderDelivery` / `updateOrderPayment` 不再把 `serverTimestamp()` sentinel 放進本地 state，時間立即顯示。
- `SENDER_EMAIL` 改為常數，不再有 `.trim()` 崩潰問題。
- 通知信預覽文字已 escape。

**Repo**
- `.firebase/`、`.idea/`、`.pnp.*`、`.yarn/` 已加入 `.gitignore`。
- Dockerfile 啟動 dev server 是刻意的（本機開發用），README 已註明。

**測試**：新增 functions 單元測試、`createOrder` emulator 測試、Firestore rules 測試（見上方驗證表）。

**待辦（負責人）**：以下檔案刪除時被權限擋下，請手動執行：

```bash
git rm -rf agent .idea .firebase .pnp.cjs .pnp.loader.mjs .yarn yarn.lock public/index.html \
  functions/.env.cksc-merchandis functions/.eslintrc.js src/components/products src/pages/CartPage.vue \
  src/css/cartpage.scss src/stores/cart.js src/utils/pricing.js src/data/catalog.js src/data/ticketTypes.js \
  src/boot/toast.js src/boot/analytics.js
```

## PARTY-13　nodemailer 10 不支援 aws-sdk v2 的 SES 設定 — ✅ Done

- `functions/lib/mailer.js` 使用 `SESv2Client` 並傳入 `{ sesClient, SendEmailCommand }`。
- `functions/package.json` 只保留 `@aws-sdk/client-sesv2`；`aws-sdk`、`@aws-sdk/client-ses`、`googleapis` 已移除。
- **驗證**：單元測試直接使用已安裝的 nodemailer 10.0.10 建立 SES transport，確認不會出現 `Missing SES configuration`，且實際送出 `SendEmailCommand` ✅。
- `sendOrderNotification` 的錯誤會以原訊息回傳給後台；`sendOrderQRCode` 失敗時會寫入可搜尋的 log `[sendOrderQRCode]`。

**待辦（負責人）**
- 設定三個 secret（`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`）。
- 確認 `no-reply@tickets.cksc.tw` 在 SES 已驗證，且帳號已脫離 sandbox。
- 部署後實際下一筆訂單，確認收到確認信。

---

## 負責人待辦清單

1. **換掉 Gmail app password**：它曾以明文寫在 `functions/README.md`，至今仍留在 git 歷史中。
2. 執行 PARTY-12 的 `git rm` 指令，再 commit 所有變更。
3. 決定正式主機（PARTY-9）與校內票驗證政策（PARTY-10），並改寫銷售條款。
4. 設定 SES secrets，然後部署：`firebase deploy -P cksc-ticket --only firestore:rules,functions`。
5. 部署後清查 `users` 裡的角色（PARTY-1），刪除舊的隨機 id 邀請並重新邀請（PARTY-7）。
6. 開賣前的建議項目：
   - 開啟 App Check（PARTY-2）
   - 在 staging 壓測併發下單（PARTY-5）
   - 實際走一次購票流程並確認收到確認信（PARTY-4、13）
