# autoArena 專案規則

> 此檔覆寫 `~/.claude/CLAUDE.md` 部分預設行為。

## 工作風格

- **Vibe coding**：可直接動手實作，不必每個 task 結束都停下確認。phase 邊界 commit 即可
- **Commit 授權**：phase / atomic 改動完成可直接 `git commit`。**不 push**（push 等使用者手動）
- **驗證走 manual e2e**：使用者用 chrome 親自跑遊戲流程驗證；不要建議導入 vitest / jest 等測試 framework
- **沒測試 framework 就不要硬走 TDD**：以 SPEC.md / tasks/plan.md 的 acceptance criteria 為驗收基準

## Code

- `extension/`（Chrome MV3）是當前主要 target；`autoArena.user.js`（userscript）維持原狀，新功能不主動 sync 過去
- 沒 build pipeline；vanilla JS only

## 第三方來源

- `tampermonkey_scripts/`：別人寫的漢化 userscripts，已 gitignore，**內容絕不 commit 進 repo**
- `antiCheat.js`：第三方 Riddle Master Assistant，僅作 reference，不修改不重新散佈
- 漢化整合策略 = B2 動態 fetch（見 [SPEC.md](./SPEC.md)）；新增同類整合預設遵循此策略

## SDD log

進入 spec / plan / build 流程時遵循 `~/.claude/CLAUDE.md` 的「Skill Framework 隔離」節 — 在 `~/.claude/sdd-framework-log.md` 補一筆索引。
