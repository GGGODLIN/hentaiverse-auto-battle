// ==UserScript==
// @name         HV Auto Battle & Encounter
// @namespace    hv-auto-arena
// @version      3.0
// @description  Auto battle + encounter refresh for HentaiVerse
// @match        *://hentaiverse.org/*
// @match        *://www.hentaiverse.org/*
// @match        *://e-hentai.org/news.php*
// @match        *://www.e-hentai.org/news.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (check, interval = 300, timeout = 3000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (check()) return true;
      await wait(interval);
    }
    return false;
  };

  const isNewsPage =
    location.hostname.includes("e-hentai") &&
    location.pathname.includes("/news.php");
  const isBattlePage = location.hostname.includes("hentaiverse");

  if (isNewsPage) {
    runEncounterMode();
  } else if (isBattlePage) {
    runBattleMode();
  }

  function runEncounterMode() {
    const THIRTY_MIN = 30 * 60 * 1000;
    const ONE_MIN = 60 * 1000;

    const hasEncounter = () => {
      const pane = document.getElementById("eventpane");
      return (
        pane &&
        pane.style.display !== "none" &&
        pane.innerText.includes("encountered a monster")
      );
    };

    const getEncounterUrl = () => {
      const pane = document.getElementById("eventpane");
      if (!pane) return null;
      const link = pane.querySelector('a[href*="hentaiverse.org"]');
      return link?.href ?? null;
    };

    const btn = document.createElement("div");
    btn.id = "autoEncounterBtn";
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      padding: "10px 18px",
      borderRadius: "24px",
      cursor: "pointer",
      zIndex: "99999",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize: "14px",
      fontWeight: "bold",
      userSelect: "none",
      transition: "all 0.3s ease",
      boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      border: "2px solid rgba(255,255,255,0.2)",
      letterSpacing: "0.5px",
    });
    document.body.appendChild(btn);

    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.05)";
      btn.style.boxShadow = "0 6px 16px rgba(0,0,0,0.5)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "scale(1)";
      btn.style.boxShadow = "0 4px 12px rgba(0,0,0,0.4)";
    });

    let countdownInterval = null;

    function showOff() {
      btn.textContent = "🎯 ENCOUNTER OFF";
      btn.style.background = "linear-gradient(135deg, #c62828, #e53935)";
      btn.style.color = "#fff";
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
    }

    function startCountdown() {
      if (countdownInterval) clearInterval(countdownInterval);

      const tick = () => {
        if (!GM_getValue("autoEncounter", false)) {
          showOff();
          return;
        }

        const nextRefresh = GM_getValue("nextRefreshTime", 0);
        const remaining = Math.max(0, nextRefresh - Date.now());
        const min = Math.floor(remaining / 60000);
        const sec = Math.floor((remaining % 60000) / 1000);
        const timeStr = `${min}:${String(sec).padStart(2, "0")}`;

        const lastTime = GM_getValue("lastEncounterTime", 0);
        const elapsed = Date.now() - lastTime;
        const isRetry = elapsed >= THIRTY_MIN;

        if (isRetry) {
          btn.textContent = `🎯 RETRY ${timeStr}`;
          btn.style.background = "linear-gradient(135deg, #E65100, #FF9800)";
        } else {
          btn.textContent = `🎯 ${timeStr}`;
          btn.style.background = "linear-gradient(135deg, #43A047, #66BB6A)";
        }
        btn.style.color = "#fff";

        if (remaining <= 0) {
          location.reload();
        }
      };

      tick();
      countdownInterval = setInterval(tick, 1000);
    }

    function scheduleRefresh(delayMs) {
      GM_setValue("nextRefreshTime", Date.now() + delayMs);
      startCountdown();
    }

    function openEncounter(url) {
      if (!url) return;
      GM_setValue("autoArena", true);
      GM_setValue("lastEncounterTime", Date.now());
      window.open(
        url,
        "_hentaiverse",
        "toolbar=0,scrollbars=0,location=0,statusbar=0,menubar=0,resizable=0,width=1250,height=720,left=" +
          (screen.width - 1250) / 2 +
          ",top=" +
          (screen.height - 720) / 2,
      );
      const pane = document.getElementById("eventpane");
      if (pane) pane.style.display = "none";
      scheduleRefresh(THIRTY_MIN);
    }

    function handlePageLoad() {
      if (hasEncounter()) {
        openEncounter(getEncounterUrl());
      } else {
        const lastTime = GM_getValue("lastEncounterTime", 0);
        const elapsed = Date.now() - lastTime;
        if (elapsed >= THIRTY_MIN) {
          scheduleRefresh(ONE_MIN);
        } else {
          scheduleRefresh(THIRTY_MIN - elapsed);
        }
      }
    }

    btn.addEventListener("click", () => {
      const current = GM_getValue("autoEncounter", false);
      if (current) {
        GM_setValue("autoEncounter", false);
        showOff();
      } else {
        GM_setValue("autoEncounter", true);
        handlePageLoad();
      }
    });

    if (GM_getValue("autoEncounter", false)) {
      handlePageLoad();
    } else {
      showOff();
    }
  }

  function runBattleMode() {
    let battleRunning = false;
    const isInBattle = () => !!document.getElementById("ckey_attack");
    const isVictorious = () =>
      document.body.innerText.substring(0, 500).includes("victorious");
    const isRiddleMaster = () => !!document.getElementById("riddlemaster");

    let audioCtx = null;
    document.addEventListener(
      "click",
      () => {
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } else if (audioCtx.state === "suspended") {
          audioCtx.resume();
        }
      },
      { once: false },
    );

    function playAlertSound() {
      try {
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === "suspended") audioCtx.resume();

        for (let i = 0; i < 5; i++) {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.frequency.value = i % 2 === 0 ? 880 : 660;
          gain.gain.value = 1.0;
          osc.start(audioCtx.currentTime + i * 0.3);
          osc.stop(audioCtx.currentTime + i * 0.3 + 0.2);
        }
      } catch (e) {
        console.error("AutoArena: Web Audio failed", e);
      }

      try {
        const audio = new Audio(
          "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbsGczGj6NwN3PesJPJ4S3zt/FaFhRkLzW3LRiQTaGt9Xdv2xMS4u61NuzZUA7hLXV3bprSEiKu9fcsmZBOoW31d27akdHirvX3LJmQDqEtdXdu2pHR4q719yyZkA6hLXV3btqR0eKu9fcsmZAOoS11d27akdHirvX3LJmQDqEtdXdu2pHR4q719yyZj86g7XV3btqR0eKu9fcsGY+OYO11d27akdHirvX3LBmPjmDtdXdu2pHR4q719ywZj45g7XV3btpR0aJu9fbr2U9OIK01NusZkA6hLXU27xqR0eKutfcsmZAOoS11d27akdH",
        );
        audio.volume = 1.0;
        audio.play().catch(() => {});
      } catch (e) {
        console.error("AutoArena: HTML Audio fallback failed", e);
      }
    }

    let titleFlashInterval = null;
    function flashTitle(msg) {
      const originalTitle = document.title;
      let toggle = true;
      if (titleFlashInterval) clearInterval(titleFlashInterval);
      titleFlashInterval = setInterval(() => {
        document.title = toggle ? `⚠ ${msg} ⚠` : originalTitle;
        toggle = !toggle;
      }, 1000);
      setTimeout(() => {
        clearInterval(titleFlashInterval);
        titleFlashInterval = null;
        document.title = originalTitle;
      }, 60000);
    }

    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission();
    }

    function sendNotification(title, body) {
      try {
        if (Notification.permission === "granted") {
          new Notification(title, { body });
        }
      } catch (e) {
        console.error("AutoArena: Notification failed", e);
      }
    }

    function alertUser(title, body) {
      playAlertSound();
      flashTitle(title);
      sendNotification(title, body);
      if (document.getElementById("autoArenaBtn")) {
        btn.textContent = "🚨 " + title;
        btn.style.background = "linear-gradient(135deg, #FF6F00, #FFA000)";
      }
    }

    function isLastRoundVictory() {
      const btcp = document.getElementById("btcp");
      if (!btcp) return false;
      const onclick = btcp.getAttribute("onclick") || "";
      if (onclick.includes("goto_arena")) return true;
      const img = btcp.querySelector("img");
      if (img && img.src && img.src.includes("finishbattle")) return true;
      return false;
    }

    if (isRiddleMaster() && GM_getValue("autoArena", false)) {
      GM_setValue("autoArena", false);
      setTimeout(() => {
        alertUser("RIDDLE MASTER", "Anti-cheat detected! Answer the riddle!");
      }, 500);
      return;
    }

    const btn = document.createElement("div");
    btn.id = "autoArenaBtn";
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      padding: "10px 18px",
      borderRadius: "24px",
      cursor: "pointer",
      zIndex: "99999",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize: "14px",
      fontWeight: "bold",
      userSelect: "none",
      transition: "all 0.3s ease",
      boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
      border: "2px solid rgba(255,255,255,0.2)",
      letterSpacing: "0.5px",
    });
    document.body.appendChild(btn);

    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.05)";
      btn.style.boxShadow = "0 6px 16px rgba(0,0,0,0.5)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "scale(1)";
      btn.style.boxShadow = "0 4px 12px rgba(0,0,0,0.4)";
    });

    function syncButton() {
      const on = GM_getValue("autoArena", false);
      btn.textContent = on ? "⚔ AUTO ON" : "⚔ AUTO OFF";
      btn.style.background = on
        ? "linear-gradient(135deg, #43A047, #66BB6A)"
        : "linear-gradient(135deg, #c62828, #e53935)";
      btn.style.color = "#fff";
    }

    syncButton();

    function readState() {
      const hp = parseInt(document.getElementById("dvrhd")?.textContent) || 0;
      const mp = parseInt(document.getElementById("dvrm")?.textContent) || 0;
      const sp = parseInt(document.getElementById("dvrs")?.textContent) || 0;
      const oc = parseInt(document.getElementById("dvrc")?.textContent) || 0;
      const hpW =
        parseInt(document.querySelector("#dvbh img")?.style.width) || 1;
      const mpW =
        parseInt(document.querySelector("#dvbm img")?.style.width) || 1;
      const spW =
        parseInt(document.querySelector("#dvbs img")?.style.width) || 1;
      const ocW =
        parseInt(document.querySelector("#dvbc img")?.style.width) || 1;
      const mxHP = Math.round(hp / (hpW / 414));
      const mxMP = Math.round(mp / (mpW / 414));
      const mxSP = Math.round(sp / (spW / 414));
      const mxOC = Math.round(oc / (ocW / 414));

      const alive = [];
      const elites = [];
      for (let i = 1; i <= 50; i++) {
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
        hpP: Math.round((hp / mxHP) * 100),
        mpP: Math.round((mp / mxMP) * 100),
        spP: Math.round((sp / mxSP) * 100),
        ocP: Math.round((oc / mxOC) * 100),
        alive,
        elites,
        buffs,
        spiritActive: spiritSrc.includes("spirit_a"),
        victory: isVictorious(),
      };
    }

    async function useItem(id) {
      if (!document.getElementById(id)) return false;
      document.getElementById("ckey_items")?.click();
      await wait(300);
      document.getElementById(id)?.click();
      await wait(300);
      document.getElementById("ckey_attack")?.click();
      await wait(300);
      return true;
    }

    async function startBattle() {
      if (battleRunning) return;
      battleRunning = true;

      let idleLoops = 0;
      const MAX_IDLE_LOOPS = 10;

      try {
        while (true) {
          if (!GM_getValue("autoArena", false)) break;

          const s = readState();

          if (s.victory) {
            await waitFor(() => document.getElementById("btcp"), 300, 3000);
            if (isLastRoundVictory()) {
              GM_setValue("autoArena", false);
              btn.textContent = "🏆 CLEARED!";
              btn.style.background =
                "linear-gradient(135deg, #FFD600, #FFAB00)";
              btn.style.color = "#333";
              alertUser("CLEARED!", "Arena challenge completed!");
              return;
            }
            await wait(1500);
            unsafeWindow.battle?.battle_continue?.();
            return;
          }

          if (s.alive.length === 0) {
            idleLoops++;
            if (idleLoops >= MAX_IDLE_LOOPS) {
              GM_setValue("autoArena", false);
              alertUser("ANTI-CHEAT", "Intervention required! Battle stalled.");
              return;
            }
            await wait(300);
            continue;
          }

          idleLoops = 0;

          if (s.hpP < 50) {
            document.getElementById("qb3")?.click();
            await wait(300);
            if (readState().hpP < 50) {
              document.getElementById("qb4")?.click();
              await wait(300);
            }
            continue;
          }

          if (s.buffs["Channeling"] && s.buffs["Heartseeker"] !== 999) {
            document.getElementById("qb2")?.click();
            await wait(300);
            continue;
          }

          if (s.mpP < 20) {
            if (await useItem("ikey_4")) continue;
          }

          if (!s.buffs["Regeneration"]) {
            if (await useItem("ikey_1")) continue;
          }

          if (!s.buffs["Replenishment"]) {
            if (await useItem("ikey_2")) continue;
          }

          if (s.spP < 70 && !s.buffs["Refreshment"]) {
            if (await useItem("ikey_5")) continue;
          }

          if ((s.buffs["Regen"] ?? 0) <= 3 && s.buffs["Regen"] !== 999) {
            document.getElementById("qb1")?.click();
            await wait(300);
            continue;
          }

          if (
            (s.buffs["Heartseeker"] ?? 0) <= 3 &&
            s.buffs["Heartseeker"] !== 999
          ) {
            document.getElementById("qb2")?.click();
            await wait(300);
            continue;
          }

          if (s.ocP > 80 && !s.spiritActive && s.alive.length > 0) {
            document.getElementById("ckey_spirit")?.click();
            await wait(300);
            document.getElementById("ckey_attack")?.click();
            await wait(300);
          }

          const target = s.elites.length > 0 ? s.elites[0] : s.alive[0];
          if (target) {
            document.getElementById("mkey_" + target)?.click();
            await wait(300);
          } else {
            await wait(300);
          }
        }
      } catch (e) {
        GM_setValue("autoArena", false);
        alertUser("ERROR", "Script stopped unexpectedly: " + e.message);
        console.error("AutoArena:", e);
      } finally {
        battleRunning = false;
        syncButton();
      }
    }

    btn.addEventListener("click", () => {
      const current = GM_getValue("autoArena", false);
      if (current) {
        GM_setValue("autoArena", false);
        syncButton();
      } else {
        if (!isInBattle()) {
          btn.textContent = "⚠ Not in battle";
          btn.style.background = "linear-gradient(135deg, #E65100, #FF9800)";
          setTimeout(syncButton, 2000);
          return;
        }
        GM_setValue("autoArena", true);
        syncButton();
        startBattle();
      }
    });

    (async () => {
      if (GM_getValue("autoArena", false)) {
        const found = await waitFor(
          () => document.getElementById("ckey_attack"),
          300,
          5000,
        );
        if (found) {
          startBattle();
        } else {
          GM_setValue("autoArena", false);
          syncButton();
          alertUser("STOPPED", "Auto was on but battle lost! Anti-cheat?");
        }
      }
    })();
  }
})();
