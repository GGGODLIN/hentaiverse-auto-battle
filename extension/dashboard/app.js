const TOGGLE_LABELS = {
  qb3: "Heal 1 (qb3)",
  qb4: "Heal 2 (qb4)",
  ikey3: "Health Potion",
  qb1: "Regen (qb1)",
  qb2: "Heartseeker (qb2)",
  qb7: "Attack 1 (qb7)",
  qb8: "Attack 2 (qb8)",
  qb9: "Attack 3 (qb9)",
  ofc: "OFC (AoE)",
  ikey1: "Health Draught",
  ikey2: "Mana Draught",
  ikey4: "Mana Potion",
  ikey5: "Spirit Draught",
  ikey6: "SP Potion",
  ikey7: "Health Elixir",
  ikey8: "Mana Elixir",
  ikey9: "Spirit Elixir",
  ikeyP: "Pickup Item",
  spirit: "Spirit Stance",
  sparkOfLife: "Spark of Life",
};

const TOGGLE_ORDER = [
  "qb3", "qb4", "ikey3", "qb1", "qb2",
  "ikey1", "ikey2", "ikey4", "ikey5", "ikey6",
  "ikey7", "ikey8", "ikey9", "ikeyP",
  "spirit", "qb7", "qb8", "qb9", "ofc", "sparkOfLife",
];

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

const THRESHOLDS = [
  { key: "hpThreshold", label: "HP Heal" },
  { key: "mpThreshold", label: "MP Potion" },
  { key: "spThreshold", label: "SP Draught" },
  { key: "spPotThreshold", label: "SP Potion" },
  { key: "ocThreshold", label: "OC Spirit" },
];

const RESET_HOUR = 8;

let state = {};

async function loadState() {
  state = await chrome.storage.local.get(null);
}

function getToggles() {
  return { ...DEFAULT_TOGGLES, ...(state.battleToggles ?? {}) };
}

function setToggle(key, value) {
  const toggles = getToggles();
  toggles[key] = value;
  state.battleToggles = toggles;
  chrome.storage.local.set({ battleToggles: toggles });
}

function getGameDay() {
  const now = new Date();
  const d = new Date(now);
  if (d.getHours() < RESET_HOUR) d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function updateResetTimer() {
  const now = new Date();
  const reset = new Date(now);
  reset.setHours(RESET_HOUR, 0, 0, 0);
  if (now >= reset) reset.setDate(reset.getDate() + 1);
  const diff = reset - now;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  document.getElementById("resetTimer").textContent =
    "Daily reset in " + h + "h " + m + "m | " + getGameDay();
}

function renderControls() {
  const btnArena = document.getElementById("btnArenaSweep");
  const arenaOn = state.arenaSweepEnabled ?? false;
  btnArena.textContent = arenaOn ? "ON" : "OFF";
  btnArena.className = "toggle-btn " + (arenaOn ? "on" : "off");

  const btnEnc = document.getElementById("btnEncounter");
  const encOn = state.encounterEnabled ?? false;
  btnEnc.textContent = encOn ? "ON" : "OFF";
  btnEnc.className = "toggle-btn " + (encOn ? "on" : "off");

  const btnUna = document.getElementById("btnUnattended");
  const unaOn = state.unattendedMode ?? false;
  btnUna.textContent = unaOn ? "ON" : "OFF";
  btnUna.className = "toggle-btn " + (unaOn ? "on" : "off");

  const statusEl = document.getElementById("currentStatus");
  const lastStatus = state.lastBattleStatus;
  if (lastStatus) {
    const icons = { victory: "🏆", defeated: "💀", alert: "🚨", reload: "🔄", continue: "⏩", system: "ℹ️" };
    statusEl.textContent = (icons[lastStatus.type] ?? "❓") + " " +
      lastStatus.reason + " (" + lastStatus.time + ")";
  }
}

function renderArenaProgress() {
  const grid = document.getElementById("arenaGrid");
  grid.innerHTML = "";
  const difficulties = state.arenaDifficulties ?? [];
  const progress = state.arenaSweepProgress ?? {};

  if (difficulties.length === 0) {
    grid.innerHTML = '<div style="color:#666;font-size:13px;">No arena data yet. Start a sweep to load difficulties.</div>';
    return;
  }

  for (const d of difficulties) {
    const status = progress[d.id] ?? "pending";
    const item = document.createElement("div");
    item.className = "arena-item " + status;

    const statusIcons = {
      pending: "⬜", in_progress: "🔵", completed: "✅", failed: "❌", skipped: "⏭",
    };

    item.innerHTML =
      '<div class="diff-level">Lv.' + d.level + '</div>' +
      '<div class="diff-id">ID: ' + d.id + '</div>' +
      '<div class="diff-status">' + (statusIcons[status] ?? "") + " " + status + '</div>';
    grid.appendChild(item);
  }
}

function renderStats() {
  const stats = state.dailyStats ?? {};
  document.getElementById("statArenaWins").textContent = stats.arenaWins ?? 0;
  document.getElementById("statArenaLosses").textContent = stats.arenaLosses ?? 0;
  document.getElementById("statEncounters").textContent = stats.encounterCount ?? 0;
  document.getElementById("statStamina").textContent = state.currentStamina ?? "--";
  const rmVal = state.riddleMasterRemaining;
  const rmEl = document.getElementById("statRiddle");
  rmEl.textContent = rmVal ?? "--";
  rmEl.style.color = (rmVal != null && rmVal <= 3) ? "#EF5350" : "#fff";
}

function renderToggles() {
  const grid = document.getElementById("toggleGrid");
  grid.innerHTML = "";
  const t = getToggles();

  for (const key of TOGGLE_ORDER) {
    const row = document.createElement("div");
    row.className = "toggle-row" + (t[key] ? "" : " disabled");
    row.innerHTML =
      '<span>' + TOGGLE_LABELS[key] + '</span>' +
      '<span class="dot">' + (t[key] ? "🟢" : "🔴") + '</span>';
    row.addEventListener("click", () => {
      setToggle(key, !t[key]);
      renderToggles();
    });
    grid.appendChild(row);
  }
}

function renderThresholds() {
  const list = document.getElementById("thresholdList");
  list.innerHTML = "";
  const t = getToggles();

  for (const { key, label } of THRESHOLDS) {
    const row = document.createElement("div");
    row.className = "threshold-row";

    const val = t[key] ?? DEFAULT_TOGGLES[key];
    row.innerHTML =
      '<span>' + label + '</span>' +
      '<div class="threshold-ctrl">' +
        '<span class="minus">−</span>' +
        '<span class="threshold-val">' + val + '%</span>' +
        '<span class="plus">+</span>' +
      '</div>';

    row.querySelector(".minus").addEventListener("click", () => {
      setToggle(key, Math.max(0, val - 5));
      renderThresholds();
    });
    row.querySelector(".plus").addEventListener("click", () => {
      setToggle(key, Math.min(100, val + 5));
      renderThresholds();
    });
    list.appendChild(row);
  }
}

function renderStrategy() {
  const section = document.getElementById("strategySection");
  section.innerHTML = "";
  const t = getToggles();

  const channelRow = document.createElement("div");
  channelRow.className = "strategy-row";
  channelRow.innerHTML =
    '<span>Channeling</span><span class="strategy-value">' + (t.channelingSkill ?? "qb2") + '</span>';
  const skillOptions = ["qb1", "qb2", "qb3", "qb4"];
  channelRow.addEventListener("click", () => {
    const cur = t.channelingSkill ?? "qb2";
    const idx = skillOptions.indexOf(cur);
    setToggle("channelingSkill", skillOptions[(idx + 1) % skillOptions.length]);
    renderStrategy();
  });
  section.appendChild(channelRow);

  const stratRow = document.createElement("div");
  stratRow.className = "strategy-row";
  const strat = t.targetStrategy ?? "focus";
  stratRow.innerHTML =
    '<span>Target</span><span class="strategy-value">' +
    (strat === "focus" ? "🎯 Focus" : "🔄 Spread") + '</span>';
  stratRow.addEventListener("click", () => {
    setToggle("targetStrategy", strat === "focus" ? "spread" : "focus");
    renderStrategy();
  });
  section.appendChild(stratRow);

  const prioRow = document.createElement("div");
  prioRow.className = "general-row";
  prioRow.innerHTML = '<span>Priority Targets</span>';
  const prioInput = document.createElement("input");
  prioInput.type = "text";
  prioInput.value = t.priorityTargets ?? "";
  prioInput.placeholder = "e.g. Yggdrasil,Healer";
  prioInput.style.width = "160px";
  prioInput.addEventListener("change", () => {
    setToggle("priorityTargets", prioInput.value);
  });
  prioRow.appendChild(prioInput);
  section.appendChild(prioRow);
}

function renderGeneralSettings() {
  const section = document.getElementById("generalSettings");
  section.innerHTML = "";
  const t = getToggles();

  const delayRow = document.createElement("div");
  delayRow.className = "general-row";
  delayRow.innerHTML = '<span>Action Delay</span>';
  const delayInput = document.createElement("input");
  delayInput.type = "number";
  delayInput.min = "300";
  delayInput.step = "50";
  delayInput.value = t.actionDelay ?? 300;
  delayInput.addEventListener("change", () => {
    const val = Math.max(300, parseInt(delayInput.value) || 300);
    delayInput.value = val;
    setToggle("actionDelay", val);
  });
  const msLabel = document.createElement("span");
  msLabel.textContent = "ms";
  msLabel.style.fontSize = "11px";
  msLabel.style.color = "#666";
  delayRow.appendChild(delayInput);
  delayRow.appendChild(msLabel);
  section.appendChild(delayRow);

  const staminaRow = document.createElement("div");
  staminaRow.className = "general-row";
  staminaRow.innerHTML = '<span>Stamina Threshold</span>';
  const staminaInput = document.createElement("input");
  staminaInput.type = "number";
  staminaInput.min = "0";
  staminaInput.value = state.staminaThreshold ?? 10;
  staminaInput.addEventListener("change", () => {
    const val = Math.max(0, parseInt(staminaInput.value) || 10);
    staminaInput.value = val;
    state.staminaThreshold = val;
    chrome.storage.local.set({ staminaThreshold: val });
  });
  staminaRow.appendChild(staminaInput);
  section.appendChild(staminaRow);

  const rmRow = document.createElement("div");
  rmRow.className = "general-row";
  rmRow.innerHTML = '<span>RM API Key</span>';
  const rmInput = document.createElement("input");
  rmInput.type = "text";
  rmInput.value = state.rmApiKey ?? "";
  rmInput.placeholder = "optional";
  rmInput.style.width = "160px";
  rmInput.addEventListener("change", () => {
    state.rmApiKey = rmInput.value;
    chrome.storage.local.set({ rmApiKey: rmInput.value });
  });
  rmRow.appendChild(rmInput);
  section.appendChild(rmRow);

  const retryRow = document.createElement("div");
  retryRow.className = "general-row";
  const retryBtn = document.createElement("button");
  retryBtn.textContent = "🔄 Retry Battle";
  Object.assign(retryBtn.style, {
    padding: "6px 16px",
    fontSize: "12px",
    cursor: "pointer",
    background: "#1976D2",
    color: "white",
    border: "none",
    borderRadius: "6px",
  });
  retryBtn.addEventListener("click", () => {
    chrome.storage.local.set({ autoArena: true, alertRetryCount: 0 });
    const tabId = state.arenaTabId;
    if (tabId) chrome.tabs.reload(tabId);
    retryBtn.textContent = "✓ Retrying...";
    setTimeout(() => { retryBtn.textContent = "🔄 Retry Battle"; }, 2000);
  });
  retryRow.appendChild(retryBtn);
  section.appendChild(retryRow);
}

function renderLog() {
  const logEl = document.getElementById("battleLog");
  const logs = state.battleLog ?? [];
  logEl.innerHTML = "";
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i];
    const div = document.createElement("div");
    div.className = "log-entry " + (entry.type ?? "system");
    div.textContent = "[" + entry.time + "] " + entry.reason;
    logEl.appendChild(div);
  }
}

function renderAll() {
  updateResetTimer();
  renderControls();
  renderArenaProgress();
  renderStats();
  renderToggles();
  renderThresholds();
  renderStrategy();
  renderGeneralSettings();
  renderLog();
}

document.getElementById("btnArenaSweep").addEventListener("click", async () => {
  const current = state.arenaSweepEnabled ?? false;
  const next = !current;
  state.arenaSweepEnabled = next;
  chrome.runtime.sendMessage({ type: "SET_ARENA_SWEEP", enabled: next });
  renderControls();
});

document.getElementById("btnEncounter").addEventListener("click", async () => {
  const current = state.encounterEnabled ?? false;
  const next = !current;
  state.encounterEnabled = next;
  chrome.runtime.sendMessage({ type: "SET_ENCOUNTER", enabled: next });
  renderControls();
});

document.getElementById("btnUnattended").addEventListener("click", () => {
  const next = !(state.unattendedMode ?? false);
  state.unattendedMode = next;
  chrome.storage.local.set({ unattendedMode: next });
  renderControls();
});

chrome.storage.onChanged.addListener((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) {
    state[key] = newValue;
  }
  renderAll();
});

setInterval(updateResetTimer, 60000);

(async () => {
  await loadState();
  renderAll();
})();
