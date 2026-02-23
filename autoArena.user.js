// ==UserScript==
// @name         HV Arena Auto Battle
// @namespace    hv-auto-arena
// @version      2.0
// @description  Automate HentaiVerse Arena battles - stops on last round, alerts on anti-cheat
// @match        *://hentaiverse.org/*
// @match        *://www.hentaiverse.org/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  let battleRunning = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const isInBattle = () => !!document.getElementById("ckey_attack");
  const isVictorious = () =>
    document.body.innerText.substring(0, 500).includes("victorious");

  // --- Alert System ---
  function playAlertSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Play 3 loud beeps
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880; // High A note
        gain.gain.value = 0.8;
        osc.start(ctx.currentTime + i * 0.4);
        osc.stop(ctx.currentTime + i * 0.4 + 0.2);
      }
    } catch (e) {
      console.error("AutoArena: Audio alert failed", e);
    }
  }

  function sendNotification(title, body) {
    try {
      if (Notification.permission === "granted") {
        new Notification(title, { body, icon: "https://hentaiverse.org/favicon.ico" });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((p) => {
          if (p === "granted") {
            new Notification(title, { body, icon: "https://hentaiverse.org/favicon.ico" });
          }
        });
      }
    } catch (e) {
      console.error("AutoArena: Notification failed", e);
    }
  }

  function alertUser(title, body) {
    playAlertSound();
    sendNotification(title, body);
    // Also flash the button
    btn.textContent = "🚨 " + title;
    btn.style.background = "linear-gradient(135deg, #FF6F00, #FFA000)";
    // Keep flashing
    let flash = true;
    const flashInterval = setInterval(() => {
      btn.style.background = flash
        ? "linear-gradient(135deg, #FF6F00, #FFA000)"
        : "linear-gradient(135deg, #c62828, #e53935)";
      flash = !flash;
    }, 500);
    // Stop flashing after 30 seconds
    setTimeout(() => clearInterval(flashInterval), 30000);
  }

  // --- Last Round Detection ---
  function isLastRoundVictory() {
    const btcp = document.getElementById("btcp");
    if (!btcp) return false;
    // On last round: onclick="common.goto_arena()" and image is finishbattle.png
    // On intermediate: onclick="battle.battle_continue()" and image is arenacontinue.png
    const onclick = btcp.getAttribute("onclick") || "";
    if (onclick.includes("goto_arena")) return true;
    const img = btcp.querySelector("img");
    if (img && img.src && img.src.includes("finishbattle")) return true;
    return false;
  }

  // --- UI Button ---
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

  // Request notification permission early
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission();
  }

  function readState() {
    const hp = parseInt(document.getElementById("dvrhd")?.textContent) || 0;
    const mp = parseInt(document.getElementById("dvrm")?.textContent) || 0;
    const sp = parseInt(document.getElementById("dvrs")?.textContent) || 0;
    const oc = parseInt(document.getElementById("dvrc")?.textContent) || 0;
    const hpW = parseInt(document.querySelector("#dvbh img")?.style.width) || 1;
    const mpW = parseInt(document.querySelector("#dvbm img")?.style.width) || 1;
    const spW = parseInt(document.querySelector("#dvbs img")?.style.width) || 1;
    const ocW = parseInt(document.querySelector("#dvbc img")?.style.width) || 1;
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
    await wait(500);
    document.getElementById(id)?.click();
    await wait(500);
    document.getElementById("ckey_attack")?.click();
    await wait(300);
    return true;
  }

  async function startBattle() {
    if (battleRunning) return;
    battleRunning = true;

    // Track consecutive idle loops for anti-cheat detection
    let idleLoops = 0;
    const MAX_IDLE_LOOPS = 60; // ~30 seconds of alive=0 without victory

    try {
      while (true) {
        if (!GM_getValue("autoArena", false)) break;

        const s = readState();

        if (s.victory) {
          // Check if this is the LAST round
          await wait(1000); // Wait for victory popup to fully render
          if (isLastRoundVictory()) {
            // Last round - STOP, don't continue
            GM_setValue("autoArena", false);
            btn.textContent = "🏆 CLEARED!";
            btn.style.background = "linear-gradient(135deg, #FFD600, #FFAB00)";
            btn.style.color = "#333";
            alertUser("CLEARED!", "Arena challenge completed!");
            return;
          }
          // Intermediate round - continue to next wave
          await wait(2000);
          unsafeWindow.battle?.battle_continue?.();
          return;
        }

        if (s.alive.length === 0) {
          idleLoops++;
          // Anti-cheat detection: too many idle loops without victory
          // This likely means an overlay/captcha appeared
          if (idleLoops >= MAX_IDLE_LOOPS) {
            GM_setValue("autoArena", false);
            alertUser("ANTI-CHEAT", "Intervention required! Battle stalled.");
            return;
          }
          await wait(500);
          continue;
        }

        // Reset idle counter when monsters are alive (normal combat)
        idleLoops = 0;

        if (s.hpP < 50) {
          document.getElementById("qb3")?.click();
          await wait(500);
          if (readState().hpP < 50) {
            document.getElementById("qb4")?.click();
            await wait(500);
          }
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
          await wait(500);
          continue;
        }

        if (
          (s.buffs["Heartseeker"] ?? 0) <= 3 &&
          s.buffs["Heartseeker"] !== 999
        ) {
          document.getElementById("qb2")?.click();
          await wait(500);
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
          await wait(500);
        } else {
          await wait(500);
        }
      }
    } catch (e) {
      GM_setValue("autoArena", false);
      // Unexpected error - could be anti-cheat or DOM change
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

  setTimeout(() => {
    if (GM_getValue("autoArena", false)) {
      if (isInBattle()) {
        startBattle();
      } else {
        GM_setValue("autoArena", false);
        syncButton();
      }
    }
  }, 1500);
})();
