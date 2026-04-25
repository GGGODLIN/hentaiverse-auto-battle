async function fetchTranslation(id) {
  const def = TRANSLATION_REGISTRY[id];
  if (!def) return { id, status: "unknown" };

  const cacheKey = TRANSLATION_KEY_PREFIX + id;
  const metaUrl = TRANSLATION_BASE_URL + "/" + def.scriptId + ".meta.js";
  const userUrl = TRANSLATION_BASE_URL + "/" + def.scriptId + ".user.js";

  const stored = await chrome.storage.local.get(cacheKey);
  const cached = stored[cacheKey] ?? null;

  try {
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) throw new Error("meta " + metaRes.status);
    const remoteVersion = parseUserscriptVersion(await metaRes.text());

    if (cached?.version === remoteVersion && cached?.source) {
      await chrome.storage.local.set({
        [cacheKey]: { ...cached, lastFetched: Date.now(), lastError: null },
      });
      return { id, status: "unchanged", version: remoteVersion };
    }

    const userRes = await fetch(userUrl);
    if (!userRes.ok) throw new Error("user " + userRes.status);
    const source = await userRes.text();

    await chrome.storage.local.set({
      [cacheKey]: {
        version: remoteVersion,
        source,
        lastFetched: Date.now(),
        lastError: null,
        sourceUrl: userUrl,
        updateUrl: metaUrl,
      },
    });
    return { id, status: "updated", version: remoteVersion };
  } catch (err) {
    if (cached) {
      await chrome.storage.local.set({
        [cacheKey]: {
          ...cached,
          lastError: { message: err.message, time: Date.now() },
        },
      });
    }
    return { id, status: "error", error: err.message };
  }
}

function parseUserscriptVersion(metaText) {
  const m = metaText.match(/@version\s+(\S+)/);
  return m?.[1] ?? null;
}

async function fetchAllTranslations() {
  const ids = Object.keys(TRANSLATION_REGISTRY);
  return Promise.all(ids.map(fetchTranslation));
}

async function ensureTranslationDefaults() {
  const stored = await chrome.storage.local.get(TRANSLATION_SETTINGS_KEY);
  if (stored[TRANSLATION_SETTINGS_KEY]) return;
  await chrome.storage.local.set({
    [TRANSLATION_SETTINGS_KEY]: TRANSLATION_DEFAULT_SETTINGS,
  });
}

async function injectTranslations(tabId, host) {
  const isHV = host.endsWith("hentaiverse.org");
  const ids = isHV ? TRANSLATION_HENTAIVERSE_IDS : TRANSLATION_CROSS_DOMAIN_IDS;
  if (ids.length === 0) return;

  const settingsStored = await chrome.storage.local.get(TRANSLATION_SETTINGS_KEY);
  const settings = settingsStored[TRANSLATION_SETTINGS_KEY] ?? TRANSLATION_DEFAULT_SETTINGS;

  let polyfillSource;
  try {
    const res = await fetch(chrome.runtime.getURL("content/translations/gm-polyfill.js"));
    polyfillSource = await res.text();
  } catch (e) {
    console.error("[SW] polyfill fetch failed:", e);
    return;
  }

  for (const id of ids) {
    if (settings[id] === false) continue;
    const stored = await chrome.storage.local.get(TRANSLATION_KEY_PREFIX + id);
    const entry = stored[TRANSLATION_KEY_PREFIX + id];
    if (!entry?.source) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (poly, src, name) => {
          try {
            new Function(poly + ";\n" + src)();
          } catch (e) {
            console.error("[Translation:" + name + "] error:", e);
          }
        },
        args: [polyfillSource, entry.source, id],
      });
    } catch (e) {
      console.error("[SW] inject failed for " + id + ":", e);
    }
  }
}
