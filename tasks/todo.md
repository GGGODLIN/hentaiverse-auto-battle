# TODO: HV 漢化整合

> 詳細 plan: [plan.md](./plan.md)
> Spec: [SPEC.md](../SPEC.md)

## Phase 0 — Foundations
- [x] T0.1 Storage schema + constants (`shared/translation-constants.js`)
- [x] T0.2 GM polyfill (`content/translations/gm-polyfill.js`)
- [x] T0.3 Manifest 加 host_permissions + bump 4.0 → 4.1

## Phase 1 — First slice (1 個漢化跑通)
- [ ] T1.1 Background updater + `fetchTranslation('hv-main')`
- [ ] T1.2 `onInstalled` trigger 首次 fetch
- [ ] T1.3 `content/translations/loader.js`（讀 storage → MAIN world inject）
- [ ] T1.4 manifest content_scripts 加 loader entry

🚦 **Checkpoint 1**: hentaiverse.org 看到中文 + autoArena 自動戰鬥不爛 → 過了才繼續

## Phase 2 — 擴展到 4 個 + dashboard UI
- [ ] T2.1 Updater registry → 4 scripts
- [ ] T2.2 Dashboard Translations panel (HTML + CSS + render)
- [ ] T2.3 Toggle on/off handler
- [ ] T2.4 立即檢查更新按鈕 + 版本/錯誤顯示

🚦 **Checkpoint 2**: 4 個 toggle 可用 + 手動更新有效 → 過了才繼續

## Phase 3 — 自動更新 + fallback + cross-domain
- [ ] T3.1 `chrome.alarms` 24h periodic
- [ ] T3.2 Fetch 失敗保留快取（驗證 T1.1 邏輯）
- [ ] T3.3 Cross-domain content script (items 漢化在 forums / hvmarket / reasoningtheory)

🚦 **Checkpoint 3**: AC1-AC10 全綠 → 過了才繼續

## Phase 4 — Final verification
- [ ] T4.1 AC1-AC10 逐項過
- [ ] T4.2 Regression: 戰鬥 / 掃蕩 / encounter 在漢化全開下無 regression
