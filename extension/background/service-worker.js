const THIRTY_MIN = 30 * 60 * 1000;
const ONE_MIN = 60 * 1000;
const ARENA_URL = "https://hentaiverse.org/?s=Battle&ss=ar";
const NEWS_URL = "https://e-hentai.org/news.php";
const RESET_HOUR = 8;

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
    await setState("arenaSweepProgress", {});
    await setState("dailyStats", {
      arenaWins: 0,
      arenaLosses: 0,
      encounterCount: 0,
      arenaStartTime: null,
    });
    await setState("battleLog", []);
    await setState("riddleMasterRemaining", null);
    await addLog({ type: "system", reason: "Daily reset (" + today + ")" });
    console.log("[SW] Daily reset for " + today);
  }
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

async function handleArenaPageReady(msg, senderTabId) {
  const sweepEnabled = await getState("arenaSweepEnabled", false);
  if (!sweepEnabled) return;

  const stamina = msg.stamina;
  const threshold = await getState("staminaThreshold", 10);

  console.log("[SW] handleArenaPageReady: stamina=" + stamina + " threshold=" + threshold + " difficulties=" + (msg.difficulties?.length ?? 0));
  if (stamina != null && stamina < threshold) {
    console.log("[SW] SWEEP OFF reason: stamina depleted");
    await addLog({ type: "system", reason: "Stamina " + stamina + " below threshold " + threshold + ", pausing" });
    await setState("arenaSweepEnabled", false);
    chrome.notifications.create({
      type: "basic",
      title: "HV Auto Arena",
      message: "Stamina depleted (" + stamina + "), arena sweep paused.",
      iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='16' font-size='16'>⚔</text></svg>",
    });
    return;
  }

  const shouldCheckEncounter = await shouldDoEncounterFirst();
  if (shouldCheckEncounter) {
    await setState("arenaTabId", senderTabId);
    await doEncounterCheck();
    return;
  }

  await pickAndEnterNextDifficulty(msg.difficulties, senderTabId);
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

async function doEncounterCheck() {
  const encounterEnabled = await getState("encounterEnabled", false);
  if (!encounterEnabled) return;

  await addLog({ type: "system", reason: "Checking for encounter..." });
  const tab = await findOrCreateTab(NEWS_URL);
  await setState("encounterTabId", tab.id);
  await chrome.tabs.reload(tab.id);
}

async function pickAndEnterNextDifficulty(difficulties, tabId) {
  const progress = await getState("arenaSweepProgress", {});
  const available = difficulties ?? await getState("arenaDifficulties", []);

  let nextDiff = null;
  for (const d of available) {
    const status = progress[d.id];
    if (!status || (status !== "completed" && status !== "skipped")) {
      nextDiff = d;
      break;
    }
  }

  console.log("[SW] pickAndEnterNextDifficulty: available=" + available.length + " progress=" + JSON.stringify(progress) + " nextDiff=" + JSON.stringify(nextDiff));
  if (available.length === 0) {
    console.log("[SW] No difficulties found, page may not be arena. Skipping.");
    return;
  }
  if (!nextDiff) {
    console.log("[SW] SWEEP OFF reason: all difficulties completed");
    await addLog({ type: "victory", reason: "All arena difficulties completed!" });
    await setState("arenaSweepEnabled", false);
    chrome.notifications.create({
      type: "basic",
      title: "HV Auto Arena",
      message: "All arena difficulties completed!",
      iconUrl: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='16' font-size='16'>🏆</text></svg>",
    });
    return;
  }

  await setState("currentArenaDifficulty", nextDiff.id);
  progress[nextDiff.id] = "in_progress";
  await setState("arenaSweepProgress", progress);
  await addLog({ type: "system", reason: "Entering arena difficulty " + nextDiff.id + " (Lv." + nextDiff.level + ")" });

  await sendToTab(tabId, {
    type: "ENTER_ARENA",
    difficultyId: nextDiff.id,
  });
}

async function handleBattleComplete(msg) {
  const { result, battleType, difficultyId } = msg;
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

    const sweepEnabled = await getState("arenaSweepEnabled", false);
    if (sweepEnabled) {
      await resumeArenaSweep();
    }
    return;
  }

  if (battleType === "arena") {
    const progress = await getState("arenaSweepProgress", {});

    if (result === "victory") {
      stats.arenaWins = (stats.arenaWins ?? 0) + 1;
      progress[difficultyId] = "completed";
      await addLog({ type: "victory", reason: "Arena " + difficultyId + " cleared!" });
    } else {
      stats.arenaLosses = (stats.arenaLosses ?? 0) + 1;
      progress[difficultyId] = "failed";
      await addLog({ type: "defeated", reason: "Arena " + difficultyId + " failed" });
    }

    await setState("dailyStats", stats);
    await setState("arenaSweepProgress", progress);
    await setState("currentArenaDifficulty", null);

    const sweepEnabled = await getState("arenaSweepEnabled", false);
    if (sweepEnabled) {
      await wait(2000);
      await resumeArenaSweep();
    }
  }
}

async function resumeArenaSweep() {
  const arenaTabId = await getState("arenaTabId", null);
  if (arenaTabId) {
    try {
      await chrome.tabs.update(arenaTabId, { url: ARENA_URL });
      return;
    } catch {}
  }
  const tab = await findOrCreateTab(ARENA_URL);
  await setState("arenaTabId", tab.id);
  await chrome.tabs.reload(tab.id);
}

async function handleEncounterFound(msg, senderTabId) {
  const { url } = msg;
  await addLog({ type: "system", reason: "Encounter found! Opening battle..." });

  const tab = await chrome.tabs.create({ url, active: false });
  await setState("encounterBattleTabId", tab.id);
  await setState("battleContext", { type: "encounter" });
  await setState("autoArena", true);
}

async function handleNoEncounter() {
  await addLog({ type: "system", reason: "No encounter available" });
  const sweepEnabled = await getState("arenaSweepEnabled", false);
  if (sweepEnabled) {
    await resumeArenaSweep();
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

  (async () => {
    await checkDailyReset();

    switch (msg.type) {
      case "ARENA_PAGE_READY":
        await handleArenaPageReady(msg, senderTabId);
        break;


      case "BATTLE_COMPLETE":
        await handleBattleComplete(msg);
        break;

      case "BATTLE_STATUS":
        break;

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
        await handleNoEncounter();
        break;

      case "GET_FULL_STATE": {
        const allData = await chrome.storage.local.get(null);
        sendResponse(allData);
        return;
      }

      case "SET_ARENA_SWEEP": {
        console.log("[SW] SET_ARENA_SWEEP enabled=" + msg.enabled);
        await setState("arenaSweepEnabled", msg.enabled);
        if (msg.enabled) {
          await setState("autoArena", true);
          await setState("arenaSweepProgress", {});
          await addLog({ type: "system", reason: "Arena sweep started" });
          await resumeArenaSweep();
        } else {
          console.log("[SW] SWEEP OFF reason: user toggled off");
          await setState("autoArena", false);
          await addLog({ type: "system", reason: "Arena sweep stopped" });
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
  })();

  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "encounterCheck") {
    const enabled = await getState("encounterEnabled", false);
    if (!enabled) return;
    const sweepRunning = await getState("arenaSweepEnabled", false);
    if (sweepRunning) return;
    const inBattle = await getState("autoArena", false);
    if (inBattle) {
      scheduleEncounterCheck();
      return;
    }
    await doEncounterCheck();
  }
  if (alarm.name === "dailyReset") {
    await checkDailyReset();
  }
});

chrome.alarms.create("dailyReset", { periodInMinutes: 5 });

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
  console.log("[SW] HV Auto Arena installed/updated");
});
