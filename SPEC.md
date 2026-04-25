# SPEC: 整合 HV 漢化 userscripts 進 autoArena extension

> 框架：agent-skills (spec-driven-development)
> 鎖定時間：2026-04-25T14:50+0800
> 對應 SDD log：`~/.claude/sdd-framework-log.md`

---

## 1. Objective

把以下 4 個第三方 HV 漢化 userscript 整合進 autoArena Chrome extension，讓使用者**單裝 extension 即可取代 Tampermonkey**：

| Script | 來源 | 大小 |
|---|---|---|
| HentaiVerse汉化 | `update.sleazyfork.org/scripts/404118` | ~300KB |
| HV - 战斗日志汉化 | `update.sleazyfork.org/scripts/445520` | ~32KB |
| HV 图片按钮汉化 | `update.sleazyfork.org/scripts/425529` | ~38KB |
| HV 物品装备汉化 | `update.sleazyfork.org/scripts/404119` | ~79KB |

**整合策略：B2 模式**（不打包原始碼進 repo，extension 動態 fetch + 24h 自動更新 + 本地快取）

**目標使用者**：repo 擁有者本人（自用，private 範圍）。第三方 script 著作權屬原作者；不重新散佈、不修改其內容。

---

## 2. Commands

此專案無 build process（vanilla JS Manifest V3 extension）。

| 操作 | 指令 / 步驟 |
|---|---|
| 開發載入 | Chrome → `chrome://extensions` → Load unpacked → 選 `extension/` |
| 重載 | extension 頁面點 reload；content script 改動需重整目標頁 |
| 手動觸發更新 | Dashboard → 「立即檢查更新」按鈕 |
| 自動更新 | `chrome.alarms` 每 24h 觸發 background updater |
| 清除快取（debug） | DevTools → Application → Storage → Extension Storage → 刪 `translation:*` keys |

---

## 3. Project Structure

新增 / 修改的檔案（既有 autoArena 核心檔不動）：

```
extension/
  manifest.json                       ← 改：bump 4.0 → 4.1，擴 host_permissions
  background/
    service-worker.js                 ← 既有，不動核心邏輯
    translation-updater.js            ← 新：alarms handler、meta.js 比對、user.js fetch、storage 寫入
  content/
    inject.js                         ← 改：document_start 時從 storage 讀快取注入漢化
    translations/
      loader.js                       ← 新：依 toggle 狀態決定注入哪幾個漢化
      gm-polyfill.js                  ← 新：GM_addStyle / unsafeWindow shim（戰鬥日誌漢化要）
  dashboard/
    index.html                        ← 改：新增 Translations panel
    app.js                            ← 改：toggle 開關 + 立即檢查更新 + 顯示版本/錯誤
    style.css                         ← 改：Translations panel 樣式
```

### chrome.storage 結構

每個漢化獨立 key，方便獨立 fetch / 失敗 / 開關：

```js
'translation:hv-main'      → { version, source, lastFetched, lastError, sourceUrl, updateUrl }
'translation:battlelog'    → { ...同上 }
'translation:img-buttons'  → { ...同上 }
'translation:items'        → { ...同上 }
'translation:settings'     → { 'hv-main': true, 'battlelog': true, 'img-buttons': true, 'items': true }
```

`source` 存原始 user.js 內容字串。autoArena 既有 storage keys（`battleLog`、`lastBattleStatus` 等）不變動。

### Manifest 改動

```json
"version": "4.1",
"host_permissions": [
  "*://hentaiverse.org/*",
  "*://www.hentaiverse.org/*",
  "*://e-hentai.org/*",
  "*://www.e-hentai.org/*",
  "*://rdma.ooguy.com/*",
  "*://forums.e-hentai.org/*",      // 新：物品漢化
  "*://hvmarket.xyz/*",              // 新：物品漢化
  "*://reasoningtheory.net/*",       // 新：物品漢化
  "*://update.sleazyfork.org/*"      // 新：fetch source
]
```

`content_scripts` 增加：
- `forums.e-hentai.org` / `hvmarket.xyz` / `reasoningtheory.net` 注入 `translations/loader.js`（只跑物品漢化）

---

## 4. Code Style

跟隨既有 [extension/content/battle.js](file:///Users/linhancheng/Desktop/work/autoArena/extension/content/battle.js) 風格 + 全域偏好：

- IIFE / 函式作用域包覆（content script、service worker 環境）
- 2 空格縮排
- 無註解（除非真的非顯而易見）
- pure function 為主
- `??` 而非 `||` 做 value fallback
- `console.log` 內容用 `JSON.stringify()`
- ES modules：service worker 可用 `import`；content script 用傳統 script tag 載入順序

---

## 5. Testing Strategy

無自動化測試框架。透過 **acceptance criteria 手動驗證** + **regression 檢查 autoArena 既有功能**。

### Acceptance Criteria

| # | 情境 | 預期 |
|---|---|---|
| AC1 | 全新安裝 → 24h 內 / 手動觸發 | 4 個 script 全部 fetch 成功並寫入 storage |
| AC2 | hentaiverse.org 載入 | 4 個漢化按使用者 toggle 注入；中文顯示正確 |
| AC3 | 關閉某 toggle → 重整頁面 | 該漢化不注入；其餘仍正常 |
| AC4 | 斷網開頁面 | 已快取漢化照常注入（用上次成功版本） |
| AC5 | sleazyfork 不可達 | dashboard 顯示「⚠️ 更新失敗，使用 vX（YYYY-MM-DD 抓取）」；不影響注入 |
| AC6 | autoArena 自動戰鬥 + 漢化全開 | 戰鬥流程正常；無 selector / API 衝突 |
| AC7 | 競技場掃蕩 + 漢化全開 | 掃蕩流程正常 |
| AC8 | encounter 自動刷新 + 漢化全開 | encounter 流程正常 |
| AC9 | 物品漢化作用域 | `forums.e-hentai.org` / `hvmarket.xyz` 也能正常注入 |
| AC10 | dashboard「立即檢查更新」 | 強制 fetch 4 個 meta.js → 比對 version → 有新才下 user.js → UI 即時更新 |

### Regression 重點

- [extension/content/battle.js](file:///Users/linhancheng/Desktop/work/autoArena/extension/content/battle.js) 用 selector + XHR hook 抓資料，不依賴文字（已驗證 grep `textlog` 無 hit），理論上不衝突；仍需實測。
- 漢化在 MAIN world `document_start` 注入，autoArena 的 `inject.js` 也是 MAIN world `document_start`；**順序需確保 autoArena 先 hook XHR**（漢化在 autoArena 之後執行，避免 XHR hook 被覆蓋或 race）。

---

## 6. Boundaries

### Always
- 漢化失敗（fetch / 注入 / 解析）一律 swallow + 記錄到 `translation:<id>.lastError`，**不可阻斷 autoArena 自動化**
- fetch 失敗保留前次成功版本（B2 + fallback option 2）
- userscript 模式 [autoArena.user.js](file:///Users/linhancheng/Desktop/work/autoArena/autoArena.user.js) 完全不動
- 漢化 source 完全保留原樣（不修改 / 不 minify / 不 transform）注入
- chrome.storage namespace `translation:*` 與 autoArena 既有 keys 不衝突

### Ask First
- 任何對 [extension/content/battle.js](file:///Users/linhancheng/Desktop/work/autoArena/extension/content/battle.js) / [arena.js](file:///Users/linhancheng/Desktop/work/autoArena/extension/content/arena.js) / [encounter.js](file:///Users/linhancheng/Desktop/work/autoArena/extension/content/encounter.js) / [inject.js](file:///Users/linhancheng/Desktop/work/autoArena/extension/content/inject.js) 既有邏輯的修改（除了在 inject.js 末尾加一行呼叫漢化 loader）
- 重組既有目錄結構
- chrome.storage schema 變動

### Never
- 不 commit [tampermonkey_scripts/](file:///Users/linhancheng/Desktop/work/autoArena/tampermonkey_scripts/)（已 gitignore）
- 不 commit fetched 漢化 source 進 repo
- 不修改原 4 個漢化 script 的內容
- 不在 content script hot path（每次注入）做網路請求；fetch 只在 background 的 alarms / 手動 trigger
- 不在 host_permissions 加 `*://*/*` 之類過寬的 pattern
- 不重新散佈第三方 script

---

## 7. 預設假設（spec 階段確認，後續 plan/impl 不再回頭）

- **A1**：只動 extension，不動 userscript 模式
- **A2**：4 個漢化 toggle 預設 ON
- **A3**：更新頻率寫死 24h，不暴露到 dashboard
- **A4**：dashboard 顯示版本 / 上次更新 / 錯誤訊息；漢化失敗不影響核心
- **A5**：dashboard 加「立即檢查更新」按鈕
- **A6**：manifest version 4.0 → 4.1
- **A7**：chrome.storage 每個 script 獨立 key
- **Q-fallback**：fetch 失敗保留快取舊版（option 2）
