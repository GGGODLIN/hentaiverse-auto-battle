# HV Auto Arena Extension Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Chrome Extension (MV3) migration with auto arena sweep, encounter coordination, Riddle Master integration, unattended mode, and a centralized Dashboard.

**Architecture:** Service Worker as central scheduler. Content scripts handle page-specific detection and execution. Dashboard as standalone tab. Battle engine core logic preserved from userscript, only plumbing changed.

**Tech Stack:** Chrome Extension MV3, vanilla JS, chrome.storage.local, chrome.alarms, chrome.tabs, chrome.notifications

**Existing state:** 9 files (~2100 lines) already created in `extension/`. This plan addresses 16 identified gaps between existing code and the design spec at `docs/superpowers/specs/2026-04-01-extension-migration-design.md`.

---

### Task 1: Fix manifest — add Riddle Master API host permission

**Files:**
- Modify: `extension/manifest.json`

- [ ] **Step 1: Add rdma.ooguy.com to host_permissions**

In `extension/manifest.json`, add `"*://rdma.ooguy.com/*"` to the `host_permissions` array:

```json
"host_permissions": [
  "*://hentaiverse.org/*",
  "*://www.hentaiverse.org/*",
  "*://e-hentai.org/*",
  "*://www.e-hentai.org/*",
  "*://rdma.ooguy.com/*"
]
```

- [ ] **Step 2: Verify manifest is valid JSON**

Run: `cd /Users/linhancheng/Desktop/work/autoArena && node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); console.log('Valid JSON')"`

Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add extension/manifest.json
git commit -m "feat: add rdma.ooguy.com to host_permissions for Riddle Master API"
```

---

### Task 2: Add minimal floating button to battle page

**Files:**
- Modify: `extension/content/battle.js`

- [ ] **Step 1: Add button creation and sync logic**

In `extension/content/battle.js`, after the `injectPageScript()` call inside `init()`, add a floating button. Insert this code block right after the `injectPageScript();` line inside `async function init()`:

```js
const btn = document.createElement("div");
btn.id = "autoArenaBtn";
Object.assign(btn.style, {
  position: "fixed",
  bottom: "20px",
  right: "20px",
  padding: "10px 18px",
  borderRadius: "24px",
  cursor: "pointer",
  zIndex: "99999",
  fontFamily: "'Segoe UI', Arial, sans-serif",
  fontSize: "14px",
  fontWeight: "bold",
  userSelect: "none",
  transition: "all 0.3s ease",
  boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
  border: "2px solid rgba(255,255,255,0.2)",
  letterSpacing: "0.5px",
  color: "#fff",
});
document.body.appendChild(btn);

function syncButton() {
  const on = storeGet("autoArena", false);
  btn.textContent = on ? "⚔ AUTO ON" : "⚔ AUTO OFF";
  btn.style.background = on
    ? "linear-gradient(135deg, #43A047, #66BB6A)"
    : "linear-gradient(135deg, #c62828, #e53935)";
}
syncButton();

btn.addEventListener("click", () => {
  const current = storeGet("autoArena", false);
  if (current) {
    storeSet("autoArena", false);
    syncButton();
  } else {
    if (!isInBattle()) {
      btn.textContent = "⚠ Not in battle";
      btn.style.background = "linear-gradient(135deg, #E65100, #FF9800)";
      setTimeout(syncButton, 2000);
      return;
    }
    storeSet("autoArena", true);
    syncButton();
    startBattle();
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.autoArena) syncButton();
});
```

- [ ] **Step 2: Verify button renders**

Load the extension in Chrome (`chrome://extensions` → Load unpacked → select `extension/`). Navigate to a hentaiverse.org page. Confirm the floating button appears in bottom-right corner showing "⚔ AUTO OFF".

- [ ] **Step 3: Commit**

```bash
git add extension/content/battle.js
git commit -m "feat: add minimal floating start/stop button on battle page"
```

---

### Task 3: Implement Riddle Master integration in battle.js

**Files:**
- Modify: `extension/content/battle.js`

- [ ] **Step 1: Replace handleRiddleMaster with full Riddle Master solve flow**

Replace the existing `async function handleRiddleMaster()` in `extension/content/battle.js` with:

```js
const RIDDLE_CHECKBOX_MAP = {
  ts: 0, ra: 1, fs: 2, rd: 3, pp: 4, aj: 5,
};

async function solveRiddleMaster() {
  const imageEl = document.querySelector("#riddleimage img");
  if (!imageEl) return false;

  try {
    const resp = await fetch(imageEl.src, { credentials: "same-origin" });
    if (!resp.ok) return false;
    const blob = await resp.blob();

    const apiKey = storeGet("rmApiKey", "");
    const headers = { "Content-Type": "image/jpeg" };
    if (apiKey) headers.apikey = apiKey;

    const apiResp = await fetch("https://rdma.ooguy.com/help2", {
      method: "POST",
      headers,
      body: blob,
    });

    if (apiResp.status === 429) {
      addLog({ type: "alert", reason: "Riddle Master: rate limited (429)" });
      return false;
    }

    const remaining = apiResp.headers.get("x-ratelimit-remaining");
    if (remaining != null) {
      storeSet("riddleMasterRemaining", parseInt(remaining));
    }

    const data = await apiResp.json();

    if (data.return === "finish") {
      addLog({ type: "alert", reason: "Riddle Master: daily limit reached" });
      return false;
    }

    if (data.return !== "good" || !data.answer) {
      addLog({ type: "alert", reason: "Riddle Master: API error (" + data.return + ")" });
      return false;
    }

    const riddler = document.getElementById("riddler1");
    if (!riddler) return false;

    for (const code of data.answer) {
      const idx = RIDDLE_CHECKBOX_MAP[code];
      if (idx != null) {
        const checkbox = riddler.children[idx]?.querySelector("input[type='checkbox']");
        if (checkbox) checkbox.checked = true;
      }
    }

    const submitBtn = document.getElementById("riddlesubmit");
    if (submitBtn) {
      submitBtn.disabled = false;
      await wait(1000 + Math.random() * 2000);
      submitBtn.click();
    }

    addLog({ type: "system", reason: "Riddle Master: solved (remaining: " + (remaining ?? "?") + ")" });
    return true;
  } catch (e) {
    addLog({ type: "alert", reason: "Riddle Master: fetch error - " + e.message });
    return false;
  }
}

async function handleRiddleMaster() {
  addLog({ type: "system", reason: "Riddle Master detected, attempting solve..." });
  await solveRiddleMaster();

  for (let i = 0; i < 30; i++) {
    await wait(2000);
    if (!isRiddleMaster()) {
      addLog({ type: "system", reason: "Riddle Master resolved, resuming battle" });
      init();
      return;
    }
  }

  setStatus("alert", "Riddle Master not resolved after 60s");
  storeSet("autoArena", false);
  notifySW("BATTLE_ALERT", {
    title: "RIDDLE MASTER",
    body: "Riddle Master not resolved after 60s",
    isUrgent: true,
  });
}
```

- [ ] **Step 2: Verify the checkbox mapping matches antiCheat.js**

Cross-reference with `antiCheat.js` lines 221-250:
- `aj` → children[5] ✓
- `fs` → children[2] ✓
- `pp` → children[4] ✓
- `ra` → children[1] ✓
- `rd` → children[3] ✓
- `ts` → children[0] ✓

Selector uses `querySelector("input[type='checkbox']")` inside each child to be more robust than the original `.children[0].children[0].checked`.

- [ ] **Step 3: Commit**

```bash
git add extension/content/battle.js
git commit -m "feat: integrate Riddle Master API solve flow into battle engine"
```

---

### Task 4: Implement Unattended Mode in battle.js

**Files:**
- Modify: `extension/content/battle.js`

- [ ] **Step 1: Modify retryOrAlert to check unattended mode**

In `extension/content/battle.js`, replace the `retryOrAlert` function inside `startBattle()` with:

```js
function retryOrAlert(title, body, isUrgent = false) {
  const count = storeGet("alertRetryCount", 0);
  const rs = readState();
  console.log("[AA] ALERT " + title + " (retry " + (count + 1) + "/3): " + body +
    " hpP=" + rs.hpP + " mpP=" + rs.mpP + " spP=" + rs.spP);
  if (count < 2) {
    setStatus("reload", title + " (" + (count + 1) + "/3)");
    storeSet("alertRetryCount", count + 1);
    location.reload();
    return true;
  }
  storeSet("alertRetryCount", 0);

  const unattended = storeGet("unattendedMode", false);
  if (unattended) {
    setStatus("alert", title + ": " + body + " (unattended, continuing)");
    addLog({ type: "alert", reason: title + ": " + body + " — unattended, continuing" });
    notifySW("BATTLE_ALERT", { title, body, isUrgent });
    return true;
  }

  storeSet("autoArena", false);
  setStatus("alert", title + ": " + body);
  notifySW("BATTLE_ALERT", { title, body, isUrgent });
  return false;
}
```

Key change: when `unattendedMode === true`, retry counter resets and returns `true` (meaning "handled, keep going") instead of setting `autoArena = false`.

- [ ] **Step 2: Verify all retryOrAlert callers handle the return value correctly**

Search for all `retryOrAlert` calls in battle.js. Each one either `return`s after a `false` result or continues after `true`. The existing pattern is:

```js
retryOrAlert("CRITICAL HP", "HP < 200 & no heals available!");
return;
```

In unattended mode, `retryOrAlert` returns `true`, but the `return` still fires — meaning the current while loop iteration ends. On the next iteration the battle loop starts fresh. This is correct behavior: the engine re-evaluates state from scratch.

- [ ] **Step 3: Commit**

```bash
git add extension/content/battle.js
git commit -m "feat: add unattended mode support to battle retry logic"
```

---

### Task 5: Add Unattended Mode and Riddle Master controls to Dashboard

**Files:**
- Modify: `extension/dashboard/index.html`
- Modify: `extension/dashboard/app.js`

- [ ] **Step 1: Add Unattended Mode toggle to HTML**

In `extension/dashboard/index.html`, add a third control row after the Encounter row inside the `<section class="controls">`:

```html
<div class="control-row">
  <label>Unattended Mode</label>
  <button id="btnUnattended" class="toggle-btn off">OFF</button>
</div>
```

- [ ] **Step 2: Add RM API Key input to HTML**

In `extension/dashboard/index.html`, inside `<div id="generalSettings"></div>`, this section is rendered dynamically by `renderGeneralSettings()` in app.js. No HTML change needed here — we add it in the JS render function.

- [ ] **Step 3: Add Unattended toggle logic to app.js**

In `extension/dashboard/app.js`, add to `renderControls()` after the encounter button logic:

```js
const btnUna = document.getElementById("btnUnattended");
const unaOn = state.unattendedMode ?? false;
btnUna.textContent = unaOn ? "ON" : "OFF";
btnUna.className = "toggle-btn " + (unaOn ? "on" : "off");
```

Add click handler after the encounter click handler:

```js
document.getElementById("btnUnattended").addEventListener("click", async () => {
  const current = state.unattendedMode ?? false;
  const next = !current;
  state.unattendedMode = next;
  chrome.storage.local.set({ unattendedMode: next });
  renderControls();
});
```

- [ ] **Step 4: Add RM API Key and Retry button to renderGeneralSettings()**

In `extension/dashboard/app.js`, add to the end of `renderGeneralSettings()`:

```js
const rmRow = document.createElement("div");
rmRow.className = "general-row";
rmRow.innerHTML = '<span>RM API Key</span>';
const rmInput = document.createElement("input");
rmInput.type = "text";
rmInput.value = state.rmApiKey ?? "";
rmInput.placeholder = "optional";
rmInput.style.width = "160px";
rmInput.addEventListener("change", () => {
  state.rmApiKey = rmInput.value;
  chrome.storage.local.set({ rmApiKey: rmInput.value });
});
rmRow.appendChild(rmInput);
section.appendChild(rmRow);

const retryRow = document.createElement("div");
retryRow.className = "general-row";
const retryBtn = document.createElement("button");
retryBtn.textContent = "🔄 Retry Battle";
Object.assign(retryBtn.style, {
  padding: "6px 16px",
  fontSize: "12px",
  cursor: "pointer",
  background: "#1976D2",
  color: "white",
  border: "none",
  borderRadius: "6px",
});
retryBtn.addEventListener("click", () => {
  chrome.storage.local.set({
    autoArena: true,
    alertRetryCount: 0,
  });
  const tabId = state.arenaTabId;
  if (tabId) {
    chrome.tabs.reload(tabId);
  }
  retryBtn.textContent = "✓ Retrying...";
  setTimeout(() => { retryBtn.textContent = "🔄 Retry Battle"; }, 2000);
});
retryRow.appendChild(retryBtn);
section.appendChild(retryRow);
```

- [ ] **Step 5: Add RM remaining warning style to renderStats()**

In `extension/dashboard/app.js`, modify the Riddle Master stat display in `renderStats()`:

```js
const rmVal = state.riddleMasterRemaining;
const rmEl = document.getElementById("statRiddle");
rmEl.textContent = rmVal ?? "--";
if (rmVal != null && rmVal <= 3) {
  rmEl.style.color = "#EF5350";
} else {
  rmEl.style.color = "#fff";
}
```

- [ ] **Step 6: Commit**

```bash
git add extension/dashboard/index.html extension/dashboard/app.js
git commit -m "feat: add unattended mode toggle, RM API key, retry button to dashboard"
```

---

### Task 6: Update Service Worker for unattended mode and daily reset fix

**Files:**
- Modify: `extension/background/service-worker.js`

- [ ] **Step 1: Add riddleMasterRemaining to daily reset**

In `extension/background/service-worker.js`, inside `checkDailyReset()`, add to the reset block after `await setState("battleLog", []);`:

```js
await setState("riddleMasterRemaining", null);
```

- [ ] **Step 2: Handle BATTLE_ALERT with unattended mode awareness**

In `extension/background/service-worker.js`, modify the `BATTLE_ALERT` case in the message listener:

```js
case "BATTLE_ALERT": {
  const { title, body } = msg;
  const unattended = await getState("unattendedMode", false);
  chrome.notifications.create({
    type: "basic",
    title: "HV: " + title,
    message: body + (unattended ? " (unattended)" : ""),
    iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='16' font-size='16'>⚠</text></svg>",
    requireInteraction: !unattended && (msg.isUrgent ?? false),
  });
  if (!unattended) {
    await addLog({ type: "alert", reason: "⚠ Needs attention: " + title + " — " + body });
  }
  break;
}
```

When unattended, notifications are informational (non-sticky). When attended, urgent alerts require interaction.

- [ ] **Step 3: Commit**

```bash
git add extension/background/service-worker.js
git commit -m "feat: add unattended mode to SW alert handling, fix daily reset for RM"
```

---

### Task 7: Verify full extension loads without errors

**Files:**
- All extension files

- [ ] **Step 1: Load extension in Chrome**

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `/Users/linhancheng/Desktop/work/autoArena/extension/`
4. Confirm extension loads without errors (no red error badge)

- [ ] **Step 2: Check Service Worker**

Click "Service Worker" link on the extension card → check console for:
- `[SW] HV Auto Arena installed/updated` log message
- No errors

- [ ] **Step 3: Open Dashboard**

Click the extension icon in toolbar. Confirm:
- Dashboard opens as standalone tab
- All sections render (Task Control, Arena Progress, Daily Stats, Battle Settings, Battle Log)
- Arena Sweep, Encounter, and Unattended Mode toggles are visible
- RM API Key input field is visible
- Retry Battle button is visible

- [ ] **Step 4: Navigate to hentaiverse.org**

Open a hentaiverse.org page. Confirm:
- Floating "⚔ AUTO OFF" button appears in bottom-right
- No console errors from battle.js or arena.js
- On arena page (`?s=Battle&ss=ar`), confirm arena.js logs difficulty parsing

- [ ] **Step 5: Navigate to e-hentai.org/news.php**

Open news.php. Confirm:
- No console errors from encounter.js
- encounter.js correctly detects presence/absence of encounter

- [ ] **Step 6: Commit all remaining changes**

```bash
git add -A extension/
git commit -m "chore: verify extension loads and all components render correctly"
```

---

### Task 8: Integration test — Arena Sweep flow

**Files:**
- No code changes, manual test

- [ ] **Step 1: Enable Arena Sweep from Dashboard**

1. Open Dashboard
2. Toggle "Arena Sweep" → ON
3. Confirm: status shows activity, a hentaiverse.org tab opens/navigates to `?s=Battle&ss=ar`

- [ ] **Step 2: Verify arena entry**

1. Confirm arena.js parsed difficulties (check Dashboard → Arena Progress shows cards)
2. Confirm SW selects first difficulty
3. Confirm form submission occurs → page navigates to battle

- [ ] **Step 3: Verify battle engine starts**

1. Confirm floating button shows "⚔ AUTO ON"
2. Confirm battle loop is running (actions being taken)
3. Let one round complete

- [ ] **Step 4: Verify victory handling**

After victory:
- If not last round: battle_continue fires, next round starts
- If last round: BATTLE_COMPLETE sent, Dashboard shows ✅, tab navigates back to arena page

- [ ] **Step 5: Verify sweep continues**

Confirm the next difficulty is automatically entered after returning to arena page.

- [ ] **Step 6: Document any issues found**

Create a file `docs/testing-notes.md` with any issues and their fixes.

---

### Task 9: Integration test — Encounter coordination

**Files:**
- No code changes, manual test

- [ ] **Step 1: Enable Encounter only**

1. Turn off Arena Sweep
2. Toggle "Encounter" → ON
3. Confirm: news.php tab is created/reloaded

- [ ] **Step 2: Verify encounter detection**

If encounter appears:
1. Confirm new tab opens with encounter battle URL
2. Confirm battle engine runs in new tab
3. Confirm tab closes after battle ends

If no encounter:
1. Confirm log shows "No encounter available"
2. Confirm alarm schedules next check

- [ ] **Step 3: Enable both Arena Sweep + Encounter**

1. Start arena sweep
2. Wait for a battle to complete
3. Confirm SW checks encounter before entering next arena difficulty

- [ ] **Step 4: Document any issues found**

Append to `docs/testing-notes.md`.

---

### Task 10: Integration test — Unattended Mode + Riddle Master

**Files:**
- No code changes, manual test

- [ ] **Step 1: Test Unattended Mode**

1. Enable Unattended Mode in Dashboard
2. Start a battle
3. Simulate an alert scenario (if possible, or wait for natural occurrence)
4. Confirm: battle does NOT pause, log shows "unattended, continuing"

- [ ] **Step 2: Test Riddle Master (if encountered)**

1. When Riddle Master appears:
2. Confirm image is extracted and sent to API
3. Confirm answer is applied and submitted (or timeout if API fails)
4. Confirm Dashboard shows remaining count
5. Confirm battle resumes after riddle resolves

- [ ] **Step 3: Test RM API Key**

1. Enter an API key in Dashboard → RM API Key field
2. Trigger Riddle Master
3. Confirm the key is sent in the `apikey` header

- [ ] **Step 4: Document any issues found**

Append to `docs/testing-notes.md`.
