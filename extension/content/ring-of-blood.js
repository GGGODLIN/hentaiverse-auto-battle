(() => {
  if (!location.hostname.includes("hentaiverse")) return;
  if (!location.search.includes("s=Battle") || !location.search.includes("ss=rb")) return;

  const WORLD = location.pathname.includes("/isekai/") ? "isekai" : "normal";
  const wk = (key) => key + "_" + WORLD;

  function parseChallenges() {
    const rows = document.querySelectorAll("#arena_list tbody tr");
    const out = [];
    for (const row of rows) {
      const tds = row.querySelectorAll("td");
      if (tds.length < 8) continue;
      const costText = tds[5]?.textContent ?? "";
      const m = costText.match(/(\d+)/);
      if (!m) continue;
      const cost = parseInt(m[1]);
      const startImg = tds[7]?.querySelector("img");
      const onclick = startImg?.getAttribute("onclick") ?? "";
      const enabled = !!onclick && !startImg.src.includes("_d.png");
      let id = null;
      let token = null;
      const initMatch = onclick.match(/init_battle\((\d+)(?:,\s*(\d+))?(?:,\s*'([^']+)')?\)/);
      if (initMatch) {
        id = parseInt(initMatch[1]);
        token = initMatch[3] ?? null;
      }
      out.push({ cost, enabled, id, token });
    }
    return out;
  }

  function parseTokens() {
    const el = document.getElementById("arena_tokens");
    const m = el?.textContent?.match(/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  function parseStamina() {
    const el = document.getElementById("stamina_readout");
    const m = el?.textContent?.match(/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  async function preflightReplenish() {
    const enabled = (await chrome.storage.local.get('replenishEnabled_' + WORLD))['replenishEnabled_' + WORLD] ?? false;
    if (!enabled) return true;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'REPLENISH_PREFLIGHT', world: WORLD });
      if (!resp || resp.skip || resp.success) return true;
      console.log('[AA] preflight FAILED: ' + JSON.stringify(resp));
      return false;
    } catch (e) {
      console.log('[AA] preflight error (proceeding): ' + JSON.stringify(e?.message));
      return true;
    }
  }

  async function enterChallenge(cost, phase) {
    const target = parseChallenges().find((c) => c.cost === cost && c.enabled);
    if (!target?.id) return false;
    await chrome.storage.local.set({
      [wk("autoArena")]: true,
      [wk("battleContext")]: { type: "rb", phase, world: WORLD },
    });
    document.getElementById("initid").value = target.id;
    const initToken = document.getElementById("inittoken");
    if (initToken && target.token) initToken.value = target.token;
    if (!await preflightReplenish()) return false;
    document.getElementById("initform").submit();
    return true;
  }

  if (document.getElementById("ckey_attack")) return;

  const tokens = parseTokens();
  const stamina = parseStamina();
  console.log("[ring-of-blood.js] tokens=" + tokens + " stamina=" + stamina);

  chrome.runtime.sendMessage({
    type: "RB_PAGE_READY",
    world: WORLD,
    tokens,
    stamina,
    challenges: parseChallenges(),
  }).catch(() => {});

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "ENTER_RB") {
      enterChallenge(msg.cost, msg.phase).then((ok) => sendResponse({ ok }));
      return true;
    }
  });
})();
