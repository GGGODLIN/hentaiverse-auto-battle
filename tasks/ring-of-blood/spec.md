# SPEC: Ring of Blood Auto-Battle

> Framework: agent-skills (spec-driven-development)
> Spec date: 2026-04-25
> Related: extends `extension/` translation/arena/encounter automation

---

## 1. Objective

自動化 HV **Ring of Blood (浴血擂台)** 的 daily token 消耗策略，**作為 Arena Sweep 結束後的 follow-up step**：

```
when arena sweep ends (all difficulties done OR sweep manually disabled OR
                       stamina paused — see §7 A8 for stamina edge case):
  if rbAutoEnabled and rbStateToday has unfinished work:
    open ?s=Battle&ss=rb tab
    讀目前 Tokens of Blood (X)
    if X >= 5 and not fsmDone:
      打 Flying Spaghetti Monster (FSM, cost 5)
      讀新 token 數 Y (戰鬥中可能掉新 token)
    if Y > 15 and not trioDone:                    # 嚴格大於，保證 Trio 後仍 >= 5
      打 Triple Trio and the Tree (Trio, cost 10)
```

整合 trigger：sweep 結束時自動接續 RoB；toggle ON 那刻若 sweep 不在跑則立即評估。**不**自帶 daily reset auto-trigger — RoB 動作完全 piggyback 在 sweep 結束點上。

**Target user**: repo 擁有者本人（自用）。獨立 toggle，跟既有 Arena Sweep / Encounter Farming / Unattended 並列。

**為何不依賴名稱識別**：使用者裝了第三方漢化，挑戰名變成「飞行意大利面怪物」「大树十重奏」。所以**用入場 cost (5 / 10)** 唯一識別目標 challenge，名稱漢化不影響。

---

## 2. Commands

無 build。Manual e2e via Chrome unpacked extension。

| 操作 | 步驟 |
|---|---|
| 開發載入 | 跟既有相同：`chrome://extensions` → reload |
| 觸發 | Dashboard → toggle 「Ring of Blood」 ON；或 daily reset 自動觸發（若 toggle ON） |
| 觀察狀態 | Dashboard 顯示 `rbStateToday` (FSM / Trio done) + 目前 token 數 |
| Debug | service worker DevTools console；RoB tab page console |

---

## 3. Project Structure

### 新增
- `extension/content/ring-of-blood.js` — match `*://hentaiverse.org/?s=Battle&ss=rb*`，document_idle，讀 token + challenges → 通知 SW；接收 SW 指令 → 點對應 challenge 進入戰鬥

### 修改
- `extension/manifest.json` — `content_scripts` 加 ring-of-blood.js entry
- `extension/background/service-worker.js`:
  - 新 message handler `RB_PAGE_READY`（content script 通知 SW 頁面就緒，附 token 數）
  - 新 helper `maybeTriggerRb()`：判斷是否該開 RoB tab（rbAutoEnabled + 有未完成 phase）
  - `handleArenaPageReady` 的 **`all done` 分支**結尾呼叫 `maybeTriggerRb()`（sweep 完成 → 接 RoB）
  - `handleArenaPageReady` 的 **`stamina depleted` 分支**結尾呼叫 `maybeTriggerRb()`（sweep 暫停 → 仍接 RoB；RoB single-round 吃 stamina 比 sweep 少，可能還打得動 — 由 RoB 戰鬥邏輯自己 handle）
  - 新 message handler `SET_RB_AUTO`（dashboard toggle 切換）
  - `SET_RB_AUTO` ON 那刻若 sweep 不在跑 → 立即 `maybeTriggerRb()`
  - `BATTLE_COMPLETE` 加處理 `effectiveType === "rb"` 分支（mark fsmDone/trioDone，回 RoB 頁繼續 or 結束）
  - `checkDailyReset` 加 `rbStateToday` reset
- `extension/dashboard/index.html` — controls section 加 1 row「Ring of Blood」
- `extension/dashboard/app.js` — 加 toggle handler + 狀態顯示（FSM / Trio done flags + tokens）
- `extension/dashboard/style.css` — 沿用既有 toggle-btn / control-row 樣式（多半不需要新 CSS）

### 不動
- `extension/content/battle.js` — 0 改動。combat AI 直接複用（user 確認 RoB 戰鬥畫面 DOM 跟 Arena 一致）。

### Storage 新 keys

```js
rbAutoEnabled: false                                  // toggle
rbStateToday: { day: "YYYY-MM-DD", fsmDone: false, trioDone: false }
rbReserveTokens: 5                                    // 預留量 (參數化但暫不暴露 UI)
rbTrioMinAfterFSM: 15                                 // Trio 觸發閾值 (>15 才打)
rbTokens: number ?? null                              // 上次讀到的 token (給 dashboard 顯示)
rbTabId: tabId ?? null                                // 當前 RoB tab
```

`battleContext` 既有 key 擴增 type：
```js
{ type: "rb", phase: "fsm" | "trio", world: "normal" }
```

### Challenge identification

`#arena_list tbody tr` 內每個 row 第 6 個 `<td>` 是「入場消耗」，文字含數字（例如 "5 令牌"）。row 第 8 個 `<td>` 是 `<img>` 啟動按鈕：
- 可打：`src="/y/arena/startchallenge.png"` + `onclick="init_battle(id, cost, token)"`
- 不可打：`src="/y/arena/startchallenge_d.png"` + 無 onclick

ring-of-blood.js 用 `cost === 5` 識別 FSM，`cost === 10` 識別 Trio。

### Entry mechanism

頁面 `init_battle()` 含 `confirm()` 對話框會卡 content script。**繞過方式**：直接從 onclick 字串萃取 `(id, cost, token)`，set `#initid` / `#inittoken`，呼叫 `#initform.submit()`。

---

## 4. Code Style

跟既有 vanilla JS 一致：

- IIFE / 函式作用域包覆
- 2 空格縮排
- 無註解（除非真的非顯而易見）
- pure function 為主
- `??` 而非 `||` 做 fallback
- `console.log` 內容用 `JSON.stringify`
- 不引入 build / 測試 framework / TypeScript

---

## 5. Testing Strategy

無自動化測試。透過 manual AC + regression。

### Acceptance Criteria

| # | 情境 | 預期 |
|---|---|---|
| AC1 | rbAutoEnabled=ON, token=20, sweep 跑完 (all done) | sweep 完成 notification → 自動 switch tab 到 RoB → 打 FSM → 重讀 token → 打 Trio → 標記 done |
| AC2 | toggle ON, token=10 | 打 FSM → 剩 5 → 不打 Trio（5 不 > 15）→ 標記 trioDone (skip) |
| AC3 | toggle ON, token=4 | log「token insufficient for FSM」→ 不打 FSM → 不打 Trio → 標記 fsmDone+trioDone (skip) |
| AC4 | toggle ON, token=15 | 打 FSM → 剩 10 → 不打 Trio（10 不 > 15）|
| AC5 | toggle ON, token=21 | 打 FSM → 剩 16 → 打 Trio → 剩 6 ≥ 5 ✓ |
| AC6 | rbAutoEnabled=OFF | 開 `?s=Battle&ss=rb` 頁無任何自動行為；sweep 結束也不觸發 RoB |
| AC7 | FSM 戰敗 | HV 機制：今天 FSM 不可再戰 → log「FSM defeated」→ 標記 fsmDone → **仍評估 Trio**（token 條件滿足仍打 — Trio 是獨立 challenge） |
| AC8 | 同日重新 toggle OFF→ON | 不重打已 done 的 phase；若兩個都 done → log「all done today」直接退出 |
| AC9 | 跨 game day (8am 後) | `rbStateToday.day` mismatch → reset → 重新走流程 |
| AC10 | rbAutoEnabled=ON 那刻 sweep 在跑 | 不立即觸發 RoB；等 sweep 結束才接續 |
| AC11 | rbAutoEnabled=ON 那刻 sweep 不在跑 | 立即 `maybeTriggerRb()` |
| AC12 | sweep 因 stamina < threshold paused | 仍 trigger RoB（RoB single round 吃 stamina 較少） |
| AC13 | Regression | Arena Sweep / Encounter / Unattended 不被影響；漢化 panel 仍顯示 |

### Regression

打開漢化 + Arena Sweep + Encounter + RoB toggle 全 ON，跑一輪：
- Arena Sweep 不被 RoB tab 干擾
- Encounter 30min cycle 不被打斷
- Dashboard 各 stats 正確更新
- battleLog 有 RB / arena / encounter 三類紀錄

---

## 6. Boundaries

### Always
- 所有自動行為僅在 `rbAutoEnabled = true` 時觸發；OFF 時開 RoB 頁絕對無副作用
- Token 不足、戰敗、無 challenge 可打 → swallow + log，不阻斷其他 autoArena 任務
- Cost (5/10) 是 challenge 識別 source-of-truth；不依賴名稱
- 跨 game day 透過 `rbStateToday.day` vs `getGameDay()` 比對自動 reset
- 戰鬥畫面複用 [extension/content/battle.js](../../extension/content/battle.js)；不複製 combat AI
- 繞過 page `init_battle()` 的 `confirm()` 對話框（直接 form submit）

### Ask First
- 修改既有 [extension/content/battle.js](../../extension/content/battle.js) combat AI 邏輯
- 改既有 storage key (例如 `battleContext`) 的 shape（**新增** type/phase field 不算 breaking — 不問）
- 重組既有目錄結構

### Never
- 不打 cost ∈ {5, 10} 以外的 RoB challenge
- toggle OFF 時不做任何 DOM 修改 / 網路請求
- 不混進 isekai world（RoB 只在 normal）
- 不重複 commit user 的 in-progress M 改動 (battle.js / app.js / SW.js)
- 不暴露 `rbReserveTokens` / `rbTrioMinAfterFSM` 到 dashboard UI（保留 storage 可手調，但不放 settings panel — 避免 UI 過擠）

---

## 7. 預設假設（spec 階段確認，後續 plan/build 不再回頭）

- **A1**：RoB 兩 world 獨立跑（normal 跟 isekai 各自有 toggle、各自的 token 數、各自的 daily state）。Isekai URL = `https://hentaiverse.org/isekai/?s=Battle&ss=rb`，規則跟 normal 完全相同（FSM 5 token、Trio 10 token、戰敗當日不可重戰）
- **A2**：cost ∈ {5, 10} 唯一識別 FSM / Trio（HV 不會在 RoB 加另一個 5 或 10 cost challenge；如未來加，cost 條件會誤觸發）
- **A3**：Trio 觸發條件採 strict `>15`（按 user 字面「超過 15」）
- **A4**：FSM/Trio 戰敗 → 標記 done（HV 機制：當日該 challenge 不可再戰，不是 design choice）
- **A5**：`rbReserveTokens` / `rbTrioMinAfterFSM` hard-coded 預設值（5 / 15），不放 dashboard UI
- **A6**：**Sweep 結束**（all done / stamina paused / 手動 OFF）為 RoB 唯一自動 trigger 來源；不獨立掛 daily alarm
- **A7**：toggle ON 那刻：
  - 若 sweep 仍在跑 → 不立即觸發；等 sweep 結束才接續
  - 若 sweep 不在跑 → `maybeTriggerRb()` 立即跑
- **A8**：sweep 因 `stamina < threshold` paused 也 trigger RoB；RoB single-round 戰鬥本身 stamina cost 比 arena round 少，可能仍打得動。若 RoB 戰鬥本身因 stamina 真的失敗 → 走 AC7 失敗路徑（標記 done 不重試）
- **A9**：戰鬥結束（victory/defeated）後 SW 透過 update RoB tab url 回 `?s=Battle&ss=rb` 重新評估下一個 phase
