const REPLENISH_DEPOSIT_FLOOR = 100000;

function bazaarBaseUrl(world) {
  return world === 'isekai' ? 'https://hentaiverse.org/isekai' : 'https://hentaiverse.org';
}
function bazaarMarketListUrl(world) {
  return bazaarBaseUrl(world) + '/?s=Bazaar&ss=mk&screen=browseitems&filter=co';
}
function bazaarMarketDetailUrl(world, itemId) {
  return bazaarMarketListUrl(world) + '&itemid=' + itemId;
}
function bazaarMarketRootUrl(world) {
  return bazaarBaseUrl(world) + '/?s=Bazaar&ss=mk';
}
function bazaarShopUrl(world) {
  return bazaarBaseUrl(world) + '/?s=Bazaar&ss=is';
}

const HV_FETCH_HEADERS = {
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,zh;q=0.8",
};

const RESTORATIVE_IDS = ['11191', '11195', '11199', '11291', '11295', '11299', '11391', '11395', '11399'];

function parseInventoriesFromText(text) {
  const inventories = {};
  for (const id of RESTORATIVE_IDS) {
    const trRe = new RegExp('<tr[^>]*onclick="[^"]*itemid=' + id + '[^"]*"[^>]*>([\\s\\S]*?)</tr>', 'i');
    const trMatch = text.match(trRe);
    if (!trMatch) continue;
    const tdMatches = [...trMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (tdMatches.length < 2) continue;
    const invHtml = tdMatches[1][1];
    const invText = invHtml.replace(/<[^>]*>/g, '').replace(/,/g, '').trim();
    const raw = parseInt(invText, 10);
    if (Number.isNaN(raw)) continue;
    inventories[id] = raw;
  }
  return inventories;
}

async function dryRun(world) {
  try {
    const res = await fetch(bazaarMarketListUrl(world), { credentials: "include", headers: HV_FETCH_HEADERS, referrer: bazaarBaseUrl(world) + "/" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();

    if (res.url.includes('s=Login') || /name="UserName"/i.test(text)) {
      return { success: false, error: 'session expired (redirected to login)' };
    }

    const inventories = parseInventoriesFromText(text);

    if (Object.keys(inventories).length === 0) {
      const hpIdx = text.indexOf('Health Potion');
      const hpSnippet = hpIdx >= 0 ? text.slice(Math.max(0, hpIdx - 80), hpIdx + 300) : null;
      console.log("[replenish] dryRun parse miss — text.length=" + text.length +
        " hasItemid11195=" + text.includes('itemid=11195') +
        " hasHealthPotion=" + text.includes('Health Potion') +
        " hasSelectItem=" + text.includes('select_item') +
        " hasOnclick=" + text.includes('onclick') +
        " finalUrl=" + JSON.stringify(res.url) +
        " head=" + JSON.stringify(text.slice(0, 300)) +
        " hpSnippet=" + JSON.stringify(hpSnippet));
      return { success: false, error: 'parse: no items matched (HTML structure changed?)' };
    }

    console.log("[replenish] dryRun inventories: " + JSON.stringify(inventories));
    return { success: true, inventories };
  } catch (err) {
    console.log("[replenish] dryRun error: " + JSON.stringify(err.message));
    return { success: false, error: err.message };
  }
}

const PACK_SIZE_100 = new Set(['11191', '11195', '11291', '11295', '11391', '11395']);
const PACK_SIZE_1 = new Set(['11199', '11299', '11399']);

function packSizeFor(itemId) {
  if (PACK_SIZE_100.has(itemId)) return 100;
  if (PACK_SIZE_1.has(itemId)) return 1;
  return 1;
}

async function fetchMarketDetail(itemId, world) {
  const url = bazaarMarketDetailUrl(world, itemId);
  try {
    const res = await fetch(url, { credentials: "include", headers: HV_FETCH_HEADERS, referrer: bazaarBaseUrl(world) + "/" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();

    if (res.url.includes('s=Login') || /name="UserName"/i.test(text)) {
      return { success: false, error: 'session expired (redirected to login)' };
    }

    const marketokenMatch = text.match(/<input[^>]*name="marketoken"[^>]*value="([^"]+)"/i);
    const marketokenMatch2 = text.match(/<input[^>]*value="([^"]+)"[^>]*name="marketoken"/i);
    const marketoken = marketokenMatch?.[1] ?? marketokenMatch2?.[1];
    if (!marketoken) return { success: false, error: 'parse: marketoken input not found' };

    const buyUpdateMatch = text.match(/<input[^>]*name="buyorder_update"[^>]*value="([^"]+)"/i);
    const buyUpdateMatch2 = text.match(/<input[^>]*value="([^"]+)"[^>]*name="buyorder_update"/i);
    const submitValue = buyUpdateMatch?.[1] ?? buyUpdateMatch2?.[1];
    if (!submitValue) return { success: false, error: 'parse: buyorder_update input not found' };

    const depositMatch = text.match(/<input[^>]*name="account_deposit"[^>]*value="([^"]+)"/i);
    const depositMatch2 = text.match(/<input[^>]*value="([^"]+)"[^>]*name="account_deposit"/i);
    const accountDepositSubmitValue = depositMatch?.[1] ?? depositMatch2?.[1];
    if (!accountDepositSubmitValue) return { success: false, error: 'parse: account_deposit input not found' };

    const accountBalMatch = text.match(/Account\s*Balance[\s\S]{1,200}?([\d,]+)\s*C/i);
    let accountBalance = accountBalMatch ? parseInt(accountBalMatch[1].replace(/,/g, ''), 10) : null;

    const marketBalMatch = text.match(/Market\s*Balance[\s\S]{1,200}?([\d,]+)\s*C/i);
    let marketBalance = marketBalMatch ? parseInt(marketBalMatch[1].replace(/,/g, ''), 10) : null;

    if (marketBalance == null || accountBalance == null) {
      const accountAmountFormMatch = text.match(/<input[^>]*name="account_amount"[^>]*>[\s\S]{0,2000}?<\/form>/i)
        ?? text.match(/<form[\s\S]{0,2000}?<input[^>]*name="account_amount"[^>]*>[\s\S]{0,2000}?<\/form>/i);
      if (accountAmountFormMatch) {
        const formHtml = accountAmountFormMatch[0];
        const nums = [...formHtml.matchAll(/([\d,]+)\s*C/g)]
          .map((m) => parseInt(m[1].replace(/,/g, ''), 10))
          .filter((n) => !Number.isNaN(n));
        if (nums.length >= 2 && marketBalance == null) marketBalance = nums[0];
        if (nums.length >= 2 && accountBalance == null) accountBalance = nums[1];
        if (nums.length === 1 && marketBalance == null) marketBalance = nums[0];
      }
    }

    let lowestAsk = null;
    const askAnchorMatch = text.match(/(Available\s+Sell\s+Orders|当前卖单)([\s\S]+?)(Available\s+Buy|当前买单|Order\s+Total|Min\s+Overbid)/i);
    if (askAnchorMatch) {
      const askSection = askAnchorMatch[2];
      const trMatches = [...askSection.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const trM of trMatches) {
        const tdMatches = [...trM[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
        if (tdMatches.length < 3) continue;
        const priceText = tdMatches[1][1].replace(/<[^>]*>/g, '').replace(/,/g, '').trim();
        const price = parseInt(priceText, 10);
        if (!Number.isNaN(price) && price > 0) {
          lowestAsk = price;
          break;
        }
      }
    }

    if (lowestAsk == null) return { success: false, error: 'parse: could not find lowest ask price in order book' };
    if (marketBalance == null) return { success: false, error: 'parse: marketBalance not found' };
    if (accountBalance == null) return { success: false, error: 'parse: accountBalance not found' };

    console.log("[replenish] fetchMarketDetail itemId=" + JSON.stringify(itemId) + " lowestAsk=" + JSON.stringify(lowestAsk) + " marketBalance=" + JSON.stringify(marketBalance) + " accountBalance=" + JSON.stringify(accountBalance));
    return { success: true, marketoken, submitValue, lowestAsk, marketBalance, accountBalance, accountDepositSubmitValue };
  } catch (err) {
    console.log("[replenish] fetchMarketDetail error: " + JSON.stringify(err.message));
    return { success: false, error: err.message };
  }
}

async function placeBuyOrder(itemId, packs, pricePerPack, marketoken, submitValue, world) {
  const url = bazaarMarketDetailUrl(world, itemId);
  try {
    const body = new URLSearchParams({
      marketoken,
      buyorder_batchcount: String(packs),
      buyorder_batchprice: String(pricePerPack),
      buyorder_update: submitValue,
    });
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...HV_FETCH_HEADERS },
      referrer: bazaarBaseUrl(world) + "/",
      body: body.toString(),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();

    if (res.url.includes('s=Login') || /name="UserName"/i.test(text)) {
      return { success: false, error: 'session expired (redirected to login)' };
    }

    console.log("[replenish] placeBuyOrder itemId=" + JSON.stringify(itemId) + " packs=" + JSON.stringify(packs) + " price=" + JSON.stringify(pricePerPack));
    return { success: true };
  } catch (err) {
    console.log("[replenish] placeBuyOrder error: " + JSON.stringify(err.message));
    return { success: false, error: err.message };
  }
}

async function deposit(amount, marketoken, depositSubmitValue, world) {
  const url = bazaarMarketRootUrl(world);
  try {
    const body = new URLSearchParams({
      marketoken,
      account_amount: String(amount),
      account_deposit: depositSubmitValue,
    });
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...HV_FETCH_HEADERS },
      referrer: bazaarBaseUrl(world) + "/",
      body: body.toString(),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();

    if (res.url.includes('s=Login') || /name="UserName"/i.test(text)) {
      return { success: false, error: 'session expired (redirected to login)' };
    }

    console.log("[replenish] deposit amount=" + JSON.stringify(amount));
    return { success: true };
  } catch (err) {
    console.log("[replenish] deposit error: " + JSON.stringify(err.message));
    return { success: false, error: err.message };
  }
}

async function fetchStoretoken(world) {
  try {
    const res = await fetch(bazaarShopUrl(world), { credentials: "include", headers: HV_FETCH_HEADERS, referrer: bazaarBaseUrl(world) + "/" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();

    if (res.url.includes('s=Login') || /name="UserName"/i.test(text)) {
      return { success: false, error: 'session expired (redirected to login)' };
    }

    const storetokenMatch = text.match(/<input[^>]*name="storetoken"[^>]*value="([^"]+)"/i);
    const storetokenMatch2 = text.match(/<input[^>]*value="([^"]+)"[^>]*name="storetoken"/i);
    const storetokenValue = storetokenMatch?.[1] ?? storetokenMatch2?.[1];
    if (!storetokenValue) return { success: false, error: 'parse: storetoken input not found' };

    console.log("[replenish] fetchStoretoken ok");
    return { success: true, value: storetokenValue };
  } catch (err) {
    console.log("[replenish] fetchStoretoken error: " + JSON.stringify(err.message));
    return { success: false, error: err.message };
  }
}

async function shopBuy(itemId, count, storetoken, world) {
  try {
    const body = new URLSearchParams({
      storetoken,
      select_mode: "shop_pane",
      select_item: itemId,
      select_count: String(count),
    });
    const res = await fetch(bazaarShopUrl(world), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...HV_FETCH_HEADERS },
      referrer: bazaarBaseUrl(world) + "/",
      body: body.toString(),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();

    if (res.url.includes('s=Login') || /name="UserName"/i.test(text)) {
      return { success: false, error: 'session expired (redirected to login)' };
    }

    console.log("[replenish] shopBuy itemId=" + JSON.stringify(itemId) + " count=" + JSON.stringify(count));
    return { success: true };
  } catch (err) {
    console.log("[replenish] shopBuy error: " + JSON.stringify(err.message));
    return { success: false, error: err.message };
  }
}

async function appendReplenishLog(entry) {
  try {
    const stored = await chrome.storage.local.get('replenishLog');
    const log = stored.replenishLog ?? [];
    log.unshift(entry);
    if (log.length > 100) log.length = 100;
    await chrome.storage.local.set({ replenishLog: log });
  } catch (err) {
    console.log("[replenish] appendReplenishLog error: " + JSON.stringify(err.message));
  }
}

function formatHHMMSS(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return hh + ':' + mm + ':' + ss;
}

async function replenishOnce(replenishConfig, world) {
  const dryResult = await dryRun(world);
  if (!dryResult.success) return dryResult;

  const { inventories } = dryResult;
  const results = [];
  let totalCost = 0;

  for (const itemId of RESTORATIVE_IDS) {
    const cfg = replenishConfig?.[itemId];
    if (!cfg) continue;
    const inv = inventories[itemId] ?? 0;
    if (inv >= cfg.low) {
      results.push({ id: itemId, status: 'skipped', reason: 'already >= low (' + inv + ')' });
      continue;
    }

    const packSize = packSizeFor(itemId);
    const shortfall = cfg.target - inv;
    let marketUnits = 0;
    let marketCost = 0;
    let marketError = null;

    const detail = await fetchMarketDetail(itemId, world);
    if (!detail.success) {
      marketError = detail.error;
    } else {
      const packsNeeded = Math.ceil(shortfall / packSize);
      const cost = packsNeeded * detail.lowestAsk;
      let currentDetail = detail;

      if (currentDetail.marketBalance < cost || currentDetail.marketBalance < REPLENISH_DEPOSIT_FLOOR) {
        const depositAmount = REPLENISH_DEPOSIT_FLOOR - currentDetail.marketBalance;
        if (depositAmount > 0) {
          if (depositAmount > currentDetail.accountBalance) {
            marketError = 'insufficient account balance to deposit (need ' + depositAmount + ', have ' + currentDetail.accountBalance + ')';
          } else {
            const depositRes = await deposit(depositAmount, currentDetail.marketoken, currentDetail.accountDepositSubmitValue, world);
            if (!depositRes.success) {
              marketError = 'deposit failed: ' + depositRes.error;
            } else {
              console.log("[replenish] deposited " + JSON.stringify(depositAmount) + " for item " + JSON.stringify(itemId));
              const refresh = await fetchMarketDetail(itemId, world);
              if (!refresh.success) {
                marketError = 'refresh-after-deposit: ' + refresh.error;
              } else {
                currentDetail = refresh;
              }
            }
          }
        }
      }

      if (!marketError) {
        const orderRes = await placeBuyOrder(itemId, packsNeeded, currentDetail.lowestAsk, currentDetail.marketoken, currentDetail.submitValue, world);
        if (!orderRes.success) {
          marketError = orderRes.error;
        } else {
          marketUnits = packsNeeded * packSize;
          marketCost = cost;
          totalCost += cost;
        }
      }
    }

    const remaining = shortfall - marketUnits;

    if (remaining <= 0) {
      results.push({ id: itemId, status: 'bought', source: 'market', units: marketUnits, cost: marketCost });
      continue;
    }

    const storetokenRes = await fetchStoretoken(world);
    if (!storetokenRes.success) {
      results.push({ id: itemId, status: 'failed', reason: 'shop fallback: ' + storetokenRes.error, marketError });
      continue;
    }

    const shopRes = await shopBuy(itemId, remaining, storetokenRes.value, world);
    if (!shopRes.success) {
      if (marketUnits > 0) {
        results.push({ id: itemId, status: 'partial', source: 'mixed', marketUnits, shopError: shopRes.error });
      } else {
        results.push({ id: itemId, status: 'failed', reason: 'shop failed: ' + shopRes.error, marketError });
      }
      continue;
    }

    if (marketUnits > 0) {
      results.push({ id: itemId, status: 'bought', source: 'mixed', marketUnits, shopUnits: remaining, marketCost, shopCost: 'unknown' });
    } else {
      results.push({ id: itemId, status: 'bought', source: 'shop', units: remaining, cost: 'unknown' });
    }
  }

  const successCount = results.filter((r) => r.status === 'bought').length;
  const failedCount = results.filter((r) => r.status === 'failed' || r.status === 'partial').length;
  const overall = failedCount > 0 && successCount === 0 ? 'failed'
    : failedCount > 0 ? 'partial'
    : 'success';

  const ts = Date.now();
  const invKey = 'replenishLastInventory_' + world;
  await chrome.storage.local.set({ [invKey]: { ts, inventories } });

  const logEntry = {
    ts,
    time: formatHHMMSS(ts),
    world,
    totalCost,
    items: results,
    overall,
  };

  await appendReplenishLog(logEntry);

  console.log("[replenish] replenishOnce done: totalCost=" + JSON.stringify(totalCost) + " results=" + JSON.stringify(results));
  return { success: true, results, totalCost };
}

async function markAbort(world, reason, shortfalls) {
  await chrome.storage.local.set({
    ['replenishAbortReason_' + world]: { ts: Date.now(), reason, shortfalls },
    ['autoArena_' + world]: false,
    ['arenaSweepEnabled_' + world]: false,
    ['rbAutoEnabled_' + world]: false,
  });
  return { success: false, error: reason, shortfalls };
}

async function replenishPreflight(world) {
  const stored = await chrome.storage.local.get([
    "replenishEnabled_" + world,
    "replenishConfig",
  ]);
  const enabled = stored["replenishEnabled_" + world] ?? false;
  if (!enabled) return { skip: true };

  const config = stored.replenishConfig ?? {};
  await replenishOnce(config, world);

  const verify = await dryRun(world);
  if (!verify.success) return markAbort(world, verify.error, []);

  const shortfalls = [];
  for (const id of RESTORATIVE_IDS) {
    const cfg = config[id];
    if (!cfg) continue;
    const current = verify.inventories[id] ?? 0;
    if (current < cfg.low) shortfalls.push({ id, current, low: cfg.low, deficit: cfg.low - current });
  }

  if (shortfalls.length > 0) {
    return markAbort(world, 'shortfall remaining', shortfalls);
  }

  await chrome.storage.local.remove('replenishAbortReason_' + world);
  return { success: true };
}

globalThis.replenishDryRun = dryRun;
globalThis.replenishOnce = replenishOnce;
globalThis.replenishPreflight = replenishPreflight;
