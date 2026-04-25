const REPLENISH_MARKET_URL = "https://hentaiverse.org/?s=Bazaar&ss=mk&screen=browseitems&filter=co";
const REPLENISH_DEPOSIT_FLOOR = 100000;

const RESTORATIVE_IDS = ['11191', '11195', '11199', '11291', '11295', '11299', '11391', '11395', '11399'];

function parseInventories(doc) {
  const inventories = {};
  for (const id of RESTORATIVE_IDS) {
    const row = doc.querySelector('tr[onclick*="' + id + '"]');
    if (!row) continue;
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) continue;
    const raw = parseInt((cells[1].textContent ?? '').replace(/,/g, ''), 10);
    if (Number.isNaN(raw)) continue;
    inventories[id] = raw;
  }
  return inventories;
}

async function dryRun() {
  try {
    const res = await fetch(REPLENISH_MARKET_URL, { credentials: "include" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();

    if (res.url.includes('s=Login') || /name="UserName"/i.test(text)) {
      return { success: false, error: 'session expired (redirected to login)' };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/html");

    const inventories = parseInventories(doc);

    if (Object.keys(inventories).length === 0) {
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

async function fetchMarketDetail(itemId) {
  const url = REPLENISH_MARKET_URL + "&itemid=" + itemId;
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();

    if (res.url.includes('s=Login') || /name="UserName"/i.test(text)) {
      return { success: false, error: 'session expired (redirected to login)' };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/html");

    const tokenInput = doc.querySelector('input[name="marketoken"]');
    if (!tokenInput) return { success: false, error: 'parse: marketoken input not found' };
    const marketoken = tokenInput.value;

    const submitInput = doc.querySelector('input[name="buyorder_update"]');
    if (!submitInput) return { success: false, error: 'parse: buyorder_update input not found' };
    const submitValue = submitInput.value;

    const tables = doc.querySelectorAll('table');
    let lowestAsk = null;
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const priceText = (cells[1].textContent ?? '').replace(/,/g, '').trim();
          const price = parseInt(priceText, 10);
          if (!Number.isNaN(price) && price > 0) {
            lowestAsk = price;
            break;
          }
        }
      }
      if (lowestAsk != null) break;
    }

    if (lowestAsk == null) return { success: false, error: 'parse: could not find lowest ask price in order book' };

    const depositSubmitInput = doc.querySelector('input[name="account_deposit"]');
    if (!depositSubmitInput) return { success: false, error: 'parse: account_deposit input not found' };
    const accountDepositSubmitValue = depositSubmitInput.value;

    const allText = doc.body?.textContent ?? '';
    const balancePattern = /[\d]{1,3}(?:,\d{3})*/g;

    let marketBalance = null;
    let accountBalance = null;

    const bodyHtml = doc.body?.innerHTML ?? '';
    const mktMatch = bodyHtml.match(/[Mm]arket\s*[Bb]alance[^<]*?(\d[\d,]+)\s*C|余额[^<]*?(\d[\d,]+)\s*C|(\d[\d,]+)\s*C[^<]*?[Mm]arket|市場余额[^>]*?(\d[\d,]+)/);
    if (mktMatch) {
      const raw = (mktMatch[1] ?? mktMatch[2] ?? mktMatch[3] ?? mktMatch[4] ?? '').replace(/,/g, '');
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed)) marketBalance = parsed;
    }

    const acctMatch = bodyHtml.match(/[Aa]ccount\s*[Bb]alance[^<]*?(\d[\d,]+)\s*C|帳戶余额[^<]*?(\d[\d,]+)\s*C|(\d[\d,]+)\s*C[^<]*?[Aa]ccount/);
    if (acctMatch) {
      const raw = (acctMatch[1] ?? acctMatch[2] ?? acctMatch[3] ?? '').replace(/,/g, '');
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed)) accountBalance = parsed;
    }

    if (marketBalance == null || accountBalance == null) {
      const accountAmountInput = doc.querySelector('input[name="account_amount"]');
      if (accountAmountInput) {
        const form = accountAmountInput.closest('form');
        if (form) {
          const formText = form.textContent ?? '';
          const nums = [...formText.matchAll(/(\d[\d,]+)\s*C/g)].map((m) => parseInt(m[1].replace(/,/g, ''), 10)).filter((n) => !Number.isNaN(n));
          if (nums.length >= 2 && marketBalance == null) marketBalance = nums[0];
          if (nums.length >= 2 && accountBalance == null) accountBalance = nums[1];
          if (nums.length === 1 && marketBalance == null) marketBalance = nums[0];
        }
      }
    }

    if (marketBalance == null) return { success: false, error: 'parse: marketBalance not found' };
    if (accountBalance == null) return { success: false, error: 'parse: accountBalance not found' };

    console.log("[replenish] fetchMarketDetail itemId=" + JSON.stringify(itemId) + " lowestAsk=" + JSON.stringify(lowestAsk) + " marketBalance=" + JSON.stringify(marketBalance) + " accountBalance=" + JSON.stringify(accountBalance));
    return { success: true, marketoken, submitValue, lowestAsk, marketBalance, accountBalance, accountDepositSubmitValue };
  } catch (err) {
    console.log("[replenish] fetchMarketDetail error: " + JSON.stringify(err.message));
    return { success: false, error: err.message };
  }
}

async function placeBuyOrder(itemId, packs, pricePerPack, marketoken, submitValue) {
  const url = REPLENISH_MARKET_URL + "&itemid=" + itemId;
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
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

async function deposit(amount, marketoken, depositSubmitValue) {
  const url = "https://hentaiverse.org/?s=Bazaar&ss=mk";
  try {
    const body = new URLSearchParams({
      marketoken,
      account_amount: String(amount),
      account_deposit: depositSubmitValue,
    });
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

const REPLENISH_SHOP_URL = "https://hentaiverse.org/?s=Bazaar&ss=is";

async function fetchStoretoken() {
  try {
    const res = await fetch(REPLENISH_SHOP_URL, { credentials: "include" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();

    if (res.url.includes('s=Login') || /name="UserName"/i.test(text)) {
      return { success: false, error: 'session expired (redirected to login)' };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/html");

    const tokenInput = doc.querySelector('input[name="storetoken"]');
    if (!tokenInput) return { success: false, error: 'parse: storetoken input not found' };

    console.log("[replenish] fetchStoretoken ok");
    return { success: true, value: tokenInput.value };
  } catch (err) {
    console.log("[replenish] fetchStoretoken error: " + JSON.stringify(err.message));
    return { success: false, error: err.message };
  }
}

async function shopBuy(itemId, count, storetoken) {
  try {
    const body = new URLSearchParams({
      storetoken,
      select_mode: "shop_pane",
      select_item: itemId,
      select_count: String(count),
    });
    const res = await fetch(REPLENISH_SHOP_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

async function replenishOnce(replenishConfig) {
  const dryResult = await dryRun();
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

    const detail = await fetchMarketDetail(itemId);
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
            const depositRes = await deposit(depositAmount, currentDetail.marketoken, currentDetail.accountDepositSubmitValue);
            if (!depositRes.success) {
              marketError = 'deposit failed: ' + depositRes.error;
            } else {
              console.log("[replenish] deposited " + JSON.stringify(depositAmount) + " for item " + JSON.stringify(itemId));
              const refresh = await fetchMarketDetail(itemId);
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
        const orderRes = await placeBuyOrder(itemId, packsNeeded, currentDetail.lowestAsk, currentDetail.marketoken, currentDetail.submitValue);
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

    const storetokenRes = await fetchStoretoken();
    if (!storetokenRes.success) {
      results.push({ id: itemId, status: 'failed', reason: 'shop fallback: ' + storetokenRes.error, marketError });
      continue;
    }

    const shopRes = await shopBuy(itemId, remaining, storetokenRes.value);
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
  const logEntry = {
    ts,
    time: formatHHMMSS(ts),
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
  await replenishOnce(config);

  const verify = await dryRun();
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
