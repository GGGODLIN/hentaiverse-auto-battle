# HentaiVerse Arena Automation Skill

## Overview
Automate HentaiVerse Arena battles using Chrome MCP browser tools. The AI injects a JavaScript combat script via `javascript_tool`, handles cross-round transitions, and monitors progress.

## Architecture

### Core Loop (AI-side)
```
1. Inject autoBattle script (WIN-only return, no time limit)
2. If returns WIN within 30s → call battle.battle_continue() → wait 3s → go to 1
3. If MCP 30s timeout → poll with lightweight check every 10-15s
4. When poll detects WIN → call battle.battle_continue() → wait 3s → go to 1
```

### Key Design Decisions
- **WIN-only return**: Script runs until victory, no time-based interruption. Simpler and faster.
- **`window.__ab` flag**: Global flag to detect if script is already running. Prevents double-injection after MCP timeout.
- **Lightweight polling**: After MCP timeout, only inject small check scripts (not combat scripts) to avoid dual-script conflicts.
- **CD-aware item usage**: Items on cooldown are removed from DOM. Check element existence before attempting to use.
- **500ms action delay**: All action delays set to 500ms for maximum speed. Spirit stance uses 300ms.
- **AI handles cross-round transitions**: `battle.battle_continue()` causes a full page refresh (`document.location+=""`), which destroys JS context. AI must re-inject after each round.
- **Elite priority targeting**: Monsters with `.btm2` background color are elites/bosses. Script targets them first.
- **No fetch override**: Replacing innerHTML via fetch caused GPU overload. Use native page refresh instead.

## Tab ID
The tab ID may change after page refresh. Use `tabs_context_mcp` to get the current tab ID if calls fail.

## Combat Script (Production Version - WIN-only + CD Detection)

```javascript
if(window.__ab){JSON.stringify({s:'ALREADY_RUNNING'})}else{
window.__ab=true;
(async function autoBattle(){
  const delay=ms=>new Promise(r=>setTimeout(r,ms));

  function rs(){
    const hp=parseInt(document.getElementById('dvrhd')?.textContent)||0;
    const mp=parseInt(document.getElementById('dvrm')?.textContent)||0;
    const sp=parseInt(document.getElementById('dvrs')?.textContent)||0;
    const oc=parseInt(document.getElementById('dvrc')?.textContent)||0;
    const hpW=parseInt(document.querySelector('#dvbh img')?.style.width)||1;
    const mpW=parseInt(document.querySelector('#dvbm img')?.style.width)||1;
    const spW=parseInt(document.querySelector('#dvbs img')?.style.width)||1;
    const ocW=parseInt(document.querySelector('#dvbc img')?.style.width)||1;
    const mxHP=Math.round(hp/(hpW/414));
    const mxMP=Math.round(mp/(mpW/414));
    const mxSP=Math.round(sp/(spW/414));
    const mxOC=Math.round(oc/(ocW/414));

    const a=[],e=[];
    for(let i=1;i<=50;i++){
      const m=document.getElementById('mkey_'+i);
      if(m&&m.offsetWidth>0&&m.style.opacity!=='0.3'&&m.style.opacity!=='0'){
        a.push(i);
        const b=m.querySelector('.btm2');
        if(b&&b.style.background&&b.style.background!=='none') e.push(i);
      }
    }

    const p=document.getElementById('pane_effects');const bf={};
    if(p){Array.from(p.children).forEach(c=>{
      const mo=c.getAttribute('onmouseover')||'';
      const mt=mo.match(/set_infopane_effect\('([^']+)',\s*'[^']*',\s*(\d+|'[^']*')\)/);
      if(mt) bf[mt[1]]=mt[2]==="'autocast'"?999:parseInt(mt[2]);
    });}

    const ss=document.getElementById('ckey_spirit')?.getAttribute('src')||'';
    const v=document.body.innerText.substring(0,500).includes('victorious');
    return{
      hpP:Math.round(hp/mxHP*100), mpP:Math.round(mp/mxMP*100),
      spP:Math.round(sp/mxSP*100), ocP:Math.round(oc/mxOC*100),
      a, e, bf, spA:ss.includes('spirit_a'), v
    };
  }

  // CD-aware item use: element missing = on cooldown → return false
  async function ui(id){
    if(!document.getElementById(id)) return false;
    document.getElementById('ckey_items')?.click();await delay(500);
    document.getElementById(id)?.click();await delay(500);
    document.getElementById('ckey_attack')?.click();await delay(300);
    return true;
  }

  try{
  while(true){
    const s=rs();
    if(s.v){window.__ab=false;return JSON.stringify({s:'WIN',hp:s.hpP});}
    if(s.a.length===0){await delay(500);continue;}

    // Priority 1: Heal if HP low
    if(s.hpP<50){
      document.getElementById('qb3')?.click();await delay(500);
      if(rs().hpP<50){document.getElementById('qb4')?.click();await delay(500);}
      continue;
    }
    // Priority 2: MP potion if low (skip if on CD)
    if(s.mpP<20){if(await ui('ikey_4')){continue;}}
    // Priority 3: Buff potions (skip if on CD)
    if(!s.bf['Regeneration']){if(await ui('ikey_1')){continue;}}
    if(!s.bf['Replenishment']){if(await ui('ikey_2')){continue;}}
    if(s.spP<70&&!s.bf['Refreshment']){if(await ui('ikey_5')){continue;}}
    // Priority 4: Rebuff skills
    if((s.bf['Regen']??0)<=3&&s.bf['Regen']!==999){
      document.getElementById('qb1')?.click();await delay(500);continue;
    }
    if((s.bf['Heartseeker']??0)<=3&&s.bf['Heartseeker']!==999){
      document.getElementById('qb2')?.click();await delay(500);continue;
    }
    // Spirit stance
    if(s.ocP>80&&!s.spA&&s.a.length>0){
      document.getElementById('ckey_spirit')?.click();await delay(300);
      document.getElementById('ckey_attack')?.click();await delay(300);
    }
    // Attack: elite first, then first alive
    const t=s.e.length>0?s.e[0]:s.a[0];
    if(t){document.getElementById('mkey_'+t)?.click();await delay(500);}
    else{await delay(500);}
  }
  }catch(e){window.__ab=false;return JSON.stringify({s:'ERROR',msg:e.message});}
})()}
```

## Lightweight Victory Polling Script
Use this after MCP timeout to check if combat script has finished:
```javascript
JSON.stringify({running:window.__ab, v:document.body.innerText.substring(0,500).includes('victorious')})
```
- `running:true` + `v:false` → script still fighting, wait and poll again
- `running:false` + `v:true` → script finished, victory detected → call battle.battle_continue()
- `running:false` + `v:false` → script may have errored or page changed → take screenshot to investigate

## DOM Reference

### Player Stats
| Element | Content |
|---------|---------|
| `#dvrhd` | Current HP number |
| `#dvrm` | Current MP number |
| `#dvrs` | Current SP number |
| `#dvrc` | Current OC number |
| `#dvbh img` style.width | HP bar width (414 = full) |
| `#dvbm img` style.width | MP bar width |
| `#dvbs img` style.width | SP bar width |
| `#dvbc img` style.width | OC bar width |

### Monster Elements
| Element | Purpose |
|---------|---------|
| `#mkey_N` (N=1-50) | Monster container. Alive if: offsetWidth>0, opacity!=='0.3', opacity!=='0' |
| `.btm2` style.background | Elite/boss indicator: has color (e.g. `rgb(219,168,160)`) vs none for normal |
| `.chbd img[src*="nbargreen"]` style.width | Monster HP bar width |
| `.btm3 div div` | Monster name |
| `.btm2 .fc4 div` | Monster level |

### Quick Buttons
| Element | Action |
|---------|--------|
| `#qb1` | Cast Regen buff |
| `#qb2` | Cast Heartseeker buff |
| `#qb3` | Heal spell 1 |
| `#qb4` | Heal spell 2 |

### Item Keys & Cooldown Detection
| Element | Item |
|---------|------|
| `#ikey_1` | Regeneration potion |
| `#ikey_2` | Replenishment potion |
| `#ikey_4` | Mana potion |
| `#ikey_5` | Refreshment potion |

**CD Detection**: When an item is on cooldown, its DOM element (`#ikey_N`) is completely removed from the page. Check `document.getElementById('ikey_N')` — if `null`, the item is on CD. The `ui()` function handles this by returning `false` when the element doesn't exist.

### Battle Actions
| Element | Action |
|---------|--------|
| `#ckey_items` | Open items panel |
| `#ckey_attack` | Confirm attack |
| `#ckey_spirit` | Toggle spirit stance |

### Buff Detection
Buffs are read from `#pane_effects` children's `onmouseover` attribute:
```
set_infopane_effect('BuffName', 'description', turnsLeft)
```
- `turnsLeft` = number: turns remaining
- `turnsLeft` = `'autocast'`: permanent (mapped to 999)

### Victory Detection
```javascript
document.body.innerText.substring(0,500).includes('victorious')
```

### Last Round vs Intermediate Round Detection
On victory, the `#btcp` element differs between intermediate and final rounds:

| Property | Intermediate Round | Last Round |
|----------|-------------------|------------|
| `onclick` | `battle.battle_continue()` | `common.goto_arena()` |
| Image | `/y/battle/arenacontinue.png` | `/y/battle/finishbattle.png` |
| Extra text | — | "You gain X credits" + "Arena challenge cleared!" |

**Detection code:**
```javascript
function isLastRoundVictory() {
  const btcp = document.getElementById("btcp");
  if (!btcp) return false;
  const onclick = btcp.getAttribute("onclick") || "";
  if (onclick.includes("goto_arena")) return true;
  const img = btcp.querySelector("img");
  if (img && img.src && img.src.includes("finishbattle")) return true;
  return false;
}
```

### Round Info
Available in battle log at round start: `"Initializing arena challenge #N (Round X / Y) ..."`
```javascript
const logDiv = document.getElementById('textlog');
const rows = Array.from(logDiv.querySelectorAll('td')).map(td => td.textContent);
const roundRow = rows.find(t => t.includes('Round'));
// e.g. "Initializing arena challenge #13 (Round 5 / 20) ..."
```

### Cross-Round Transition
```javascript
battle.battle_continue()  // Source: function(){S||(S=!0,document.location+="")}
// This triggers a full page refresh - all JS state is lost
```

## Combat Priority Order
1. HP < 50% → Heal (qb3, then qb4 if still low)
2. MP < 20% → Mana potion (ikey_4) — skip if on CD
3. No Regeneration buff → Use potion (ikey_1) — skip if on CD
4. No Replenishment buff → Use potion (ikey_2) — skip if on CD
5. SP < 70% and no Refreshment → Use potion (ikey_5) — skip if on CD
6. Regen buff <= 3 turns → Recast (qb1)
7. Heartseeker buff <= 3 turns → Recast (qb2)
8. OC > 80% and spirit not active → Activate spirit
9. Attack: Elite/boss first, then first alive monster

## Script Safety Mechanisms
- **`window.__ab` flag**: Set to `true` when script starts, `false` on WIN or ERROR. Prevents double-injection.
- **try/catch**: Script errors are caught and returned as `{s:'ERROR', msg:...}` instead of silent failures.
- **CD-aware `ui()` function**: Returns `false` if item element doesn't exist (on CD), outer logic falls through to next action instead of looping.

## Failed Approaches (Lessons Learned)
1. **fetch override for battle.battle_continue()**: Replaced innerHTML via fetch to avoid page refresh. Worked but caused severe GPU overload due to constant DOM re-rendering.
2. **Full auto script with battle_continue inside**: Script handles everything autonomously. Works within a single page load but dies on page refresh.
3. **localStorage auto-bootstrap**: Saved script to localStorage hoping to auto-run on page load. Cannot auto-execute JS on page load without Tampermonkey.
4. **No CD check on items**: Script loops infinitely opening/closing items panel when potion is on CD because element doesn't exist but script keeps retrying.

## Anti-Cheat Detection
When anti-cheat triggers, it likely overlays the battle screen, causing `alive.length === 0` without `victorious` text appearing. The script detects this by counting consecutive idle loops (alive=0, no victory). After 10 loops (~5 seconds), it triggers an alert.

**Alert system:**
- **Sound**: 3 loud beeps via Web Audio API (880Hz, 0.8 gain)
- **Notification**: Browser Notification API (requests permission on first load)
- **Visual**: Button flashes orange/red for 30 seconds

## Tampermonkey Userscript (v2.0)
The `autoArena.user.js` file is a Tampermonkey userscript that handles everything autonomously:
- Auto-fights each round
- Auto-continues to next round via `battle_continue()`
- **Stops on last round** (detects `finishbattle.png` / `goto_arena`)
- **Alerts on anti-cheat** (sound + notification + flashing button)
- **Alerts on errors** (unexpected script crashes)
- Persists ON/OFF state across page refreshes via `GM_setValue`
