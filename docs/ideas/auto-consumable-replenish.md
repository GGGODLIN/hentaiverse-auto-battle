# 自動補充消耗品 (Auto-Consumable Replenish)

> 框架：agent-skills (idea-refine → spec → plan)
> Idea-refine 完成：2026-04-25
> 對應 SDD log：`~/.claude/sdd-framework-log.md`

## Problem Statement

How might we 讓 HV 自動化流程中藥水永遠夠用、且絕不打斷既有 battle / arena / RoB 自動跑？

## Recommended Direction

**做法 4：兩階段做。** 階段 A 先在 Dashboard 加 [補貨] 按鈕 + 顯示當前 quick slot 數量，呼叫 Bazaar buy API 補到目標。階段 B 把這個補貨函式掛進 [battle.js](file:///Users/linhancheng/Desktop/work/autoArena/extension/content/battle.js) / [arena.js](file:///Users/linhancheng/Desktop/work/autoArena/extension/content/arena.js) / [ring-of-blood.js](file:///Users/linhancheng/Desktop/work/autoArena/extension/content/ring-of-blood.js) 三個開戰入口，變成 pre-flight 自動觸發。

理由：階段 A 在 1 天內可交付且本身就有 value；同時是 buy API 的 go/no-go 閘門 —
如果 buy API 不通，階段 B 也不能做，先把這個風險單獨爆掉再投資 hook 邏輯。

## Locked Scope (from idea-refine 4 dimensions)

- **Success criteria**：省手動跑商店時間
- **Source**：Bazaar shop API buy（`POST /?s=Bazaar&ss=is`，`select_mode=shop_pane`）
- **Trigger**：Pre-flight only — Battle / Arena / RoB 開始前
- **Item scope**：Restoratives only (HP/MP/SP potions, draughts, elixirs)

## Key Assumptions to Validate (階段 A 同步驗證)

- [x] **A1 — Buy API 通** (2026-04-25 verified via chrome-devtools MCP)：`POST /?s=Bazaar&ss=is` with `select_mode=shop_pane&select_item=11195&select_count=1` → HTTP 200, Credits 1,955,779 → 1,955,679 (−100), HP +1。Health Potion 售價 100 credits。response 為新 Bazaar HTML 含新 storetoken。
- [x] **A2 — storetoken 取得** (2026-04-25 verified)：DOM `input[name="storetoken"]`，11 字元，無 JS global，存於 `<form>` 內。
- [x] **A3 — 藥水 item_id** (2026-04-25 verified)：`dynjs_itemc` 結構為 `{ id: { n: name, q: desc } }`；9 個 restoratives：
  - Health Draught=11191 / Health Potion=11195 / Health Elixir=11199
  - Mana Draught=11291 / Mana Potion=11295 / Mana Elixir=11299
  - Spirit Draught=11391 / Spirit Potion=11395 / Spirit Elixir=11399
- [x] **A4a — 無日購買上限**（user statement 2026-04-25 + 實測 confirm）：9 種 restoratives 商店無限出售
- [ ] **A4b — credits 不夠**：server 怎麼回？(low priority — credits 充足，現實不太會碰)
- [ ] **A5 — 目標數量策略**：寫死、還是 dashboard 可調、還是每種獨立？
  → 預設假設：階段 A 寫死（HP/MP/SP 各 50），階段 B 再決定要不要開放

## MVP Scope (階段 A)

**進 scope**：

- Dashboard 新增 panel：顯示 9 個藥水（HP/MP/SP × Draught/Potion/Elixir）當前 quick slot 數量 + 1 顆 [補貨到目標] 按鈕
- Service worker 接 `REPLENISH_CONSUMABLES` 訊息：抓 storetoken → 連續 9 個 buy 請求 → 回報結果
- 失敗時 dashboard 顯示錯誤；不影響其他自動化

**不在 scope**：階段 B 的 pre-flight hook（驗證完 A1~A4 再做）

## Not Doing (and Why)

- **Infusions / Scrolls** — Phase 1 鎖了「Restoratives only」；要加擴 scope 時再開新 spec
- **Battle-mid 自動補** — Hot path 改動風險高且超出「省商店時間」success criteria
- **Daily alarm restock** — 不滿足「打很多場中途用完」的場景
- **從 Item Box 拉到 quick slot** — 假設 inventory 沒囤貨，直接從 shop 買最直接
- **動 userscript 模式** — 按 [CLAUDE.md](file:///Users/linhancheng/Desktop/work/autoArena/CLAUDE.md) extension only

## Open Questions (進 spec 前要決)

- 階段 B 補貨失敗時：abort 開戰、還是 warn 後照開？
- 目標數量是否要 per-world (normal / isekai 各自獨立)？
- 是否要記錄補貨 log 進 [battle.js](file:///Users/linhancheng/Desktop/work/autoArena/extension/content/battle.js) 既有的 `battleLog`？
