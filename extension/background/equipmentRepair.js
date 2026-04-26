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
  ed: "Energy Cell",
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
          if (!repairForm) return { needsRepair: false, reason: "no repair_all form" };
          let costText = "";
          const parent = repairForm.parentElement;
          if (parent) {
            for (const child of parent.children) {
              if (child.tagName !== "FORM") costText += " " + (child.textContent || "");
            }
          }
          if (/已全部修[复復]|全部修[复復]|all\s+(?:items|equipment|tab).*?(?:repaired|fixed)|fully\s+repaired|no\s+repair\s+needed/i.test(costText)) {
            return { needsRepair: false, reason: "all repaired message", costText };
          }
          const patterns = {
            sm: /(\d+)\s*x?\s*(?:Scrap\s*Metal|金属废料|金屬廢料)/i,
            sw: /(\d+)\s*x?\s*(?:Scrap\s*Wood|木材废料|木材廢料)/i,
            sc: /(\d+)\s*x?\s*(?:Scrap\s*Cloth|布制废料|布製廢料)/i,
            sl: /(\d+)\s*x?\s*(?:Scrap\s*Leather|皮革废料|皮革廢料)/i,
            ed: /(\d+)\s*x?\s*(?:Energy\s*Cell|Energy\s*Drink|能量元|能量飲料)/i,
          };
          const cost = {};
          for (const [k, re] of Object.entries(patterns)) {
            const mm = costText.match(re);
            cost[k] = mm ? parseInt(mm[1], 10) : 0;
          }
          const total = Object.values(cost).reduce((a, b) => a + b, 0);
          if (total > 0) return { needsRepair: true, cost, scraped: true };
          return { needsRepair: true, cost, scraped: false, costText };
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

async function buyFromShop(world, materialId, count) {
  if (typeof fetchStoretoken !== "function" || typeof shopBuy !== "function") {
    return { success: false, error: "shop fallback unavailable (replenish module not loaded)" };
  }
  const tokenRes = await fetchStoretoken(world);
  if (!tokenRes.success) return { success: false, error: "shop storetoken: " + tokenRes.error };
  const buyRes = await shopBuy(materialId, count, tokenRes.value, world);
  if (!buyRes.success) return { success: false, error: "shop buy: " + buyRes.error };
  return { success: true, units: count, source: "shop", cost: null, pricePerUnit: null };
}

async function buyMaterial(world, materialId, count) {
  const detail = await fetchMarketDetail(materialId, world);
  if (!detail.success) {
    if (detail.error?.includes("lowest ask price")) {
      console.log("[repair] buyMaterial bazaar empty for " + materialId + ", falling back to shop");
      return await buyFromShop(world, materialId, count);
    }
    return { success: false, error: detail.error };
  }

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

    try { await chrome.tabs.reload(tabId); } catch {}
    try {
      await waitForTabComplete(tabId, 12000);
    } catch (e) {
      console.log("[repair] verify reload timeout, treating POST as success: " + e.message);
      return { success: true, repaired: true, cost: scrape.cost, inventory: invResult.inventory, purchases, verifyWarning: "reload timeout" };
    }
    await new Promise((r) => setTimeout(r, 400));
    const verifyScrape = await scrapeRepairCost(tabId);
    if (verifyScrape?.error) {
      return { success: true, repaired: true, cost: scrape.cost, inventory: invResult.inventory, purchases, verifyWarning: verifyScrape.error };
    }
    if (verifyScrape?.needsRepair !== false) {
      return { success: false, error: "still needs repair after POST (re-scraped)", cost: scrape.cost, verifyCost: verifyScrape?.cost, purchases };
    }

    return { success: true, repaired: true, cost: scrape.cost, inventory: invResult.inventory, purchases };
  } finally {
    try { await chrome.tabs.remove(tabId); } catch {}
  }
}

function isekaiRepairUrl(filter) {
  return "https://hentaiverse.org/isekai/?s=Bazaar&ss=am&screen=repair&filter=" + (filter ?? "equipped");
}

function parseIsekaiRepairPage(text) {
  const tokenMatch = text.match(/<input[^>]*name="postoken"[^>]*value="([^"]+)"/i);
  const tokenMatch2 = text.match(/<input[^>]*value="([^"]+)"[^>]*name="postoken"/i);
  const postoken = tokenMatch?.[1] ?? tokenMatch2?.[1];
  const items = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(text)) !== null) {
    const row = m[1];
    const eqM = row.match(/name="eqids\[\]"[^>]*value="(\d+)"/);
    if (!eqM) continue;
    const pcM = row.match(/(\d{1,3})\s*%/);
    if (!pcM) continue;
    items.push({ eqid: eqM[1], pct: parseInt(pcM[1], 10) });
  }
  return { postoken, items };
}

async function fetchIsekaiRepairPage() {
  try {
    const res = await fetch(isekaiRepairUrl("equipped"), {
      credentials: "include",
      headers: REPAIR_FETCH_HEADERS,
      referrer: "https://hentaiverse.org/isekai/",
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    if (res.url.includes("s=Login") || /name="UserName"/i.test(text)) {
      return { success: false, error: "session expired (redirected to login)" };
    }
    const parsed = parseIsekaiRepairPage(text);
    if (!parsed.postoken) return { success: false, error: "parse: postoken not found" };
    return { success: true, postoken: parsed.postoken, items: parsed.items };
  } catch (err) {
    console.log("[repair] fetchIsekaiRepairPage error: " + JSON.stringify(err.message));
    return { success: false, error: err.message };
  }
}

async function postIsekaiRepair(postoken, eqids) {
  try {
    const params = new URLSearchParams();
    params.append("postoken", postoken);
    for (const id of eqids) params.append("eqids[]", id);
    const res = await fetch(isekaiRepairUrl("equipped"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...REPAIR_FETCH_HEADERS },
      referrer: "https://hentaiverse.org/isekai/",
      body: params.toString(),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    if (res.url.includes("s=Login") || /name="UserName"/i.test(text)) {
      return { success: false, error: "session expired (redirected to login)" };
    }
    return { success: true, html: text };
  } catch (err) {
    console.log("[repair] postIsekaiRepair error: " + JSON.stringify(err.message));
    return { success: false, error: err.message };
  }
}

async function scrapeIsekaiEqitems() {
  const tab = await chrome.tabs.create({ url: isekaiRepairUrl("equipped"), active: false });
  const tabId = tab.id;
  try {
    try { await waitForTabComplete(tabId, 12000); }
    catch (e) { return { error: "page load: " + e.message }; }
    await new Promise((r) => setTimeout(r, 400));
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: async () => {
        for (let i = 0; i < 30; i++) {
          const tokenInput = document.querySelector('input[name="postoken"]');
          const postoken = tokenInput ? tokenInput.value : null;
          if (postoken) {
            const eqitemsObj = (typeof eqitems !== 'undefined' && eqitems) ? eqitems : {};
            const items = [];
            const eqitemsOut = {};
            for (const eqid of Object.keys(eqitemsObj)) {
              const data = eqitemsObj[eqid];
              if (data && data.m) eqitemsOut[eqid] = { m: data.m, t: data.t };
            }
            for (const cb of document.querySelectorAll('input[name="eqids[]"]')) {
              const eqid = cb.value;
              const row = cb.closest('tr');
              const pctMatch = row?.textContent?.match(/(\d{1,3})\s*%/);
              const pct = pctMatch ? parseInt(pctMatch[1], 10) : null;
              if (pct != null) items.push({ eqid, pct, disabled: !!cb.disabled });
            }
            return { postoken, eqitems: eqitemsOut, items };
          }
          await new Promise((rs) => setTimeout(rs, 200));
        }
        return { error: "postoken not populated within timeout" };
      },
    });
    return results?.[0]?.result ?? { error: "executeScript returned no result" };
  } catch (err) {
    return { error: err.message };
  } finally {
    try { await chrome.tabs.remove(tabId); } catch {}
  }
}

async function repairWithAutoBuyIsekai(world) {
  const scrape = await scrapeIsekaiEqitems();
  if (scrape.error) return { success: false, error: "scrape: " + scrape.error };
  if (!scrape.postoken) return { success: false, error: "scrape: postoken missing" };

  const stillBad = scrape.items.filter((it) => !it.disabled && it.pct < 100);
  if (stillBad.length === 0) {
    return { success: true, repaired: false, reason: "no repair needed" };
  }
  const eqidsToRepair = stillBad.map((it) => it.eqid);

  const totalNeed = {};
  for (const eqid of eqidsToRepair) {
    const data = scrape.eqitems[eqid];
    if (!data || !data.m) return { success: false, error: "missing eqitems for " + eqid };
    for (const [matId, count] of Object.entries(data.m)) {
      totalNeed[matId] = (totalNeed[matId] ?? 0) + count;
    }
  }
  console.log("[repair] isekai precise need: " + JSON.stringify(totalNeed));

  const invResult = await fetchMaterialInventory(world);
  if (!invResult.success) return { success: false, error: "inventory: " + invResult.error };

  const purchases = [];
  const matIdToKey = Object.fromEntries(Object.entries(MATERIAL_IDS).map(([k, v]) => [v, k]));
  for (const [matId, need] of Object.entries(totalNeed)) {
    const key = matIdToKey[matId];
    const have = key ? (invResult.inventory[key] ?? 0) : 0;
    if (need <= have) continue;
    const deficit = need - have;
    const buyRes = await buyMaterial(world, matId, deficit);
    purchases.push({ matId, key: key ?? null, need, have, deficit, ...buyRes });
    if (!buyRes.success) {
      const label = key ? MATERIAL_NAMES[key] : matId;
      return { success: false, error: "buy " + label + " failed: " + buyRes.error, purchases };
    }
  }

  const post = await postIsekaiRepair(scrape.postoken, eqidsToRepair);
  if (!post.success) return { success: false, error: "post: " + post.error, purchases };

  const verify = await fetchIsekaiRepairPage();
  if (!verify.success) return { success: false, error: "verify: " + verify.error, purchases };
  const stillBadAfter = verify.items.filter((it) => it.pct < 100);
  if (stillBadAfter.length > 0) {
    return { success: false, error: "still needs repair after POST: " + stillBadAfter.map((i) => i.eqid + "@" + i.pct + "%").join(","), purchases };
  }

  return { success: true, repaired: true, eqidsRepaired: eqidsToRepair, purchases };
}

async function repairOnce(world) {
  const result = world === "isekai" ? await repairWithAutoBuyIsekai(world) : await repairWithAutoBuy(world);
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

  await appendRepairLog({ ts, time: formatHHMMSS(ts), world, outcome: "repaired", cost: result.cost, purchases: result.purchases, eqidsRepaired: result.eqidsRepaired });
  console.log("[repair] repairOnce world=" + world + " ok purchases=" + JSON.stringify(result.purchases));
  return { success: true, repaired: true, cost: result.cost, purchases: result.purchases, eqidsRepaired: result.eqidsRepaired };
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
