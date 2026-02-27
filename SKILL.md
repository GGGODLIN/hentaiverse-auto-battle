# HentaiVerse Arena Automation — Technical Reference

## Overview

Tampermonkey userscript (`autoArena.user.js`) that fully automates HentaiVerse Arena battles and encounter farming. Supports both Normal and Isekai modes. No AI intervention required.

**Two modes in one script:**
- **Battle Mode** (`hentaiverse.org`) — auto-fights, auto-continues rounds, stops on last round or anti-cheat
- **Encounter Mode** (`e-hentai.org/news.php`) — auto-refreshes every 30 min to catch random encounters, opens battle popup

## Architecture

### Battle Mode Flow
```
Page load → Riddle Master check → if detected, alert & stop
         → if autoArena ON, wait for #ckey_attack (polling 300ms, 5s timeout)
         → detect mode (Normal/Isekai) → load toggle profile
         → start combat loop
         → victory → wait for #btcp (polling 300ms, 3s timeout)
           → last round (finishbattle/goto_arena)? → STOP + alert "CLEARED"
           → intermediate round → wait 1.5s → battle.battle_continue() → page refresh → repeat
```

### Encounter Mode Flow
```
Page load → if autoEncounter ON:
  → #eventpane has "encountered a monster"?
    → YES: GM_setValue('autoArena', true) → window.open(battle popup) → start battle poll → schedule 30min refresh
    → NO:  elapsed since last encounter >= 30min? → retry every 1min : wait remaining time
```

### Cross-Page Communication
Both modes share GM storage (single script, single `@namespace`):
- Encounter mode sets `autoArena = true` before opening battle popup
- Battle mode in popup reads `autoArena = true` → auto-starts combat
- Encounter mode polls `autoArena` → when it turns `false` (battle ended), plays alert sound from news.php (bypasses popup autoplay policy)

## Mode Detection

Isekai mode is auto-detected by the absence of `#dvrhd` (HP text element):
- **Normal mode**: reads HP/MP/SP/OC from text elements + bar width
- **Isekai mode**: reads percentages from bar width only (`width / 414 * 100`)

## Toggle Profiles

Each mode has an independent set of toggles stored in separate GM keys:
- `battleToggles_normal` — Normal mode profile
- `battleToggles_isekai` — Isekai mode profile

Settings panel (⚙ gear button) shows current profile label and 13 toggles:

| Toggle | Controls |
|--------|----------|
| Heal 1 (qb3) | Heal spell 1 |
| Heal 2 (qb4) | Heal spell 2 |
| Health Potion | Backup heal (ikey_3) |
| Regen (qb1) | Regen buff |
| Heartseeker (qb2) | Heartseeker buff + Channeling trigger |
| Health Draught | Regeneration potion (ikey_1) |
| Mana Draught | Replenishment potion (ikey_2) |
| Mana Potion | MP recovery (ikey_4) |
| Spirit Draught | Refreshment potion (ikey_5) |
| Spirit Stance | Spirit stance activation |
| Attack 1 (qb7) | Attack skill 1 |
| Attack 2 (qb8) | Attack skill 2 |
| Attack 3 (qb9) | Attack skill 3 |

All toggles default to ON. Disabled toggles skip the corresponding action in combat loop.

## Combat Priority Order

1. HP < 50% → Heal (qb3 → qb4 → Health Potion if still low) — all heals on CD + all enabled → STOP + alert
2. **Channeling buff active** + Heartseeker not autocast → Cast Heartseeker (qb2) — free MP
3. MP < 30% → Mana potion (ikey_4) — skip if on CD
4. No Regeneration buff → Use potion (ikey_1) — skip if on CD
5. No Replenishment buff → Use potion (ikey_2) — skip if on CD
6. SP < 70% and no Refreshment → Use potion (ikey_5) — skip if on CD
7. Regen buff <= 3 turns (and not autocast) → Recast (qb1)
8. Heartseeker buff <= 3 turns (and not autocast) → Recast (qb2)
9. OC > 80% and spirit not active → Activate spirit stance
10. Attack: qb7 → qb8 → qb9 (click skill → click target) → fallback normal attack

**Attack skill targeting**: Elite/boss first, then highest HP monster (reads `.chbd img[alt="health"]` width)
**Normal attack targeting**: Elite/boss first, then first alive monster

## DOM Reference

### Player Stats
| Element | Content |
|---------|---------|
| `#dvrhd` | Current HP number (Normal mode only) |
| `#dvrm` | Current MP number (Normal mode only) |
| `#dvrs` | Current SP number (Normal mode only) |
| `#dvrc` | Current OC number (Normal mode only) |
| `#dvbh img` style.width | HP bar width (414 = full) |
| `#dvbm img` style.width | MP bar width |
| `#dvbs img` style.width | SP bar width |
| `#dvbc img` style.width | OC bar width |

### Monster Elements
| Element | Purpose |
|---------|---------|
| `#mkey_N` (N=1-50) | Monster container. Alive if: offsetWidth>0, opacity!=='0.3', opacity!=='0' |
| `.btm2` style.background | Elite/boss indicator: has color vs none for normal |
| `.chbd img[alt="health"]` style.width | Monster HP bar width (for skill targeting) |

### Quick Buttons
| Element | Action |
|---------|--------|
| `#qb1` | Cast Regen buff |
| `#qb2` | Cast Heartseeker buff |
| `#qb3` | Heal spell 1 |
| `#qb4` | Heal spell 2 |
| `#qb7` | Attack skill 1 |
| `#qb8` | Attack skill 2 |
| `#qb9` | Attack skill 3 |

### Item Keys & Cooldown Detection
| Element | Item |
|---------|------|
| `#ikey_1` | Health Draught (Regeneration buff) |
| `#ikey_2` | Mana Draught (Replenishment buff) |
| `#ikey_3` | Health Potion (backup heal) |
| `#ikey_4` | Mana Potion |
| `#ikey_5` | Spirit Draught (Refreshment buff) |

**CD Detection**: When an item or skill is on cooldown, its DOM element (`#ikey_N` or `#qbN`) is completely removed from the page. `useItem()` returns `false` when the element doesn't exist. Attack skills check `document.getElementById(qb)` before clicking.

### Buff Detection
Buffs are read from `#pane_effects` children's `onmouseover` attribute:
```
set_infopane_effect('BuffName', 'description', turnsLeft)
```
- `turnsLeft` = number: turns remaining
- `turnsLeft` = `'autocast'`: permanent (mapped to 999)

Key buffs: `Regeneration`, `Replenishment`, `Refreshment` (potions), `Regen`, `Heartseeker` (skills), `Channeling` (random proc)

### Victory & Round Detection
- **Victory**: `document.body.innerText.substring(0,500).includes('victorious')`
- **Last round**: `#btcp` onclick includes `goto_arena` or img src includes `finishbattle`
- **Intermediate**: `#btcp` onclick is `battle.battle_continue()`

### Encounter Detection (e-hentai.org/news.php)
- `#eventpane` contains "encountered a monster" text
- Encounter link: `a[href*="hentaiverse.org"]` within `#eventpane`
- Opens popup: `window.open(url, '_hentaiverse', ...width=1250,height=720...)`

## Anti-Cheat Detection

### Riddle Master
Pony identification captcha. Page DOM is replaced with `#riddlemaster` element.
- **Detection**: `document.getElementById('riddlemaster')` on page load
- **Response**: Immediately set autoArena OFF, alert user

### Idle Loop Detection
Battle overlay/interrupt causes `alive.length === 0` without victory.
- **Detection**: 10 consecutive idle loops (~3 seconds) without victory
- **Response**: Set autoArena OFF, alert user

### Bootstrap Detection
Page loads but `#ckey_attack` doesn't appear within 5 seconds.
- **Response**: Set autoArena OFF, alert user

### Low HP Detection
All 3 heal methods (qb3, qb4, Health Potion) enabled but all on CD.
- **Response**: Set autoArena OFF, alert user "All heals on CD!"

## Alert System
Triggered on anti-cheat, errors, low HP, and arena completion:
1. **Sound**: 5 alternating beeps via Web Audio API (880Hz/660Hz)
2. **Title flash**: Browser tab title alternates between `⚠ ALERT ⚠` and original title (60s)
3. **System notification**: Browser Notification API
4. **Button update**: Shows `🚨 TITLE` with orange background
5. **Encounter mode sound**: news.php polls `autoArena` and plays alert when battle ends (bypasses popup autoplay policy)

## Key Design Decisions
- **300ms action delay**: All combat actions use 300ms delay for speed
- **Polling with retry**: Victory detection and page load use `waitFor()` polling (300ms interval, configurable timeout) instead of fixed delays
- **CD-aware item/skill usage**: Items and skills on CD are removed from DOM; `useItem()` returns false → falls through to next priority
- **Elite priority targeting**: Monsters with `.btm2` background color are targeted first
- **Smart skill targeting**: Attack skills target highest HP monster (among non-elites) to maximize value
- **Mode auto-detection**: Isekai mode detected by `!dvrhd`, uses bar-width-only percentage calculation
- **Profile separation**: Normal and Isekai toggle states stored independently
- **`battle.battle_continue()` triggers full page refresh** (`document.location+=""`), destroying all JS state. Tampermonkey re-injects the script on reload.

## Failed Approaches (Lessons Learned)
1. **fetch override for battle.battle_continue()**: Replaced innerHTML via fetch to avoid page refresh. Caused severe GPU overload.
2. **Full auto script with battle_continue inside**: Works within a single page load but dies on page refresh.
3. **localStorage auto-bootstrap**: Cannot auto-execute JS on page load without Tampermonkey.
4. **No CD check on items**: Script loops infinitely when potion is on CD because element doesn't exist but script keeps retrying.
