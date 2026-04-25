(() => {
  if (!location.hostname.includes("hentaiverse")) return;
  if (!location.search.includes("s=Battle") || !location.search.includes("ss=ar")) return;

  const WORLD = location.pathname.includes("/isekai/") ? "isekai" : "normal";
  const wk = (key) => key + "_" + WORLD;

  const _cache = {};

  async function initCache() {
    const data = await chrome.storage.local.get(null);
    Object.assign(_cache, data);
    chrome.storage.onChanged.addListener((changes) => {
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (newValue === undefined) delete _cache[key];
        else _cache[key] = newValue;
      }
    });
  }

  function storeGet(key, defaultValue) {
    const val = _cache[key];
    return val !== undefined ? val : defaultValue;
  }

  function storeSet(key, value) {
    _cache[key] = value;
    chrome.storage.local.set({ [key]: value });
  }

  function parseDifficulties() {
    const results = [];
    const imgs = document.querySelectorAll("table img[onclick]");
    for (const img of imgs) {
      const onclick = img.getAttribute("onclick") ?? "";
      const match = onclick.match(/init_battle\((\d+)(?:,\s*(\d+))?(?:,\s*'([^']+)')?\)/);
      if (!match) continue;
      const row = img.closest("tr");
      if (!row) continue;
      const tds = row.querySelectorAll("td");
      const lvText = tds[2]?.textContent?.trim() ?? "";
      const lvMatch = lvText.match(/(\d+)/);
      results.push({
        id: parseInt(match[1]),
        entryCost: match[2] ? parseInt(match[2]) : 0,
        token: match[3] ?? "",
        level: lvMatch ? parseInt(lvMatch[1]) : 0,
      });
    }
    return results;
  }

  function parseStamina() {
    const el = document.getElementById("stamina_readout");
    if (!el) return null;
    const text = el.textContent ?? "";
    const match = text.match(/(\d+)/);
    return match ? parseInt(match[1]) : null;
  }

  async function preflightReplenish() {
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: "REPLENISH_PREFLIGHT", world: WORLD });
    } catch (e) {
      console.log("[AA] arena preflight: sendMessage error, proceeding: " + e.message);
      return true;
    }
    if (!resp) {
      console.log("[AA] arena preflight: no response from service worker, proceeding");
      return true;
    }
    if (resp.skip) return true;
    if (resp.success) return true;
    console.log("[AA] arena preflight FAILED: " + JSON.stringify(resp));
    return false;
  }

  async function enterArena(difficultyId, token) {
    const form = document.getElementById("initform");
    if (!form) return false;
    const initId = form.querySelector('input[name="initid"]');
    if (!initId) return false;
    initId.value = difficultyId;
    const initToken = form.querySelector('input[name="inittoken"]');
    if (initToken && token) initToken.value = token;
    const proceed = await preflightReplenish();
    if (!proceed) {
      console.log("[AA] arena preflight FAILED, aborting entry for difficultyId=" + difficultyId);
      return false;
    }
    await chrome.storage.local.set({
      [wk("autoArena")]: true,
      [wk("battleContext")]: { type: "arena", difficultyId, world: WORLD },
    });
    form.submit();
    return true;
  }

  async function init() {
    await initCache();

    if (document.getElementById("ckey_attack")) {
      console.log("[arena.js] In battle, skipping arena init");
      return;
    }

    const difficulties = parseDifficulties();
    const stamina = parseStamina();
    console.log("[arena.js] world=" + WORLD + " difficulties=" + difficulties.length + " stamina=" + stamina);

    storeSet(wk("arenaDifficulties"), difficulties);
    if (stamina != null) {
      storeSet(wk("currentStamina"), stamina);
    }

    chrome.runtime.sendMessage({
      type: "ARENA_PAGE_READY",
      difficulties,
      stamina,
      world: WORLD,
    }).catch(() => {});

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === "ENTER_ARENA") {
        const diff = difficulties.find((d) => d.id === msg.difficultyId);
        if (diff) {
          enterArena(diff.id, diff.token);
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: "Difficulty not found" });
        }
      }
      if (msg.type === "GET_ARENA_INFO") {
        sendResponse({ difficulties, stamina });
      }
      return true;
    });

  }

  init();
})();
