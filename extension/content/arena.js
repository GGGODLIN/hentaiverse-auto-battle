(() => {
  if (!location.hostname.includes("hentaiverse")) return;
  if (!location.search.includes("s=Battle") || !location.search.includes("ss=ar")) return;

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
      const match = onclick.match(/init_battle\((\d+),\s*(\d+),\s*'([^']+)'\)/);
      if (!match) continue;
      const row = img.closest("tr");
      if (!row) continue;
      const tds = row.querySelectorAll("td");
      const lvText = tds[2]?.textContent?.trim() ?? "";
      const lvMatch = lvText.match(/(\d+)/);
      results.push({
        id: parseInt(match[1]),
        entryCost: parseInt(match[2]),
        token: match[3],
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

  function enterArena(difficultyId, token) {
    const form = document.getElementById("initform");
    if (!form) return false;
    const initId = form.querySelector('input[name="initid"]');
    const initToken = form.querySelector('input[name="inittoken"]');
    if (!initId || !initToken) return false;
    initId.value = difficultyId;
    initToken.value = token;
    storeSet("autoArena", true);
    storeSet("battleContext", { type: "arena", difficultyId });
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

    storeSet("arenaDifficulties", difficulties);
    if (stamina != null) {
      storeSet("currentStamina", stamina);
    }

    chrome.runtime.sendMessage({
      type: "ARENA_PAGE_READY",
      difficulties,
      stamina,
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
