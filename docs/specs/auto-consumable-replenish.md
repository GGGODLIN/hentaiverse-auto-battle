# SPEC: 自動補充消耗品 (Auto-Consumable Replenish)

> 框架：agent-skills (idea-refine done → spec → plan → build)
> Idea-refine: [docs/ideas/auto-consumable-replenish.md](../ideas/auto-consumable-replenish.md)
> Lock 時間：2026-04-25
> SDD log：`~/.claude/sdd-framework-log.md`

---

## 1. Objective

讓 HV 自動化流程的 9 種 restoratives（HP / MP / SP × Draught / Potion / Elixir）保持充足。使用者按 dashboard [補貨] 或 開戰前自動 trigger，**省手動跑 Bazaar + 順帶省 credits（market 比 shop 約 5× 便宜）**。

**目標使用者**：repo 擁有者本人（自用，private 範圍）。

---

## 2. 範圍 — 兩階段

| Stage | 內容 | 預估 |
|---|---|---|
| **1** | Dashboard 補貨按鈕 + per-item config + market primary + 自動儲值 + shop fallback + replenishLog panel | 5-7 天 |
| **2** | Pre-flight hook：per-world 「補水」toggle（預設 OFF）；toggle ON 時 battle / arena / RoB Start 前檢查 & 補；補不齊則 **abort**（不進戰鬥）；toggle OFF 時跳過整個流程 | 1-2 天 |

### Restoratives 預設 config（per-item，dashboard 可調）

| ID | 名稱 (漢化) | Market 單位 | 預設 low（補貨閾值）| 預設 target（補到）|
|---|---|---|---|---|
| 11191 | 体力长效药 (Health Draught) | 100 包 | 500 | 600 |
| 11195 | 体力药水 (Health Potion) | 100 包 | 500 | 600 |
| 11199 | 终极体力药 (Health Elixir) | 1 件 | 100 | 200 |
| 11291 | 法力长效药 (Mana Draught) | 100 包 | 500 | 600 |
| 11295 | 法力药水 (Mana Potion) | 100 包 | 500 | 600 |
| 11299 | 终极法力药 (Mana Elixir) | 1 件 | 100 | 200 |
| 11391 | 灵力长效药 (Spirit Draught) | 100 包 | 500 | 600 |
| 11395 | 灵力药水 (Spirit Potion) | 100 包 | 500 | 600 |
| 11399 | 终极灵力药 (Spirit Elixir) | 1 件 | 100 | 200 |

設定走 `chrome.storage.local` key `replenishConfig`，**global**（不 per-world，藥水庫存 server-side 全帳號共用）。

---

## 3. Commands

無 build process（vanilla JS Manifest V3 extension）。

| 操作 | 指令 / 步驟 |
|---|---|
| 開發載入 | Chrome → `chrome://extensions` → Load unpacked → 選 `extension/` |
| 重載 | extension 頁面點 reload；content script 改動需重整目標頁 |
| 手動觸發補貨 | Dashboard → [補貨] 按鈕 |
| 看補貨記錄 | Dashboard → Replenish panel → log list |
| 清除設定（debug）| DevTools → Application → Storage → Extension Storage → 刪 `replenish*` keys |

---

## 4. Project Structure

新增 / 修改：

```
extension/
  manifest.json                       ← 改：bump 4.1 → 4.2
  background/
    service-worker.js                 ← 改：加 message handler REPLENISH_CONSUMABLES
    replenish.js                      ← 新：核心補貨邏輯（fetch market / shop / deposit）
  dashboard/
    index.html                        ← 改：加 Replenish panel
    app.js                            ← 改：補貨 button、per-item config UI、log render
    style.css                         ← 改：Replenish panel 樣式
```

階段 2 才動：

```
extension/
  content/
    battle.js                         ← 改：Start hook 觸發 REPLENISH_CONSUMABLES
    arena.js                          ← 改：同上
    ring-of-blood.js                  ← 改：同上
  dashboard/
    app.js                            ← 改：對應世界 toggle 旁的失敗警示
```

### chrome.storage 結構

```js
'replenishConfig'      → { '11195': { low: 500, target: 600 }, ... }   // 9 entries
'replenishLog'         → [{ time, items: [{ id, before, bought, after, source: 'market'|'shop', cost }], totalCost, world?, abortedStart? }, ...]   // 最多 100 筆，FIFO
'replenishEnabled_normal' → boolean   // Stage 2 per-world toggle，預設 false
'replenishEnabled_isekai' → boolean   // Stage 2 per-world toggle，預設 false
```

既有 keys（`battleLog`, `lastBattleStatus`, `autoArena_<world>`, `translation:*` 等）不變動。

---

## 5. Core Logic（[replenish.js](../../extension/background/replenish.js)）

### 主流程

```
async function replenishOnce(world?):
  results = []
  for itemId in [11191, 11195, 11199, 11291, 11295, 11299, 11391, 11395, 11399]:
    cfg = config[itemId]
    detail = await fetchMarketDetail(itemId)          // GET ?s=Bazaar&ss=mk&...&itemid=<id>
    inv = detail.yourInventory
    if inv >= cfg.low: continue

    shortfall = cfg.target - inv
    unit = detail.packSize                            // 100 or 1
    askPricePerPack = detail.lowestAskPerPack
    marketStockUnits = detail.marketStockUnits
    marketBalance = detail.marketBalance
    marketoken = detail.marketoken

    packsNeeded = ceil(shortfall / unit)
    actualPacks = min(packsNeeded, floor(marketStockUnits / unit))
    marketCost = actualPacks * askPricePerPack

    if actualPacks > 0:
      if marketBalance < max(marketCost, REPLENISH_DEPOSIT_FLOOR):
        depositAmount = REPLENISH_DEPOSIT_FLOOR - marketBalance
        await deposit(marketoken, depositAmount)
        marketoken = await refetchMarketoken(itemId)  // refresh after deposit
      await placeBuyOrder(marketoken, itemId, actualPacks, askPricePerPack)

    remaining = shortfall - actualPacks * unit
    if remaining > 0:
      storetoken = await fetchStoretoken()            // GET ?s=Bazaar&ss=is
      await shopBuy(storetoken, itemId, remaining)    // POST select_count=remaining

    results.push({ id: itemId, before: inv, bought: shortfall - max(0, remaining_after_shop), source, cost })

  appendReplenishLog({ time, items: results, totalCost, world })
  return summary
```

### Constants

```js
const REPLENISH_DEPOSIT_FLOOR = 100_000           // market balance 不夠就 deposit 補到這
const REPLENISH_LOG_MAX = 100
const RESTORATIVE_IDS = [11191, 11195, 11199, 11291, 11295, 11299, 11391, 11395, 11399]
```

---

## 6. Code Style

跟隨既有 [extension/content/battle.js](../../extension/content/battle.js) / [translation-updater.js](../../extension/background/translation-updater.js) 風格 + 全域偏好：

- IIFE / 函式作用域包覆（content script、service worker 環境）
- 2 空格縮排、無註解（除非真的非顯而易見）
- pure function 為主
- `??` 而非 `||` 做 value fallback
- `console.log` 內容用 `JSON.stringify()`
- ES modules：service worker 可用 `import`；content script 用傳統 script tag 載入順序

---

## 7. Testing Strategy

無自動化測試框架。透過 **acceptance criteria 手動驗證** + **regression 檢查 autoArena 既有功能**。

### Acceptance Criteria

| # | 情境 | 預期 |
|---|---|---|
| AC1 | Dashboard 點 [補貨] | 9 種藥水比對 inventory vs config，缺額（< low）自動補到 target；log panel 顯示每筆來源 + 成本 |
| AC2 | Per-item config 改 target=300 點補貨 | 該藥水補到 300（其他不動）|
| AC3 | Market 缺貨（marketStock < shortfall）| 部分 market + 剩餘走 shop fallback 補完 |
| AC4 | Market balance < 100,000 | 補貨前自動 deposit 補到 ≥ 100,000；log 註明 |
| AC5 | 庫存全部 ≥ low | [補貨] 按下去什麼都不做（log 註明 nothing to do）|
| AC6 | 階段 2 — `replenishEnabled_<world>` = false | 完全跳過補貨流程，戰鬥正常開（行為等同階段 1 沒做時）|
| AC7 | 階段 2 — toggle ON 且補貨成功 | 戰鬥正常開（無延遲感知）|
| AC8 | 階段 2 — toggle ON 且補貨失敗（market 沒貨 + shop 也補不齊）| **abort 不進戰鬥**；對應世界 `autoArena_<world>` toggle 自動關閉 + dashboard 顯示阻斷原因 |
| AC9 | 既有 autoArena 自動戰鬥（toggle OFF 時）| 不受影響（regression check）|
| AC10 | 既有掃蕩 / encounter / RoB | 不受影響（regression check）|
| AC11 | 漢化全開 | 補貨 fetch parse 仍 work（fetch 拿 raw HTML 不含漢化，selector / token 不依賴中文文字）|

---

## 8. Boundaries

### Always
- `replenishEnabled_<world>` = false 時：完全跳過補貨；**不可阻斷既有自動戰鬥**
- `replenishEnabled_<world>` = true 時：補不齊則 abort + 自動關 `autoArena_<world>`（user opt-in 才會 abort）
- 9 個 restoratives only — Infusions / Scrolls / Powerups / 其他 restorative (Energy Drink / Last Elixir) 不補
- `chrome.storage` namespace `replenish*` 與既有 keys 不衝突
- 所有 fetch / token 處理在 service worker（content script 不碰）
- userscript 模式 [autoArena.user.js](../../autoArena.user.js) 完全不動

### Ask First
- 動 [battle.js](../../extension/content/battle.js) / [arena.js](../../extension/content/arena.js) / [ring-of-blood.js](../../extension/content/ring-of-blood.js) 既有邏輯（階段 2 只能在 Start 點加一行 sendMessage `REPLENISH_CONSUMABLES`，其他不動）
- 擴 scope（Infusions / Scrolls / 其他 items）
- `replenishConfig` schema 變動
- 改 `REPLENISH_DEPOSIT_FLOOR = 100_000` 預設值

### Never
- 不從 Item Box 拉藥水到 quick slot（從 server inventory 補，不是 quick slot 補）
- 不對 HV market 掛賣單（只下買單 instant fill at lowest ask）
- 不暴露 `storetoken` / `marketoken` 到 dashboard UI 或 log
- 不 commit 任何 token / 帳戶 credits 數值到 repo
- 不在 content script hot path 跑網路請求；fetch 只在 service worker
- 不重新散佈第三方 script

---

## 9. 預設假設（spec 階段 lock，後續 plan / impl 不再回頭）

- **A1**：shop API `?s=Bazaar&ss=is` `select_count=N` 一次買 N 件，server 算總價 + clamp（**不散買 N 次**）
- **A2**：market `buyorder_update` with `buyorder_batchprice = lowest_ask` 會 instant fill（已驗證 lowest ask 高於我下單價會 queued）
- **A3**：`storetoken` / `marketoken` 每次操作前**重新 fetch 對應頁面取得**（會 rotate）
- **A4**：「系統店直接供货价」是 detail page reference，**不對應另一個 API endpoint**；shop API `?ss=is` 才是實際 fallback
- **A5**：市場餘額閾值 `REPLENISH_DEPOSIT_FLOOR = 100,000` 寫死，dashboard 可選 expose
- **A6**：補貨 sequential per-item（不 parallel），避免 token / 餘額 race
- **A7**：9 個藥水的中文名 / market 單位（100 或 1）寫死在 const（穩定 game data，不動態 detect）
- **A8**：market lowest ask > 系統店供货价的情況極罕見；Stage 1 不做 price comparison（user 選 D2=b：市場永遠優先）
- **A9**：fetch market detail page 同時拿到：marketoken / inventory / pack size / lowest ask / market stock / market balance / account balance — 一次 GET 六鳥
- **A10**：shop API `select_count=N` 大量買若 server clamp（庫存有限），response 仍 200；errorKw 偵測涵蓋此情況
- **A11**：Stage 2 toggle = `replenishEnabled_<world>` per-world boolean，與 `autoArena_<world>` 並列在 dashboard。預設 false（opt-in），避免新功能意外 block 既有自動戰鬥流程
- **A12**：「補不齊」定義 = 跑完 market + shop fallback 後，至少 1 個 restorative 仍 < `low`
