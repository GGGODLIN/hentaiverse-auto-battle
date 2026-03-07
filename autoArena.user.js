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

    function playAlertSound(isUrgent = false) {
      try {
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === "suspended") audioCtx.resume();
        if (isUrgent) {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.type = "square";
          for (let i = 0; i < 10; i++) {
            osc.frequency.setValueAtTime(1200, audioCtx.currentTime + i * 0.4);
            osc.frequency.setValueAtTime(
              800,
              audioCtx.currentTime + i * 0.4 + 0.2,
            );
          }
          gain.gain.setValueAtTime(1.0, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(
            0.01,
            audioCtx.currentTime + 4,
          );
          osc.start(audioCtx.currentTime);
          osc.stop(audioCtx.currentTime + 4);
        } else {
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
        }
      } catch (e) {
        console.error("AutoArena: Web Audio failed", e);
      }
    }

    let battlePollInterval = null;

    function startBattlePoll() {
      if (battlePollInterval) clearInterval(battlePollInterval);
      battlePollInterval = setInterval(() => {
        if (!GM_getValue("autoArena", false)) {
          clearInterval(battlePollInterval);
          battlePollInterval = null;
          const reason = GM_getValue("battleStopReason", "");
          playAlertSound(reason === "urgent");
          GM_setValue("battleStopReason", "");
        }
      }, 3000);
    }

    function openEncounter(url) {
      if (!url) return;
      GM_setValue("autoArena", true);
      GM_setValue("battleStopReason", "");
      GM_setValue("lastEncounterTime", Date.now());
      window.open(url, "_blank");
      const pane = document.getElementById("eventpane");
      if (pane) pane.style.display = "none";
      startBattlePoll();
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

    function playAlertSound(isUrgent = false) {
      try {
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === "suspended") audioCtx.resume();

        if (isUrgent) {
          // Siren sound for urgent alerts (e.g. Anti-Cheat)
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.connect(gain);
          gain.connect(audioCtx.destination);

          osc.type = "square";
          osc.frequency.setValueAtTime(880, audioCtx.currentTime);

          for (let i = 0; i < 10; i++) {
            osc.frequency.setValueAtTime(1200, audioCtx.currentTime + i * 0.4);
            osc.frequency.setValueAtTime(
              800,
              audioCtx.currentTime + i * 0.4 + 0.2,
            );
          }

          gain.gain.setValueAtTime(1.0, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(
            0.01,
            audioCtx.currentTime + 4,
          );

          osc.start(audioCtx.currentTime);
          osc.stop(audioCtx.currentTime + 4);
        } else {
          // Standard beep for normal stops (e.g. Low HP, Spark Lost)
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
        }
      } catch (e) {
        console.error("AutoArena: Web Audio failed", e);
      }

      try {
        if (!isUrgent) {
          const audio = new Audio(
            "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbsGczGj6NwN3PesJPJ4S3zt/FaFhRkLzW3LRiQTaGt9Xdv2xMS4u61NuzZUA7hLXV3bprSEiKu9fcsmZBOoW31d27akdHirvX3LJmQDqEtdXdu2pHR4q719yyZkA6hLXV3btqR0eKu9fcsmZAOoS11d27akdHirvX3LJmQDqEtdXdu2pHR4q719yyZj86g7XV3btqR0eKu9fcsGY+OYO11d27akdHirvX3LBmPjmDtdXdu2pHR4q719ywZj45g7XV3btpR0aJu9fbr2U9OIK01NusZkA6hLXU27xqR0eKutfcsmZAOoS11d27akdH",
          );
          audio.volume = 1.0;
          audio.play().catch(() => {});
        }
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

    function alertUser(title, body, isUrgent = false) {
      if (isUrgent) GM_setValue("battleStopReason", "urgent");
      playAlertSound(isUrgent);
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
        alertUser(
          "RIDDLE MASTER",
          "Anti-cheat detected! Answer the riddle!",
          true,
        );
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

    const DEFAULT_TOGGLES = {
      qb1: true,
      qb2: true,
      qb3: true,
      qb4: true,
      spirit: true,
      qb7: true,
      qb8: true,
      qb9: true,
      ikey1: true,
      ikey2: true,
      ikey3: true,
      ikey4: true,
      ikey5: true,
      ikeyP: true,
      sparkOfLife: false,
      hpThreshold: 50,
      mpThreshold: 30,
      spThreshold: 70,
      ocThreshold: 80,
      channelingSkill: "qb2",
      targetStrategy: "focus",
    };
    const TOGGLE_LABELS = {
      qb3: "Heal 1 (qb3)",
      qb4: "Heal 2 (qb4)",
      ikey3: "Health Potion",
      qb1: "Regen (qb1)",
      qb2: "Heartseeker (qb2)",
      qb7: "Attack 1 (qb7)",
      qb8: "Attack 2 (qb8)",
      qb9: "Attack 3 (qb9)",
      ikey1: "Health Draught",
      ikey2: "Mana Draught",
      ikey4: "Mana Potion",
      ikey5: "Spirit Draught",
      ikeyP: "Pickup Item",
      spirit: "Spirit Stance",
      sparkOfLife: "Spark of Life",
    };
    const TOGGLE_ORDER = [
      "qb3",
      "qb4",
      "ikey3",
      "qb1",
      "qb2",
      "ikey1",
      "ikey2",
      "ikey4",
      "ikey5",
      "ikeyP",
      "spirit",
      "qb7",
      "qb8",
      "qb9",
      "sparkOfLife",
    ];

    const isIsekai = !document.getElementById("dvrhd");
    const profileKey = isIsekai
      ? "battleToggles_isekai"
      : "battleToggles_normal";
    const profileLabel = isIsekai ? "Isekai" : "Normal";

    function getToggles() {
      const saved = GM_getValue(profileKey, {});
      return { ...DEFAULT_TOGGLES, ...saved };
    }

    function setToggle(key, val) {
      const t = getToggles();
      t[key] = val;
      GM_setValue(profileKey, t);
    }

    const gearBtn = document.createElement("div");
    Object.assign(gearBtn.style, {
      position: "fixed",
      bottom: "20px",
      right: "160px",
      padding: "10px 14px",
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
      background: "linear-gradient(135deg, #37474F, #546E7A)",
      color: "#fff",
    });
    gearBtn.textContent = "\u2699";
    document.body.appendChild(gearBtn);

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed",
      bottom: "60px",
      right: "20px",
      padding: "12px 16px",
      borderRadius: "12px",
      zIndex: "99998",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      fontSize: "13px",
      background: "rgba(30, 30, 30, 0.95)",
      color: "#fff",
      boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
      border: "1px solid rgba(255,255,255,0.15)",
      display: "none",
      minWidth: "180px",
    });
    document.body.appendChild(panel);

    function renderPanel() {
      const t = getToggles();
      panel.innerHTML = "";

      const header = document.createElement("div");
      Object.assign(header.style, {
        fontSize: "11px",
        opacity: "0.6",
        marginBottom: "6px",
        borderBottom: "1px solid rgba(255,255,255,0.15)",
        paddingBottom: "4px",
      });
      header.textContent = "\uD83C\uDFAE " + profileLabel + " Profile";
      panel.appendChild(header);

      TOGGLE_ORDER.forEach((key) => {
        const row = document.createElement("div");
        Object.assign(row.style, {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "4px 0",
          cursor: "pointer",
          userSelect: "none",
        });
        const label = document.createElement("span");
        label.textContent = TOGGLE_LABELS[key];
        label.style.opacity = t[key] ? "1" : "0.4";
        const dot = document.createElement("span");
        dot.textContent = t[key] ? "\uD83D\uDFE2" : "\uD83D\uDD34";
        dot.style.fontSize = "10px";
        dot.style.marginLeft = "8px";
        row.appendChild(label);
        row.appendChild(dot);
        row.addEventListener("click", () => {
          setToggle(key, !t[key]);
          renderPanel();
        });
        panel.appendChild(row);
      });

      const sep1 = document.createElement("div");
      Object.assign(sep1.style, {
        borderTop: "1px solid rgba(255,255,255,0.15)",
        marginTop: "6px",
        paddingTop: "6px",
        fontSize: "11px",
        opacity: "0.6",
      });
      sep1.textContent = "Thresholds";
      panel.appendChild(sep1);

      const thresholds = [
        { key: "hpThreshold", label: "HP Heal" },
        { key: "mpThreshold", label: "MP Potion" },
        { key: "spThreshold", label: "SP Draught" },
        { key: "ocThreshold", label: "OC Spirit" },
      ];
      thresholds.forEach(({ key, label }) => {
        const row = document.createElement("div");
        Object.assign(row.style, {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "4px 0",
          userSelect: "none",
        });
        const lbl = document.createElement("span");
        lbl.textContent = label;
        const ctrl = document.createElement("span");
        Object.assign(ctrl.style, {
          display: "flex",
          alignItems: "center",
          gap: "6px",
        });
        const minus = document.createElement("span");
        minus.textContent = "-";
        minus.style.cursor = "pointer";
        minus.style.padding = "0 4px";
        minus.addEventListener("click", () => {
          setToggle(key, Math.max(0, (t[key] ?? DEFAULT_TOGGLES[key]) - 5));
          renderPanel();
        });
        const val = document.createElement("span");
        val.textContent = (t[key] ?? DEFAULT_TOGGLES[key]) + "%";
        val.style.minWidth = "32px";
        val.style.textAlign = "center";
        const plus = document.createElement("span");
        plus.textContent = "+";
        plus.style.cursor = "pointer";
        plus.style.padding = "0 4px";
        plus.addEventListener("click", () => {
          setToggle(key, Math.min(100, (t[key] ?? DEFAULT_TOGGLES[key]) + 5));
          renderPanel();
        });
        ctrl.appendChild(minus);
        ctrl.appendChild(val);
        ctrl.appendChild(plus);
        row.appendChild(lbl);
        row.appendChild(ctrl);
        panel.appendChild(row);
      });

      const sep2 = document.createElement("div");
      Object.assign(sep2.style, {
        borderTop: "1px solid rgba(255,255,255,0.15)",
        marginTop: "6px",
        paddingTop: "6px",
      });
      const chRow = document.createElement("div");
      Object.assign(chRow.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        cursor: "pointer",
        userSelect: "none",
      });
      const chLabel = document.createElement("span");
      chLabel.textContent = "Channeling";
      const chVal = document.createElement("span");
      chVal.textContent = t.channelingSkill ?? "qb2";
      chVal.style.opacity = "0.8";
      chRow.appendChild(chLabel);
      chRow.appendChild(chVal);
      const skillOptions = ["qb1", "qb2", "qb3", "qb4"];
      chRow.addEventListener("click", () => {
        const cur = t.channelingSkill ?? "qb2";
        const idx = skillOptions.indexOf(cur);
        setToggle(
          "channelingSkill",
          skillOptions[(idx + 1) % skillOptions.length],
        );
        renderPanel();
      });
      sep2.appendChild(chRow);

      const stratRow = document.createElement("div");
      Object.assign(stratRow.style, {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        cursor: "pointer",
        userSelect: "none",
        marginTop: "4px",
      });
      const stratLabel = document.createElement("span");
      stratLabel.textContent = "Target";
      const stratVal = document.createElement("span");
      const strat = t.targetStrategy ?? "focus";
      stratVal.textContent = strat === "focus" ? "🎯 Focus" : "🔄 Spread";
      stratVal.style.opacity = "0.8";
      stratRow.appendChild(stratLabel);
      stratRow.appendChild(stratVal);
      stratRow.addEventListener("click", () => {
        setToggle("targetStrategy", strat === "focus" ? "spread" : "focus");
        renderPanel();
      });
      sep2.appendChild(stratRow);
      panel.appendChild(sep2);

      const sepSound = document.createElement("div");
      Object.assign(sepSound.style, {
        borderTop: "1px solid rgba(255,255,255,0.15)",
        marginTop: "8px",
        paddingTop: "8px",
        display: "flex",
        justifyContent: "space-between",
        gap: "8px",
      });
      const btnNormal = document.createElement("button");
      btnNormal.textContent = "🔊 Normal";
      Object.assign(btnNormal.style, {
        flex: 1,
        padding: "4px",
        fontSize: "11px",
        cursor: "pointer",
        background: "#43A047",
        color: "white",
        border: "none",
        borderRadius: "4px",
      });
      btnNormal.onclick = () => playAlertSound(false);

      const btnUrgent = document.createElement("button");
      btnUrgent.textContent = "🚨 Urgent";
      Object.assign(btnUrgent.style, {
        flex: 1,
        padding: "4px",
        fontSize: "11px",
        cursor: "pointer",
        background: "#E53935",
        color: "white",
        border: "none",
        borderRadius: "4px",
      });
      btnUrgent.onclick = () => playAlertSound(true);

      sepSound.appendChild(btnNormal);
      sepSound.appendChild(btnUrgent);
      panel.appendChild(sepSound);
    }

    gearBtn.addEventListener("click", () => {
      const visible = panel.style.display !== "none";
      panel.style.display = visible ? "none" : "block";
      if (!visible) renderPanel();
    });

    function readState() {
      const hpW =
        parseInt(document.querySelector("#dvbh img")?.style.width) || 1;
      const mpW =
        parseInt(document.querySelector("#dvbm img")?.style.width) || 1;
      const spW =
        parseInt(document.querySelector("#dvbs img")?.style.width) || 1;
      const ocW =
        parseInt(document.querySelector("#dvbc img")?.style.width) || 1;

      const isIsekai = !document.getElementById("dvrhd");
      let hpP, mpP, spP, ocP;

      if (isIsekai) {
        hpP = Math.round((hpW / 414) * 100);
        mpP = Math.round((mpW / 414) * 100);
        spP = Math.round((spW / 414) * 100);
        ocP = Math.round((ocW / 414) * 100);
      } else {
        const hp = parseInt(document.getElementById("dvrhd").textContent) || 0;
        const mp = parseInt(document.getElementById("dvrm").textContent) || 0;
        const sp = parseInt(document.getElementById("dvrs").textContent) || 0;
        const oc = parseInt(document.getElementById("dvrc").textContent) || 0;
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
        hpP,
        mpP,
        spP,
        ocP,
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
              alertUser(
                "ANTI-CHEAT",
                "Intervention required! RiddleMaster detected.",
                true,
              );
              return;
            }
            await wait(300);
            continue;
          }

          idleLoops = 0;

          const t = getToggles();

          if (t.sparkOfLife) {
            const hpBarSrc =
              document.querySelector("#dvbh img")?.getAttribute("src") ?? "";
            const sparkBuffGone = !s.buffs["Spark of Life"];
            const sparkBarGone =
              hpBarSrc.includes("bar_") && !hpBarSrc.includes("dgreen");
            if (sparkBuffGone || sparkBarGone) {
              GM_setValue("autoArena", false);
              alertUser("SPARK LOST", "Spark of Life disappeared!");
              return;
            }
          }

          if (s.hpP < (t.hpThreshold ?? 50) && (t.qb3 || t.qb4 || t.ikey3)) {
            if (t.qb3) {
              document.getElementById("qb3")?.click();
              await wait(300);
            }
            if (readState().hpP < (t.hpThreshold ?? 50) && t.qb4) {
              document.getElementById("qb4")?.click();
              await wait(300);
            }
            if (readState().hpP < (t.hpThreshold ?? 50) && t.ikey3) {
              await useItem("ikey_3");
            }
            const qb3OnCd = !t.qb3 || !document.getElementById("qb3");
            const qb4OnCd = !t.qb4 || !document.getElementById("qb4");
            const ikey3OnCd = !t.ikey3 || !document.getElementById("ikey_3");
            if (
              readState().hpP < (t.hpThreshold ?? 50) &&
              qb3OnCd &&
              qb4OnCd &&
              ikey3OnCd
            ) {
              GM_setValue("autoArena", false);
              alertUser(
                "LOW HP",
                "All heals on CD! Manual intervention needed.",
              );
              return;
            }
            if (readState().hpP >= (t.hpThreshold ?? 50)) continue;
          }

          if (s.buffs["Channeling"]) {
            const chSkill = t.channelingSkill ?? "qb2";
            if (t[chSkill] && document.getElementById(chSkill)) {
              document.getElementById(chSkill).click();
              await wait(300);
              continue;
            }
          }

          if (t.ikeyP && document.getElementById("ikey_p")) {
            if (await useItem("ikey_p")) continue;
          }

          if (t.ikey4 && s.mpP < (t.mpThreshold ?? 30)) {
            if (await useItem("ikey_4")) continue;
          }

          if (t.ikey1 && !s.buffs["Regeneration"]) {
            if (await useItem("ikey_1")) continue;
          }

          if (t.ikey2 && !s.buffs["Replenishment"]) {
            if (await useItem("ikey_2")) continue;
          }

          if (
            t.ikey5 &&
            s.spP < (t.spThreshold ?? 70) &&
            !s.buffs["Refreshment"]
          ) {
            if (await useItem("ikey_5")) continue;
          }

          if (
            t.qb1 &&
            (s.buffs["Regen"] ?? 0) <= 3 &&
            s.buffs["Regen"] !== 999 &&
            document.getElementById("qb1")
          ) {
            document.getElementById("qb1").click();
            await wait(300);
            continue;
          }

          if (
            t.qb2 &&
            (s.buffs["Heartseeker"] ?? 0) <= 3 &&
            s.buffs["Heartseeker"] !== 999 &&
            document.getElementById("qb2")
          ) {
            document.getElementById("qb2").click();
            await wait(300);
            continue;
          }

          if (
            t.spirit &&
            s.ocP > (t.ocThreshold ?? 80) &&
            !s.spiritActive &&
            s.alive.length > 0
          ) {
            document.getElementById("ckey_spirit")?.click();
            await wait(300);
            document.getElementById("ckey_attack")?.click();
            await wait(300);
          }

          function getHighestHpTarget(monsters) {
            let best = monsters[0];
            let bestHp = 0;
            for (const i of monsters) {
              const m = document.getElementById("mkey_" + i);
              const hpImg = m?.querySelector('.chbd img[alt="health"]');
              const hpW = parseInt(hpImg?.style.width) || 0;
              if (hpW > bestHp) {
                bestHp = hpW;
                best = i;
              }
            }
            return best;
          }

          const isSpread = (t.targetStrategy ?? "focus") === "spread";
          const normalTarget = isSpread
            ? getHighestHpTarget(s.alive)
            : s.elites.length > 0
              ? s.elites[0]
              : s.alive[0];
          if (normalTarget != null) {
            let usedSkill = false;
            for (const qb of ["qb7", "qb8", "qb9"]) {
              if (t[qb] && document.getElementById(qb)) {
                const skillTarget = isSpread
                  ? getHighestHpTarget(s.alive)
                  : s.elites.length > 0
                    ? s.elites[0]
                    : getHighestHpTarget(s.alive);
                document.getElementById(qb).click();
                await wait(300);
                document.getElementById("mkey_" + skillTarget)?.click();
                await wait(300);
                usedSkill = true;
                break;
              }
            }
            if (!usedSkill) {
              document.getElementById("mkey_" + normalTarget)?.click();
              await wait(300);
            }
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
          alertUser(
            "STOPPED",
            "Auto was on but battle lost! Anti-cheat?",
            true,
          );
        }
      }
    })();
  }
})();
