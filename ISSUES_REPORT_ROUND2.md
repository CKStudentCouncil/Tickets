# 上線前修正（程式碼審查）第二輪處理結果

比對最新的 `上線前修正（程式碼審查） › Issues.csv`（PARTY-1 ～ PARTY-27）與第一輪的 `ISSUES_REPORT.md`，把所有未完成的 issue 處理完。

**狀態說明**
- ✅ **Done**：已修正，並有測試佐證
- 🟡 **Done，另有負責人待辦**：程式碼已完成，還需要在 Console 設定或做政策決定
- 🚀 **需部署**：修正在程式碼裡，要部署到 `cksc-ticket` 才會生效

**驗證結果**（本輪修改尚未 commit）

| 測試 | 指令 | 結果 |
|---|---|---|
| Functions 單元測試 | `cd functions && npm test` | 41 / 41 通過（不需任何憑證，部署前會自動執行） |
| Firestore rules（emulator） | `npm run test:rules` | 29 / 29 通過 |
| createOrder 等 functions（emulator） | `cd functions && npm run test:emulator` | 13 / 13 通過 |
| Functions 載入（模擬 `firebase deploy`） | `firebase emulators:exec --only functions,firestore` | 8 / 8 個 function 以 Node 22 成功載入，`.env` 參數讀取正常 |
| 前端 production build | `npx quasar build` | 成功 |

---

## 總覽

| Issue | 優先 | 標題 | 第一輪後 | 本輪結果 |
|---|---|---|---|---|
| PARTY-1 | Urgent | 任何登入者都能把自己升成 super_admin | Done | ✅（維持，測試仍通過） |
| PARTY-2 | Urgent | 訂單集合公開可讀、可直接寫入 | Done | ✅（維持） |
| PARTY-3 | Urgent | createOrder 完全信任前端金額與狀態 | Done | ✅（維持） |
| PARTY-4 | Urgent | 票種資料四個來源對不上 | Done | ✅（維持） |
| PARTY-5 | Urgent | 超賣與限購競態 | Done | ✅（維持；25 併發搶 5 張仍剛好賣 5 張） |
| PARTY-6 | Urgent | 部署設定指向錯誤專案 | Todo | ✅ 🚀 |
| PARTY-7 | High | pendingUsers 權限與管理錯誤 | Done | ✅（維持） |
| PARTY-8 | High | manager 登入被導首頁、掃碼被擋 | Done | ✅（維持） |
| PARTY-9 | High | 連結與 QR Code 指向 souvenir.cksc.tw | Todo | ✅ |
| PARTY-10 | High | 數量驗證不足、校內票與限購可繞過 | Todo | 🟡 |
| PARTY-11 | High | 確認信 UTC；老師辦公室欄位 | Done | ✅（維持） |
| PARTY-12 | Low | 清理遺留程式碼與 repo 雜項 | Backlog | 🟡（檔案刪除需負責人執行） |
| PARTY-13 | Urgent | nodemailer 10 SES 設定 | Done | ✅（維持） |
| PARTY-14 | Urgent | Node.js 20 將於 10/30 除役 | 新 | ✅ 🚀 |
| PARTY-15 | High | 腳本可呼叫 createOrder 預訂光庫存 | 新 | 🟡 🚀（需在 Console 開啟 App Check） |
| PARTY-16 | High | 排程中的演出陣容與故事可提前讀取 | 新 | ✅ 🚀 |
| PARTY-17 | High | 通知信限流以封數計算 | 新 | ✅ 🚀 |
| PARTY-18 | High | 票券總量預設 0 被視為不限量 | 新 | ✅ 🚀 |
| PARTY-19 | High | 票券 QR Code 可被偽造 | 新 | ✅ 🚀 |
| PARTY-20 | Medium | 每日流水號文件爭用 | 新 | ✅ 🚀 |
| PARTY-21 | Medium | 新增演出項目上傳失敗留下無圖項目 | 新 | ✅ |
| PARTY-22 | Medium | 隱藏的自訂主旨覆蓋繳費／取票通知主旨 | 新 | ✅ 🚀 |
| PARTY-23 | Medium | 問卷分數沒有驗證 | 新 | ✅ 🚀 |
| PARTY-24 | Medium | 開賣時間到了購買按鈕不會出現 | 新 | ✅ |
| PARTY-25 | Medium | 確認信寄送失敗沒有重試或補寄 | 新 | ✅ 🚀 |
| PARTY-26 | Low | updatedBy 洩漏工作人員姓名／email | 新 | ✅ |
| PARTY-27 | Low | 常數重複定義、同步註解指錯檔案 | 新 | ✅（重複的死檔需負責人刪除） |

---

## 第一輪標記 Done 的 issue

PARTY-1、2、3、4、5、7、8、11、13 在 Linear 已是 Done。本輪修改後重新執行全部測試，這些 issue 的驗收測試都仍通過，沒有退化。

---

## 第一輪未完成的 issue

### PARTY-6　Firebase 部署設定指向錯誤專案 — ✅ Done（部署需負責人執行）

程式碼部分在第一輪已完成：
- `.firebaserc` 指向 `cksc-ticket`
- predeploy 改為執行單元測試
- `firestore.rules` 已存在

**本輪驗證**
- 以 Functions emulator 模擬 `firebase deploy` 的載入步驟：8 個 function 都能以 Node 22 載入，`functions/.env` 參數讀取正常。
- predeploy 的單元測試在沒有任何憑證的環境下 41 / 41 通過，所以部署時不會卡在這一步。

**負責人待辦**
- `firebase deploy -P cksc-ticket --only firestore:rules,firestore:indexes,functions`
- 部署後到 Console 確認生效的 rules 與檔案一致。

### PARTY-9　連結指向 souvenir.cksc.tw — ✅ Done

- 負責人已確認正式網域為 `https://tickets.cksc.tw`，與前端 `src/config/app.js`、functions `lib/constants.js` 的 `SITE_URL` 一致。
- 單元測試確認兩邊相同，且通知信不含 souvenir 網址。

**部署時請確認**：`tickets.cksc.tw` 已加入 Firebase Auth 授權網域；只保留實際綁定這個網域的那一套 hosting（GitHub Pages 或 Firebase Hosting）。

### PARTY-10　下單驗證不足 — 🟡 Done（預設採現場查驗）

- **數量驗證**（第一輪）：逐項檢查整數且大於 0、單筆最多 20 張，單元測試涵蓋。
- **本輪修正**：先採用 issue 中不需額外開發的方案 A「現場查驗」。
  - 票種頁在校內票顯示「限六校在學學生購買，入場時須出示學生證，資格不符者不得入場」。
  - 有限購的票種顯示「以購票人本人計算，入場時核對身分」。
  - README 已寫明伺服器無法驗證身分的限制。

**負責人待辦**
- `SalesPolicyPage.vue` 仍是紀念品系統的銷售條款，需改寫成舞會條款，並加入上述查驗規定（法律文字不由我代寫）。
- 若要改採方案 B（學校 Google 帳號登入才能買校內票），需另外開發。

### PARTY-12　清理遺留程式碼與 repo 雜項 — 🟡 Done（檔案刪除需負責人執行）

程式碼層面都已完成：
- 死碼已移除
- 小錯誤已修正
- `.gitignore` 已補齊
- 已新增測試：單元 41、rules 29、emulator 13

以下死檔仍在 repo 中（之前的刪除指令被權限擋下，請手動執行）：

```bash
git rm -rf agent .idea .firebase .pnp.cjs .pnp.loader.mjs .yarn yarn.lock public/index.html \
  functions/.env.cksc-merchandis functions/.eslintrc.js src/components/products src/pages/CartPage.vue \
  src/css/cartpage.scss src/stores/cart.js src/utils/pricing.js src/data/catalog.js \
  src/boot/toast.js src/boot/analytics.js
```

注意：`src/data/ticketTypes.js` 已改為存放 `ELIGIBLE_IDENTITIES`（PARTY-27），**不要刪除**，已從清單移除。

---

## 新 issue（PARTY-14 ～ 27）

### PARTY-14　Node.js 20 將於 10/30 除役 — ✅ Done

- `firebase.json` 的 runtime 已是 `nodejs22`，`functions/package.json` 的 `engines.node` 已是 `"22"`（第一輪審查時已處理）。
- 本輪以 emulator 確認 functions 在 Node 22 下正常載入。

**負責人待辦**：10/30 前部署一次 functions。

### PARTY-15　腳本可呼叫 createOrder 預訂光庫存 — 🟡 Done（需開啟 App Check）

**修正**
- **App Check**：前端 `src/boot/firebase.js` 在 `APP_CHECK_SITE_KEY` 有值時啟用 reCAPTCHA Enterprise。
  - `createOrder` 與 `getOrders` 在 `functions/.env` 設定 `ENFORCE_APP_CHECK=true` 後，會拒絕沒有有效 App Check token 的請求。
  - 預設關閉，避免在 Console 設定完成前把所有訂單擋掉。
- **IP 頻率限制**：`ORDER_LIMIT_PER_IP` 可設定每個 IP 每 10 分鐘的訂單上限，預設 0（關閉）。
  - 學校網路與行動網路常有大量買家共用同一個 IP，所以只建議在確認遭到濫用時開啟，並設得寬鬆。
- 其他已有的防護：每人限購、單筆最多 20 張、確認信失敗不會卡住流程（PARTY-25）。

**負責人待辦**（步驟見 README 的 Bot Protection 一節）
1. 在 Firebase Console 註冊 App Check（reCAPTCHA Enterprise），把 site key 填入 `src/config/app.js` 的 `APP_CHECK_SITE_KEY`，然後部署前端。
2. 觀察一天 App Check 數據後，把 `functions/.env` 的 `ENFORCE_APP_CHECK` 改成 `true`，再部署 functions。

**未做**：「未付款訂單逾期自動釋放」需要先訂出付款期限政策，這次沒有實作。目前可由 admin 刪單，名額會自動退回（`releaseOrderStock`）。

### PARTY-16　排程中的演出陣容與故事可提前讀取 — ✅ Done

**修正**
- `publishAt` 改存 Firestore Timestamp。
- Rules：`partyStories` 只有 `enabled == true` 且已到公開時間時才能讀；`partyLineup` 只有到公開時間後才能讀。
  - super admin 仍可讀全部。
  - 容許 5 分鐘時間誤差，讓時鐘稍快的裝置仍能正常查詢。
- 前台 `IntroPage` / `PerformerPage` 改用帶 `where()` 條件的查詢（`src/services/contentService.js`），未公開的資料不會傳到瀏覽器。
  - 陣容頁每 60 秒重新查詢一次，讓新公開的項目自動出現。
- 新增 `partyStories` 的複合索引（`firestore.indexes.json`）。
- **舊資料遷移**：super admin 開啟後台管理頁時，會自動轉換：
  - 字串格式的 `publishAt` → Timestamp
  - 沒有 `enabled` 欄位的舊故事 → 補上 `enabled: true`（否則會從前台消失）
  - 刪除舊的 `updatedBy` / `createdBy`

**驗收**：rules 測試確認前台查詢只回傳已公開項目，未公開、已停用、舊格式的項目都讀不到，super admin 仍看得到草稿。

**原因紀錄**：原本在規則中加上 `publishAt is timestamp` 檢查，實測發現 rules 引擎無法從查詢條件證明這一點，會拒絕合法查詢，因此移除該檢查。字串格式的舊值本來就無法通過時間比較，仍會被擋下。

**負責人待辦**：部署後以 super admin 開一次「舞會介紹管理」和「社團與藝人管理」，讓舊資料完成遷移；並部署 `firestore:indexes`。

### PARTY-17　通知信限流以封數計算 — ✅ Done

**修正**（`functions/lib/notifications.js`）
- **限流改以收件人數計算**：每批 50 位收件人（1 位 To 加 49 位 BCC），以 `SES_RECIPIENTS_PER_SECOND`（預設 14）計算等待時間。3000 位買家約需 3.5 分鐘，而不是原本的 4.5 秒。
- **寄送進度記錄在 `notificationJobs/{jobId}`**：每批成功後更新進度。
  - 執行時間接近上限時，會回傳 `partial`，由後台自動接續。
  - SES 出錯時保存中斷位置，後台顯示「已寄出 X / Y 位」和「繼續寄送」按鈕，從中斷處續寄，**不會重複寄信**。
- function timeout 提高到 540 秒，前端 callable timeout 提高到 560 秒。
  - 原本前端 70 秒逾時會誤報「發送失敗」，工作人員因此重寄，造成重複信件。

**驗收**：單元測試確認 50 位收件人以 14/s 計算會等待 3.57 秒，3000 位買家總計超過 200 秒。

### PARTY-18　票券總量預設 0 被視為不限量 — ✅ Done

**修正**
- 後台新增明確的「不限量」勾選框（`unlimitedStock`）。
- 新票種的總量預設為空白；存檔時必須輸入正整數，或勾選不限量。
- 伺服器改為：沒有勾選不限量時，總量 0 或空白代表「沒有票可賣」。

**驗收**：單元測試與 emulator 測試確認總量為 0 的票種會回傳「剩餘票量不足」，勾選不限量才會無上限販售。

**負責人待辦（重要）**：`settings/ticketTypes` 裡總量為 0 的舊票種，部署後會變成**無法販售**。請到「票務管理」打開每個票種，填入總量或勾選不限量後重新儲存。

### PARTY-19　票券 QR Code 可被偽造 — ✅ Done

**修正**
- 每筆訂單產生無法猜測的 `ticketCode`（72-bit 隨機）。
- 確認信與網站上的 QR Code 都改為 `/admin/orders/{id}?c={ticketCode}`。
- 工作人員掃碼後，訂單頁會比對驗證碼：
  - 相符：顯示「✓ QR 驗證碼相符」。
  - 不符：顯示紅色警告「可能是偽造的 QR Code」，標記已領票前需再次確認。
  - 不是從 QR 開啟：提示先核對購票人身分。
- 工作人員尚未登入時，驗證碼會經登入頁的 redirect 保留下來。

**驗收**：emulator 測試確認每筆訂單都有 `ticketCode`，買家透過 `getOrders` 取得相同的碼來顯示 QR。

### PARTY-20　每日流水號文件爭用 — ✅ Done

**修正**
- **訂單編號**不再使用共用流水號，改為「學校代碼＋日期＋6 碼隨機」，例如 `CKS20261105K7Q2MX`。
  - 隨機碼不含易混淆的 0/O/1/I。
  - 碰撞時自動換號，最多重試 3 次。
  - 舊的流水號格式仍可查詢。
- **安全重試**：前端每次結帳產生一個 `requestId`，遇到 `aborted`、`unavailable`、`deadline-exceeded`、`internal` 時自動重試（最多 3 次，間隔隨機）。伺服器以 `orderRequests/{requestId}` 判斷，重試會回傳同一筆訂單，**不會重複下單**。
- **錯誤訊息**：交易因競爭失敗時回傳「目前購票人數眾多，請稍後再試一次」，不再是籠統的 internal。
- **冷啟動**：新增 `CREATE_ORDER_MIN_INSTANCES` 參數（`functions/.env`），開賣前設為 2～3 可減少冷啟動。

**驗收**
- emulator 測試：同一個 `requestId` 呼叫兩次，回傳同一筆訂單且只扣一次庫存。
- 25 筆同時搶 5 張票，仍剛好成功 5 筆，其餘回傳 `resource-exhausted`。

**限制**：每個票種的已售數量（`ticketSales/{票種}`）仍是單一文件。這是精確防止超賣的必要代價，無法分片。開賣前仍建議在 staging 以 200～500 筆併發壓測。

### PARTY-21　新增演出項目上傳失敗留下無圖項目 — ✅ Done

**修正**（`PerformerManagementPage.vue` 的 `saveItem`）
- 先產生文件 id，再上傳圖片，圖片成功後才一次寫入文件。
- 上傳失敗時什麼都不會寫入，重試也不會產生重複項目。
- 若圖片已上傳、但寫入文件失敗，會刪除剛上傳的圖片。
- 文件寫入成功後，後續步驟（刪除舊圖、重新載入）失敗時，不會誤刪新圖。

### PARTY-22　隱藏的自訂主旨覆蓋繳費／取票通知主旨 — ✅ Done

- **前端**：只有「自訂訊息」會送出主旨。
- **伺服器**：`resolveSubject` 只在 `type === 'custom'` 時採用自訂主旨，其他類型一律使用預設主旨。前後端各自把關。

**驗收**：單元測試重現 issue 的步驟（先填「舞會延期」再切換到繳費），寄出的主旨是「【建中舞會購票系統】繳費通知」。

### PARTY-23　問卷分數沒有驗證 — ✅ Done

**修正**
- **Rules**
  - `scores` 必須剛好是 q4～q25 這 22 題，每題都必須是 1～5 的整數。
  - `identity` / `device` / `issueCount` 必須是問卷提供的選項。
  - `channels` 至少 1 項、`issueTypes` 可為空，兩者都只能包含問卷提供的選項。
- **後台**：平均值與分布圖都只計入 1～5 的整數。

**驗收**：rules 測試確認：
- 問卷頁上的每一個選項、每一種分數都能正常送出。
- `1000000`、`'5'`、`0`、`4.5`、多出的題號、缺題、未知選項都被拒絕。

### PARTY-24　開賣時間到了購買按鈕不會出現 — ✅ Done

**修正**
- 新增 `src/composables/useNow.js`，提供定時更新的 `now`。
- 票種頁每秒更新：開賣前顯示「開賣時間・倒數 X 天 HH:MM:SS」，時間一到自動出現購買按鈕；已結束、未公布開賣時間時也有文字說明。
- 首頁的狀態標籤每 10 秒更新一次。

### PARTY-25　確認信寄送失敗沒有重試或補寄 — ✅ Done

**修正**
- 訂單新增 `emailStatus`：`pending` / `sent` / `failed` / `skipped`，失敗時一併記錄 `emailError`。
- `sendOrderQRCode` 失敗時會重新丟出錯誤並開啟自動重試（`failurePolicy`），最多重試 1 小時；已寄出的不會重寄。
- 新增 `resendOrderEmail` callable（限 admin）。
- 後台訂單卡片顯示確認信狀態與錯誤原因，並有「補寄確認信」按鈕；新增「確認信：寄送失敗／尚未寄出」篩選。

### PARTY-26　updatedBy 洩漏工作人員姓名／email — ✅ Done

- `settings/ticketTypes`、`partyStories`、`partyLineup` 改存 `updatedByUid` / `createdByUid`，不再存姓名或 email。
- 舊的 `updatedBy` / `createdBy` 欄位：
  - 票種設定：下次儲存時整份覆蓋而移除。
  - 故事與陣容：後台開啟時自動遷移並刪除（見 PARTY-16）。

**負責人待辦**：部署後以 super admin 開一次「票務管理」並儲存，清除 `settings/ticketTypes` 上的舊欄位。

### PARTY-27　常數重複定義、同步註解指錯檔案 — ✅ Done（死檔需刪除）

- `src/data/schools.js` 的註解已改為指向 `functions/lib/constants.js`。
- `ELIGIBLE_IDENTITIES`：前端只保留 `src/data/ticketTypes.js` 一份，`ticketTypeService` 改為 re-export。
- **前後端一致性測試**（`functions/test/unit/consistency.test.js`）：`SITE_URL`、學校清單、校內學校、`ELIGIBLE_IDENTITIES`、台灣時間解析，任一不一致時測試就會失敗。部署前會自動執行。
- 剩下的重複定義都在待刪的死檔中：`boot/analytics.js` 的 `trackEvent`、`data/catalog.js` 的學校清單。執行 PARTY-12 的 `git rm` 後即完全消除。

---

## 負責人待辦清單

1. **換掉 Gmail app password**（第一輪提過，仍在 git 歷史中）。
2. 執行 PARTY-12 的 `git rm` 指令，commit 本輪變更（包含新增的 `functions/.env`）。
3. 設定 SES secrets 後部署：`firebase deploy -P cksc-ticket --only firestore:rules,firestore:indexes,functions`，並在 10/30 前完成（PARTY-14）。
4. 部署後：
   - 「票務管理」逐一檢查票種總量並重新儲存（PARTY-18、26）。
   - 以 super admin 開啟「舞會介紹管理」「社團與藝人管理」，完成舊資料遷移（PARTY-16）。
5. 開啟 App Check，觀察後再設定 `ENFORCE_APP_CHECK=true`（PARTY-15）。
6. 改寫 `SalesPolicyPage.vue` 銷售條款，加入現場查驗規定（PARTY-10）。
7. 開賣前：
   - 把 `CREATE_ORDER_MIN_INSTANCES` 設為 2～3，並在 staging 壓測併發下單（PARTY-20）；開賣後改回 0。
   - 確認 `SES_RECIPIENTS_PER_SECOND` 與 AWS 帳號的實際額度一致（PARTY-17）。
