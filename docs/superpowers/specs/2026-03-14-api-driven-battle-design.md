# API-Driven Battle Engine Design

Date: 2026-03-14

## Summary

在現有 `autoArena.user.js` 中新增 API-driven 戰鬥模式，取代 DOM click + 固定 delay 的方式。Token 透過 XHR Hook 從第一次遊戲 API call 攔截取得，取得後自動切換為 API 模式。

## Scope

- **改**：戰鬥迴圈（新增 `startBattleAPI`）、新增 response 解析與 DOM 同步模組
- **不改**：Encounter Mode、UI 按鈕、設定面板框架、Anti-cheat、Alert 系統

## Architecture

```
頁面載入 → hookToken() 安裝 XHR Hook
         → 用戶啟動 auto → startBattle()（現有 DOM click 模式）
         → 第一個 API call 被攔截 → 取得 token
         → 切換到 startBattleAPI()

API 戰鬥迴圈：
  sendAction(mode, target, skill)
    → fetch POST /json
    → parseResponse(response)
    → syncDOM(response)  ← 獨立函數，可禁用
    → decide(state)
    → 立即 sendAction(...)
```

## Key Modules

### `hookToken()`
- Hook `XMLHttpRequest.prototype.send`
- 攔截第一個 POST `/json` 的 request body
- 從 JSON body 提取 `token` 欄位
- 存入 `window._hvToken`
- Hook 完成後不移除（不影響遊戲運作）

### `sendAction(mode, target, skill)`
- `fetch('/json', { method: 'POST', body: JSON.stringify({type:"battle", method:"action", token, mode, target, skill}) })`
- 回傳 parsed JSON response

### `parseResponse(resp)`
從 9+3 個 HTML string 欄位解析出結構化狀態物件：

```js
{
  hp, mp, sp, oc,
  hpP, mpP, spP, ocP,
  buffs: { name: turns },
  alive: [id...],
  elites: [id...],
  monsterHp: { id: width },
  skillReady: [id...],
  itemReady: [id...],
  spiritActive: bool,
  victory: bool,
  isLastRound: bool,
  hasPickup: bool,
}
```

解析方式：
- **vitals**: regex 或 DOMParser 從 `pane_vitals` 提取 `#dvrhd` 等文字和 bar width
- **buffs**: regex match `set_infopane_effect\('([^']+)',\s*'[^']*',\s*(\d+|'autocast')\)` from `pane_effects`
- **monsters**: DOMParser 解析 `pane_monster`，透過 `opacity:0.3` 和 `nbardead.png` 判斷死活
- **skills/items CD**: 檢查 id 是否存在於 `pane_quickbar` / `table_skills` / `table_magic` / `pane_item`
- **victory**: 檢查 `textlog` 是否含 `"Victorious"`
- **isLastRound**: 檢查 `pane_completion` 中 `#btcp` onclick 是否含 `goto_arena` 或 img src 含 `finishbattle`
- **spiritActive**: 檢查 `pane_action` 中 `ckey_spirit` src 是否含 `spirit_a`
- **hasPickup**: 檢查 `pane_item` 中 `ikey_p` 是否存在

### `syncDOM(resp)`
- 獨立函數，可透過設定面板 toggle 禁用
- 將 response 的 HTML string 塞回對應 DOM 元素：
  - `pane_vitals` → vitals 區域（HP/MP/SP/OC bars + 數值）
  - `pane_monster` → `#pane_monster`
  - `pane_effects` → `#pane_effects`
  - `pane_quickbar` → quickbar 區域
  - 勝利時：`pane_completion` → completion 區域
- 禁用時完全跳過，變成盲打模式

### `decide(state)`
- 沿用現有 10 級優先順序邏輯
- 輸入：parseResponse 的結構化狀態
- 輸出：`{ mode, target, skill }` 描述下一個 action
- 與現有邏輯相同但不再讀 DOM，改讀 state 物件

### `startBattleAPI()`
主迴圈：
```
while (autoArena ON) {
  const resp = await sendAction(action.mode, action.target, action.skill)
  const state = parseResponse(resp)
  syncDOM(resp)

  if (state.victory) {
    if (state.isLastRound) → stop + alert CLEARED
    else → battle.battle_continue() (仍用 DOM，待未來測試 API 方式)
    return
  }

  anti-cheat checks (idle loop, low HP, spark of life)

  action = decide(state)
}
```

## Settings Panel Changes

- 新增 toggle: `apiMode`（預設 ON）
  - ON: token 取得後使用 API 模式
  - OFF: 使用原有 DOM click 模式
- 新增 toggle: `syncDOM`（預設 ON）
  - ON: 每次 API response 同步畫面
  - OFF: 盲打模式

## Token Lifecycle

1. 頁面載入時安裝 XHR Hook
2. 任何 API call（喝水、上 buff、攻擊）觸發時攔截 token
3. Token 為 session-based，整場戰鬥有效
4. 頁面 refresh 後需重新攔截（battle_continue 會觸發 refresh）

## Fallback Strategy

- Token 未取得前：使用原有 DOM click 模式（`startBattle`）
- API call 失敗時：停止自動戰鬥 + alert，不 fallback 到 DOM 模式（避免狀態混亂）

## battle_continue Handling

- 勝利後仍使用 `battle.battle_continue()`（DOM 方式）
- 這會觸發頁面 refresh，Tampermonkey 重新注入腳本
- 重新走 hookToken → startBattle → 攔截 token → 切換 API 的流程

## Not In Scope

- Encounter Mode 改造
- battle_continue 的 API 化
- 新 UI 設計
