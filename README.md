**English** | [繁體中文](README.zh-TW.md)

# HV Auto Battle & Encounter

Automation toolkit for HentaiVerse Arena battles and encounter farming on E-Hentai. Available in two modes:

| Mode | Install | Features |
|------|---------|----------|
| **Chrome Extension** | Load unpacked `extension/` | Dashboard, Arena Sweep, Encounter coordination, Riddle Master API, Unattended Mode |
| **Tampermonkey** | Paste `autoArena.user.js` | Standalone battle engine with floating settings panel |

---

## Chrome Extension (Recommended)

Full-featured automation with a centralized Dashboard, automatic arena sweeping, and coordinated encounter farming.

### Features

- **Arena Sweep** — automatically enters arena battles from easiest to hardest difficulty
- **Normal + Isekai** — independent sweep for both worlds, can run simultaneously
- **Dashboard** — standalone tab for control, monitoring, and configuration
- **Encounter Coordination** — checks for encounters between Normal arena battles (every 30 min)
- **Riddle Master Integration** — auto-solves anti-cheat challenges via API
- **Unattended Mode** — fully autonomous operation, accepts death as recovery
- **Floating Button** — quick start/stop toggle on battle pages (shows world context)

### Installation

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `extension/` folder
5. Click the extension icon to open Dashboard

### Usage

1. **Dashboard** — toggle Arena Sweep (Normal/Isekai), Encounter Farming, and Unattended Mode
2. **Battle Settings** — configure skills, items, thresholds, and strategy from Dashboard
3. **Arena Sweep** — click ON for Normal and/or Isekai, each sweeps independently
4. **Encounter** — enable to auto-check e-hentai.org/news.php between Normal arena battles
5. **Riddle Master** — optionally set an API key in Dashboard for priority access

### File Structure

```
extension/
├── manifest.json              MV3 manifest
├── background/
│   └── service-worker.js      Central scheduler
├── content/
│   ├── inject.js              XHR hook (MAIN world, document_start)
│   ├── battle.js              Battle engine (hentaiverse.org)
│   ├── arena.js               Arena entry (hentaiverse.org?s=Battle&ss=ar)
│   └── encounter.js           Encounter detection (e-hentai.org/news.php)
└── dashboard/
    ├── index.html             Dashboard UI
    ├── app.js                 Dashboard logic
    └── style.css              Dark theme
```

---

## Tampermonkey (Standalone Battle Engine)

Lightweight userscript for manual arena battles and encounter farming. No arena sweep or dashboard — you enter each battle manually.

### Features

- Fully automated combat with priority-based action system
- Auto-continues between rounds
- Stops on last round — won't navigate away from results
- Settings panel with per-skill toggles
- Encounter auto-refresh on e-hentai.org/news.php
- Anti-cheat detection (Riddle Master, idle loop, low HP)
- Triple alert: sound beeps + browser notification + tab title flash

### Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Create a new script → paste contents of `autoArena.user.js`
3. Save (Ctrl+S)

### Usage

1. Enter an Arena battle on `hentaiverse.org`
2. Click `⚔ AUTO OFF` (bottom-right) to start
3. Click `⚙` to toggle skills/potions
4. For encounters: go to `e-hentai.org/news.php` → click `🎯 ENCOUNTER OFF`

---

## Setup Requirements

Both modes rely on fixed quick button and item slot positions:

### Quick Buttons

| Slot | Skill |
|------|-------|
| qb1 | Regen |
| qb2 | Heartseeker |
| qb3 | Heal spell 1 |
| qb4 | Heal spell 2 |
| qb7 | Attack skill 1 |
| qb8 | Attack skill 2 |
| qb9 | Attack skill 3 |

### Item Slots

| Slot | Item |
|------|------|
| 1 | Health Draught |
| 2 | Mana Draught |
| 3 | Health Potion |
| 4 | Mana Potion |
| 5 | Spirit Draught |

## Combat Priority

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | HP < 50% | Heal (qb3 → qb4 → Health Potion) |
| 2 | Channeling buff active | Cast Heartseeker (free MP) |
| 3 | MP < 50% | Mana Potion |
| 4 | No Regeneration buff | Health Draught |
| 5 | No Replenishment buff | Mana Draught |
| 6 | SP < 80%, no Refreshment | Spirit Draught |
| 7 | Regen ≤ 3 turns | Recast |
| 8 | Heartseeker ≤ 3 turns | Recast |
| 9 | OC > 90%, spirit inactive | Activate spirit |
| 10 | — | Attack skill (qb7→qb8→qb9) or normal attack |

## License

MIT
