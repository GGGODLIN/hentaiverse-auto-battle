# HV Auto Arena — Extension Migration Design Spec

## Overview

Migrate the existing Tampermonkey userscript (`autoArena.user.js` ~1490 lines) and third-party Riddle Master script (`antiCheat.js`) into a unified Chrome Extension (MV3). Add auto arena entry, a centralized Dashboard, and coordinated encounter/arena scheduling.

## Goals

1. **Auto Arena Sweep** — automatically enter arena battles from easiest to hardest difficulty
2. **Dashboard** — standalone tab for centralized control, monitoring, and configuration
3. **Encounter Coordination** — schedule encounter checks between arena battles, never miss one
4. **Riddle Master Integration** — handle anti-cheat challenges automatically within the extension
5. **Unattended Mode** — fully autonomous operation that accepts death as a recovery mechanism

## Non-Goals

- Multiple battle profiles (single profile for now)
- Chrome Web Store publishing (local use only)
- Mobile/remote control

---

## Architecture

### Approach: Service Worker as Central Scheduler

The Service Worker is the sole decision-maker. Content scripts only detect state and execute commands. This avoids logic fragmentation across pages that can be interrupted by navigation.

### File Structure

```
extension/
├── manifest.json              MV3
├── background/
│   └── service-worker.js      Central scheduler
├── content/
│   ├── inject.js              Page-context bridge (XHR hook, battle_continue)
│   ├── battle.js              Battle engine (hentaiverse.org battle pages)
│   ├── arena.js               Arena entry (hentaiverse.org?s=Battle&ss=ar)
│   └── encounter.js           Encounter detection (e-hentai.org/news.php)
└── dashboard/
    ├── index.html             Standalone tab Dashboard
    ├── app.js                 Dashboard logic
    └── style.css              Dark theme
```

### Content Script Loading

| Script | Matches | Activation |
|--------|---------|------------|
| `battle.js` + `arena.js` | `*://hentaiverse.org/*` | Each checks page type, exits early if not relevant |
| `encounter.js` | `*://e-hentai.org/news.php*` | Only on news.php |
| `inject.js` | `web_accessible_resources` | Dynamically injected by battle.js |

### Manifest Permissions

- `storage` — state persistence
- `alarms` — SW wake-up for scheduled tasks
- `tabs` — tab creation, navigation, close
- `notifications` — alert notifications
- `host_permissions` — hentaiverse.org, e-hentai.org, rdma.ooguy.com (Riddle Master API)

---

## Page-Context Bridge (inject.js ↔ battle.js)

Content scripts run in an isolated world. Two operations require page-context access:

1. **XHR interception (`waitForApi`)** — hooks `XMLHttpRequest.prototype` to detect when game API calls complete
2. **`battle.battle_continue()`** — calls the game's global JS function to advance rounds

Communication via `CustomEvent`:
- `__hv_cmd` (content script → page): `{ action, id, ... }`
- `__hv_resp` (page → content script): `{ id, action }`

All other DOM operations (click, read elements) work directly from content scripts.

---

## Storage Layer

### chrome.storage.local replaces GM_setValue/GM_getValue

Content scripts use an in-memory cache for synchronous reads:

```
init: load all data from chrome.storage.local into _cache
read: return _cache[key] (synchronous)
write: update _cache[key] + chrome.storage.local.set (async, fire-and-forget)
listen: chrome.storage.onChanged updates _cache from external changes
```

Service Worker accesses chrome.storage.local directly (async).

Dashboard listens to `chrome.storage.onChanged` for real-time UI updates.

### Key State Schema

```
// Controls
arenaSweepEnabled: boolean
encounterEnabled: boolean
unattendedMode: boolean
autoArena: boolean              // battle engine running flag

// Arena
arenaDifficulties: [{ id, entryCost, token, level }]  // parsed from page
arenaSweepProgress: { [difficultyId]: "completed" | "failed" | "in_progress" }
currentArenaDifficulty: number | null
currentStamina: number
arenaTabId: number | null

// Encounter
lastEncounterTime: number       // timestamp
encounterTabId: number | null
encounterBattleTabId: number | null

// Battle
battleContext: { type: "arena" | "encounter", difficultyId?: number }
battleToggles: { ...toggles }   // single profile
lastBattleStatus: { type, reason, time }
alertRetryCount: number

// Riddle Master
rmApiKey: string                // empty = free tier (20/day)
riddleMasterRemaining: number | null

// Daily
lastResetDate: string           // "YYYY-MM-DD" in game-day terms
dailyStats: { arenaWins, arenaLosses, encounterCount }
battleLog: [{ type, reason, time }]  // max 200 entries

// Settings
staminaThreshold: number        // default 10
```

---

## Core Scheduling Logic (Service Worker)

### Arena Sweep Flow

```
Arena sweep enabled:
1. Navigate arena tab → ?s=Battle&ss=ar
2. arena.js reports: available difficulties + stamina + tokens
3. Check stamina >= threshold (default 10)
   ├─ Below → pause sweep, notify via chrome.notifications
   └─ OK → continue
4. Check encounter due (lastEncounterTime + 30min <= now)
   ├─ Due → do encounter first → then return to step 1
   └─ Not due → continue
5. Pick next uncompleted difficulty (ascending by level)
6. Command arena.js to submit form (set initid + inittoken, form.submit())
7. Page navigates to battle → battle.js auto-starts engine
8. Battle ends → battle.js reports result to SW
   ├─ Victory (last round) → record completed → back to step 1
   ├─ Victory (non-last) → battle_continue (engine handles internally)
   └─ Defeated → record failed → back to step 1
9. All difficulties done → notify "All completed!", disable sweep
```

### Encounter Flow

Encounters trigger only when news.php is refreshed. The server checks if >= 30min since last encounter. This means we fully control trigger timing — no risk of "missing" an encounter.

```
1. SW reloads news.php tab (or creates one)
2. encounter.js loads, checks #eventpane
   ├─ Encounter found → send URL to SW
   │   → SW opens new tab with encounter URL
   │   → battle.js starts engine in new tab
   │   → Battle ends → SW closes encounter tab
   └─ No encounter → notify SW
3. Record check timestamp
4. If arena sweep active → resume arena
   If encounter-only mode → schedule next check via chrome.alarms
```

### Coordination Rule

- Before starting a new arena battle: always check encounter first if due
- During arena battle: never refresh news.php (irrelevant, encounter is client-triggered)
- After arena battle ends: check encounter before next arena battle

### SW Sleep Handling

- `chrome.alarms` for scheduled wake-ups (encounter timer, daily reset check every 5min)
- During battles: SW is not needed — battle.js runs autonomously in content script
- SW wakes on `chrome.runtime.sendMessage` from content scripts at decision points

---

## Battle Engine Migration

### Principle: Zero changes to core battle logic

The battle loop, healing priorities, Spark of Life handling, buff management, target selection, item usage, and retry mechanism are preserved exactly.

### What stays unchanged

- `readState()` — read HP/MP/SP/OC/alive/elites/buffs from DOM
- `startBattle()` — full battle loop
- `useItem()` — item usage flow (open items panel → click item → back to attack)
- `isVictorious()` / `isLastRoundVictory()` / `isRiddleMaster()`
- `retryOrAlert()` — retry 3 times via page reload, then escalate
- Target selection: Focus/Spread, Priority Targets, getHighestHpTarget
- Spark of Life recovery sequence
- Channeling handling
- OFC (AoE) usage when >= 4 alive

### What changes

| Original | Replacement |
|----------|------------|
| `GM_getValue` / `GM_setValue` | In-memory cache + `chrome.storage.local` |
| `unsafeWindow.battle.battle_continue()` | CustomEvent bridge to inject.js |
| Full floating UI (button + gear + settings panel) | Minimal status button (start/stop only) |
| `alertUser()` (sound + notification + title flash) | `chrome.runtime.sendMessage` → SW → `chrome.notifications` |
| Profile key based on isekai detection | Single profile key `battleToggles` |

### What's added

- `battleContext` storage key: tracks current battle type and difficulty ID
- `BATTLE_COMPLETE` message to SW on victory/defeat with result and context
- `battleLog` entries for key events (max 200)
- Listener for SW commands: `START_BATTLE` / `STOP_BATTLE`

### Minimal Floating Button on Battle Page

A single button on the battle page for immediate control:
- Shows status: "⚔ AUTO ON" / "⚔ AUTO OFF"
- Click to toggle start/stop
- No settings panel, no gear button (settings are in Dashboard)

### Auto-Start Conditions

On page load, battle.js checks:
1. `autoArena === true` in storage
2. Wait for `#ckey_attack` to appear (max 5 seconds)
3. Found → start engine
4. Not found + not on arena page → report error to SW

---

## ALERT Handling & Unattended Mode

### Game Mechanic: Battles are server-persistent

An unfinished battle cannot be skipped. Navigating to any hentaiverse.org page redirects back to the ongoing battle. Page reload = re-enter same battle.

### Alert Escalation

```
Problem detected (CRITICAL HP, SPARK LOST, etc.):
1. Retry via page reload (up to 3 times)
2. After 3 retries:
   ├─ Unattended Mode ON → reset retry counter, continue battle
   │   → May result in death → death ends battle → SW continues sweep
   └─ Unattended Mode OFF → pause, notify user
       → Dashboard shows "⚠ Needs attention" + "Retry" button
       → User clicks Retry → reload page + reset autoArena + reset retry counter
```

### Unattended Mode

Dashboard toggle. When ON:
- All alerts that would normally pause become "continue fighting"
- Accepts death as the escape mechanism from stuck battles
- All events still logged to battleLog
- chrome.notifications still fire (informational, not blocking)

---

## Riddle Master Integration

### Source

Integrates the third-party Riddle Master Assistant Reborn (`antiCheat.js`) directly into the extension.

### API

- Endpoint: `POST https://rdma.ooguy.com/help2`
- Payload: riddle image as binary JPEG
- Headers: `Content-Type: image/jpeg`, `apikey: <key or empty>`
- Response: `{ return: "good" | "error" | "finish", answer: ["aj","fs",...] }`
- Rate limit: `x-ratelimit-remaining` response header
- Free tier: 20 requests/day per IP

### Flow

```
Battle engine detects #riddlemaster:
1. Pause battle loop
2. Get image from #riddleimage
3. POST image to rdma.ooguy.com/help2 (using fetch, enabled by host_permissions)
4. Response handling:
   ├─ "good" → tick checkboxes per answer codes → click #riddlesubmit
   │   → Log "Riddle solved" + update riddleMasterRemaining
   ├─ "finish" → daily limit reached → do nothing, log it
   └─ error/timeout → API failure → do nothing, log it
5. Wait for #riddlemaster to disappear (countdown expires or solved)
6. Resume battle loop
```

### Answer Code → Checkbox Mapping

| Code | Checkbox index in #riddler1 |
|------|----------------------------|
| ts | children[0] |
| ra | children[1] |
| fs | children[2] |
| rd | children[3] |
| pp | children[4] |
| aj | children[5] |

### Important: Never guess

If API fails or quota exhausted, do NOT submit any answer. Submitting wrong answers has worse consequences than not answering. Let the countdown timer expire naturally.

### Riddle Master × Unattended Mode

Unattended mode does NOT change Riddle Master behavior. The rule "never guess" is absolute regardless of mode. When API fails:
1. Do nothing, let countdown expire
2. Battle resumes after countdown
3. Engine continues normally (unattended or not)

### Dashboard Display

- Riddle Master remaining count (from last API response)
- Visual warning when remaining <= 3
- API key input field (optional, empty = free tier)

---

## Dashboard

### Access

Click extension icon → opens `chrome-extension://[id]/dashboard/index.html` as standalone tab. If already open, focuses existing tab.

### Layout

```
┌─ Header ─────────────────────────────────────────────┐
│  ⚔ HV Auto Arena              Reset in 5h 23m       │
├─ Task Control ───────────────────────────────────────┤
│  Arena Sweep [ON/OFF]     Unattended Mode [ON/OFF]   │
│  Encounter   [ON/OFF]                                │
│  Status: 🔵 Arena Lv.140 in progress...              │
├─ Arena Progress ─────────────────────────────────────┤
│  Grid of difficulty cards with status icons           │
│  (✅ completed, ❌ failed, 🔵 in_progress, ⬜ pending)│
├─ Daily Stats ────────────────────────────────────────┤
│  Arena Wins | Losses | Encounters | Stamina | RM     │
├─ Battle Settings ────────────────────────────────────┤
│  Skills/Items toggles    │  Thresholds (HP/MP/SP/OC) │
│  Strategy (Focus/Spread) │  Channeling skill          │
│  Priority Targets        │  Action Delay              │
│  Stamina Threshold       │  RM API Key                │
├─ Battle Log ─────────────────────────────────────────┤
│  Reverse-chronological event log (max 200 entries)   │
└──────────────────────────────────────────────────────┘
```

### Real-time Updates

`chrome.storage.onChanged` listener — any state change from any source (battle.js, SW, etc.) automatically refreshes the UI. No polling.

### Daily Reset (08:00 Local Time)

The game day starts at 08:00. A timestamp before 08:00 belongs to the previous game day.

**Cleared on reset:**
- `arenaSweepProgress`
- `dailyStats`
- `battleLog`
- `riddleMasterRemaining`

**Preserved across resets:**
- `battleToggles` (all settings)
- `staminaThreshold`
- `arenaSweepEnabled` / `encounterEnabled` / `unattendedMode`
- `rmApiKey`

---

## Message Protocol

### Content Script → Service Worker

| Message | When | Data |
|---------|------|------|
| `ARENA_PAGE_READY` | arena.js loaded on arena page | `{ difficulties, stamina }` |
| `ARENA_SWEEP_READY` | arena.js loaded + sweep enabled | — |
| `BATTLE_COMPLETE` | Battle ended (victory/defeat) | `{ result, battleType, difficultyId }` |
| `BATTLE_ALERT` | Alert after retries exhausted | `{ title, body, isUrgent }` |
| `BATTLE_ERROR` | Unexpected error | `{ error }` |
| `BATTLE_STATUS` | Status update | `{ status: { type, reason, time } }` |
| `ENCOUNTER_FOUND` | Encounter detected on news.php | `{ url }` |
| `NO_ENCOUNTER` | No encounter on news.php | — |

### Service Worker → Content Script (via chrome.tabs.sendMessage)

| Message | Target | Data |
|---------|--------|------|
| `ENTER_ARENA` | arena.js | `{ difficultyId }` |
| `START_BATTLE` | battle.js | — |
| `STOP_BATTLE` | battle.js | — |
| `CHECK_ENCOUNTER` | encounter.js | — |

### Dashboard → Service Worker

| Message | Data |
|---------|------|
| `SET_ARENA_SWEEP` | `{ enabled }` |
| `SET_ENCOUNTER` | `{ enabled }` |
| `UPDATE_TOGGLES` | `{ toggles }` |
| `UPDATE_SETTINGS` | `{ settings }` |
| `GET_FULL_STATE` | — (response: all state) |
| `OPEN_DASHBOARD` | — |

---

## Arena Entry Mechanism

### Page Structure (hentaiverse.org?s=Battle&ss=ar)

- Table listing all available difficulties (varies per account level)
- Each row has an `<img onclick="init_battle(id, entryCost, 'token')">` button
- Hidden form `#initform` with inputs: `initid`, `inittoken`
- `init_battle()` calls `confirm()` → sets form values → `form.submit()`
- Stamina displayed in `#stamina_readout` ancestor element

### Extension Bypass

Skip `confirm()` by directly setting form values and submitting:
1. Parse all `init_battle(id, entryCost, 'token')` from onclick attributes
2. Set `#initform input[name=initid]` = difficulty ID
3. Set `#initform input[name=inittoken]` = token
4. Set `autoArena = true` + `battleContext = { type: "arena", difficultyId }`
5. `form.submit()`

### Dynamic Parsing

Difficulty IDs are non-sequential and vary by account. Arena.js parses available difficulties on every page load using regex on onclick attributes. Never hardcode IDs.

---

## Important Constraints

1. **Never use translated text for DOM matching** — a translation plugin modifies text nodes. Use element IDs, classes, structural selectors, and onclick attribute parsing only.
2. **Battles are server-persistent** — unfinished battles redirect all HV page loads. Cannot skip a difficulty mid-battle.
3. **Encounters are client-triggered** — only appear when news.php is refreshed. Safe to delay checking.
4. **Riddle Master: never guess** — wrong answers worse than no answer. Only submit when API returns "good".
5. **Tokens are per-page-load** — arena entry tokens regenerate on each page load, must re-parse after every navigation.
