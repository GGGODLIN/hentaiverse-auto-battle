(() => {
  if (!location.hostname.includes("e-hentai")) return;
  if (!location.pathname.includes("/news.php")) return;

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

  function hasEncounter() {
    const pane = document.getElementById("eventpane");
    return (
      pane &&
      pane.style.display !== "none" &&
      pane.innerText.includes("encountered a monster")
    );
  }

  function getEncounterUrl() {
    const pane = document.getElementById("eventpane");
    if (!pane) return null;
    const link = pane.querySelector('a[href*="hentaiverse.org"]');
    return link?.href ?? null;
  }

  async function init() {
    await initCache();

    const encounterEnabled = storeGet("encounterEnabled", false);
    const sweepEnabled = storeGet("arenaSweepEnabled", false);
    console.log("[encounter.js] init: encounterEnabled=" + encounterEnabled + " sweepEnabled=" + sweepEnabled);
    if (!encounterEnabled && !sweepEnabled) {
      console.log("[encounter.js] skipped: neither enabled");
      return;
    }

    if (hasEncounter()) {
      const url = getEncounterUrl();
      if (url) {
        storeSet("lastEncounterTime", Date.now());
        chrome.runtime.sendMessage({
          type: "ENCOUNTER_FOUND",
          url,
        }).catch(() => {});
        const pane = document.getElementById("eventpane");
        if (pane) pane.style.display = "none";
      }
    } else {
      console.log("[encounter.js] no encounter, sending NO_ENCOUNTER");
      chrome.runtime.sendMessage({
        type: "NO_ENCOUNTER",
      }).catch((e) => console.log("[encounter.js] sendMessage failed:", e));
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === "CHECK_ENCOUNTER") {
        sendResponse({
          hasEncounter: hasEncounter(),
          url: getEncounterUrl(),
        });
      }
      return true;
    });
  }

  init();
})();
