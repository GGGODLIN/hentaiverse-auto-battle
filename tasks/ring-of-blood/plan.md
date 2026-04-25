# PLAN: Ring of Blood Auto-Battle

> Spec: [spec.md](./spec.md)
> Framework: agent-skills (planning-and-task-breakdown)
> Plan date: 2026-04-25

## 切分原則

- **Vertical slicing**：Phase 1 first slice 只覆蓋「toggle ON + 手動開 RoB 頁 → 打 FSM 一場」最薄路徑（不含 Trio、不含 sweep-end 自動 trigger、不含 daily reset），驗證 enter→battle→complete 整條 pipe 通了再擴展
- Phase 2 補 Trio + 整合到 sweep 結束 trigger
- Phase 3 補 daily reset + dashboard 細節
- Phase 4 e2e by user
- 既有 [extension/content/battle.js](../../extension/content/battle.js) 0 改動 — 透過 `battleContext.type` propagation
- 既有 [extension/content/arena.js](../../extension/content/arena.js) 是模板，ring-of-blood.js 跟著走

## Dependency graph

```
Phase 0 — Foundations
  T0.1 storage constants + getRbStateToday()

Phase 1 — First slice (manual open RoB → FSM only)
  T1.1 manifest content_scripts entry          ┐
  T1.2 ring-of-blood.js (parse + msg)          │── 並行
  T1.3 dashboard toggle UI + SET_RB_AUTO       ┘
       ↓
  T1.4 SW RB_PAGE_READY handler (FSM only, no Trio)
       ↓
  T1.5 SW BATTLE_COMPLETE — add "rb" branch (mark fsmDone, no follow-up)

🚦 Checkpoint 1: toggle ON → 手動開 ?s=Battle&ss=rb → 自動打 FSM 一場 → mark fsmDone

Phase 2 — Trio + sweep-end trigger
  T2.1 maybeTriggerRb() helper
  T2.2 hook 進 handleArenaPageReady "all done" branch
  T2.3 hook 進 handleArenaPageReady "stamina depleted" branch
  T2.4 RB_PAGE_READY 加 Trio logic (FSM done 後重讀 token 判斷)
  T2.5 BATTLE_COMPLETE rb 分支：FSM done 後 reload RoB 頁；Trio done 後結束
  T2.6 SET_RB_AUTO ON 那刻條件式立即評估 (sweep 不在跑就 trigger)

🚦 Checkpoint 2: sweep all done → RoB FSM → RoB Trio 完整鏈

Phase 3 — Daily reset + dashboard status
  T3.1 checkDailyReset 加 rbStateToday reset
  T3.2 dashboard Translations panel 旁加 RoB status panel (today's flags + token)

🚦 Checkpoint 3: 跨日 reset 正確 + dashboard 顯示完整

Phase 4 — Final verification (user e2e)
  T4.1 AC1–AC13 逐項過
  T4.2 Regression: 漢化 + Arena Sweep + Encounter + RoB 同時跑
```

---

## Phase 0 — Foundations

### T0.1 Storage constants + helper
**做什麼**：[extension/background/service-worker.js](../../extension/background/service-worker.js) 開頭加常數 + helper：

```js
const RB_DEFAULT_RESERVE = 5;
const RB_DEFAULT_TRIO_MIN = 15;

async function getRbStateToday() {
  const today = getGameDay();
  let s = await getState("rbStateToday", null);
  if (!s || s.day !== today) {
    s = { day: today, fsmDone: false, trioDone: false };
    await setState("rbStateToday", s);
  }
  return s;
}
```

`rbAutoEnabled` / `rbReserveTokens` / `rbTrioMinAfterFSM` / `rbTokens` / `rbTabId` 是 storage keys，不需要常數化（跟既有 `encounterEnabled` 等風格一致）。

**AC**：grep `rbStateToday` / `getRbStateToday` 在 SW.js 有 hit；reload extension 後 `chrome.storage.local.get('rbStateToday', console.log)` 取得 today 結構或 null。
**Verify**：`chrome://extensions` reload 無錯。

---

## Phase 1 — First slice

### T1.1 Manifest content_scripts entry
**做什麼**：[extension/manifest.json](../../extension/manifest.json) `content_scripts` 加：

```json
{
  "matches": ["*://hentaiverse.org/*", "*://www.hentaiverse.org/*"],
  "js": ["content/ring-of-blood.js"],
  "run_at": "document_idle"
}
```

不擴 host_permissions（hentaiverse.org 已涵蓋）。

**AC**：reload 無錯，DevTools → Sources 列出 ring-of-blood.js。

### T1.2 Build ring-of-blood.js
**做什麼**：建 [extension/content/ring-of-blood.js](../../extension/content/ring-of-blood.js)，仿 [arena.js](../../extension/content/arena.js) 結構：

```js
(() => {
  if (!location.hostname.includes("hentaiverse")) return;
  if (!location.search.includes("s=Battle") || !location.search.includes("ss=rb")) return;

  const WORLD = "normal";
  const wk = (key) => key + "_" + WORLD;

  function parseChallenges() {
    const rows = document.querySelectorAll("#arena_list tbody tr");
    const out = [];
    for (const row of rows) {
      const tds = row.querySelectorAll("td");
      if (tds.length < 8) continue;
      const costText = tds[5]?.textContent ?? "";
      const m = costText.match(/(\d+)/);
      if (!m) continue;
      const cost = parseInt(m[1]);
      const startImg = tds[7]?.querySelector("img");
      const onclick = startImg?.getAttribute("onclick") ?? "";
      const enabled = !!onclick && !startImg.src.includes("_d.png");
      let id = null, token = null;
      const initMatch = onclick.match(/init_battle\((\d+),\s*(\d+),\s*'([^']+)'\)/);
      if (initMatch) { id = parseInt(initMatch[1]); token = initMatch[3]; }
      out.push({ cost, enabled, id, token });
    }
    return out;
  }

  function parseTokens() {
    const el = document.getElementById("arena_tokens");
    const m = el?.textContent?.match(/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  function parseStamina() {
    const el = document.getElementById("stamina_readout");
    const m = el?.textContent?.match(/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  async function enterChallenge(cost, phase) {
    const target = parseChallenges().find((c) => c.cost === cost && c.enabled);
    if (!target?.id) return false;
    await chrome.storage.local.set({
      [wk("autoArena")]: true,
      [wk("battleContext")]: { type: "rb", phase, world: WORLD },
    });
    document.getElementById("initid").value = target.id;
    document.getElementById("inittoken").value = target.token;
    document.getElementById("initform").submit();
    return true;
  }

  if (document.getElementById("ckey_attack")) return;

  const tokens = parseTokens();
  const stamina = parseStamina();
  chrome.runtime.sendMessage({
    type: "RB_PAGE_READY",
    tokens,
    stamina,
    challenges: parseChallenges(),
  }).catch(() => {});

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "ENTER_RB") {
      enterChallenge(msg.cost, msg.phase).then((ok) => sendResponse({ ok }));
      return true;
    }
  });
})();
```

**AC**：開 `?s=Battle&ss=rb` 頁面 → SW console 應收到 `RB_PAGE_READY` log。
**Verify**：暫加 SW console.log 確認；之後拿掉。

### T1.3 Dashboard toggle UI + SET_RB_AUTO
**做什麼**：
- [extension/dashboard/index.html](../../extension/dashboard/index.html) 在 `Encounter Farming` 那 row 旁加 `Ring of Blood` row（同 toggle-btn pattern）
- [extension/dashboard/app.js](../../extension/dashboard/app.js)：
  - `renderControls()` 加 btnRingOfBlood 顯示
  - 加 click handler → sendMessage `{ type: "SET_RB_AUTO", enabled }`
- [extension/background/service-worker.js](../../extension/background/service-worker.js) message handler 加：

```js
case "SET_RB_AUTO": {
  await setState("rbAutoEnabled", msg.enabled);
  if (msg.enabled) {
    await addLog({ type: "system", reason: "RoB auto started" });
    // Phase 2 才加：立即評估若 sweep 不在跑
  } else {
    await addLog({ type: "system", reason: "RoB auto stopped" });
  }
  break;
}
```

**AC**：dashboard 看到 Ring of Blood toggle，點擊切換可 reflect storage `rbAutoEnabled`。

### T1.4 SW RB_PAGE_READY handler (FSM only)
**做什麼**：[extension/background/service-worker.js](../../extension/background/service-worker.js) 加 message handler 跟 helper：

```js
async function handleRbPageReady(msg, senderTabId) {
  const enabled = await getState("rbAutoEnabled", false);
  if (!enabled) return;

  await setState("rbTokens", msg.tokens);
  await setState("rbTabId", senderTabId);

  const state = await getRbStateToday();
  const reserve = await getState("rbReserveTokens", RB_DEFAULT_RESERVE);

  // Phase 1: 只跑 FSM
  if (!state.fsmDone) {
    if (msg.tokens != null && msg.tokens >= 5) {
      await addLog({ type: "system", reason: "RoB: entering FSM (tokens=" + msg.tokens + ")" });
      await sendToTab(senderTabId, { type: "ENTER_RB", cost: 5, phase: "fsm" });
    } else {
      state.fsmDone = true;
      state.trioDone = true;
      await setState("rbStateToday", state);
      await addLog({ type: "alert", reason: "RoB: insufficient tokens for FSM (" + msg.tokens + "/5), skipping" });
    }
    return;
  }
}
```

message handler switch 加 `case "RB_PAGE_READY":`。

**AC**：toggle ON + token >= 5 + 手動開 RoB 頁 → SW log「entering FSM」→ FSM 戰鬥開始。

### T1.5 SW BATTLE_COMPLETE — add "rb" branch
**做什麼**：[extension/background/service-worker.js](../../extension/background/service-worker.js) `handleBattleComplete` 在 encounter / arena 分支之後加：

```js
if (effectiveType === "rb") {
  const ctx = await getState(wk("battleContext", world), {});
  const state = await getRbStateToday();
  if (ctx.phase === "fsm") state.fsmDone = true;
  if (ctx.phase === "trio") state.trioDone = true;
  await setState("rbStateToday", state);
  await addLog({
    type: result === "victory" ? "victory" : "defeated",
    reason: "RoB " + ctx.phase + " " + result,
  });
  // Phase 1 stop here; Phase 2 will reload RoB page to evaluate next phase
  return;
}
```

**AC**：FSM 戰鬥結束（victory or defeated）→ `rbStateToday.fsmDone = true` → battleLog 有 "RoB fsm victory/defeated"。

🚦 **CHECKPOINT 1**:
- toggle ON
- 手動開 [?s=Battle&ss=rb](https://hentaiverse.org/?s=Battle&ss=rb)
- 自動點 FSM (5 token cost) → 進入戰鬥 → battle.js combat AI 跑完 → BATTLE_COMPLETE → mark fsmDone
- Trio 不會自動跑（Phase 2 才做）
- autoArena Arena Sweep / Encounter 不被影響

---

## Phase 2 — Trio + sweep-end trigger

### T2.1 maybeTriggerRb() helper
**做什麼**：

```js
async function maybeTriggerRb() {
  const enabled = await getState("rbAutoEnabled", false);
  if (!enabled) return;
  const state = await getRbStateToday();
  if (state.fsmDone && state.trioDone) return;

  const RB_URL = "https://hentaiverse.org/?s=Battle&ss=rb";
  const tabId = await getState("rbTabId", null);
  let tab = null;
  if (tabId) {
    try { tab = await chrome.tabs.get(tabId); } catch {}
  }
  if (tab) {
    await chrome.tabs.update(tab.id, { url: RB_URL });
  } else {
    tab = await chrome.tabs.create({ url: RB_URL, active: false });
    await setState("rbTabId", tab.id);
  }
}
```

### T2.2 Hook into sweep "all done" branch
**做什麼**：[extension/background/service-worker.js](../../extension/background/service-worker.js) `handleArenaPageReady` 跟 `handleBattleComplete` 內既有的「all difficulties done」結尾加：

```js
// existing: notification "All arena difficulties completed!"
await maybeTriggerRb();
return;
```

需找 `handleArenaPageReady` 跟 `handleBattleComplete` 共 3 處 all-done branch（normal/isekai 的 sweep complete + per-battle allDone）。

### T2.3 Hook into sweep "stamina depleted"
**做什麼**：`handleArenaPageReady` 內 `stamina < threshold` 那段，notification 之後加：

```js
await maybeTriggerRb();
return;
```

### T2.4 RB_PAGE_READY 加 Trio logic
**做什麼**：T1.4 的 handler 補 Trio：

```js
async function handleRbPageReady(msg, senderTabId) {
  // ... (T1.4 code)

  if (!state.fsmDone) { /* T1.4 */ return; }

  // Trio
  if (!state.trioDone) {
    const trioMin = await getState("rbTrioMinAfterFSM", RB_DEFAULT_TRIO_MIN);
    if (msg.tokens != null && msg.tokens > trioMin) {
      await addLog({ type: "system", reason: "RoB: entering Trio (tokens=" + msg.tokens + ")" });
      await sendToTab(senderTabId, { type: "ENTER_RB", cost: 10, phase: "trio" });
    } else {
      state.trioDone = true;
      await setState("rbStateToday", state);
      await addLog({ type: "system", reason: "RoB: skipping Trio (tokens=" + msg.tokens + ", threshold>" + trioMin + ")" });
    }
    return;
  }

  await addLog({ type: "system", reason: "RoB: all done today" });
}
```

### T2.5 BATTLE_COMPLETE phase chaining
**做什麼**：T1.5 的 rb 分支末尾改成 reload RoB tab（讓 RB_PAGE_READY 重新 evaluate Trio）：

```js
if (effectiveType === "rb") {
  // ... mark done as before
  if (!state.trioDone) {
    const rbTabId = await getState("rbTabId", null);
    if (rbTabId) {
      try { await chrome.tabs.update(rbTabId, { url: "https://hentaiverse.org/?s=Battle&ss=rb" }); } catch {}
    }
  }
  return;
}
```

### T2.6 SET_RB_AUTO immediate evaluation
**做什麼**：T1.3 的 handler 補：

```js
case "SET_RB_AUTO": {
  await setState("rbAutoEnabled", msg.enabled);
  if (msg.enabled) {
    await addLog({ type: "system", reason: "RoB auto started" });
    const sweepNormal = await getState(wk("arenaSweepEnabled", "normal"), false);
    const sweepIsekai = await getState(wk("arenaSweepEnabled", "isekai"), false);
    if (!sweepNormal && !sweepIsekai) {
      await maybeTriggerRb();
    }
  } else {
    await addLog({ type: "system", reason: "RoB auto stopped" });
  }
  break;
}
```

🚦 **CHECKPOINT 2**:
- 啟動 sweep + RoB toggle ON
- sweep 跑完 → 自動 switch tab → 打 FSM → reload RoB → 打 Trio → 結束
- 各 token 邊界 (4 / 10 / 15 / 21) 行為對齊 AC2-5
- AC10/11/12 邊界 trigger 行為正確

---

## Phase 3 — Daily reset + dashboard status

### T3.1 Daily reset
**做什麼**：`checkDailyReset` 既有 `lastResetDate !== today` block 內加：

```js
await setState("rbStateToday", { day: today, fsmDone: false, trioDone: false });
```

### T3.2 Dashboard status panel
**做什麼**：[extension/dashboard/index.html](../../extension/dashboard/index.html) Translations panel 之前加 RoB status section（或 controls 內加 status row）：

```html
<div class="status-row" id="rbStatus"></div>
```

[extension/dashboard/app.js](../../extension/dashboard/app.js) renderAll 加：

```js
function renderRbStatus() {
  const el = document.getElementById("rbStatus");
  if (!el) return;
  const s = state.rbStateToday ?? {};
  const tokens = state.rbTokens ?? "?";
  const fsm = s.fsmDone ? "✅" : "⬜";
  const trio = s.trioDone ? "✅" : "⬜";
  el.textContent = "RoB: " + fsm + " FSM " + trio + " Trio | tokens=" + tokens;
}
```

🚦 **CHECKPOINT 3**:
- 跨 8am 後重整 dashboard → today flags reset
- 整天進度即時顯示

---

## Phase 4 — Final verification (user e2e)

### T4.1 AC1–AC13 walkthrough
按 [spec.md §5](./spec.md) AC table 逐項過。最關鍵：
- AC1 (sweep 完接 RoB)
- AC7 (FSM 戰敗仍評估 Trio — 等戰敗時機才能測，可能下次戰敗時順便)
- AC10/11/12 (trigger 邊界)

### T4.2 Regression
- 漢化全開 + Arena Sweep + Isekai Sweep + Encounter Farming + RoB toggle = 全部 ON
- 跑完一輪 daily 確認沒互相干擾

---

## 風險紀錄

| 風險 | 緩解 |
|---|---|
| RoB 戰鬥 stamina 不夠失敗 | AC7 路徑：戰敗 → mark done → 不重試（HV 機制 + 不浪費 token） |
| `init_battle()` confirm dialog 卡 content script | T1.2 已 bypass — 直接 form submit |
| 漢化把 challenge 名稱改了影響識別 | 用 cost 不用名稱 — 已在 spec 確認 |
| sweep 結束後 RoB tab 跟 sweep tab 衝突 | maybeTriggerRb 優先 reuse `rbTabId`；若無則新 tab |
| HV 在 RoB 加新 5 或 10 cost challenge | 暫時當作不會發生；若真發生會誤打，需要加名稱 + cost 雙條件識別（spec A2 已標） |
| user M (battle.js / app.js / SW) 仍在 working tree | 跟 Phase 1-3 漢化 commits 同樣處理：`git stash` 後做我的，commit，pop |

---

## 不在這次 plan 範圍

- 修改 [extension/content/battle.js](../../extension/content/battle.js) combat AI 邏輯（boundary §6 ask first）
- isekai 世界 RoB（spec A1 排除）
- Daily reset 自動 trigger RoB（spec A6 排除，僅 sweep-end trigger）
- 把 `rbReserveTokens` / `rbTrioMinAfterFSM` 暴露到 dashboard advanced settings
