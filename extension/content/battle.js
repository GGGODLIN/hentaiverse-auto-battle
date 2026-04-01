(() => {
  if (!location.hostname.includes("hentaiverse")) return;

  const WORLD = location.pathname.includes("/isekai/") ? "isekai" : "normal";
  const wk = (key) => key + "_" + WORLD;

  const _cache = {};
  let _cacheReady = false;

  async function initCache() {
    const data = await chrome.storage.local.get(null);
    Object.assign(_cache, data);
    _cacheReady = true;
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

  let _bridgeId = 0;
  const _bridgeCallbacks = {};

  function initBridge() {
    window.addEventListener("__hv_resp", (e) => {
      const { id } = e.detail;
      if (id && _bridgeCallbacks[id]) {
        _bridgeCallbacks[id]();
        delete _bridgeCallbacks[id];
      }
    });
  }

  function waitForApi(timeout = 5000) {
    return new Promise((resolve) => {
      const id = ++_bridgeId;
      _bridgeCallbacks[id] = resolve;
      window.dispatchEvent(new CustomEvent("__hv_cmd", {
        detail: { action: "waitForApi", id, timeout }
      }));
      setTimeout(() => {
        if (_bridgeCallbacks[id]) {
          _bridgeCallbacks[id]();
          delete _bridgeCallbacks[id];
        }
      }, timeout);
    });
  }

  function battleContinue() {
    window.dispatchEvent(new CustomEvent("__hv_cmd", {
      detail: { action: "battleContinue", id: ++_bridgeId }
    }));
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const waitFor = async (check, interval = 300, timeout = 3000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (check()) return true;
      await wait(interval);
    }
    return false;
  };

  function notifySW(type, data = {}) {
    chrome.runtime.sendMessage({ type, ...data }).catch(() => {});
  }

  function addLog(entry) {
    const logs = storeGet("battleLog", []);
    const now = new Date();
    const time = String(now.getHours()).padStart(2, "0") + ":" +
      String(now.getMinutes()).padStart(2, "0") + ":" +
      String(now.getSeconds()).padStart(2, "0");
    logs.push({ ...entry, time });
    if (logs.length > 200) logs.splice(0, logs.length - 200);
    storeSet("battleLog", logs);
  }

  function setStatus(type, reason) {
    const now = new Date();
    const time = String(now.getHours()).padStart(2, "0") + ":" +
      String(now.getMinutes()).padStart(2, "0") + ":" +
      String(now.getSeconds()).padStart(2, "0");
    storeSet("lastBattleStatus", { type, reason, time });
    addLog({ type, reason });
    notifySW("BATTLE_STATUS", { status: { type, reason, time }, world: WORLD });
  }

  const isInBattle = () => !!document.getElementById("ckey_attack");
  const isVictorious = () => document.body.innerText.substring(0, 500).includes("victorious");
  const isRiddleMaster = () => !!document.getElementById("riddlemaster");

  function isLastRoundVictory() {
    const btcp = document.getElementById("btcp");
    if (!btcp) return false;
    const onclick = btcp.getAttribute("onclick") ?? "";
    if (onclick.includes("goto_arena")) return true;
    const img = btcp.querySelector("img");
    if (img && img.src && img.src.includes("finishbattle")) return true;
    return false;
  }

  const DEFAULT_TOGGLES = {
    qb1: true, qb2: true, qb3: true, qb4: true,
    spirit: true, qb7: false, qb8: false, qb9: false,
    ofc: true,
    ikey1: true, ikey2: true, ikey3: true, ikey4: true,
    ikey5: true, ikey6: true, ikey7: true, ikey8: true,
    ikey9: true, ikeyP: true,
    sparkOfLife: true,
    priorityTargets: "Yggdrasil",
    hpThreshold: 50,
    mpThreshold: 50,
    spThreshold: 80,
    spPotThreshold: 55,
    ocThreshold: 90,
    channelingSkill: "qb2",
    targetStrategy: "focus",
    actionDelay: 300,
  };

  function getToggles() {
    const saved = storeGet(wk("battleToggles"), {});
    return { ...DEFAULT_TOGGLES, ...saved };
  }

  function readState() {
    const hpW = parseInt(document.querySelector("#dvbh img")?.style.width) ?? 1;
    const mpW = parseInt(document.querySelector("#dvbm img")?.style.width) ?? 1;
    const spW = parseInt(document.querySelector("#dvbs img")?.style.width) ?? 1;
    const ocW = parseInt(document.querySelector("#dvbc img")?.style.width) ?? 1;

    const isIsekai = !document.getElementById("dvrhd");
    let hpP, mpP, spP, ocP;

    if (isIsekai) {
      hpP = Math.round((hpW / 414) * 100);
      mpP = Math.round((mpW / 414) * 100);
      spP = Math.round((spW / 414) * 100);
      ocP = Math.round((ocW / 414) * 100);
    } else {
      const hp = parseInt(document.getElementById("dvrhd").textContent) ?? 0;
      const mp = parseInt(document.getElementById("dvrm").textContent) ?? 0;
      const sp = parseInt(document.getElementById("dvrs").textContent) ?? 0;
      const oc = parseInt(document.getElementById("dvrc").textContent) ?? 0;
      const mxHP = Math.round(hp / (hpW / 414));
      const mxMP = Math.round(mp / (mpW / 414));
      const mxSP = Math.round(sp / (spW / 414));
      const mxOC = Math.round(oc / (ocW / 414));
      hpP = Math.round((hp / mxHP) * 100);
      mpP = Math.round((mp / mxMP) * 100);
      spP = Math.round((sp / mxSP) * 100);
      ocP = Math.round((oc / mxOC) * 100);
    }

    const alive = [];
    const elites = [];
    for (let i = 0; i <= 50; i++) {
      const m = document.getElementById("mkey_" + i);
      if (
        m &&
        m.offsetWidth > 0 &&
        m.style.opacity !== "0.3" &&
        m.style.opacity !== "0"
      ) {
        alive.push(i);
        const b = m.querySelector(".btm2");
        if (b && b.style.background && b.style.background !== "none")
          elites.push(i);
      }
    }

    const pane = document.getElementById("pane_effects");
    const buffs = {};
    if (pane) {
      Array.from(pane.children).forEach((c) => {
        const mo = c.getAttribute("onmouseover") ?? "";
        const mt = mo.match(
          /set_infopane_effect\('([^']+)',\s*'[^']*',\s*(\d+|'[^']*')\)/,
        );
        if (mt) buffs[mt[1]] = mt[2] === "'autocast'" ? 999 : parseInt(mt[2]);
      });
    }

    const spiritSrc =
      document.getElementById("ckey_spirit")?.getAttribute("src") ?? "";

    return {
      hpP, mpP, spP, ocP,
      alive, elites, buffs,
      spiritActive: spiritSrc.includes("spirit_a"),
      victory: isVictorious(),
    };
  }

  async function useItem(id) {
    if (!document.getElementById(id)) return false;
    document.getElementById("ckey_items")?.click();
    await wait(50);
    const p = waitForApi();
    document.getElementById(id)?.click();
    await p;
    document.getElementById("ckey_attack")?.click();
    await wait(50);
    return true;
  }

  let battleRunning = false;

  async function startBattle() {
    if (battleRunning) return;
    battleRunning = true;

    let idleLoops = 0;
    const MAX_IDLE_LOOPS = 10;
    let successActions = 0;

    function retryOrAlert(title, body, isUrgent = false) {
      const count = storeGet(wk("alertRetryCount"), 0);
      const rs = readState();
      console.log("[AA] ALERT " + title + " (retry " + (count + 1) + "/3): " + body +
        " hpP=" + rs.hpP + " mpP=" + rs.mpP + " spP=" + rs.spP);
      if (count < 2) {
        setStatus("reload", title + " (" + (count + 1) + "/3)");
        storeSet(wk("alertRetryCount"), count + 1);
        location.reload();
        return true;
      }
      storeSet(wk("alertRetryCount"), 0);

      const unattended = storeGet("unattendedMode", false);
      if (unattended) {
        setStatus("alert", title + ": " + body + " (unattended, continuing)");
        addLog({ type: "alert", reason: title + ": " + body + " — unattended, continuing" });
        notifySW("BATTLE_ALERT", { title, body, isUrgent, world: WORLD });
        return true;
      }

      storeSet(wk("autoArena"), false);
      setStatus("alert", title + ": " + body);
      notifySW("BATTLE_ALERT", { title, body, isUrgent, world: WORLD });
      return false;
    }

    try {
      while (true) {
        if (!storeGet(wk("autoArena"), false)) break;

        const s = readState();

        if (s.hpP <= 0 && Object.keys(s.buffs).length === 0) {
          console.log("[AA] DEFEATED: hpP=" + s.hpP + " alive=" + s.alive.length);
          storeSet(wk("autoArena"), false);
          storeSet(wk("alertRetryCount"), 0);
          setStatus("defeated", "You have been defeated");
          const ctx = storeGet("battleContext", {});
          notifySW("BATTLE_COMPLETE", {
            result: "defeated",
            battleType: ctx.type,
            difficultyId: ctx.difficultyId,
            world: WORLD,
          });
          return;
        }

        if (s.hpP < 50) {
          console.log("[AA] LOW HP: hpP=" + s.hpP +
            " rawHp=" + (document.getElementById("dvrhd")?.textContent ?? "?") +
            " alive=" + s.alive.length + " buffs=" + JSON.stringify(s.buffs));
        }

        const rawHp = parseInt(document.getElementById("dvrhd")?.textContent) ?? 0;
        const healsAvail = {
          qb3: !!document.getElementById("qb3"),
          qb4: !!document.getElementById("qb4"),
          ikey3: !!document.getElementById("ikey_3"),
          ikey7: !!document.getElementById("ikey_7"),
        };
        if (rawHp > 0 && rawHp < 200 && !healsAvail.qb3 && !healsAvail.qb4 &&
          !healsAvail.ikey3 && !healsAvail.ikey7) {
          retryOrAlert("CRITICAL HP", "HP < 200 & no heals available!");
          return;
        }

        const t0 = getToggles();
        if (t0.sparkOfLife) {
          if (s.spP < 40) {
            const spCanRecover = (t0.ikey6 && document.getElementById("ikey_6")) ||
              (t0.ikey9 && document.getElementById("ikey_9"));
            if (!spCanRecover) {
              retryOrAlert("SP CRITICAL", "SP too low for Spark & no potions!");
              return;
            }
          }
          if (s.mpP < 20) {
            const mpCanRecover = (t0.ikey4 && document.getElementById("ikey_4")) ||
              (t0.ikey8 && document.getElementById("ikey_8"));
            if (!mpCanRecover) {
              retryOrAlert("MP CRITICAL", "MP too low for autocast & no potions!");
              return;
            }
          }
        }

        if (storeGet(wk("alertRetryCount"), 0) > 0 && s.buffs["Spark of Life"] && s.hpP >= 50) {
          console.log("[AA] Recovered after retry, resetting counter");
          storeSet(wk("alertRetryCount"), 0);
        }

        if (s.victory) {
          await waitFor(() => document.getElementById("btcp"), 300, 3000);
          if (isLastRoundVictory()) {
            storeSet(wk("autoArena"), false);
            storeSet(wk("alertRetryCount"), 0);
            const ctx = storeGet("battleContext", {});
            setStatus("victory", "Arena cleared!");
            notifySW("BATTLE_COMPLETE", {
              result: "victory",
              battleType: ctx.type,
              difficultyId: ctx.difficultyId,
              world: WORLD,
            });
            return;
          }
          await wait(1500);
          setStatus("continue", "Round continue");
          battleContinue();
          return;
        }

        if (s.alive.length === 0) {
          idleLoops++;
          if (idleLoops >= MAX_IDLE_LOOPS) {
            let recovered = false;
            for (let retry = 0; retry < 3; retry++) {
              await wait(5000);
              const rs = readState();
              if (rs.alive.length > 0 || rs.victory) {
                recovered = true;
                break;
              }
            }
            if (!recovered) {
              retryOrAlert("ANTI-CHEAT", "Battle stalled after retries!", true);
              return;
            }
            idleLoops = 0;
            continue;
          }
          await wait(300);
          continue;
        }

        idleLoops = 0;

        const t = getToggles();

        if (t.sparkOfLife) {
          if (!s.buffs["Spark of Life"]) {
            console.log("[AA] SPARK GONE: hpP=" + s.hpP + " mpP=" + s.mpP +
              " spP=" + s.spP + " rawHp=" + rawHp + " buffs=" + JSON.stringify(s.buffs));
            await wait(100);
            let sr = readState();

            if (sr.hpP < 50) {
              if (t.qb3 && document.getElementById("qb3")) {
                const p = waitForApi();
                document.getElementById("qb3").click();
                await p;
                await wait(100);
                sr = readState();
              }
              if (sr.hpP < 50 && t.qb4 && document.getElementById("qb4")) {
                const p = waitForApi();
                document.getElementById("qb4").click();
                await p;
                await wait(100);
                sr = readState();
              }
              if (sr.hpP < 50 && t.ikey3) {
                await useItem("ikey_3");
                await wait(100);
                sr = readState();
              }
              if (sr.hpP < 50 && t.ikey7) {
                await useItem("ikey_7");
                await wait(100);
                sr = readState();
              }
            }
            if (sr.mpP < 50 && t.ikey4) {
              await useItem("ikey_4");
              await wait(100);
              sr = readState();
            }
            if (sr.mpP < 20 && t.ikey8) {
              await useItem("ikey_8");
              await wait(100);
              sr = readState();
            }
            if (sr.spP < 50) {
              if (t.ikey6) {
                await useItem("ikey_6");
                await wait(100);
                sr = readState();
              }
              if (sr.spP < 50 && t.ikey5) {
                await useItem("ikey_5");
                await wait(100);
                sr = readState();
              }
              if (sr.spP < 40 && t.ikey9) {
                await useItem("ikey_9");
                await wait(100);
                sr = readState();
              }
            }

            console.log("[AA] Spark recovery done: hpP=" + sr.hpP + " mpP=" + sr.mpP +
              " spP=" + sr.spP + " spark=" + !!sr.buffs["Spark of Life"]);

            if (sr.buffs["Spark of Life"]) {
              console.log("[AA] Spark recovered via replenish");
              storeSet(wk("alertRetryCount"), 0);
              continue;
            }

            const reason = sr.hpP < 50 ? "HP" : sr.mpP < 20 ? "MP" : sr.spP < 40 ? "SP" : null;
            if (reason) {
              retryOrAlert("SPARK LOST", "Spark gone & " + reason + " too low!");
              return;
            }

            retryOrAlert("SPARK LOST", "Spark not recovered after replenish");
            return;
          }
        }

        if (s.hpP < (t.hpThreshold ?? 50) && (t.qb3 || t.qb4 || t.ikey3)) {
          if (t.qb3) {
            const p = waitForApi();
            document.getElementById("qb3")?.click();
            await p;
          }
          if (readState().hpP < (t.hpThreshold ?? 50) && t.qb4) {
            const p = waitForApi();
            document.getElementById("qb4")?.click();
            await p;
          }
          if (readState().hpP < (t.hpThreshold ?? 50) && t.ikey3) {
            await useItem("ikey_3");
          }
          if (readState().hpP < (t.hpThreshold ?? 50) && t.ikey7) {
            await useItem("ikey_7");
          }
          if (readState().hpP >= (t.hpThreshold ?? 50)) continue;
        }

        if (s.buffs["Channeling"]) {
          const chSkill = t.channelingSkill ?? "qb2";
          if (t[chSkill] && document.getElementById(chSkill)) {
            const p = waitForApi();
            document.getElementById(chSkill).click();
            await p;
            continue;
          }
        }

        if (t.ikeyP && document.getElementById("ikey_p")) {
          if (await useItem("ikey_p")) continue;
        }

        if (t.ikey4 && s.mpP < (t.mpThreshold ?? 30)) {
          if (await useItem("ikey_4")) continue;
        }

        if (t.ikey8 && s.mpP < 20) {
          if (await useItem("ikey_8")) continue;
        }

        if (t.ikey6 && s.spP < (t.spPotThreshold ?? 50)) {
          if (await useItem("ikey_6")) continue;
        }

        if (t.ikey9 && s.spP < 40) {
          if (await useItem("ikey_9")) continue;
        }

        if (t.ikey1 && !s.buffs["Regeneration"]) {
          if (await useItem("ikey_1")) continue;
        }

        if (t.ikey2 && !s.buffs["Replenishment"]) {
          if (await useItem("ikey_2")) continue;
        }

        if (t.ikey5 && s.spP < (t.spThreshold ?? 70) && !s.buffs["Refreshment"]) {
          if (await useItem("ikey_5")) continue;
        }

        if (
          t.qb1 &&
          (s.buffs["Regen"] ?? 0) <= 3 &&
          s.buffs["Regen"] !== 999 &&
          document.getElementById("qb1")
        ) {
          const p = waitForApi();
          document.getElementById("qb1").click();
          await p;
          continue;
        }

        if (
          t.qb2 &&
          (s.buffs["Heartseeker"] ?? 0) <= 3 &&
          s.buffs["Heartseeker"] !== 999 &&
          document.getElementById("qb2")
        ) {
          const p = waitForApi();
          document.getElementById("qb2").click();
          await p;
          continue;
        }

        if (
          t.spirit &&
          s.ocP > (t.ocThreshold ?? 80) &&
          !s.spiritActive &&
          s.alive.length > 0
        ) {
          document.getElementById("ckey_spirit")?.click();
          await wait(50);
          document.getElementById("ckey_attack")?.click();
          await wait(50);
        }

        function getHighestHpTarget(monsters) {
          let best = monsters[0];
          let bestHp = 0;
          for (const i of monsters) {
            const m = document.getElementById("mkey_" + i);
            const hpImg = m?.querySelector('.chbd img[alt="health"]');
            const hpW = parseInt(hpImg?.style.width) ?? 0;
            if (hpW > bestHp) {
              bestHp = hpW;
              best = i;
            }
          }
          return best;
        }

        function getPriorityTarget(aliveList) {
          const names = (t.priorityTargets ?? "")
            .split(",")
            .map((n) => n.trim().toLowerCase())
            .filter((n) => n);
          if (names.length === 0) return null;
          for (const i of aliveList) {
            const m = document.getElementById("mkey_" + i);
            const nameEl = m?.querySelector(".btm3 div div");
            const monsterName = (nameEl?.textContent ?? "").trim().toLowerCase();
            if (names.some((n) => monsterName.includes(n))) return i;
          }
          return null;
        }

        const isSpread = (t.targetStrategy ?? "focus") === "spread";
        const priorityTarget = getPriorityTarget(s.alive);
        const normalTarget = priorityTarget != null
          ? priorityTarget
          : isSpread
            ? getHighestHpTarget(s.alive)
            : s.elites.length > 0
              ? s.elites[0]
              : s.alive[0];

        if (normalTarget != null) {
          let usedSkill = false;

          if (t.ofc && document.getElementById("1111") && s.alive.length >= 4) {
            document.getElementById("1111").click();
            await wait(50);
            const p = waitForApi();
            document.getElementById("mkey_" + s.alive[0])?.click();
            await p;
            usedSkill = true;
          }

          if (!usedSkill) {
            for (const qb of ["qb7", "qb8", "qb9"]) {
              if (t[qb] && document.getElementById(qb)) {
                const skillTarget = priorityTarget != null
                  ? priorityTarget
                  : isSpread
                    ? getHighestHpTarget(s.alive)
                    : s.elites.length > 0
                      ? s.elites[0]
                      : getHighestHpTarget(s.alive);
                document.getElementById(qb).click();
                await wait(50);
                const p = waitForApi();
                document.getElementById("mkey_" + skillTarget)?.click();
                await p;
                usedSkill = true;
                break;
              }
            }
          }

          if (!usedSkill) {
            const p = waitForApi();
            document.getElementById("mkey_" + normalTarget)?.click();
            await p;
          }

          successActions++;
          if (successActions >= 3 && storeGet(wk("alertRetryCount"), 0) > 0) {
            console.log("[AA] Stable combat, resetting retry counter");
            storeSet(wk("alertRetryCount"), 0);
            successActions = 0;
          }
        } else {
          await wait(300);
        }
      }
    } catch (e) {
      console.error("AutoArena:", e);
      retryOrAlert("ERROR", "Script error: " + e.message);
    } finally {
      battleRunning = false;
    }
  }

  const RIDDLE_CHECKBOX_MAP = { ts: 0, ra: 1, fs: 2, rd: 3, pp: 4, aj: 5 };

  async function solveRiddleMaster() {
    try {
      const imgEl = document.querySelector("#riddleimage img");
      if (!imgEl) {
        addLog({ type: "alert", reason: "Riddle Master: no image element found" });
        return false;
      }

      const imgSrc = imgEl.src;
      const imgResp = await fetch(imgSrc, { credentials: "same-origin" });
      const blob = await imgResp.blob();

      const reader = new FileReader();
      const base64 = await new Promise((resolve) => {
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });

      const rmResult = await chrome.runtime.sendMessage({
        type: "RM_SOLVE",
        imageBase64: base64,
        apiKey: storeGet("rmApiKey", ""),
      });

      if (!rmResult || rmResult.error) {
        addLog({ type: "alert", reason: "Riddle Master API: " + (rmResult?.error ?? "no response") });
        return false;
      }

      const data = rmResult.data;

      const riddler1 = document.getElementById("riddler1");
      if (!riddler1) {
        addLog({ type: "alert", reason: "Riddle Master: #riddler1 not found" });
        return false;
      }

      const answers = Array.isArray(data.answer) ? data.answer : [];
      for (const code of answers) {
        const idx = RIDDLE_CHECKBOX_MAP[code];
        if (idx === undefined) continue;
        const checkbox = riddler1.children[idx]?.querySelector("input");
        if (checkbox) checkbox.checked = true;
      }

      const submitBtn = document.getElementById("riddlesubmit");
      if (submitBtn) submitBtn.disabled = false;

      const delay = 1000 + Math.random() * 2000;
      await wait(delay);
      submitBtn?.click();
      addLog({ type: "info", reason: "Riddle Master: submitted answer " + JSON.stringify(answers) });
      return true;
    } catch (e) {
      addLog({ type: "alert", reason: "Riddle Master solve error: " + e.message });
      return false;
    }
  }

  async function handleRiddleMaster() {
    addLog({ type: "info", reason: "Riddle Master detected, attempting solve..." });
    await solveRiddleMaster();

    const TIMEOUT = 60000;
    const INTERVAL = 2000;
    const start = Date.now();

    while (Date.now() - start < TIMEOUT) {
      await wait(INTERVAL);
      if (!isRiddleMaster()) {
        addLog({ type: "info", reason: "Riddle Master resolved, resuming battle" });
        init();
        return;
      }
    }

    setStatus("alert", "Riddle Master not resolved after 60s");
    storeSet(wk("autoArena"), false);
    notifySW("BATTLE_ALERT", {
      title: "RIDDLE MASTER",
      body: "Anti-cheat not resolved after 60s!",
      isUrgent: true,
      world: WORLD,
    });
  }

  async function init() {
    await initCache();
    initBridge();

    const btn = document.createElement("div");
    btn.id = "autoArenaBtn";
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      zIndex: "99999",
      padding: "8px 16px",
      borderRadius: "999px",
      cursor: "pointer",
      fontFamily: "sans-serif",
      fontSize: "13px",
      fontWeight: "bold",
      color: "#fff",
      userSelect: "none",
      boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
      transition: "background 0.2s",
    });
    document.body.appendChild(btn);

    const label = WORLD === "isekai" ? "ISEKAI" : "AUTO";
    function syncButton() {
      const on = storeGet(wk("autoArena"), false);
      btn.textContent = on ? "⚔ " + label + " ON" : "⚔ " + label + " OFF";
      btn.style.background = on ? "#2a7f3e" : "#9b2335";
    }

    syncButton();

    btn.addEventListener("click", () => {
      const nowOn = storeGet(wk("autoArena"), false);
      const next = !nowOn;
      storeSet(wk("autoArena"), next);
      if (next && isInBattle()) {
        startBattle();
      }
      syncButton();
    });

    chrome.storage.onChanged.addListener((changes) => {
      if (wk("autoArena") in changes) {
        syncButton();
        if (changes[wk("autoArena")].newValue && isInBattle()) {
          startBattle();
        }
      }
    });

    if (isRiddleMaster() && storeGet(wk("autoArena"), false)) {
      handleRiddleMaster();
      return;
    }

    if (storeGet(wk("autoArena"), false)) {
      const found = await waitFor(
        () => document.getElementById("ckey_attack"),
        300,
        5000,
      );
      if (found) {
        startBattle();
      } else if (location.search.includes("s=Battle")) {
        // On arena page, not battle — let arena.js handle it
      } else {
        storeSet(wk("autoArena"), false);
        storeSet(wk("alertRetryCount"), 0);
        setStatus("alert", "Battle not found after reload");
        notifySW("BATTLE_ERROR", { error: "Battle not found", world: WORLD });
      }
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === "START_BATTLE") {
        storeSet(wk("autoArena"), true);
        if (isInBattle()) {
          startBattle();
        }
        syncButton();
        sendResponse({ ok: true });
      }
      if (msg.type === "STOP_BATTLE") {
        storeSet(wk("autoArena"), false);
        syncButton();
        sendResponse({ ok: true });
      }
      return true;
    });
  }

  init();
})();
