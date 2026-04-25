(async () => {
  const host = location.hostname;
  const isHV = host.endsWith("hentaiverse.org");
  const ids = isHV ? TRANSLATION_HENTAIVERSE_IDS : TRANSLATION_CROSS_DOMAIN_IDS;
  if (ids.length === 0) return;

  const keys = [TRANSLATION_SETTINGS_KEY, ...ids.map((id) => TRANSLATION_KEY_PREFIX + id)];
  const stored = await chrome.storage.local.get(keys);
  const settings = stored[TRANSLATION_SETTINGS_KEY] ?? TRANSLATION_DEFAULT_SETTINGS;

  let polyfillSource;
  try {
    const polyfillUrl = chrome.runtime.getURL("content/translations/gm-polyfill.js");
    const res = await fetch(polyfillUrl);
    if (!res.ok) throw new Error("polyfill " + res.status);
    polyfillSource = await res.text();
  } catch (e) {
    console.error("[Translation] polyfill load failed:", e.message);
    return;
  }

  function injectIntoMainWorld(scriptSource, id) {
    const s = document.createElement("script");
    s.dataset.translationId = id;
    s.textContent = polyfillSource + "\n;\n" + scriptSource;
    (document.head ?? document.documentElement).appendChild(s);
    s.remove();
  }

  for (const id of ids) {
    if (settings[id] === false) continue;
    const entry = stored[TRANSLATION_KEY_PREFIX + id];
    if (!entry?.source) continue;
    injectIntoMainWorld(entry.source, id);
  }
})();
