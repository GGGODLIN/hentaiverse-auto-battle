function forgeBaseUrl(world) {
  return world === "isekai" ? "https://hentaiverse.org/isekai" : "https://hentaiverse.org";
}
function forgeRepairUrl(world) {
  return forgeBaseUrl(world) + "/?s=Forge&ss=re&filter=equipped";
}

const REPAIR_FETCH_HEADERS = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,zh;q=0.8",
};

async function fetchRepairPage(world) {
  try {
    const res = await fetch(forgeRepairUrl(world), {
      credentials: "include",
      headers: REPAIR_FETCH_HEADERS,
      referrer: forgeBaseUrl(world) + "/",
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    if (res.url.includes("s=Login") || /name="UserName"/i.test(text)) {
      return { success: false, error: "session expired (redirected to login)" };
    }
    const hasRepairAllForm = /name="repair_all"/i.test(text);
    return { success: true, hasRepairAllForm, html: text };
  } catch (err) {
    console.log("[repair] fetchRepairPage error: " + JSON.stringify(err.message));
    return { success: false, error: err.message };
  }
}

async function postRepairAll(world) {
  try {
    const body = new URLSearchParams({ repair_all: "1" });
    const res = await fetch(forgeRepairUrl(world), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...REPAIR_FETCH_HEADERS },
      referrer: forgeBaseUrl(world) + "/",
      body: body.toString(),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    if (res.url.includes("s=Login") || /name="UserName"/i.test(text)) {
      return { success: false, error: "session expired (redirected to login)" };
    }
    const stillNeedsRepair = /name="repair_all"/i.test(text);
    return { success: true, stillNeedsRepair, html: text };
  } catch (err) {
    console.log("[repair] postRepairAll error: " + JSON.stringify(err.message));
    return { success: false, error: err.message };
  }
}

async function appendRepairLog(entry) {
  try {
    const stored = await chrome.storage.local.get("repairLog");
    const log = stored.repairLog ?? [];
    log.unshift(entry);
    if (log.length > 100) log.length = 100;
    await chrome.storage.local.set({ repairLog: log });
  } catch (err) {
    console.log("[repair] appendRepairLog error: " + JSON.stringify(err.message));
  }
}

function formatHHMMSS(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return hh + ":" + mm + ":" + ss;
}

async function repairOnce(world) {
  const page = await fetchRepairPage(world);
  if (!page.success) return { success: false, error: page.error };

  if (!page.hasRepairAllForm) {
    const ts = Date.now();
    await appendRepairLog({ ts, time: formatHHMMSS(ts), world, outcome: "skipped", reason: "no repair needed" });
    return { success: true, repaired: false, reason: "no repair needed" };
  }

  const post = await postRepairAll(world);
  if (!post.success) {
    const ts = Date.now();
    await appendRepairLog({ ts, time: formatHHMMSS(ts), world, outcome: "failed", reason: post.error });
    return { success: false, error: post.error };
  }

  const ts = Date.now();
  if (post.stillNeedsRepair) {
    await appendRepairLog({ ts, time: formatHHMMSS(ts), world, outcome: "partial", reason: "POST returned but form still present (insufficient materials?)" });
    return { success: false, error: "repair_all submitted but form still shown — likely insufficient materials" };
  }

  await appendRepairLog({ ts, time: formatHHMMSS(ts), world, outcome: "repaired" });
  console.log("[repair] repairOnce world=" + world + " ok");
  return { success: true, repaired: true };
}

async function markRepairAbort(world, reason) {
  await chrome.storage.local.set({
    ["repairAbortReason_" + world]: { ts: Date.now(), reason },
    ["autoArena_" + world]: false,
    ["arenaSweepEnabled_" + world]: false,
    ["rbAutoEnabled_" + world]: false,
  });
  return { success: false, error: reason };
}

async function repairPreflight(world) {
  const stored = await chrome.storage.local.get(["repairEnabled_" + world]);
  const enabled = stored["repairEnabled_" + world] ?? false;
  if (!enabled) return { skip: true };

  const result = await repairOnce(world);
  if (!result.success) {
    return markRepairAbort(world, result.error);
  }

  await chrome.storage.local.remove("repairAbortReason_" + world);
  return { success: true, repaired: result.repaired };
}

globalThis.repairOnce = repairOnce;
globalThis.repairPreflight = repairPreflight;
globalThis.fetchRepairPage = fetchRepairPage;
