# PLAN: 整合 HV 漢化 userscripts 進 autoArena extension

> 來源 spec: [SPEC.md](../SPEC.md)
> 框架: agent-skills (planning-and-task-breakdown)
> 對應 SDD log: `~/.claude/sdd-framework-log.md`

## 切分原則

- **Vertical slicing**：每個 phase 都做出「fetch → store → inject → 看得到效果」一條完整路徑，再橫向擴展
- **Phase 1 用最小 viable case**（只跑 1 個漢化）驗證機制可行；Phase 2 才擴展到 4 個 + UI
- **Checkpoint 在 phase 之間**：使用者看到結果 → 確認沒問題 → 才繼續下一 phase

## Dependency Graph

```
Phase 0 — Foundations (序列)
  T0.1 storage schema + 共用常數
   ↓
  T0.2 GM polyfill 模組
   ↓
  T0.3 manifest 加 host_permissions（fetch 用）

Phase 1 — First slice: 1 個漢化能 fetch + inject + 顯示
  T1.1 background updater (registry-ready, 先只 fetch HentaiVerse汉化)
   ↓
  T1.2 onInstalled trigger 首次 fetch
   ↓
  T1.3 content/translations/loader.js (讀 storage → 注入)
   ↓
  T1.4 inject.js 末端呼叫 loader (順序：inject 的 XHR hook 完成後才跑漢化)
   ↓
  🚦 Checkpoint 1: 重整 hentaiverse.org 看到中文 + autoArena 自動戰鬥不爛

Phase 2 — 擴展到 4 個 + dashboard UI
  T2.1 updater registry → 4 個 scripts
  T2.2 dashboard Translations panel (HTML + CSS section)
  T2.3 toggle on/off handler
  T2.4 立即檢查更新按鈕 + 顯示 version / lastFetched / lastError
   ↓
  🚦 Checkpoint 2: dashboard 4 個 toggle 可用，手動更新有效

Phase 3 — 自動更新 + fallback + cross-domain
  T3.1 chrome.alarms 24h 設定
  T3.2 fetch 失敗保留快取 + 寫 lastError
  T3.3 物品漢化的 cross-domain (forums.e-hentai.org / hvmarket.xyz / reasoningtheory.net) 注入
   ↓
  🚦 Checkpoint 3: AC1-AC10 全綠

Phase 4 — Final verification
  T4.1 AC1-AC10 逐項手動驗證
  T4.2 autoArena regression 驗證 (戰鬥/掃蕩/encounter 在漢化全開下)
```

---

## Phase 0 — Foundations

### T0.1 Storage schema + 共用常數
**做什麼**：在 `extension/background/translation-updater.js` 開頭定義常數：

```js
const TRANSLATION_REGISTRY = {
  'hv-main':      { name: 'HentaiVerse汉化',     scriptId: 404118, runAt: 'document_idle' },
  'battlelog':    { name: 'HV - 战斗日志汉化',    scriptId: 445520, runAt: 'document_idle' },
  'img-buttons':  { name: 'HV 图片按钮汉化',      scriptId: 425529, runAt: 'document_idle' },
  'items':        { name: 'HV 物品装备汉化',      scriptId: 404119, runAt: 'document_idle' },
};
const TRANSLATION_BASE_URL = 'https://update.sleazyfork.org/scripts';
const TRANSLATION_KEY_PREFIX = 'translation:';
const TRANSLATION_SETTINGS_KEY = 'translation:settings';
const TRANSLATION_UPDATE_ALARM = 'translationUpdate';
const TRANSLATION_UPDATE_INTERVAL_MIN = 60 * 24;
```

`storage[TRANSLATION_KEY_PREFIX + id]` shape: `{ version, source, lastFetched, lastError, sourceUrl, updateUrl }`
`storage[TRANSLATION_SETTINGS_KEY]` shape: `{ [id]: boolean }`，預設 `{ 'hv-main': true, ... }` 全 true

**AC**：constants 集中在 updater 檔案開頭，loader / dashboard / SW 統一 import 或 reference 同一份。
**Verify**：`grep -r "translation:" extension/` 應只看到這幾個 key，無散落字面值。

### T0.2 GM polyfill
**做什麼**：建 `extension/content/translations/gm-polyfill.js`，定義：

```js
function GM_addStyle(css) {
  const s = document.createElement('style');
  s.textContent = css;
  (document.head ?? document.documentElement).appendChild(s);
  return s;
}
```

`unsafeWindow` 在 MAIN world = `window`，無需額外定義（如必要 `var unsafeWindow = window;`）。
其他 GM_* (GM_getValue / GM_setValue / GM_xmlhttpRequest) 4 個 script 都沒用，**不做**多餘 shim。

**AC**：polyfill 檔可被獨立 inject、執行後 `typeof GM_addStyle === 'function'`。
**Verify**：`grep -E "GM_[A-Za-z]+" tampermonkey_scripts/*.user.js` 列出實際用的 GM API，確認 polyfill 涵蓋。

### T0.3 Manifest host_permissions
**做什麼**：[extension/manifest.json](../extension/manifest.json) 加：
- `*://forums.e-hentai.org/*`
- `*://hvmarket.xyz/*`
- `*://reasoningtheory.net/*`
- `*://update.sleazyfork.org/*`

**不**加 content_scripts entries（留 Phase 3 處理）。`version` bump → `4.1`。

**AC**：manifest valid JSON，extension 可正常 reload。
**Verify**：`chrome://extensions` reload 無錯，console 無 manifest warnings。

---

## Phase 1 — First slice: 1 個漢化跑通

### T1.1 Background updater (registry-ready, 跑 1 個)
**做什麼**：建 `extension/background/translation-updater.js`：

```js
async function fetchTranslation(id) {
  const def = TRANSLATION_REGISTRY[id];
  const metaUrl = `${TRANSLATION_BASE_URL}/${def.scriptId}.meta.js`;
  const userUrl = `${TRANSLATION_BASE_URL}/${def.scriptId}.user.js`;

  const cached = await chrome.storage.local.get(TRANSLATION_KEY_PREFIX + id);
  const cachedEntry = cached[TRANSLATION_KEY_PREFIX + id];

  try {
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) throw new Error(`meta ${metaRes.status}`);
    const metaText = await metaRes.text();
    const remoteVersion = parseUserscriptVersion(metaText);

    if (cachedEntry?.version === remoteVersion && cachedEntry?.source) {
      return { id, status: 'unchanged', version: remoteVersion };
    }

    const userRes = await fetch(userUrl);
    if (!userRes.ok) throw new Error(`user ${userRes.status}`);
    const source = await userRes.text();

    await chrome.storage.local.set({
      [TRANSLATION_KEY_PREFIX + id]: {
        version: remoteVersion,
        source,
        lastFetched: Date.now(),
        lastError: null,
        sourceUrl: userUrl,
        updateUrl: metaUrl,
      },
    });
    return { id, status: 'updated', version: remoteVersion };
  } catch (err) {
    if (cachedEntry) {
      await chrome.storage.local.set({
        [TRANSLATION_KEY_PREFIX + id]: {
          ...cachedEntry,
          lastError: { message: err.message, time: Date.now() },
        },
      });
    }
    return { id, status: 'error', error: err.message };
  }
}

function parseUserscriptVersion(metaText) {
  const m = metaText.match(/@version\s+(\S+)/);
  return m?.[1] ?? null;
}

async function fetchAllTranslations() {
  const ids = Object.keys(TRANSLATION_REGISTRY);
  return Promise.all(ids.map(fetchTranslation));
}
```

Phase 1 只測 `'hv-main'` 一個 ID。其他 3 個 registry 留著但暫不 trigger。

**AC**：呼叫 `fetchTranslation('hv-main')` 後 `storage` 有 `translation:hv-main` entry，含 `source` (string, ~300KB) 跟 `version`。
**Verify**：service worker console 看 fetch 結果；DevTools → Storage → Extension → 看 entry。

### T1.2 onInstalled trigger 首次 fetch
**做什麼**：`service-worker.js` 既有 `chrome.runtime.onInstalled.addListener` (line 549) 加一行：

```js
await fetchTranslation('hv-main'); // Phase 1: 只 fetch 主漢化
```

import / include `translation-updater.js` 進 SW。Manifest V3 SW 是 ES module 的話用 `import`；既有 SW 是傳統 script，要在 manifest 改 `"type": "module"`。**這一步可能要先評估副作用，若不改 module 就用 `importScripts()`**。

**AC**：reinstall extension → onInstalled 跑完後 `storage` 有 `translation:hv-main`。
**Verify**：`chrome://extensions` 點 reload，看 SW logs。

### T1.3 content/translations/loader.js
**做什麼**：建 `extension/content/translations/loader.js`，**注意它要在 MAIN world 跑**（用 `<script>` injection 從 ISOLATED 世界把 source 注入 page world）：

```js
(async () => {
  const settings = (await chrome.storage.local.get(TRANSLATION_SETTINGS_KEY))[TRANSLATION_SETTINGS_KEY] ?? {};
  const ids = ['hv-main']; // Phase 1: 只跑 1 個
  for (const id of ids) {
    if (settings[id] === false) continue;
    const entry = (await chrome.storage.local.get(TRANSLATION_KEY_PREFIX + id))[TRANSLATION_KEY_PREFIX + id];
    if (!entry?.source) continue;
    injectIntoPage(entry.source);
  }
})();

function injectIntoPage(source) {
  const s = document.createElement('script');
  s.textContent = `(function(){ ${GM_POLYFILL_SOURCE}\n${source} })();`;
  (document.head ?? document.documentElement).appendChild(s);
  s.remove();
}
```

`GM_POLYFILL_SOURCE` 是 polyfill 字串（從 T0.2 inline / 載入）。

Loader 跑在 ISOLATED world (有 chrome.storage 權限)，把組裝好的 script 字串 inject 進 MAIN world。

**AC**：[hentaiverse.org](https://hentaiverse.org/) 載入 → 觀察主介面文字變中文（例如「主菜单」）。
**Verify**：DevTools Elements 找原本 "Character" 的位置看是否變中文。

### T1.4 manifest content_scripts 加 loader
**做什麼**：[extension/manifest.json](../extension/manifest.json) `content_scripts` 加：

```json
{
  "matches": ["*://hentaiverse.org/*", "*://www.hentaiverse.org/*"],
  "js": ["content/translations/loader.js"],
  "run_at": "document_idle"
}
```

`run_at: document_idle` 確保 inject.js (document_start) 已 hook 完 XHR 才跑漢化。

**AC**：reload extension 後 manifest 包含此 entry，loader 在 hentaiverse.org idle 後執行。
**Verify**：DevTools → Sources 看 content scripts 列出 loader.js。

🚦 **CHECKPOINT 1**:
- 重整 hentaiverse.org → 主漢化生效，文字變中文
- 開啟自動戰鬥 (autoArena) → 戰鬥流程仍正常
- inject.js 的 XHR hook 仍能 hit (`/json` 請求 `_apiResolve` 觸發)
- **若任一不 OK，停下回頭**，不繼續 Phase 2

---

## Phase 2 — 擴展到 4 個 + dashboard UI

### T2.1 Updater registry 擴展到 4 個
**做什麼**：T1.1 的 `fetchAllTranslations()` 已支援 registry，loader 的 ids 從寫死 `['hv-main']` 改成 `Object.keys(TRANSLATION_REGISTRY)`。

**AC**：手動跑 `fetchAllTranslations()` → 4 個 storage entry 都有 source。
**Verify**：DevTools Storage 看 4 個 `translation:*` keys。

### T2.2 Dashboard Translations panel
**做什麼**：[extension/dashboard/index.html](../extension/dashboard/index.html) 加 section：

```html
<section class="translations-section">
  <h3>漢化（Translations）</h3>
  <div id="translationsList"></div>
  <button id="btnTranslationUpdate">立即檢查更新</button>
  <div id="translationUpdateStatus"></div>
</section>
```

[extension/dashboard/style.css](../extension/dashboard/style.css) 加對應樣式（沿用既有 toggle-row / general-row 風格）。

[extension/dashboard/app.js](../extension/dashboard/app.js) 加 `renderTranslations()` 並接進 `renderAll()` (line 383)。

**AC**：dashboard 載入後可見 4 個漢化 row 顯示名稱 / 版本 / 上次更新時間 / 開關。
**Verify**：點開 dashboard 視覺 check。

### T2.3 Toggle handler
**做什麼**：每個 row 加 click → 改 `storage[TRANSLATION_SETTINGS_KEY][id]` → renderTranslations()。

**AC**：toggle 關閉某漢化 → 重整 hentaiverse.org → 該漢化不注入；其他漢化照舊。
**Verify**：手動切 toggle 並重整頁面驗證。

### T2.4 立即檢查更新按鈕
**做什麼**：button click → `chrome.runtime.sendMessage({ type: 'FETCH_TRANSLATIONS' })`。

`service-worker.js` 加 message handler:
```js
case 'FETCH_TRANSLATIONS': {
  const results = await fetchAllTranslations();
  sendResponse({ results });
  return;
}
```

UI 顯示 progress / 結果（更新 / 已是最新 / 失敗）。

**AC**：按下按鈕 → 4 個 script 重新 fetch（meta 比對；無新版的不重下 user.js）→ status 更新。
**Verify**：DevTools Network 看到 4 個 meta.js 請求；有新版時看到對應 user.js 請求。

🚦 **CHECKPOINT 2**:
- 4 個漢化都能注入
- 個別 toggle 切換有效
- 立即檢查更新有反應
- autoArena 仍正常

---

## Phase 3 — 自動更新 + fallback + cross-domain

### T3.1 chrome.alarms 24h 自動觸發
**做什麼**：`service-worker.js` 加：

```js
chrome.alarms.create(TRANSLATION_UPDATE_ALARM, { periodInMinutes: TRANSLATION_UPDATE_INTERVAL_MIN });
```

alarm handler 加：
```js
if (alarm.name === TRANSLATION_UPDATE_ALARM) {
  await fetchAllTranslations();
}
```

**AC**：`chrome.alarms.getAll()` 列出 `translationUpdate` periodicity 24h。
**Verify**：service worker DevTools console `chrome.alarms.getAll(console.log)`。

### T3.2 Fetch 失敗保留快取（已在 T1.1 實作，這裡是驗證）
**做什麼**：T1.1 catch block 已寫 `lastError` + 不覆蓋 `source`。這 task 是針對它寫**驗證情境**：

模擬：手動把 manifest 的 `update.sleazyfork.org` 拿掉 → 點立即更新 → fetch fail → 重整 hentaiverse.org 仍中文。

**AC**：fetch 失敗時舊版繼續生效；dashboard 顯示「⚠️ 更新失敗，使用 vX (timestamp)」。
**Verify**：手動模擬 + dashboard UI check。

### T3.3 Cross-domain content script (物品漢化)
**做什麼**：[extension/manifest.json](../extension/manifest.json) `content_scripts` 加新 entry，**只 inject items 漢化**：

```json
{
  "matches": ["*://forums.e-hentai.org/*showtopic=*", "*://hvmarket.xyz/*", "*://reasoningtheory.net/*"],
  "js": ["content/translations/loader.js"],
  "run_at": "document_idle"
}
```

loader.js 改：偵測 host 是 hentaiverse 才跑全部 4 個；非 hentaiverse host 只跑 `'items'`。

**AC**：開 [hvmarket.xyz](https://hvmarket.xyz/) → 物品漢化生效（裝備名變中文）。autoArena 既有功能在 hvmarket 不會被誤觸發（hvmarket 不在 autoArena 的 content_scripts 範圍）。
**Verify**：到 hvmarket / forums.e-hentai 跑一次。

🚦 **CHECKPOINT 3**:
- 24h 自動更新已設定
- fetch 失敗 fallback 驗證過
- cross-domain 漢化注入有效

---

## Phase 4 — Final verification

### T4.1 AC1-AC10 逐項過 (見 [SPEC.md §5](../SPEC.md))
逐 AC 手動驗證並 check off。

### T4.2 Regression 驗證
- 開啟漢化 4 個 + autoArena 自動戰鬥 → 跑 1 場戰鬥確認正常
- 開啟漢化 + 競技場掃蕩 → 跑 1 個 difficulty 確認
- 開啟漢化 + encounter farming → 跑 1 次 encounter 確認

**AC**：所有 AC 過 + 無 regression。
**Verify**：手動操作 + 看 dashboard battleLog 有對應紀錄。

---

## 風險紀錄

| 風險 | 緩解 |
|---|---|
| 漢化 script 也 hook XHR.prototype，跟 inject.js 競爭 | document_idle 注入確保 inject 先跑；漢化 wrap 上去後鏈式呼叫 `apply(this, arguments)` 應 OK；T1 Checkpoint 實測 |
| Manifest V3 SW 的 ES module 改造可能影響既有邏輯 | 用 `importScripts()` 而非 `import` 改 module 模式 |
| 300KB 主漢化每次注入 cost | source 已在 storage，不重 fetch；inject 是同步 DOM 操作，可接受 |
| chrome.storage.local quota（5MB） | 4 個 source 加總 ~450KB，遠低於上限 |
| 漢化作者改網址或下架 | T3.2 fallback 機制；dashboard 顯示錯誤；極端情況 fallback 到 [tampermonkey_scripts/](../tampermonkey_scripts/) 內參考檔（手動操作） |

---

## 不在這次 plan 範圍

- 從 [autoArena.user.js](../autoArena.user.js) (userscript 模式) 整合漢化
- 任何 build pipeline / 打包工具導入
- E2E 自動測試框架
- 漢化效果對 autoArena selector 的逐項自動 regression（人工抽測即可）
