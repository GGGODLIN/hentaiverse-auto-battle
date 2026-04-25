# TODO: Ring of Blood Auto-Battle

> Plan: [plan.md](./plan.md)
> Spec: [spec.md](./spec.md)

## Phase 0 — Foundations
- [ ] T0.1 Storage constants + `getRbStateToday()` helper

## Phase 1 — First slice (manual open RoB → FSM only)
- [ ] T1.1 Manifest `content_scripts` entry for ring-of-blood.js
- [ ] T1.2 Build `extension/content/ring-of-blood.js`(parse + msg + ENTER_RB listener)
- [ ] T1.3 Dashboard `Ring of Blood` toggle + SW `SET_RB_AUTO` handler
- [ ] T1.4 SW `RB_PAGE_READY` handler — FSM only
- [ ] T1.5 SW `BATTLE_COMPLETE` add `rb` branch (mark fsmDone, no follow-up)

🚦 **Checkpoint 1**: toggle ON → 手動開 `?s=Battle&ss=rb` → 自動打 FSM → mark fsmDone → e2e 待測

## Phase 2 — Trio + sweep-end trigger
- [ ] T2.1 `maybeTriggerRb()` helper
- [ ] T2.2 Hook into `handleArenaPageReady` "all done" + `handleBattleComplete` "allDone"
- [ ] T2.3 Hook into `handleArenaPageReady` "stamina depleted"
- [ ] T2.4 `RB_PAGE_READY` add Trio logic (tokens > threshold)
- [ ] T2.5 `BATTLE_COMPLETE` rb-branch chains: FSM → reload RoB; Trio → end
- [ ] T2.6 `SET_RB_AUTO` ON 那刻條件式立即評估

🚦 **Checkpoint 2**: sweep 完 → RoB FSM → RoB Trio 完整鏈 → e2e 待測

## Phase 3 — Daily reset + dashboard status
- [ ] T3.1 `checkDailyReset` reset `rbStateToday`
- [ ] T3.2 Dashboard RoB status row (today flags + tokens)

🚦 **Checkpoint 3**: 跨 8am reset 正確 + dashboard 顯示完整 → e2e 待測

## Phase 4 — Final verification (user e2e)
- [ ] T4.1 AC1–AC13 逐項過
- [ ] T4.2 Regression: 漢化 + Arena Sweep + Encounter + RoB 同時跑
