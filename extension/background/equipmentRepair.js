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

const MATERIAL_IDS = {
  sm: "60053",
  sw: "60054",
  sc: "60051",
  sl: "60052",
  ed: "60071",
};

const MATERIAL_NAMES = {
  sm: "Scrap Metal",
  sw: "Scrap Wood",
  sc: "Scrap Cloth",
  sl: "Scrap Leather",
  ed: "Energy Drink",
};

async function fetchMaterialInventory(world) {
  try {
    const url = forgeBaseUrl(world) + "/?s=Bazaar&ss=mk&screen=browseitems&filter=ma";
    const res = await fetch(url, {
      credentials: "include",
      headers: REPAIR_FETCH_HEADERS,
      referrer: forgeBaseUrl(world) + "/",
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    if (res.url.includes("s=Login") || /name="UserName"/i.test(text)) {
      return { success: false, error: "session expired (redirected to login)" };
    }
    const inv = {};
    for (const [key, id] of Object.entries(MATERIAL_IDS)) {
      const trRe = new RegExp('<tr[^>]*onclick="[^"]*itemid=' + id + '[^"]*"[^>]*>([\\s\\S]*?)</tr>', "i");
      const trMatch = text.match(trRe);
      if (!trMatch) {
        inv[key] = 0;
        continue;
      }
      const tdMatches = [...trMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      if (tdMatches.length < 2) {
        inv[key] = 0;
        continue;
      }
      const invText = tdMatches[1][1].replace(/<[^>]*>/g, "").replace(/,/g, "").trim();
      const n = parseInt(invText, 10);
      inv[key] = Number.isNaN(n) ? 0 : n;
    }
    return { success: true, inventory: inv };
  } catch (err) {
    console.log("[repair] fetchMaterialInventory error: " + JSON.stringify(err.message));
    return { success: false, error: err.message };
  }
}

async function scrapeRepairCost(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => {
        function parse() {
          const repairForm = [...document.querySelectorAll("form")]
            .find((f) => [...f.elements].some((el) => el.name === "repair_all"));
          if (!repairForm) return { needsRepair: false };
          let costText = "";
          const parent = repairForm.parentElement;
          if (parent) {
            for (const child of parent.children) {
              if (child.tagName !== "FORM") costText += " " + (child.textContent || "");
            }
          }
          const patterns = {
            sm: /(\d+)\s*x?\s*(?:Scrap\s*Metal|金属废料|金屬廢料)/i,
            sw: /(\d+)\s*x?\s*(?:Scrap\s*Wood|木材废料|木材廢料)/i,
            sc: /(\d+)\s*x?\s*(?:Scrap\s*Cloth|布制废料|布製廢料)/i,
            sl: /(\d+)\s*x?\s*(?:Scrap\s*Leather|皮革废料|皮革廢料)/i,
            ed: /(\d+)\s*x?\s*(?:Energy\s*Drink|能量元|能量飲料)/i,
          };
          const cost = {};
          for (const [k, re] of Object.entries(patterns)) {
            const mm = costText.match(re);
            cost[k] = mm ? parseInt(mm[1], 10) : 0;
          }
          const total = Object.values(cost).reduce((a, b) => a + b, 0);
          return { needsRepair: true, cost, scraped: total > 0 };
        }
        for (let i = 0; i < 25; i++) {
          const r = parse();
          if (r.needsRepair === false) return r;
          if (r.scraped) return r;
          await new Promise((rs) => setTimeout(rs, 200));
        }
        return parse();
      },
    });
    return results?.[0]?.result ?? null;
  } catch (err) {
    console.log("[repair] scrapeRepairCost error: " + JSON.stringify(err.message));
    return { error: err.message };
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("tab load timeout"));
    }, timeoutMs);
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete" && !done) {
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

const REPAIR_DEPOSIT_BUFFER = 10000;

async function buyMaterial(world, materialId, count) {
  const detail = await fetchMarketDetail(materialId, world);
  if (!detail.success) return { success: false, error: detail.error };

  const totalCost = count * detail.lowestAsk;
  let currentDetail = detail;

  if (currentDetail.marketBalance < totalCost) {
    const depositAmount = totalCost - currentDetail.marketBalance + REPAIR_DEPOSIT_BUFFER;
    if (depositAmount > currentDetail.accountBalance) {
      return { success: false, error: "insufficient account balance to deposit (need " + depositAmount + ", have " + currentDetail.accountBalance + ")" };
    }
    const depositRes = await deposit(depositAmount, currentDetail.marketoken, currentDetail.accountDepositSubmitValue, world);
    if (!depositRes.success) return { success: false, error: "deposit failed: " + depositRes.error };
    const refresh = await fetchMarketDetail(materialId, world);
    if (!refresh.success) return { success: false, error: "refresh-after-deposit: " + refresh.error };
    currentDetail = refresh;
  }

  const orderRes = await placeBuyOrder(materialId, count, currentDetail.lowestAsk, currentDetail.marketoken, currentDetail.submitValue, world);
  if (!orderRes.success) return { success: false, error: orderRes.error };

  return { success: true, units: count, cost: totalCost, pricePerUnit: currentDetail.lowestAsk };
}

async function repairWithAutoBuy(world) {
  const tab = await chrome.tabs.create({ url: forgeRepairUrl(world), active: false });
  const tabId = tab.id;

  try {
    try {
      await waitForTabComplete(tabId, 12000);
    } catch (e) {
      return { success: false, error: "page load: " + e.message };
    }
    await new Promise((r) => setTimeout(r, 400));

    const scrape = await scrapeRepairCost(tabId);
    if (scrape?.error) return { success: false, error: "scrape: " + scrape.error };
    if (scrape?.needsRepair === false) {
      return { success: true, repaired: false, reason: "no repair needed" };
    }
    if (!scrape?.scraped) {
      return { success: false, error: "cost not parsed (rendered DOM did not yield cost numbers)" };
    }

    const invResult = await fetchMaterialInventory(world);
    if (!invResult.success) return { success: false, error: "inventory: " + invResult.error };

    const shortfalls = [];
    for (const [key, costN] of Object.entries(scrape.cost)) {
      if (!Number.isFinite(costN) || costN <= 0) continue;
      const have = invResult.inventory[key] ?? 0;
      if (have < costN) {
        shortfalls.push({ key, itemid: MATERIAL_IDS[key], deficit: costN - have, have, need: costN });
      }
    }

    const purchases = [];
    for (const sf of shortfalls) {
      const buyRes = await buyMaterial(world, sf.itemid, sf.deficit);
      purchases.push({ key: sf.key, itemid: sf.itemid, deficit: sf.deficit, ...buyRes });
      if (!buyRes.success) {
        return { success: false, error: "buy " + MATERIAL_NAMES[sf.key] + " failed: " + buyRes.error, cost: scrape.cost, inventory: invResult.inventory, purchases };
      }
    }

    const repair = await postRepairAll(world);
    if (!repair.success) return { success: false, error: "post: " + repair.error, cost: scrape.cost, purchases };

    const verify = await fetchRepairPage(world);
    if (verify.success && verify.hasRepairAllForm) {
      return { success: false, error: "still needs repair after POST (verified via filter=equipped GET)", cost: scrape.cost, purchases };
    }

    return { success: true, repaired: true, cost: scrape.cost, inventory: invResult.inventory, purchases };
  } finally {
    try { await chrome.tabs.remove(tabId); } catch {}
  }
}

async function repairOnce(world) {
  const result = await repairWithAutoBuy(world);
  const ts = Date.now();

  if (!result.success) {
    await appendRepairLog({ ts, time: formatHHMMSS(ts), world, outcome: "failed", reason: result.error, cost: result.cost, purchases: result.purchases });
    console.log("[repair] repairOnce world=" + world + " failed: " + JSON.stringify(result.error));
    return { success: false, error: result.error, purchases: result.purchases };
  }

  if (!result.repaired) {
    await appendRepairLog({ ts, time: formatHHMMSS(ts), world, outcome: "skipped", reason: result.reason });
    return { success: true, repaired: false, reason: result.reason };
  }

  await appendRepairLog({ ts, time: formatHHMMSS(ts), world, outcome: "repaired", cost: result.cost, purchases: result.purchases });
  console.log("[repair] repairOnce world=" + world + " ok cost=" + JSON.stringify(result.cost) + " purchases=" + JSON.stringify(result.purchases));
  return { success: true, repaired: true, cost: result.cost, purchases: result.purchases };
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
