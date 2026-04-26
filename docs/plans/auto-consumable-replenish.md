# PLAN: 自動補充消耗品 (Auto-Consumable Replenish)

> 框架：agent-skills (idea-refine ✅ → spec ✅ → **plan** → build)
> Spec: [docs/specs/auto-consumable-replenish.md](../specs/auto-consumable-replenish.md)
> Idea-refine: [docs/ideas/auto-consumable-replenish.md](../ideas/auto-consumable-replenish.md)
> Lock 時間：2026-04-26

---

## 切片原則

每個 task 是 **vertical slice** — 從 dashboard UI 到 service worker 到 HV server，端到端能 demo。**不分層**（不會「先寫所有 fetch fn 再寫所有 UI」），每完成一個 task 就有可手動 verify 的功能增量。

依循既有 codebase pattern：
- **Service worker** ([service-worker.js](../../extension/background/service-worker.js)) — `getState/setState` wrapper、`importScripts` 載入子模組、message handler
- **Background 模組** ([translation-updater.js](../../extension/background/translation-updater.js)) — async fetch + cache + lastError + Promise.all
- **Content script** ([ring-of-blood.js](../../extension/content/ring-of-blood.js)) — IIFE + WORLD detection + `wk()` per-world key
- **Dashboard** ([app.js](../../extension/dashboard/app.js)) — `state = chrome.storage.local.get(null)` + toggle render

---

## 依賴圖

```
Stage 1:
  T1 (panel + config UI)
       │
       ▼
  T2 (fetch market detail → 顯示 inventory)
       │
       ▼
  T3 (single-item market buy demo)
       │
       ▼
  T4 (loop 9 items + auto-deposit)
       │
       ▼
  T5 (shop fallback)
       │
       ▼
  T6 (replenishLog persistence + UI)

  ⏸  Checkpoint A — Stage 1 全部 verified

Stage 2:
  T7 (replenishEnabled_<world> toggle UI)
       │
       ▼
  T8 (battle.js Start hook + abort 邏輯)
       │
       ├──▶  T9a (arena.js Start hook)
       │
       └──▶  T9b (ring-of-blood.js Start hook)
       │
       ▼
  T10 (auto-disable autoArena on abort + dashboard alert)

  ⏸  Checkpoint B — Stage 2 全部 verified + regression check
```

---

## Stage 1 — Dashboard 手動補貨（5-7 天）

### T1: Replenish panel 雛型 + per-item config UI

**Scope**：dashboard 加一個 Replenish panel（純 UI），9 個藥水各一行 [low input] / [target input]，下方一顆 [補貨] 按鈕（這個 task 不 wire 動作）。預設 config 寫進 `replenishConfig` storage key。

**Files**:
- [extension/dashboard/index.html](../../extension/dashboard/index.html) — 新增 `<section id="replenishPanel">`
- [extension/dashboard/app.js](../../extension/dashboard/app.js) — 預設 config / render / change handler 寫 storage
- [extension/dashboard/style.css](../../extension/dashboard/style.css) — panel 樣式

**Acceptance**:
- 開 dashboard → 看到 Replenish panel + 9 行 [name | low | target] + [補貨] 按鈕
- 改任一個 input → reload 後保留
- 預設值：Draught/Potion (11191/11195/11291/11295/11391/11395) low=500 target=600；Elixir (11199/11299/11399) low=100 target=200

**Verify**:
1. Load extension → 開 dashboard
2. 確認 panel 出現、9 行
3. 改第 1 個 low 為 700 → 重整 dashboard → 仍是 700
4. DevTools → chrome.storage.local → `replenishConfig` 看到 9 entries

---

### T2: Service worker 接訊息 + fetch market 顯示 inventory（read-only）

**Scope**：[補貨] 按鈕 → dashboard sendMessage `REPLENISH_DRY_RUN` → service worker fetch market consumables 列表頁 → parse 9 個藥水當前庫存 → 回傳 dashboard 顯示「current vs low/target」。**不買、不寫**。

**Files**:
- [extension/background/replenish.js](../../extension/background/replenish.js) — 新增；export `dryRun()` async fn
- [extension/background/service-worker.js](../../extension/background/service-worker.js) — `importScripts("/background/replenish.js")` + 訊息 handler
- [extension/dashboard/app.js](../../extension/dashboard/app.js) — sendMessage + render result

**Acceptance**:
- 按 [補貨] → panel 9 行旁顯示「現有: N」(從 server fetch 的真值)
- 庫存 < low 的 row 標紅；≥ low 的 row 綠

**Verify**:
1. 進 Bazaar 手動買 1 個藥水改變庫存
2. dashboard 按 [補貨] → 數字應和 Bazaar 顯示一致
3. service worker DevTools console 看到 fetch log

**Implementation note**:
- Fetch URL: `https://hentaiverse.org/?s=Bazaar&ss=mk&screen=browseitems&filter=co`
- Parse 用 `DOMParser` + 對 9 個中文藥水名（const lookup）找 `lines.indexOf(name)` 後取 `lines[idx+1]` 當庫存（驗證過的 pattern）
- 失敗 swallow + dashboard 顯示 error

**Carry-over from T1 code review (commit 5806078)**:
- **拆 render path**：T1 的 `renderReplenishPanel()` 一個 fn cover「config UI」+ 未來「status display」，每次 onChanged 都全 rebuild 9 個 input → input focus 易丟。T2 開始把它拆成 `renderReplenishConfig()`（input rows，初次 / 設定變更才 render）和 `renderReplenishStatus()`（inventory 顯示，每次 onChanged render）
- **per-item shallow merge**：T1 的 `getReplenishConfig()` 對整 entry 淺合併，未來擴 entry shape 易產生資料殘缺。T2 加 inventory 之前改成 per-item merge：
  ```js
  Object.fromEntries(REPLENISH_ITEMS.map(({ id }) => [
    id,
    { ...DEFAULT_REPLENISH_CONFIG[id], ...(stored[id] ?? {}) }
  ]))
  ```
- **`btnReplenish` wire 上 fetch 時**：加 `btn.disabled = true` + `try/finally` 防雙擊（仿 `btnTranslationUpdate` pattern）

---

### T3: Single-item market buy（最簡的真實寫操作）

**Scope**：選缺額最大的單一藥水做完整 buy 流程驗證。fetch detail page → 抓 marketoken / pack size / lowest ask / market stock → place buy_order at lowest ask → log result。**只做 1 個藥水、不 fallback、不 deposit**（先假設 market balance 夠）。

**Files**:
- [extension/background/replenish.js](../../extension/background/replenish.js) — 加 `fetchMarketDetail(itemId)`、`placeBuyOrder(itemId, packs, pricePerPack)`
- [extension/background/service-worker.js](../../extension/background/service-worker.js) — 新訊息 type `REPLENISH_SINGLE`

**Acceptance**:
- dashboard 加臨時 [Test Buy 1 Pack] 按鈕（測完 T4 移除）
- 按下 → 該藥水 inventory +unit、market 餘額 -cost、dashboard 顯示「Bought N × Health Potion @ X C」

**Verify**:
1. 記下 Health Potion 庫存 + market 餘額
2. 按 [Test Buy 1 Pack]
3. 進 Bazaar Item Market 確認庫存 +100、餘額 -1860（或 ask 價）
4. log 出現

**Implementation note**:
- Fetch detail page: `?s=Bazaar&ss=mk&screen=browseitems&filter=co&itemid=<id>`
- POST body: `marketoken=<token>&buyorder_batchcount=<packs>&buyorder_batchprice=<price>&buyorder_update=投放买单`
- 注意 `投放买单` 是中文 submit value — 從 button[value] 動態抓避免漢化變動

---

### T4: 9-item loop + auto-deposit

**Scope**：把 T3 邏輯套到 9 個藥水迭代執行，sequential。市場餘額 < `REPLENISH_DEPOSIT_FLOOR (100,000)` 時 deposit (100,000 - current)。market 沒貨先暫停（不 fallback，留 T5）。

**Files**:
- [extension/background/replenish.js](../../extension/background/replenish.js) — 加 `replenishOnce()` loop、`deposit(amount)`、refactor T3 為 helper

**Acceptance**:
- [補貨] 按鈕 wire 真實 `replenishOnce()`
- 9 個 item < low 的全部補到 ≥ target
- market 餘額 < 100k 自動 deposit
- 按一次完成所有缺貨補

**Verify**:
1. 手動把多個藥水庫存降到 < low（例如打 RoB 消耗藥水）
2. 確認 market 餘額 < 100k
3. 按 [補貨] → 觀察：deposit 動作 → 9 個藥水分別 buy_order → 每個庫存 ≥ target
4. dashboard 即時顯示進度（可選）

---

### T5: Shop fallback

**Scope**：market 對某 item 沒貨 / market_stock < shortfall_in_units / buy_order 失敗 → 改用 shop API `?ss=is` `select_count=<剩餘缺額>` 補完。

**Files**:
- [extension/background/replenish.js](../../extension/background/replenish.js) — 加 `shopBuy(itemId, count)`、insert 進 loop

**Acceptance**:
- 模擬 market 缺貨情境（暫時把 detail page 解析的 marketStock hardcode = 0）→ 確認 shop 補完
- 真實情境：剩餘缺額正確走 shop

**Verify**:
1. 暫時把 replenish.js 改成 `marketStock = 0` for one item
2. 按 [補貨] → 該 item 走 shop API
3. log 顯示 `source: 'shop'`
4. 改回 code、整體再跑一次正常

**Implementation note**:
- shop API verified（idea-refine A1 已驗）：`POST /?s=Bazaar&ss=is` body `storetoken=<>&select_mode=shop_pane&select_item=<>&select_count=<>`
- storetoken 來源：fetch `?s=Bazaar&ss=is` → parse `input[name="storetoken"]`

---

### T6: replenishLog 持久化 + dashboard 顯示

**Scope**：每次 replenishOnce 結束 append entry 到 `replenishLog` (FIFO max 100)。dashboard 加 log section 顯示最近 10 筆，可展開看 9 個 item 細節。

**Files**:
- [extension/background/replenish.js](../../extension/background/replenish.js) — 加 `appendReplenishLog(entry)`
- [extension/dashboard/index.html](../../extension/dashboard/index.html) — log section
- [extension/dashboard/app.js](../../extension/dashboard/app.js) — log render
- [extension/dashboard/style.css](../../extension/dashboard/style.css) — log row 樣式

**Acceptance**:
- 補貨後 log 出現新 entry：時間、9 個 item 細節（before / bought / after / source / cost）、totalCost
- 最舊的被擠出（測 100 筆 FIFO）

**Verify**:
1. 跑 3 次補貨
2. dashboard log 顯示 3 筆（最新在上）
3. DevTools storage 看 `replenishLog` array 長度

---

## ⏸ Checkpoint A — Stage 1 完成

**Acceptance gate**:
- 跑 spec.md AC1-AC5（dashboard 補貨完整功能）通過
- regression: 既有 autoArena 自動戰鬥 / 掃蕩 / encounter / RoB 不受影響（手動跑一輪確認）

---

## Stage 2 — Pre-flight Hook（1-2 天）

### T7: replenishEnabled_<world> toggle UI

**Scope**：dashboard 對應世界區塊加新 toggle「補水模式」。預設 OFF。寫 `replenishEnabled_<world>` 到 chrome.storage。

**Files**:
- [extension/dashboard/index.html](../../extension/dashboard/index.html) / [app.js](../../extension/dashboard/app.js) / [style.css](../../extension/dashboard/style.css)

**Acceptance**:
- normal / isekai 各自有「補水模式」toggle
- 改 toggle → reload 保留
- toggle 視覺上接近既有 `autoArena_<world>` toggle 樣式（一致性）

---

### T8: Hook battle.js Start + abort 邏輯

**Scope**：[battle.js](../../extension/content/battle.js) 在自動戰鬥流程開始前（具體點要 read code 找）插入：
1. 若 `replenishEnabled_<world>` = false → 跳過，照原邏輯
2. 否則 sendMessage `REPLENISH_PREFLIGHT` (with world) → wait response
3. response.success = true → 繼續開戰
4. response.success = false → abort（不開戰），dashboard 警示

**Files**:
- [extension/content/battle.js](../../extension/content/battle.js) — Start 點 hook（一行 await sendMessage + 條件 return）
- [extension/background/replenish.js](../../extension/background/replenish.js) — 加 `preflight(world)` 包 replenishOnce + 補不齊判斷
- [extension/background/service-worker.js](../../extension/background/service-worker.js) — `REPLENISH_PREFLIGHT` handler

**Acceptance**:
- toggle OFF → 開戰行為跟之前完全一樣
- toggle ON 且庫存夠 → 開戰前看不出差異（補貨快、無感）
- toggle ON 且庫存少 → 補貨後開戰
- toggle ON 且補不齊 → 不開戰

**Verify**:
1. toggle ON，把 Health Elixir 降到 < low + market 上掛單比 system supply 還貴讓 fallback shop 也買不到（人為構造）→ 開戰指令 → 確認沒進戰鬥 + dashboard 顯示阻斷原因
2. toggle ON，正常情境 → 補完開戰
3. toggle OFF → 行為等同沒裝這 feature

---

### T9a: Hook arena.js Start

**Scope**：對 [arena.js](../../extension/content/arena.js) 同樣 hook（自動掃蕩開始前）。

**Files**: [extension/content/arena.js](../../extension/content/arena.js)

**Acceptance**: 跟 T8 同款，apply 在 arena 自動掃蕩流程

---

### T9b: Hook ring-of-blood.js Start

**Scope**：對 [ring-of-blood.js](../../extension/content/ring-of-blood.js) 同樣 hook（FSM 進入 RoB 戰鬥 / Trio 觸發前）。

**Files**: [extension/content/ring-of-blood.js](../../extension/content/ring-of-blood.js)

**Acceptance**: 跟 T8 同款，apply 在 RoB FSM transition 前

---

### T10: Auto-disable autoArena on abort + dashboard alert

**Scope**：T8/T9 abort 時自動 `setState(autoArena_<world>, false)` + dashboard 對應世界區塊顯示阻斷原因 banner。

**Files**:
- [extension/background/replenish.js](../../extension/background/replenish.js) / [service-worker.js](../../extension/background/service-worker.js)
- [extension/dashboard/app.js](../../extension/dashboard/app.js) — alert UI

**Acceptance**:
- abort 後 `autoArena_<world>` 自動變 false（防 user 沒注意又開戰）
- dashboard 顯示「阻斷：藥水補不齊（缺 Health Elixir 87 個）」之類具體訊息
- user 補完藥水手動再 toggle ON `autoArena_<world>` 才能再開戰

**Verify**:
1. 構造 abort 情境
2. dashboard `autoArena_<world>` toggle 自動關
3. 看到 alert
4. 手動補滿藥水（或 toggle 補水 OFF）→ 重開 autoArena → 正常戰鬥

---

## ⏸ Checkpoint B — Stage 2 完成 + 全 regression

**Acceptance gate**:
- spec.md AC6-AC11 全通過
- 漢化 4 個 userscript 仍正常運作
- 既有自動戰鬥 / 掃蕩 / encounter / RoB 完全不受影響（手動跑各一輪）

---

## Todo Checklist（從上到下做，每個項目 commit 一次）

### Stage 1
- [ ] **T1** Replenish panel + 9 個 per-item config input + 預設 config 寫 storage
- [ ] **T2** Service worker fetch market 列表 → dashboard 顯示 9 個 inventory
- [ ] **T3** 單一 item market buy demo（含 marketoken 取得 + buy_order POST）
- [ ] **T4** 9-item loop + auto-deposit（market balance < 100k）
- [ ] **T5** Shop fallback（market 沒貨 / 失敗 → shop API）
- [ ] **T6** `replenishLog` 持久化 + dashboard log section
- [ ] **Checkpoint A** — AC1-AC5 + regression

### Stage 2
- [ ] **T7** `replenishEnabled_<world>` toggle UI
- [ ] **T8** Hook [battle.js](../../extension/content/battle.js) Start + abort 邏輯
- [ ] **T9a** Hook [arena.js](../../extension/content/arena.js) Start
- [ ] **T9b** Hook [ring-of-blood.js](../../extension/content/ring-of-blood.js) Start
- [ ] **T10** Auto-disable `autoArena_<world>` on abort + dashboard alert
- [ ] **Checkpoint B** — AC6-AC11 + 全 regression
