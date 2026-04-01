[English](README.md) | **繁體中文**

# HV Auto Battle & Encounter

HentaiVerse 競技場戰鬥與 E-Hentai 遭遇戰自動化工具。提供兩種模式：

| 模式 | 安裝方式 | 功能 |
|------|---------|------|
| **Chrome Extension** | 載入 `extension/` 資料夾 | Dashboard、Arena Sweep、遭遇戰協調、Riddle Master API、無人值守模式 |
| **Tampermonkey** | 貼上 `autoArena.user.js` | 獨立戰鬥引擎，附浮動設定面板 |

---

## Chrome Extension（推薦）

完整功能的自動化工具，包含集中式 Dashboard、自動競技場掃蕩、協調遭遇戰農怪。

### 功能

- **Arena Sweep** — 自動從最簡單到最難的難度依序進入競技場戰鬥
- **主世界 + 異世界** — 兩個世界獨立掃蕩，可同時運行
- **Dashboard** — 獨立分頁，集中控制、監控與設定
- **遭遇戰協調** — 在主世界競技場戰鬥之間自動檢查遭遇戰（每 30 分鐘）
- **Riddle Master 整合** — 透過 API 自動解答反作弊挑戰
- **無人值守模式** — 完全自主運作，接受死亡作為恢復機制
- **浮動按鈕** — 戰鬥頁面快速開關（顯示世界資訊）

### 安裝

1. Clone 或下載此專案
2. 開啟 Chrome `chrome://extensions`
3. 啟用右上角 **開發者模式**
4. 點擊 **載入未封裝項目** → 選擇 `extension/` 資料夾
5. 點擊擴充功能圖示開啟 Dashboard

### 使用方式

1. **Dashboard** — 開關 Arena Sweep（主世界／異世界）、遭遇戰農怪、無人值守模式
2. **戰鬥設定** — 在 Dashboard 設定技能、藥水、門檻值與策略
3. **Arena Sweep** — 分別點擊主世界和／或異世界的 ON，各自獨立掃蕩
4. **遭遇戰** — 啟用後自動在主世界競技場間隔檢查 e-hentai.org/news.php
5. **Riddle Master** — 可在 Dashboard 設定 API Key 取得優先存取

### 檔案結構

```
extension/
├── manifest.json              MV3 manifest
├── background/
│   └── service-worker.js      中央排程器
├── content/
│   ├── inject.js              XHR hook（MAIN world，document_start）
│   ├── battle.js              戰鬥引擎（hentaiverse.org）
│   ├── arena.js               競技場入場（hentaiverse.org?s=Battle&ss=ar）
│   └── encounter.js           遭遇戰偵測（e-hentai.org/news.php）
└── dashboard/
    ├── index.html             Dashboard 介面
    ├── app.js                 Dashboard 邏輯
    └── style.css              深色主題
```

---

## Tampermonkey（獨立戰鬥引擎）

輕量油猴腳本，用於手動競技場戰鬥與遭遇戰農怪。無 Arena Sweep 或 Dashboard — 需手動進入每場戰鬥。

### 功能

- 基於優先順序的全自動戰鬥系統
- 波次之間自動續戰
- 最後一波自動停下 — 不會跳離結算畫面
- 設定面板，可單獨開關每個技能和藥水
- e-hentai.org/news.php 遭遇戰自動刷新
- 反作弊偵測（Riddle Master、怠速偵測、低血量）
- 三重警報：蜂鳴聲 + 瀏覽器通知 + 分頁標題閃爍

### 安裝

1. 安裝 [Tampermonkey](https://www.tampermonkey.net/)
2. 建立新腳本 → 貼上 `autoArena.user.js` 的內容
3. 儲存（Ctrl+S）

### 使用方式

1. 在 `hentaiverse.org` 進入競技場戰鬥
2. 點擊右下角 `⚔ AUTO OFF` 按鈕開始
3. 點擊 `⚙` 開關技能和藥水
4. 遭遇戰：前往 `e-hentai.org/news.php` → 點擊 `🎯 ENCOUNTER OFF`

---

## 前置設定

兩種模式都依賴固定的技能快捷欄和物品欄位置：

### 技能快捷欄（Quick Buttons）

| 欄位 | 設定技能 |
|------|---------|
| qb1 | Regen（回復 buff） |
| qb2 | Heartseeker（命中 buff） |
| qb3 | 治療術 1 |
| qb4 | 治療術 2 |
| qb7 | 攻擊技能 1 |
| qb8 | 攻擊技能 2 |
| qb9 | 攻擊技能 3 |

### 物品欄（Item Slots）

| 欄位 | 設定物品 |
|------|---------|
| 1 | Health Draught |
| 2 | Mana Draught |
| 3 | Health Potion |
| 4 | Mana Potion |
| 5 | Spirit Draught |

## 戰鬥優先順序

| 優先序 | 條件 | 動作 |
|--------|------|------|
| 1 | HP < 50% | 治療（qb3 → qb4 → Health Potion） |
| 2 | Channeling buff 存在 | 施放 Heartseeker（免 MP） |
| 3 | MP < 50% | Mana Potion |
| 4 | 無 Regeneration buff | Health Draught |
| 5 | 無 Replenishment buff | Mana Draught |
| 6 | SP < 80% 且無 Refreshment | Spirit Draught |
| 7 | Regen ≤ 3 回合 | 重新施放 |
| 8 | Heartseeker ≤ 3 回合 | 重新施放 |
| 9 | OC > 90% 且 spirit 未啟動 | 啟動 spirit stance |
| 10 | — | 攻擊技能（qb7→qb8→qb9）或普攻 |

## License

MIT
