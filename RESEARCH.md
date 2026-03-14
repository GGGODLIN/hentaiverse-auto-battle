# HentaiVerse API 逆向研究筆記

研究日期：2026-03-13 ~ 2026-03-14
完整研究記錄另存於：`/Users/linhancheng/Desktop/work/HV_cheat/README.md`

---

## 研究目的

逆向工程 HentaiVerse 的戰鬥與商店 API，尋找可利用的漏洞或可優化 autoArena 腳本的技術細節。

## 結論

**HV 後端驗證非常完整，未發現可利用漏洞。** 所有測試的攻擊向量（參數竄改、CD bypass、負數、溢位等）都被 server-side 驗證擋下。

---

## Battle API 研究

### 端點與格式
- `POST /json`，Content-Type: `application/json`
- Payload: `{type:"battle", method:"action", token:"<session_token>", mode:"attack|magic|items|defend", target:<N>, skill:<N>|"ikey_N"}`

### Token 機制
- Session-based，可重複使用（不是 one-time-use）
- 嵌在 JS 的 `api_call` 函數中，不在 DOM hidden input
- 長度 11 字元

### Mode 規則
- 普通攻擊：`mode:"attack", skill:0`
- 所有技能（包括物理技）：`mode:"magic", skill:<numeric_id>`
- 道具：`mode:"items", skill:"ikey_N"`
- 防禦：`mode:"defend"`

### Skill ID 對照表
```
逃跑: 1001, 掃描: 1011
Shield Bash: 2201, Vital Strike: 2202, Merciful Blow: 2203
火焰: 111/112/113, 冰霜: 121/122/123, 閃電: 131/132/133
治療 Cure: 311, Regen: 312
Buffs: 411~432
道具: "ikey_1"~"ikey_5"
```

### 測試結果

| 測試項目 | 結果 |
|---------|------|
| 無效 skill ID | 降級成普通攻擊（server fallback） |
| 額外欄位 | 忽略（server 只讀已知欄位） |
| 攻擊死掉的目標 | 拒絕 |
| 錯誤 Token | 拒絕 |
| CD 中的技能 | 拒絕，回傳 "Cooldown is still pending for {skill}" |
| 不同技能輪替 | 允許（每個技能有獨立 CD） |
| 直接 call API 繞過 UI CD | 無效，CD 是 server-side 驗證 |

### 對 autoArena 的啟示
- 目前腳本的 DOM click 方式和直接 API call **效果一樣**，沒有速度優勢能繞過限制
- Skill rotation（不同技能輪替）是合法策略，腳本已經在做（qb7→qb8→qb9）
- CD 偵測用 DOM 檢查（元素是否存在）是正確做法，和 server 行為一致

---

## Shop API 研究

### 端點與格式
- `POST /?s=Bazaar&ss=is`，Content-Type: `application/x-www-form-urlencoded`
- Payload: `storetoken=<csrf_token>&select_mode=item_pane|shop_pane&select_item=<item_id>&select_count=<quantity>`

### 前端邏輯（ItemShop 類別）
- `set_count()` 用 `Math.max(0, Math.min(a, r))` 限制數量（r = 庫存上限）
- 價格不在 payload 中，server 自己查表計算
- storetoken 是 CSRF 防護 token

### 測試結果

| 測試項目 | Credits 變化 | 結果 |
|---------|-------------|------|
| 超大數量（遠超庫存） | 只賣出實際庫存量 | Server clamp |
| 負數 (-100) | 無變化 | Server 拒絕 |
| 買模式 + 負數 | 無變化 | Server 拒絕 |
| 小數 (0.5) | 無變化 | Server 拒絕 |
| Int 溢位 (2147483648) | 賣出全部庫存 | Server clamp 到實際持有數 |

---

## 技術筆記

### XHR Hook（攔截遊戲 API）
```javascript
const origOpen = XMLHttpRequest.prototype.open;
const origSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function(method, url) {
  this._url = url;
  return origOpen.apply(this, arguments);
};
XMLHttpRequest.prototype.send = function(body) {
  // 攔截 request/response
  return origSend.apply(this, arguments);
};
```

### 遊戲 JS 物件
- `battle`：`lock_action(el, 1, 'magic', skillId)`, `process_action`, `battle_continue`, `set_mode`, `commit_target`
- `common`：`number_format`
- `dynjs_itemc`：物品 ID → 名稱對照

### textlog 格式
- Response 中 `textlog` 是 `[{t: "HTML string"}, ...]` 陣列

### Buff 偵測
- `#pane_effects` 子元素的 `onmouseover`
- 格式：`set_infopane_effect('BuffName', 'description', turnsLeft)`

---

## Battle API Response 結構研究

研究日期：2026-03-14
方法：透過 XHR Hook 攔截 + 直接 fetch `/json` 驗證

### Response 欄位

每次 `POST /json` 戰鬥 action 的 response 包含 **9 個基本欄位**，全部都會回傳（不是差異更新）：

| 欄位 | 型別 | 內容 |
|------|------|------|
| `pane_vitals` | HTML string | HP/MP/SP/OC 數值（`#dvrhd` 等）+ bar 寬度（`414px` = 100%） |
| `pane_effects` | HTML string | 所有 buff，含 `set_infopane_effect('Name', 'desc', turnsLeft)` |
| `pane_monster` | HTML string | 所有怪物完整 HTML（HP bar、名稱、死活狀態） |
| `pane_quickbar` | HTML string | qb1~qb4 快捷欄（CD 中的技能不出現） |
| `table_skills` | HTML string | 物理技能列表（CD 中不出現），如 1001, 1011, 1111, 2201~2203 |
| `table_magic` | HTML string | 魔法技能列表（CD 中不出現），如 111~432 |
| `textlog` | JSON array | `[{t: "文字", c?: "b"}]`，c:"b" 表示 buff/事件相關 |
| `healthflash` | boolean | 低血量閃爍指示 |
| `exp` | number | 當前經驗值 |

勝利時額外出現 **3 個欄位**：

| 欄位 | 型別 | 內容 |
|------|------|------|
| `pane_completion` | HTML string | `#btcp` 按鈕（中間輪 `battle.battle_continue()` / 最後輪 `goto_arena` 或 `finishbattle`） |
| `pane_action` | HTML string | 行動按鈕列（attack/skill/items/spirit/defend），可讀 spirit 狀態 |
| `pane_item` | HTML string | 完整道具欄（含 CD 狀態、pickup item） |

### 狀態判斷方式（從 Response 解析）

| 狀態 | 判斷方式 |
|------|---------|
| HP/MP/SP/OC 數值 | 解析 `pane_vitals` 中的 `#dvrhd`/`#dvrm`/`#dvrs`/`#dvrc` text |
| HP/MP/SP/OC 百分比 | bar img 的 `style.width`，414px = 100% |
| Buff 及剩餘回合 | 解析 `pane_effects` 中的 `set_infopane_effect('Name', ..., turns)` |
| 怪物死活 | 死掉的怪 `style="opacity:0.3"` + HP bar src 變 `nbardead.png` |
| 怪物擊敗 | textlog 出現 `"X has been defeated."` |
| 勝利 | textlog 出現 `"You are Victorious!"` (c:"b") |
| 最後一輪 | `pane_completion` 中 `#btcp` onclick 含 `goto_arena` 或 img src 含 `finishbattle` |
| 中間輪 | `pane_completion` 中 `#btcp` onclick 為 `battle.battle_continue()` |
| 技能 CD | 該 id 不出現在 `pane_quickbar` / `table_skills` / `table_magic` |
| 道具 CD | `pane_item` 中該 slot 沒有 `id` 屬性和 `onclick`，文字 class 從 `fcb` 變 `fcg` |
| Spirit 啟動 | `pane_action` 中 `#ckey_spirit` src 含 `spirit_a`（啟動）vs `spirit_n`（未啟動） |
| Pickup item | `pane_item` 中 `#ikey_p` 存在 |

### quickbar 額外資訊

`pane_quickbar` 的每個 qb 元素 onclick 包含完整的技能資訊：
```
onclick="battle.lock_action(this,1,'magic',312); battle.set_friendly_skill(312); battle.touch_and_go()"
```
- 可從中提取 skill ID（如 312 = Regen, 431 = Heartseeker, 2201 = Shield Bash）
- 可區分 friendly skill（自我施放，有 `touch_and_go()`）vs hostile skill（需選目標，用 `set_hostile_skill()`）

### 直接 fetch API 測試結果

| 測試項目 | 結果 |
|---------|------|
| fetch POST /json 普攻 | 成功，response 結構與 XHR 完全相同 |
| fetch POST /json 技能攻擊 | 成功，OC 不足時 textlog 回傳錯誤訊息但不報錯 |
| DOM 自動更新 | **不會**。`process_action` 期望 XHR 物件（檢查 readyState），不能直接餵 JSON |
| 手動同步 DOM | 可行。把 response 的 HTML string 直接 innerHTML 塞回對應元素即可 |
| 連續快速送 request | 可行，server 正常回應，無 rate limit（測試 15 連發） |

### 架構改造方向

**現行**：DOM click → 固定 delay (300ms×3) → 讀 DOM 狀態 → 下一步
**新方案**：fetch API → 解析 response → 立即 fetch 下一步（+ 可選 DOM 同步）

優勢：
- 消除盲等，延遲只剩 network round-trip
- 狀態從 response 解析，不依賴 DOM render 時序
- 程式碼更簡潔

注意事項：
- Token 需從頁面 JS 提取（`api_call` 函數內）
- `process_action()` 不能直接使用，需自行處理 response
- 畫面同步需手動把 HTML 塞回 DOM（`pane_vitals`、`pane_monster`、`pane_effects` 等）

---

## 尚未測試（未來方向）

1. **Race Condition** — 同時送多個交易 request，測試 server lock 機制
2. **多開 Session** — 同帳號兩個戰鬥視窗的交互影響
3. **其他系統** — 拍賣、鍛造、附魔、抽獎的 API 驗證
4. **Encounter Token** — 能否重複使用同一個 encounter 連結
5. ~~**勝利後 Response**~~ — ✅ 已完成：勝利時多 3 個欄位（pane_completion, pane_action, pane_item）
6. **battle_continue API** — 下一輪是否也能用 API 直接觸發而非 DOM click
