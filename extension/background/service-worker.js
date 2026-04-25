importScripts("/shared/translation-constants.js", "/background/translation-updater.js", "/background/replenish.js");

const THIRTY_MIN = 30 * 60 * 1000;
const ONE_MIN = 60 * 1000;
const ARENA_URL_NORMAL = "https://hentaiverse.org/?s=Battle&ss=ar";
const ARENA_URL_ISEKAI = "https://hentaiverse.org/isekai/?s=Battle&ss=ar";

function wk(key, world) { return key + "_" + world; }
function arenaUrl(world) { return world === "isekai" ? ARENA_URL_ISEKAI : ARENA_URL_NORMAL; }
const NEWS_URL = "https://e-hentai.org/news.php";
const RESET_HOUR = 8;
const RB_DEFAULT_RESERVE = 5;
const RB_DEFAULT_TRIO_MIN = 15;

function getGameDay() {
  const now = new Date();
  const d = new Date(now);
  if (d.getHours() < RESET_HOUR) d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

async function getState(key, defaultValue) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? defaultValue;
}

async function setState(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function addLog(entry) {
  const logs = (await getState("battleLog", []));
  const now = new Date();
  const time = String(now.getHours()).padStart(2, "0") + ":" +
    String(now.getMinutes()).padStart(2, "0") + ":" +
    String(now.getSeconds()).padStart(2, "0");
  logs.push({ ...entry, time });
  if (logs.length > 200) logs.splice(0, logs.length - 200);
  await setState("battleLog", logs);
}

async function checkDailyReset() {
  const today = getGameDay();
  const lastReset = await getState("lastResetDate", null);
  if (lastReset !== today) {
    await setState("lastResetDate", today);
    await setState(wk("arenaSweepProgress", "normal"), {});
    await setState(wk("arenaSweepProgress", "isekai"), {});
    await setState("dailyStats", {
      arenaWins: 0,
      arenaLosses: 0,
      encounterCount: 0,
      arenaStartTime: null,
    });
    await setState("battleLog", []);
    await setState("riddleMasterRemaining", null);
    await setState(wk("rbStateToday", "normal"), { day: today, fsmDone: false, trioDone: false });
    await setState(wk("rbStateToday", "isekai"), { day: today, fsmDone: false, trioDone: false });
    await addLog({ type: "system", reason: "Daily reset (" + today + ")" });
    console.log("[SW] Daily reset for " + today);
  }
}

async function getRbStateToday(world) {
  const today = getGameDay();
  let s = await getState(wk("rbStateToday", world), null);
  if (!s || s.day !== today) {
    s = { day: today, fsmDone: false, trioDone: false };
    await setState(wk("rbStateToday", world), s);
  }
  return s;
}

async function findOrCreateTab(url) {
  const tabs = await chrome.tabs.query({ url: url + "*" });
  if (tabs.length > 0) return tabs[0];
  const tab = await chrome.tabs.create({ url, active: false });
  return tab;
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

async function openWorldTab(world, url) {
  const key = wk("worldTabId", world);
  const tabId = await getState(key, null);
  let tab = null;
  if (tabId) {
    try { tab = await chrome.tabs.get(tabId); } catch {}
  }
  if (tab) {
    if (tab.url === url) {
      await chrome.tabs.reload(tab.id);
    } else {
      await chrome.tabs.update(tab.id, { url });
    }
  } else {
    tab = await chrome.tabs.create({ url, active: false });
    await setState(key, tab.id);
  }
  return tab.id;
}

async function handleArenaPageReady(msg, senderTabId) {
  const world = msg.world ?? "normal";
  const sweepEnabled = await getState(wk("arenaSweepEnabled", world), false);
  if (!sweepEnabled) return;

  const stamina = msg.stamina;
  const threshold = await getState("staminaThreshold", 10);

  console.log("[SW] handleArenaPageReady: world=" + world + " stamina=" + stamina + " threshold=" + threshold + " difficulties=" + (msg.difficulties?.length ?? 0));
  if (stamina != null && stamina < threshold) {
    console.log("[SW] SWEEP OFF reason: stamina depleted (" + world + ")");
    await addLog({ type: "system", reason: "[" + world + "] Stamina " + stamina + " below threshold " + threshold + ", pausing" });
    await setState(wk("arenaSweepEnabled", world), false);
    await setState(wk("autoArena", world), false);
    chrome.notifications.create({
      type: "basic",
      title: "HV Auto Arena (" + world + ")",
      message: "Stamina depleted (" + stamina + "), arena sweep paused.",
      iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='16' font-size='16'>⚔</text></svg>",
    });
    await maybeTriggerRb(world);
    return;
  }

  if (world === "normal") {
    const shouldCheckEncounter = await shouldDoEncounterFirst();
    if (shouldCheckEncounter) {
      await setState(wk("worldTabId", "normal"), senderTabId);
      await doEncounterCheck();
      return;
    }
  }

  await setState(wk("worldTabId", world), senderTabId);
  await pickAndEnterNextDifficulty(msg.difficulties, senderTabId, world);
}

async function handleRbPageReady(msg, senderTabId) {
  const world = msg.world ?? "normal";
  const enabled = await getState(wk("rbAutoEnabled", world), false);
  if (!enabled) return;

  await setState(wk("rbTokens", world), msg.tokens);
  await setState(wk("worldTabId", world), senderTabId);

  const state = await getRbStateToday(world);

  if (!state.fsmDone) {
    if (msg.tokens != null && msg.tokens >= 5) {
      await addLog({ type: "system", reason: "[" + world + "] RoB: entering FSM (tokens=" + msg.tokens + ")" });
      await sendToTab(senderTabId, { type: "ENTER_RB", cost: 5, phase: "fsm" });
    } else {
      state.fsmDone = true;
      state.trioDone = true;
      await setState(wk("rbStateToday", world), state);
      await addLog({ type: "alert", reason: "[" + world + "] RoB: insufficient tokens for FSM (" + msg.tokens + "/5), skipping" });
    }
    return;
  }

  if (!state.trioDone) {
    const trioMin = await getState("rbTrioMinAfterFSM", RB_DEFAULT_TRIO_MIN);
    if (msg.tokens != null && msg.tokens > trioMin) {
      await addLog({ type: "system", reason: "[" + world + "] RoB: entering Trio (tokens=" + msg.tokens + ")" });
      await sendToTab(senderTabId, { type: "ENTER_RB", cost: 10, phase: "trio" });
    } else {
      state.trioDone = true;
      await setState(wk("rbStateToday", world), state);
      await addLog({ type: "system", reason: "[" + world + "] RoB: skipping Trio (tokens=" + msg.tokens + ", threshold>" + trioMin + ")" });
    }
    return;
  }

  await addLog({ type: "system", reason: "[" + world + "] RoB: all done today" });
}

function rbUrl(world) {
  return world === "isekai"
    ? "https://hentaiverse.org/isekai/?s=Battle&ss=rb"
    : "https://hentaiverse.org/?s=Battle&ss=rb";
}

async function maybeTriggerRb(world) {
  const enabled = await getState(wk("rbAutoEnabled", world), false);
  if (!enabled) return;
  const state = await getRbStateToday(world);
  if (state.fsmDone && state.trioDone) return;

  await openWorldTab(world, rbUrl(world));
}

async function shouldDoEncounterFirst() {
  const encounterEnabled = await getState("encounterEnabled", false);
  const lastEncounter = await getState("lastEncounterTime", 0);
  const elapsed = Date.now() - lastEncounter;
  const should = encounterEnabled && elapsed >= THIRTY_MIN;
  console.log("[SW] shouldDoEncounterFirst: enabled=" + encounterEnabled + " elapsed=" + Math.round(elapsed / 1000) + "s should=" + should);
  if (!encounterEnabled) return false;
  return elapsed >= THIRTY_MIN;
}

let _encounterResponseReceived = false;

async function doEncounterCheck() {
  const encounterEnabled = await getState("encounterEnabled", false);
  if (!encounterEnabled) return;

  _encounterResponseReceived = false;
  await addLog({ type: "system", reason: "Checking for encounter..." });

  const savedTabId = await getState("encounterTabId", null);
  let tab = null;
  if (savedTabId) {
    try {
      tab = await chrome.tabs.get(savedTabId);
    } catch {}
  }
  if (tab) {
    await chrome.tabs.update(tab.id, { url: NEWS_URL });
  } else {
    tab = await findOrCreateTab(NEWS_URL);
    await setState("encounterTabId", tab.id);
    await chrome.tabs.reload(tab.id);
  }

  setTimeout(async () => {
    if (_encounterResponseReceived) return;
    console.log("[SW] Encounter check timeout, no response from encounter.js");
    await setState("lastEncounterTime", Date.now());
    await addLog({ type: "system", reason: "Encounter check timeout, resuming" });
    const sweepEnabled = await getState(wk("arenaSweepEnabled", "normal"), false);
    if (sweepEnabled) {
      await resumeArenaSweep("normal");
    }
  }, 15000);
}

async function pickAndEnterNextDifficulty(difficulties, tabId, world) {
  const progress = await getState(wk("arenaSweepProgress", world), {});
  const available = difficulties ?? await getState(wk("arenaDifficulties", world), []);

  let nextDiff = null;
  for (const d of available) {
    const status = progress[d.id];
    if (!status || (status !== "completed" && status !== "skipped")) {
      nextDiff = d;
      break;
    }
  }

  console.log("[SW] pickAndEnterNextDifficulty: world=" + world + " available=" + available.length + " progress=" + JSON.stringify(progress) + " nextDiff=" + JSON.stringify(nextDiff));
  if (available.length === 0) {
    console.log("[SW] No difficulties found (" + world + "), turning off sweep");
    await addLog({ type: "system", reason: "[" + world + "] No arena difficulties available" });
    await setState(wk("arenaSweepEnabled", world), false);
    await setState(wk("autoArena", world), false);
    return;
  }
  if (!nextDiff) {
    console.log("[SW] SWEEP OFF reason: all difficulties completed (" + world + ")");
    await addLog({ type: "victory", reason: "[" + world + "] All arena difficulties completed!" });
    await setState(wk("arenaSweepEnabled", world), false);
    await setState(wk("autoArena", world), false);
    chrome.notifications.create({
      type: "basic",
      title: "HV Auto Arena (" + world + ")",
      message: "All arena difficulties completed!",
      iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='16' font-size='16'>🏆</text></svg>",
    });
    await maybeTriggerRb(world);
    return;
  }

  await setState(wk("currentArenaDifficulty", world), nextDiff.id);
  progress[nextDiff.id] = "in_progress";
  await setState(wk("arenaSweepProgress", world), progress);
  await addLog({ type: "system", reason: "[" + world + "] Entering arena difficulty " + nextDiff.id + " (Lv." + nextDiff.level + ")" });

  await sendToTab(tabId, {
    type: "ENTER_ARENA",
    difficultyId: nextDiff.id,
  });
}

async function handleBattleComplete(msg) {
  const { result, battleType, difficultyId } = msg;
  const world = msg.world ?? "normal";
  const stats = await getState("dailyStats", {
    arenaWins: 0, arenaLosses: 0, encounterCount: 0,
  });

  if (battleType === "encounter") {
    stats.encounterCount = (stats.encounterCount ?? 0) + 1;
    await setState("dailyStats", stats);
    await setState("lastEncounterTime", Date.now());
    await addLog({ type: result === "victory" ? "victory" : "defeated", reason: "Encounter " + result });

    const battleTabId = await getState("encounterBattleTabId", null);
    if (battleTabId) {
      try { await chrome.tabs.remove(battleTabId); } catch {}
      await setState("encounterBattleTabId", null);
    }

    const sweepEnabled = await getState(wk("arenaSweepEnabled", "normal"), false);
    if (sweepEnabled) {
      await resumeArenaSweep("normal");
    }
    return;
  }

  if (battleType === "rb") {
    const ctx = await getState(wk("battleContext", world), {});
    const rbState = await getRbStateToday(world);
    if (ctx.phase === "fsm") rbState.fsmDone = true;
    if (ctx.phase === "trio") rbState.trioDone = true;
    await setState(wk("rbStateToday", world), rbState);
    await addLog({
      type: result === "victory" ? "victory" : "defeated",
      reason: "[" + world + "] RoB " + ctx.phase + " " + result,
    });
    if (!rbState.trioDone) {
      await openWorldTab(world, rbUrl(world));
    }
    return;
  }

  if (battleType === "arena") {
    const progress = await getState(wk("arenaSweepProgress", world), {});

    if (result === "victory") {
      stats.arenaWins = (stats.arenaWins ?? 0) + 1;
      progress[difficultyId] = "completed";
      await addLog({ type: "victory", reason: "[" + world + "] Arena " + difficultyId + " cleared!" });
    } else {
      stats.arenaLosses = (stats.arenaLosses ?? 0) + 1;
      progress[difficultyId] = "failed";
      await addLog({ type: "defeated", reason: "[" + world + "] Arena " + difficultyId + " failed" });
    }

    await setState("dailyStats", stats);
    await setState(wk("arenaSweepProgress", world), progress);
    await setState(wk("currentArenaDifficulty", world), null);

    const sweepEnabled = await getState(wk("arenaSweepEnabled", world), false);
    if (!sweepEnabled) return;

    const allDiffs = await getState(wk("arenaDifficulties", world), []);
    const allDone = allDiffs.length > 0 && allDiffs.every((d) => {
      const s = progress[d.id];
      return s === "completed" || s === "failed" || s === "skipped";
    });

    if (allDone) {
      console.log("[SW] All difficulties done for " + world + ", ending sweep");
      await addLog({ type: "victory", reason: "[" + world + "] All arena difficulties completed!" });
      await setState(wk("arenaSweepEnabled", world), false);
      await setState(wk("autoArena", world), false);
      chrome.notifications.create({
        type: "basic",
        title: "HV Auto Arena (" + world + ")",
        message: "All arena difficulties completed!",
        iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='16' font-size='16'>🏆</text></svg>",
      });
      await maybeTriggerRb(world);
      return;
    }

    if (sweepEnabled) {
      await wait(2000);
      await resumeArenaSweep(world);
    }
  }
}

async function resumeArenaSweep(world) {
  await openWorldTab(world, arenaUrl(world));
}

async function handleEncounterFound(msg, senderTabId) {
  _encounterResponseReceived = true;
  const { url } = msg;
  await addLog({ type: "system", reason: "Encounter found! Opening battle..." });

  const tab = await chrome.tabs.create({ url, active: false });
  await setState("encounterBattleTabId", tab.id);
  await setState(wk("battleContext", "normal"), { type: "encounter", world: "normal" });
  await setState(wk("autoArena", "normal"), true);
}

async function handleNoEncounter() {
  _encounterResponseReceived = true;
  await setState("lastEncounterTime", Date.now());
  await addLog({ type: "system", reason: "No encounter available" });
  const sweepEnabled = await getState(wk("arenaSweepEnabled", "normal"), false);
  if (sweepEnabled) {
    await resumeArenaSweep("normal");
  } else {
    scheduleEncounterCheck();
  }
}

function scheduleEncounterCheck() {
  chrome.alarms.create("encounterCheck", { delayInMinutes: 1 });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const senderTabId = sender.tab?.id;
  const needsResponse = msg.type === "GET_FULL_STATE" || msg.type === "RM_SOLVE" || msg.type === "FETCH_TRANSLATIONS" || msg.type === "REPLENISH_DRY_RUN" || msg.type === "REPLENISH_RUN" || msg.type === "REPLENISH_PREFLIGHT";

  (async () => {
    try {
      await checkDailyReset();

      switch (msg.type) {
        case "ARENA_PAGE_READY":
          await handleArenaPageReady(msg, senderTabId);
          break;

        case "RB_PAGE_READY":
          await handleRbPageReady(msg, senderTabId);
          break;

        case "BATTLE_COMPLETE":
          await handleBattleComplete(msg);
          break;

        case "BATTLE_STATUS":
          break;

        case "BATTLE_ALERT": {
          const { title, body } = msg;
          const alertWorld = msg.world ?? "normal";
          const unattended = await getState("unattendedMode", false);
          chrome.notifications.create({
            type: "basic",
            title: "HV [" + alertWorld + "]: " + title,
            message: body + (unattended ? " (unattended)" : ""),
            iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='16' font-size='16'>⚠</text></svg>",
            requireInteraction: !unattended && (msg.isUrgent ?? false),
          });
          if (!unattended) {
            await addLog({ type: "alert", reason: "Needs attention: " + title + " — " + body });
          }
          break;
        }

        case "BATTLE_ERROR":
          await addLog({ type: "alert", reason: msg.error });
          break;

        case "ENCOUNTER_FOUND":
          await handleEncounterFound(msg, senderTabId);
          break;

        case "NO_ENCOUNTER":
          console.log("[SW] NO_ENCOUNTER received, calling handleNoEncounter");
          await handleNoEncounter();
          break;

        case "GET_FULL_STATE": {
          const allData = await chrome.storage.local.get(null);
          sendResponse(allData);
          return;
        }

        case "FETCH_TRANSLATIONS": {
          const results = await fetchAllTranslations();
          sendResponse({ results });
          return;
        }

        case "SET_ARENA_SWEEP": {
          const world = msg.world ?? "normal";
          console.log("[SW] SET_ARENA_SWEEP enabled=" + msg.enabled + " world=" + world);
          await setState(wk("arenaSweepEnabled", world), msg.enabled);
          if (msg.enabled) {
            await setState(wk("autoArena", world), true);
            await setState(wk("arenaSweepProgress", world), {});
            await addLog({ type: "system", reason: "[" + world + "] Arena sweep started" });
            await resumeArenaSweep(world);
          } else {
            console.log("[SW] SWEEP OFF reason: user toggled off (" + world + ")");
            await setState(wk("autoArena", world), false);
            await addLog({ type: "system", reason: "[" + world + "] Arena sweep stopped" });
          }
          break;
        }

        case "SET_ENCOUNTER": {
          await setState("encounterEnabled", msg.enabled);
          if (msg.enabled) {
            await addLog({ type: "system", reason: "Encounter farming started" });
            await doEncounterCheck();
          } else {
            chrome.alarms.clear("encounterCheck");
            await addLog({ type: "system", reason: "Encounter farming stopped" });
          }
          break;
        }

        case "SET_RB_AUTO": {
          const rbWorld = msg.world ?? "normal";
          await setState(wk("rbAutoEnabled", rbWorld), msg.enabled);
          if (msg.enabled) {
            await addLog({ type: "system", reason: "[" + rbWorld + "] RoB auto started" });
            const sweepSame = await getState(wk("arenaSweepEnabled", rbWorld), false);
            if (!sweepSame) {
              await maybeTriggerRb(rbWorld);
            }
          } else {
            await addLog({ type: "system", reason: "[" + rbWorld + "] RoB auto stopped" });
          }
          break;
        }

        case "UPDATE_TOGGLES":
          await setState("battleToggles", msg.toggles);
          break;

        case "UPDATE_SETTINGS":
          for (const [k, v] of Object.entries(msg.settings)) {
            await setState(k, v);
          }
          break;

        case "RM_SOLVE": {
          try {
          const base64 = msg.imageBase64;
          const byteString = atob(base64.split(",")[1]);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
          const blob = new Blob([ab], { type: "image/jpeg" });

          const headers = { "Content-Type": "image/jpeg" };
          if (msg.apiKey) headers["apikey"] = msg.apiKey;

          const resp = await fetch("https://rdma.ooguy.com/help2", {
            method: "POST",
            headers,
            body: blob,
          });

          if (resp.status === 429) {
            sendResponse({ error: "rate limited (429)" });
            return;
          }

          const remaining = resp.headers.get("x-ratelimit-remaining");
          if (remaining !== null) {
            await setState("riddleMasterRemaining", parseInt(remaining));
          }

          const data = await resp.json();

          if (data.return === "finish") {
            sendResponse({ error: "daily limit reached" });
            return;
          }
          if (data.return !== "good") {
            sendResponse({ error: "API error: " + JSON.stringify(data.return) });
            return;
          }

          sendResponse({ data });
        } catch (e) {
          sendResponse({ error: e.message });
        }
        return;
      }

      case "REPLENISH_DRY_RUN": {
        const result = await replenishDryRun();
        sendResponse(result);
        return;
      }

      case "REPLENISH_RUN": {
        const runResult = await replenishOnce(msg.replenishConfig);
        sendResponse(runResult);
        return;
      }

      case "REPLENISH_PREFLIGHT": {
        const preflightResult = await replenishPreflight(msg.world ?? "normal");
        sendResponse(preflightResult);
        return;
      }

      case "OPEN_DASHBOARD": {
        const url = chrome.runtime.getURL("dashboard/index.html");
        const existing = await chrome.tabs.query({ url });
        if (existing.length > 0) {
          await chrome.tabs.update(existing[0].id, { active: true });
        } else {
          await chrome.tabs.create({ url });
        }
        break;
      }
    }
    } catch (e) {
      console.error("[SW] Message handler error:", e);
    }
  })();

  return needsResponse;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "encounterCheck") {
    const enabled = await getState("encounterEnabled", false);
    if (!enabled) return;
    const sweepRunning = await getState(wk("arenaSweepEnabled", "normal"), false);
    if (sweepRunning) {
      scheduleEncounterCheck();
      return;
    }
    const inBattle = await getState(wk("autoArena", "normal"), false);
    if (inBattle) {
      scheduleEncounterCheck();
      return;
    }
    await doEncounterCheck();
  }
  if (alarm.name === "dailyReset") {
    await checkDailyReset();
  }
  if (alarm.name === TRANSLATION_UPDATE_ALARM) {
    await fetchAllTranslations();
  }
});

chrome.alarms.create("dailyReset", { periodInMinutes: 5 });
chrome.alarms.create(TRANSLATION_UPDATE_ALARM, { periodInMinutes: TRANSLATION_UPDATE_INTERVAL_MIN });

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("dashboard/index.html");
  const existing = await chrome.tabs.query({ url });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
  } else {
    await chrome.tabs.create({ url });
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await checkDailyReset();
  await ensureTranslationDefaults();
  try {
    await fetchAllTranslations();
  } catch (e) {
    console.error("[SW] translation fetch failed:", e);
  }
  console.log("[SW] HV Auto Arena installed/updated");
});
