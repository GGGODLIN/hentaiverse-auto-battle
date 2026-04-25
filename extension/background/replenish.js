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

globalThis.replenishDryRun = dryRun;
