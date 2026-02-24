[English](README.md) | **繁體中文**

# HV Auto Battle & Encounter

用於自動化 HentaiVerse 競技場戰鬥與 E-Hentai 遭遇戰農怪的 Tampermonkey 腳本。

## 功能

### ⚔ 競技場自動戰鬥（`hentaiverse.org`）
- 基於優先順序的全自動戰鬥系統
- 波次之間自動續戰
- **最後一波自動停下** — 不會跳離結算畫面
- 精英/Boss 優先攻擊
- 冷卻偵測 — 藥水 CD 中自動跳過
- Channeling buff 偵測 — 觸發時趁免 MP 施放 Heartseeker
- Spirit stance 自動管理

### 🎯 遭遇戰自動刷新（`e-hentai.org/news.php`）
- 每 30 分鐘定時刷新頁面
- 自動偵測怪物遭遇並開啟戰鬥視窗
- 自動在彈出視窗中啟用戰鬥模式
- 浮動按鈕顯示倒數計時
- 超過 30 分鐘未出現遭遇時，改為每 1 分鐘重試

### 🚨 反作弊保護
- **Riddle Master** 頁面載入時立即偵測
- **怠速偵測** — 戰鬥卡住時觸發
- **三重警報**：蜂鳴聲 + 瀏覽器通知 + 分頁標題閃爍

## 安裝

1. 安裝 [Tampermonkey](https://www.tampermonkey.net/) 瀏覽器擴充
2. 點擊 Tampermonkey 圖示 → 建立新腳本
3. 將 `autoArena.user.js` 的內容全部貼上取代
4. 儲存（Ctrl+S）

## 前置設定

腳本依賴固定的技能快捷欄和物品欄位置，使用前請確認遊戲內設定如下：

### 技能快捷欄（Quick Buttons）

![技能快捷欄設定](screenshots/quick_buttons.png)

| 欄位 | 設定技能 |
|------|---------|
| qb1 | Regen（回復 buff） |
| qb2 | Heartseeker（命中 buff） |
| qb3 | 治療術 1 |
| qb4 | 治療術 2 |

### 物品欄（Item Slots）

![物品欄設定](screenshots/item_slots.png)

| 欄位 | 設定物品 |
|------|---------|
| 1 | Health Draught |
| 2 | Mana Draught |
| 3 | （未使用） |
| 4 | Mana Potion |
| 5 | Spirit Draught |

## 使用方式

### 競技場戰鬥
1. 在 `hentaiverse.org` 進入競技場戰鬥
2. 點擊右下角 `⚔ AUTO OFF` 按鈕開始
3. 腳本自動戰鬥並在波次間自動續戰
4. 競技場通關或偵測到反作弊時自動停止

### 遭遇戰農怪
1. 前往 `e-hentai.org/news.php`
2. 點擊右下角 `🎯 ENCOUNTER OFF` 按鈕啟用
3. 按鈕顯示倒數計時至下次刷新
4. 偵測到怪物遭遇時自動開啟戰鬥並開打

## 戰鬥優先順序

| 優先序 | 條件 | 動作 |
|--------|------|------|
| 1 | HP < 50% | 治療（qb3，不夠再 qb4） |
| 2 | Channeling buff 存在 | 施放 Heartseeker（免 MP） |
| 3 | MP < 20% | Mana Potion |
| 4 | 無 Regeneration buff | Health Draught |
| 5 | 無 Replenishment buff | Mana Draught |
| 6 | SP < 70% 且無 Refreshment | Spirit Draught |
| 7 | Regen ≤ 3 回合 | 重新施放 |
| 8 | Heartseeker ≤ 3 回合 | 重新施放 |
| 9 | OC > 80% 且 spirit 未啟動 | 啟動 spirit stance |
| 10 | — | 攻擊（精英優先） |

## GM Storage Keys

| Key | 使用模式 | 用途 |
|-----|---------|------|
| `autoArena` | 戰鬥模式 | 自動戰鬥開關 |
| `autoEncounter` | 遭遇戰模式 | 自動刷新開關 |
| `lastEncounterTime` | 遭遇戰模式 | 上次遭遇的時間戳 |
| `nextRefreshTime` | 遭遇戰模式 | 下次刷新的目標時間 |

## License

MIT
