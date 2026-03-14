# API-Driven Battle Engine Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add API-driven battle mode to existing autoArena.user.js, eliminating DOM click delays by directly calling the game's POST /json endpoint.

**Architecture:** XHR Hook captures token from first game API call, then battle loop switches to fetch-based API calls. Response HTML is parsed into structured state for decision-making, with optional DOM sync for visual feedback.

**Tech Stack:** Vanilla JS, Tampermonkey GM APIs, fetch API, DOMParser

**Note:** No test framework exists for this userscript. Testing is done manually in-browser during an active HV battle.

---

## File Structure

- Modify: `autoArena.user.js` — all changes within `runBattleMode()`

New functions added inside `runBattleMode()`:
- `hookToken()` — XHR hook for token capture
- `parseResponse(resp)` — HTML response → structured state object
- `syncDOM(resp)` — response HTML → DOM (toggleable)
- `sendAction(mode, target, skill)` — fetch POST /json wrapper
- `decide(state, toggles)` — priority-based decision engine (pure function)
- `startBattleAPI()` — API-driven main battle loop

Modified:
- `DEFAULT_TOGGLES` — add `apiMode`, `syncDOM`
- `TOGGLE_LABELS` / `TOGGLE_ORDER` — add new toggle labels
- `renderPanel()` — add new toggles to settings panel
- Button click handler — route to `startBattleAPI()` when token available and apiMode ON
- Auto-start block — same routing logic

---

### Task 1: hookToken()

**Files:**
- Modify: `autoArena.user.js:258` (inside `runBattleMode()`, near the top)

- [ ] **Step 1: Add token state variable and hookToken function**

Add after line 263 (`const isRiddleMaster = ...`):

```js
let hvToken = null;

function hookToken() {
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    if (!hvToken && this._hvUrl && this._hvUrl.includes("/json")) {
      try {
        const parsed = JSON.parse(body);
        if (parsed.token) {
          hvToken = parsed.token;
          console.log("AutoArena: Token captured");
        }
      } catch (e) {}
    }
    return origSend.apply(this, arguments);
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._hvUrl = url;
    return origOpen.apply(this, arguments);
  };
}
```

- [ ] **Step 2: Call hookToken() on page load**

Add right after the `hookToken` function definition:

```js
hookToken();
```

- [ ] **Step 3: Verify in browser**

Open HV battle, open DevTools console, do one manual action (click a monster). Check console shows `AutoArena: Token captured`.

---

### Task 2: parseResponse(resp)

**Files:**
- Modify: `autoArena.user.js` — add after `hookToken()` call

- [ ] **Step 1: Add parseResponse function**

```js
function parseResponse(resp) {
  const parser = new DOMParser();
  const parse = (html) => parser.parseFromString("<div>" + html + "</div>", "text/html");

  const vitalsDoc = parse(resp.pane_vitals);
  const hpW = parseInt(vitalsDoc.querySelector("#dvbh img")?.style.width) || 1;
  const mpW = parseInt(vitalsDoc.querySelector("#dvbm img")?.style.width) || 1;
  const spW = parseInt(vitalsDoc.querySelector("#dvbs img")?.style.width) || 1;
  const ocW = parseInt(vitalsDoc.querySelector("#dvbc img")?.style.width) || 1;

  const hpText = vitalsDoc.getElementById("dvrhd")?.textContent;
  const isIsekaiResp = !hpText;

  let hp = 0, mp = 0, sp = 0, oc = 0;
  let hpP, mpP, spP, ocP;

  if (isIsekaiResp) {
    hpP = Math.round((hpW / 414) * 100);
    mpP = Math.round((mpW / 414) * 100);
    spP = Math.round((spW / 414) * 100);
    ocP = Math.round((ocW / 414) * 100);
  } else {
    hp = parseInt(hpText) || 0;
    mp = parseInt(vitalsDoc.getElementById("dvrm")?.textContent) || 0;
    sp = parseInt(vitalsDoc.getElementById("dvrs")?.textContent) || 0;
    oc = parseInt(vitalsDoc.getElementById("dvrc")?.textContent) || 0;
    hpP = Math.round((hpW / 414) * 100);
    mpP = Math.round((mpW / 414) * 100);
    spP = Math.round((spW / 414) * 100);
    ocP = Math.round((ocW / 414) * 100);
  }

  const hpBarSrc = vitalsDoc.querySelector("#dvbh img")?.getAttribute("src") ?? "";

  const buffs = {};
  const buffMatches = (resp.pane_effects ?? "").matchAll(
    /set_infopane_effect\('([^']+)',\s*'[^']*',\s*(\d+|'autocast')\)/g
  );
  for (const m of buffMatches) {
    buffs[m[1]] = m[2] === "'autocast'" ? 999 : parseInt(m[2]);
  }

  const monsterDoc = parse(resp.pane_monster);
  const alive = [];
  const elites = [];
  const monsterHp = {};
  monsterDoc.querySelectorAll('[id^="mkey_"]').forEach((m) => {
    const id = parseInt(m.id.replace("mkey_", ""));
    const opacity = m.style.opacity;
    if (opacity === "0.3" || opacity === "0") return;
    const hpImg = m.querySelector('img[alt="health"]');
    if (hpImg && hpImg.src && hpImg.src.includes("nbardead")) return;
    alive.push(id);
    monsterHp[id] = parseInt(hpImg?.style.width) || 0;
    const btm2 = m.querySelector(".btm2");
    if (btm2 && btm2.style.background && btm2.style.background !== "none") {
      elites.push(id);
    }
  });

  const qbDoc = parse(resp.pane_quickbar);
  const qbSkillMap = {};
  qbDoc.querySelectorAll('[id^="qb"]').forEach((el) => {
    const onclick = el.getAttribute("onclick") ?? "";
    const skillMatch = onclick.match(/lock_action\(this,1,'magic',(\d+)\)/);
    if (skillMatch) qbSkillMap[el.id] = parseInt(skillMatch[1]);
  });

  const skillIds = [];
  if (resp.table_skills) {
    const skillDoc = parse(resp.table_skills);
    skillDoc.querySelectorAll("[id]").forEach((el) => {
      const id = parseInt(el.id);
      if (!isNaN(id)) skillIds.push(id);
    });
  }

  const itemIds = [];
  if (resp.pane_item) {
    const itemDoc = parse(resp.pane_item);
    itemDoc.querySelectorAll('[id^="ikey_"]').forEach((el) => {
      itemIds.push(el.id);
    });
  } else {
    ["ikey_1", "ikey_2", "ikey_3", "ikey_4", "ikey_5", "ikey_6", "ikey_p"].forEach((id) => {
      if ((resp.pane_quickbar ?? "").includes('id="' + id + '"') ||
          (resp.pane_monster ?? "").includes('id="' + id + '"')) return;
      const el = document.getElementById(id);
      if (el) itemIds.push(id);
    });
  }

  let spiritActive = false;
  if (resp.pane_action) {
    spiritActive = resp.pane_action.includes("spirit_a");
  } else {
    const spiritSrc = document.getElementById("ckey_spirit")?.getAttribute("src") ?? "";
    spiritActive = spiritSrc.includes("spirit_a");
  }

  const victory = (resp.textlog ?? []).some(
    (l) => l.t && l.t.toLowerCase().includes("victorious")
  );

  let isLastRound = false;
  let hasPickup = false;
  if (resp.pane_completion) {
    const compDoc = parse(resp.pane_completion);
    const btcp = compDoc.getElementById("btcp");
    if (btcp) {
      const onclick = btcp.getAttribute("onclick") ?? "";
      const img = btcp.querySelector("img");
      isLastRound = onclick.includes("goto_arena") ||
        (img && img.src && img.src.includes("finishbattle"));
    }
  }
  if (resp.pane_item) {
    hasPickup = resp.pane_item.includes('id="ikey_p"');
  } else {
    hasPickup = !!document.getElementById("ikey_p");
  }

  return {
    hp, mp, sp, oc,
    hpP, mpP, spP, ocP,
    hpBarSrc,
    buffs,
    alive,
    elites,
    monsterHp,
    qbSkillMap,
    skillReady: skillIds,
    itemReady: itemIds,
    spiritActive,
    victory,
    isLastRound,
    hasPickup,
  };
}
```

- [ ] **Step 2: Verify in browser**

In DevTools, run:
```js
// After one DOM-click action triggers XHR hook
const testResp = window._hvResponses[0].response; // from earlier XHR hook
const state = parseResponse(testResp);
console.log(JSON.stringify(state, null, 2));
```

Confirm all fields are populated correctly.

---

### Task 3: syncDOM(resp)

**Files:**
- Modify: `autoArena.user.js` — add after `parseResponse()`

- [ ] **Step 1: Add syncDOM function**

```js
function syncDOM(resp) {
  const t = getToggles();
  if (!(t.syncDOM ?? true)) return;

  const paneMap = {
    pane_vitals: ["dvbh", "dvbm", "dvbs", "dvbc", "dvrhd", "dvrm", "dvrs", "dvrc"],
    pane_monster: "pane_monster",
    pane_effects: "pane_effects",
  };

  if (resp.pane_vitals) {
    const container = document.createElement("div");
    container.innerHTML = resp.pane_vitals;
    ["dvrhd", "dvrm", "dvrs", "dvrc"].forEach((id) => {
      const src = container.querySelector("#" + id);
      const dst = document.getElementById(id);
      if (src && dst) dst.textContent = src.textContent;
    });
    ["dvbh", "dvbm", "dvbs", "dvbc"].forEach((id) => {
      const srcImg = container.querySelector("#" + id + " img");
      const dstImg = document.querySelector("#" + id + " img");
      if (srcImg && dstImg) {
        dstImg.style.width = srcImg.style.width;
        if (srcImg.src) dstImg.src = srcImg.src;
      }
    });
  }

  if (resp.pane_monster) {
    const el = document.getElementById("pane_monster");
    if (el) el.innerHTML = resp.pane_monster;
  }

  if (resp.pane_effects) {
    const el = document.getElementById("pane_effects");
    if (el) el.innerHTML = resp.pane_effects;
  }

  if (resp.pane_quickbar) {
    const el = document.getElementById("quickbar")?.parentElement;
    if (el) el.innerHTML = resp.pane_quickbar;
  }

  if (resp.pane_completion) {
    const el = document.getElementById("pane_completion") ??
      document.querySelector(".btcp")?.parentElement;
    if (el) el.innerHTML = resp.pane_completion;
  }

  if (resp.pane_action) {
    const el = document.getElementById("pane_action");
    if (el) el.innerHTML = resp.pane_action;
  }

  if (resp.textlog) {
    const logEl = document.getElementById("textlog");
    if (logEl) {
      resp.textlog.forEach((entry) => {
        const div = document.createElement("div");
        div.innerHTML = entry.t;
        logEl.appendChild(div);
      });
      logEl.scrollTop = logEl.scrollHeight;
    }
  }
}
```

---

### Task 4: sendAction(mode, target, skill)

**Files:**
- Modify: `autoArena.user.js` — add after `syncDOM()`

- [ ] **Step 1: Add sendAction function**

```js
async function sendAction(mode, target, skill) {
  const payload = {
    type: "battle",
    method: "action",
    token: hvToken,
    mode,
    target,
    skill,
  };
  const resp = await fetch("/json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error("API call failed: " + resp.status);
  return await resp.json();
}
```

---

### Task 5: decide(state, toggles)

**Files:**
- Modify: `autoArena.user.js` — add after `sendAction()`

This is a pure function port of the existing `startBattle()` decision logic. Instead of reading DOM and clicking, it returns an action descriptor.

- [ ] **Step 1: Add helper function for target selection**

```js
function getHighestHpTargetFromState(monsters, monsterHp) {
  let best = monsters[0];
  let bestHp = 0;
  for (const id of monsters) {
    const hp = monsterHp[id] ?? 0;
    if (hp > bestHp) {
      bestHp = hp;
      best = id;
    }
  }
  return best;
}
```

- [ ] **Step 2: Add decide function**

```js
function decide(state, toggles) {
  const t = toggles;
  const s = state;

  if (s.hpP < (t.hpThreshold ?? 50) && (t.qb3 || t.qb4 || t.ikey3)) {
    if (t.qb3 && s.qbSkillMap.qb3) {
      return { mode: "magic", target: 0, skill: s.qbSkillMap.qb3 };
    }
    if (t.qb4 && s.qbSkillMap.qb4) {
      return { mode: "magic", target: 0, skill: s.qbSkillMap.qb4 };
    }
    if (t.ikey3 && s.itemReady.includes("ikey_3")) {
      return { mode: "items", target: 0, skill: "ikey_3" };
    }
  }

  if (s.buffs["Channeling"]) {
    const chSkill = t.channelingSkill ?? "qb2";
    if (t[chSkill] && s.qbSkillMap[chSkill]) {
      return { mode: "magic", target: 0, skill: s.qbSkillMap[chSkill] };
    }
  }

  if (t.ikeyP && s.hasPickup) {
    return { mode: "items", target: 0, skill: "ikey_p" };
  }

  if (t.ikey4 && s.mpP < (t.mpThreshold ?? 30) && s.itemReady.includes("ikey_4")) {
    return { mode: "items", target: 0, skill: "ikey_4" };
  }

  if (t.ikey6 && s.spP < (t.spPotThreshold ?? 50) && s.itemReady.includes("ikey_6")) {
    return { mode: "items", target: 0, skill: "ikey_6" };
  }

  if (t.ikey1 && !s.buffs["Regeneration"] && s.itemReady.includes("ikey_1")) {
    return { mode: "items", target: 0, skill: "ikey_1" };
  }

  if (t.ikey2 && !s.buffs["Replenishment"] && s.itemReady.includes("ikey_2")) {
    return { mode: "items", target: 0, skill: "ikey_2" };
  }

  if (t.ikey5 && s.spP < (t.spThreshold ?? 70) && !s.buffs["Refreshment"] && s.itemReady.includes("ikey_5")) {
    return { mode: "items", target: 0, skill: "ikey_5" };
  }

  if (t.qb1 && (s.buffs["Regen"] ?? 0) <= 3 && s.buffs["Regen"] !== 999 && s.qbSkillMap.qb1) {
    return { mode: "magic", target: 0, skill: s.qbSkillMap.qb1 };
  }

  if (t.qb2 && (s.buffs["Heartseeker"] ?? 0) <= 3 && s.buffs["Heartseeker"] !== 999 && s.qbSkillMap.qb2) {
    return { mode: "magic", target: 0, skill: s.qbSkillMap.qb2 };
  }

  if (t.spirit && s.ocP > (t.ocThreshold ?? 80) && !s.spiritActive && s.alive.length > 0) {
    return { mode: "defend", target: 0, skill: 0, spiritFirst: true };
  }

  const isSpread = (t.targetStrategy ?? "focus") === "spread";

  if (t.ofc && s.skillReady.includes(1111) && s.alive.length >= 4) {
    return { mode: "magic", target: s.alive[0], skill: 1111 };
  }

  for (const qb of ["qb7", "qb8", "qb9"]) {
    if (t[qb] && s.qbSkillMap[qb]) {
      const target = isSpread
        ? getHighestHpTargetFromState(s.alive, s.monsterHp)
        : s.elites.length > 0
          ? s.elites[0]
          : getHighestHpTargetFromState(s.alive, s.monsterHp);
      return { mode: "magic", target, skill: s.qbSkillMap[qb] };
    }
  }

  const normalTarget = isSpread
    ? getHighestHpTargetFromState(s.alive, s.monsterHp)
    : s.elites.length > 0
      ? s.elites[0]
      : s.alive[0];
  return { mode: "attack", target: normalTarget ?? 0, skill: 0 };
}
```

---

### Task 6: startBattleAPI()

**Files:**
- Modify: `autoArena.user.js` — add after `decide()`

- [ ] **Step 1: Add startBattleAPI function**

```js
async function startBattleAPI() {
  if (battleRunning) return;
  battleRunning = true;

  let idleLoops = 0;
  const MAX_IDLE_LOOPS = 10;

  try {
    let action = decide(readStateForAPI(), getToggles());

    while (true) {
      if (!GM_getValue("autoArena", false)) break;

      let resp;
      if (action.spiritFirst) {
        resp = await sendAction("defend", 0, 0);
        const spiritState = parseResponse(resp);
        syncDOM(resp);
        if (!spiritState.spiritActive) {
          action = decide(spiritState, getToggles());
          continue;
        }
        action = decide(spiritState, getToggles());
        continue;
      }

      resp = await sendAction(action.mode, action.target, action.skill);
      const state = parseResponse(resp);
      syncDOM(resp);

      if (state.victory) {
        if (state.isLastRound) {
          GM_setValue("autoArena", false);
          btn.textContent = "\uD83C\uDFC6 CLEARED!";
          btn.style.background = "linear-gradient(135deg, #FFD600, #FFAB00)";
          btn.style.color = "#333";
          alertUser("CLEARED!", "Arena challenge completed!");
          return;
        }
        await wait(1500);
        unsafeWindow.battle?.battle_continue?.();
        return;
      }

      if (state.alive.length === 0) {
        idleLoops++;
        if (idleLoops >= MAX_IDLE_LOOPS) {
          let recovered = false;
          for (let retry = 0; retry < 3; retry++) {
            await wait(5000);
            resp = await sendAction("defend", 0, 0);
            const rs = parseResponse(resp);
            syncDOM(resp);
            if (rs.alive.length > 0 || rs.victory) {
              recovered = true;
              action = decide(rs, getToggles());
              break;
            }
          }
          if (!recovered) {
            GM_setValue("autoArena", false);
            alertUser("ANTI-CHEAT", "Battle stalled after retries!", true);
            return;
          }
          idleLoops = 0;
          continue;
        }
        await wait(300);
        action = { mode: "defend", target: 0, skill: 0 };
        continue;
      }

      idleLoops = 0;
      const t = getToggles();

      if (t.sparkOfLife) {
        const sparkBuffGone = !state.buffs["Spark of Life"];
        const sparkBarGone = state.hpBarSrc.includes("bar_") && !state.hpBarSrc.includes("dgreen");
        if (sparkBuffGone || sparkBarGone) {
          GM_setValue("autoArena", false);
          alertUser("SPARK LOST", "Spark of Life disappeared!");
          return;
        }
      }

      action = decide(state, t);
    }
  } catch (e) {
    GM_setValue("autoArena", false);
    alertUser("ERROR", "Script stopped unexpectedly: " + e.message);
    console.error("AutoArena:", e);
  } finally {
    battleRunning = false;
    syncButton();
  }
}
```

- [ ] **Step 2: Add readStateForAPI helper**

This reads initial state from DOM for the first `decide()` call before any API response exists:

```js
function readStateForAPI() {
  const s = readState();
  const qbSkillMap = {};
  document.querySelectorAll('#quickbar [id^="qb"]').forEach((el) => {
    const onclick = el.getAttribute("onclick") ?? "";
    const m = onclick.match(/lock_action\(this,1,'magic',(\d+)\)/);
    if (m) qbSkillMap[el.id] = parseInt(m[1]);
  });
  const skillReady = [];
  document.querySelectorAll("#table_skills [id], #table_magic [id]").forEach((el) => {
    const id = parseInt(el.id);
    if (!isNaN(id)) skillReady.push(id);
  });
  const itemReady = [];
  document.querySelectorAll('[id^="ikey_"]').forEach((el) => {
    if (el.getAttribute("onclick")) itemReady.push(el.id);
  });
  return {
    ...s,
    hp: parseInt(document.getElementById("dvrhd")?.textContent) || 0,
    mp: parseInt(document.getElementById("dvrm")?.textContent) || 0,
    sp: parseInt(document.getElementById("dvrs")?.textContent) || 0,
    oc: parseInt(document.getElementById("dvrc")?.textContent) || 0,
    hpBarSrc: document.querySelector("#dvbh img")?.getAttribute("src") ?? "",
    monsterHp: {},
    qbSkillMap,
    skillReady,
    itemReady,
    isLastRound: false,
    hasPickup: !!document.getElementById("ikey_p"),
  };
}
```

---

### Task 7: Settings Panel — Add apiMode and syncDOM toggles

**Files:**
- Modify: `autoArena.user.js:451-515` (DEFAULT_TOGGLES, TOGGLE_LABELS, TOGGLE_ORDER)

- [ ] **Step 1: Add to DEFAULT_TOGGLES**

Add these two entries:

```js
apiMode: true,
syncDOM: true,
```

- [ ] **Step 2: Add to TOGGLE_LABELS**

```js
apiMode: "API Mode",
syncDOM: "Sync DOM",
```

- [ ] **Step 3: Add to TOGGLE_ORDER**

Add at the beginning of the array:

```js
"apiMode",
"syncDOM",
```

---

### Task 8: Integration — Wire API mode into existing flow

**Files:**
- Modify: `autoArena.user.js:1170-1186` (btn click handler)
- Modify: `autoArena.user.js:1188-1207` (auto-start block)

- [ ] **Step 1: Modify button click handler**

Replace the `startBattle()` call in the click handler:

```js
btn.addEventListener("click", () => {
  const current = GM_getValue("autoArena", false);
  if (current) {
    GM_setValue("autoArena", false);
    syncButton();
  } else {
    if (!isInBattle()) {
      btn.textContent = "\u26A0 Not in battle";
      btn.style.background = "linear-gradient(135deg, #E65100, #FF9800)";
      setTimeout(syncButton, 2000);
      return;
    }
    GM_setValue("autoArena", true);
    syncButton();
    const t = getToggles();
    if (t.apiMode && hvToken) {
      startBattleAPI();
    } else {
      startBattle();
    }
  }
});
```

- [ ] **Step 2: Modify auto-start block**

Replace the auto-start IIFE:

```js
(async () => {
  if (GM_getValue("autoArena", false)) {
    const found = await waitFor(
      () => document.getElementById("ckey_attack"),
      300,
      5000,
    );
    if (found) {
      const t = getToggles();
      if (t.apiMode && hvToken) {
        startBattleAPI();
      } else {
        startBattle();
      }
    } else {
      GM_setValue("autoArena", false);
      syncButton();
      alertUser(
        "STOPPED",
        "Auto was on but battle lost! Anti-cheat?",
        true,
      );
    }
  }
})();
```

- [ ] **Step 3: Add auto-switch from DOM mode to API mode**

Inside `startBattle()`, at the top of the while loop (after `if (!GM_getValue("autoArena", false)) break;`), add a check to switch to API mode once token is captured:

```js
if (getToggles().apiMode && hvToken && !battleRunning) {
  startBattleAPI();
  return;
}
```

Wait — `battleRunning` is already true inside `startBattle()`. We need a different mechanism. Instead, add this check right after the first action in the loop:

After the existing `const s = readState();` line inside `startBattle()`:

```js
if (getToggles().apiMode && hvToken) {
  battleRunning = false;
  startBattleAPI();
  return;
}
```

---

### Task 9: Manual Testing Checklist

- [ ] **Test 1: Token capture** — Start a battle, click AUTO ON, verify console shows "Token captured" after first action
- [ ] **Test 2: API mode auto-switch** — With apiMode ON, start battle in DOM mode, confirm it switches to API mode after token capture
- [ ] **Test 3: Combat loop** — Let API mode run through several rounds, verify monsters are being attacked and HP/buffs update on screen
- [ ] **Test 4: Victory handling** — Complete a wave, verify victory detection and battle_continue works
- [ ] **Test 5: Last round** — Complete final arena wave, verify CLEARED alert
- [ ] **Test 6: Healing** — Let HP drop below threshold, verify heals fire correctly
- [ ] **Test 7: Potion usage** — Verify buff potions (Health Draught, Mana Draught) are used when buffs are missing
- [ ] **Test 8: syncDOM toggle OFF** — Disable syncDOM in settings, verify battle continues but screen doesn't update
- [ ] **Test 9: apiMode toggle OFF** — Disable apiMode, verify fallback to DOM click mode
- [ ] **Test 10: Encounter mode** — Verify encounter mode still works (should be unchanged)
- [ ] **Test 11: Spark of Life** — With sparkOfLife ON, verify detection still works
- [ ] **Test 12: Anti-cheat** — Verify idle loop detection still triggers
