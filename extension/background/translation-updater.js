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
