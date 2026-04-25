const REPLENISH_MARKET_URL = "https://hentaiverse.org/?s=Bazaar&ss=mk&screen=browseitems&filter=co";

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

    console.log("[replenish] fetchMarketDetail itemId=" + JSON.stringify(itemId) + " lowestAsk=" + JSON.stringify(lowestAsk));
    return { success: true, marketoken, submitValue, lowestAsk };
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

async function replenishSingleTest(replenishConfig) {
  const dryResult = await dryRun();
  if (!dryResult.success) return dryResult;

  const { inventories } = dryResult;

  let biggestShortfallId = null;
  let biggestShortfall = 0;

  for (const [id, count] of Object.entries(inventories)) {
    const cfg = replenishConfig?.[id];
    if (!cfg) continue;
    if (count < cfg.low) {
      const shortfall = cfg.low - count;
      if (shortfall > biggestShortfall) {
        biggestShortfall = shortfall;
        biggestShortfallId = id;
      }
    }
  }

  if (biggestShortfallId == null) {
    return { success: false, error: 'no shortfall' };
  }

  const itemId = biggestShortfallId;
  const detailResult = await fetchMarketDetail(itemId);
  if (!detailResult.success) return detailResult;

  const { marketoken, submitValue, lowestAsk } = detailResult;
  const packSize = packSizeFor(itemId);
  const packs = 1;
  const totalCost = lowestAsk * packs;

  const orderResult = await placeBuyOrder(itemId, packs, lowestAsk, marketoken, submitValue);
  if (!orderResult.success) return orderResult;

  return {
    success: true,
    item: {
      id: itemId,
      packs,
      unitsBought: packs * packSize,
      pricePerPack: lowestAsk,
      totalCost,
    },
  };
}

globalThis.replenishDryRun = dryRun;
globalThis.replenishSingleTest = replenishSingleTest;
