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

const REPLENISH_ITEMS = [
  { id: '11191', name: '体力长效药' },
  { id: '11195', name: '体力药水' },
  { id: '11199', name: '终极体力药' },
  { id: '11291', name: '法力长效药' },
  { id: '11295', name: '法力药水' },
  { id: '11299', name: '终极法力药' },
  { id: '11391', name: '灵力长效药' },
  { id: '11395', name: '灵力药水' },
  { id: '11399', name: '终极灵力药' },
];

const DEFAULT_REPLENISH_CONFIG = {
  '11191': { low: 500, target: 600 },
  '11195': { low: 500, target: 600 },
  '11199': { low: 100, target: 200 },
  '11291': { low: 500, target: 600 },
  '11295': { low: 500, target: 600 },
  '11299': { low: 100, target: 200 },
  '11391': { low: 500, target: 600 },
  '11395': { low: 500, target: 600 },
  '11399': { low: 100, target: 200 },
};

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
  const arenaOn = state.arenaSweepEnabled_normal ?? false;
  btnArena.textContent = arenaOn ? "ON" : "OFF";
  btnArena.className = "toggle-btn " + (arenaOn ? "on" : "off");

  const btnArenaIsekai = document.getElementById("btnArenaIsekai");
  const isekaiOn = state.arenaSweepEnabled_isekai ?? false;
  btnArenaIsekai.textContent = isekaiOn ? "ON" : "OFF";
  btnArenaIsekai.className = "toggle-btn " + (isekaiOn ? "on" : "off");

  const btnEnc = document.getElementById("btnEncounter");
  const encOn = state.encounterEnabled ?? false;
  btnEnc.textContent = encOn ? "ON" : "OFF";
  btnEnc.className = "toggle-btn " + (encOn ? "on" : "off");

  const btnUna = document.getElementById("btnUnattended");
  const unaOn = state.unattendedMode ?? false;
  btnUna.textContent = unaOn ? "ON" : "OFF";
  btnUna.className = "toggle-btn " + (unaOn ? "on" : "off");

  const btnRb = document.getElementById("btnRingOfBlood");
  const rbOn = state.rbAutoEnabled_normal ?? false;
  btnRb.textContent = rbOn ? "ON" : "OFF";
  btnRb.className = "toggle-btn " + (rbOn ? "on" : "off");

  const btnRbIsekai = document.getElementById("btnRingOfBloodIsekai");
  const rbIsekaiOn = state.rbAutoEnabled_isekai ?? false;
  btnRbIsekai.textContent = rbIsekaiOn ? "ON" : "OFF";
  btnRbIsekai.className = "toggle-btn " + (rbIsekaiOn ? "on" : "off");

  const btnReplenishNormal = document.getElementById("btnReplenishModeNormal");
  const replenishNormalOn = state.replenishEnabled_normal ?? false;
  btnReplenishNormal.textContent = replenishNormalOn ? "ON" : "OFF";
  btnReplenishNormal.className = "toggle-btn " + (replenishNormalOn ? "on" : "off");

  const btnReplenishIsekai = document.getElementById("btnReplenishModeIsekai");
  const replenishIsekaiOn = state.replenishEnabled_isekai ?? false;
  btnReplenishIsekai.textContent = replenishIsekaiOn ? "ON" : "OFF";
  btnReplenishIsekai.className = "toggle-btn " + (replenishIsekaiOn ? "on" : "off");

  const btnRepairNormal = document.getElementById("btnRepairModeNormal");
  if (btnRepairNormal) {
    const repairNormalOn = state.repairEnabled_normal ?? false;
    btnRepairNormal.textContent = repairNormalOn ? "ON" : "OFF";
    btnRepairNormal.className = "toggle-btn " + (repairNormalOn ? "on" : "off");
  }

  const btnRepairIsekai = document.getElementById("btnRepairModeIsekai");
  if (btnRepairIsekai) {
    const repairIsekaiOn = state.repairEnabled_isekai ?? false;
    btnRepairIsekai.textContent = repairIsekaiOn ? "ON" : "OFF";
    btnRepairIsekai.className = "toggle-btn " + (repairIsekaiOn ? "on" : "off");
  }

  const statusEl = document.getElementById("currentStatus");
  const lastStatus = state.lastBattleStatus;
  if (lastStatus) {
    const icons = { victory: "🏆", defeated: "💀", alert: "🚨", reload: "🔄", continue: "⏩", system: "ℹ️" };
    statusEl.textContent = (icons[lastStatus.type] ?? "❓") + " " +
      lastStatus.reason + " (" + lastStatus.time + ")";
  }
}

function renderRbStatus() {
  const el = document.getElementById("rbStatus");
  if (!el) return;
  const parts = [];
  for (const world of ["normal", "isekai"]) {
    const enabled = state["rbAutoEnabled_" + world] ?? false;
    if (!enabled) continue;
    const s = state["rbStateToday_" + world] ?? {};
    const tokens = state["rbTokens_" + world] ?? "?";
    const fsm = s.fsmDone ? "✅" : "⬜";
    const trio = s.trioDone ? "✅" : "⬜";
    const label = world === "normal" ? "N" : "I";
    parts.push(label + " " + fsm + " FSM " + trio + " Trio (t=" + tokens + ")");
  }
  el.textContent = parts.length ? "RoB: " + parts.join(" | ") : "";
}

function renderArenaProgressForWorld(grid, worldLabel, difficulties, progress) {
  if (difficulties.length === 0) return;

  const header = document.createElement("div");
  header.style.cssText = "grid-column:1/-1;font-weight:bold;font-size:13px;margin-top:8px;";
  header.textContent = worldLabel;
  grid.appendChild(header);

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

function renderArenaProgress() {
  const grid = document.getElementById("arenaGrid");
  grid.innerHTML = "";

  const normalDiffs = state.arenaDifficulties_normal ?? [];
  const normalProgress = state.arenaSweepProgress_normal ?? {};
  const isekaiDiffs = state.arenaDifficulties_isekai ?? [];
  const isekaiProgress = state.arenaSweepProgress_isekai ?? {};

  if (normalDiffs.length === 0 && isekaiDiffs.length === 0) {
    grid.innerHTML = '<div style="color:#666;font-size:13px;">No arena data yet. Start a sweep to load difficulties.</div>';
    return;
  }

  renderArenaProgressForWorld(grid, "Normal", normalDiffs, normalProgress);
  renderArenaProgressForWorld(grid, "Isekai", isekaiDiffs, isekaiProgress);
}

function renderStats() {
  const stats = state.dailyStats ?? {};
  document.getElementById("statArenaWins").textContent = stats.arenaWins ?? 0;
  document.getElementById("statArenaLosses").textContent = stats.arenaLosses ?? 0;
  document.getElementById("statEncounters").textContent = stats.encounterCount ?? 0;
  const normalStam = state.currentStamina_normal;
  const isekaiStam = state.currentStamina_isekai;
  const stamParts = [];
  if (normalStam != null) stamParts.push("N:" + normalStam);
  if (isekaiStam != null) stamParts.push("I:" + isekaiStam);
  document.getElementById("statStamina").textContent = stamParts.length > 0 ? stamParts.join(" / ") : "--";
  const rmVal = state.riddleMasterRemaining;
  const rmLastSolve = state.riddleMasterLastSolve;
  const rmEl = document.getElementById("statRiddle");
  let rmText = rmVal ?? "--";
  if (rmLastSolve) {
    const d = new Date(rmLastSolve);
    rmText += " (" + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ")";
  }
  rmEl.textContent = rmText;
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
    chrome.storage.local.set({ autoArena_normal: true, alertRetryCount_normal: 0 });
    const tabId = state.arenaTabId_normal;
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

function renderTranslations() {
  const list = document.getElementById("translationsList");
  if (!list) return;
  list.innerHTML = "";
  const settings = state[TRANSLATION_SETTINGS_KEY] ?? TRANSLATION_DEFAULT_SETTINGS;
  for (const id of TRANSLATION_HENTAIVERSE_IDS) {
    const def = TRANSLATION_REGISTRY[id];
    const entry = state[TRANSLATION_KEY_PREFIX + id];
    const enabled = settings[id] !== false;
    const row = document.createElement("div");
    row.className = "translation-row" + (enabled ? "" : " disabled");

    const left = document.createElement("div");
    left.style.flex = "1";

    const name = document.createElement("div");
    name.className = "translation-name";
    name.textContent = def.name;
    left.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "translation-meta";
    if (entry?.version) {
      const fetched = entry.lastFetched ? new Date(entry.lastFetched).toLocaleString() : "—";
      meta.textContent = "v" + entry.version + " · " + fetched;
    } else {
      meta.textContent = "(not fetched)";
    }
    left.appendChild(meta);

    if (entry?.lastError) {
      const err = document.createElement("div");
      err.className = "translation-error";
      err.textContent = "⚠ " + entry.lastError.message;
      left.appendChild(err);
    }

    row.appendChild(left);

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.textContent = enabled ? "🟢" : "🔴";
    row.appendChild(dot);

    row.addEventListener("click", () => {
      const next = !enabled;
      const newSettings = { ...settings, [id]: next };
      state[TRANSLATION_SETTINGS_KEY] = newSettings;
      chrome.storage.local.set({ [TRANSLATION_SETTINGS_KEY]: newSettings });
      renderTranslations();
    });

    list.appendChild(row);
  }
}

function itemName(id) {
  return (REPLENISH_ITEMS.find((i) => i.id === id) ?? {}).name ?? id;
}

function renderReplenishAbortAlerts() {
  const container = document.getElementById('replenishAbortAlerts');
  if (!container) return;
  container.innerHTML = '';

  for (const world of ['normal', 'isekai']) {
    const reason = state['replenishAbortReason_' + world];
    if (!reason) continue;

    const alert = document.createElement('div');
    alert.className = 'replenish-abort-alert';

    const text = document.createElement('span');
    const worldLabel = world === 'normal' ? 'N' : 'I';
    const time = new Date(reason.ts).toLocaleTimeString();
    let detail = reason.reason;
    if (reason.shortfalls?.length > 0) {
      detail = reason.shortfalls.map((s) => itemName(s.id) + ' 缺 ' + s.deficit).join(', ');
    }
    text.textContent = '⚠️ [' + worldLabel + '] ' + detail + ' (' + time + ') autoArena 已自動關閉';
    alert.appendChild(text);

    const close = document.createElement('button');
    close.textContent = '✕';
    close.className = 'replenish-abort-close';
    close.addEventListener('click', async () => {
      await chrome.storage.local.remove('replenishAbortReason_' + world);
      delete state['replenishAbortReason_' + world];
      renderReplenishAbortAlerts();
    });
    alert.appendChild(close);

    container.appendChild(alert);
  }
}

function getReplenishConfig() {
  const stored = state.replenishConfig ?? {};
  return Object.fromEntries(
    REPLENISH_ITEMS.map(({ id }) => [
      id,
      { ...DEFAULT_REPLENISH_CONFIG[id], ...(stored[id] ?? {}) }
    ])
  );
}

function setReplenishConfig(itemId, field, value) {
  const config = getReplenishConfig();
  const updated = { ...config, [itemId]: { ...config[itemId], [field]: value } };
  state.replenishConfig = updated;
  chrome.storage.local.set({ replenishConfig: updated });
}

function renderReplenishConfig() {
  const list = document.getElementById('replenishList');
  if (!list) return;
  list.innerHTML = '';
  const config = getReplenishConfig();

  for (const item of REPLENISH_ITEMS) {
    const entry = config[item.id] ?? DEFAULT_REPLENISH_CONFIG[item.id];
    const row = document.createElement('div');
    row.className = 'replenish-row';
    row.dataset.itemId = item.id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'replenish-name';
    nameSpan.textContent = item.name;
    row.appendChild(nameSpan);

    const lowInput = document.createElement('input');
    lowInput.type = 'number';
    lowInput.min = '0';
    lowInput.value = entry.low;
    lowInput.title = '低於此數量時補貨';
    lowInput.addEventListener('change', () => {
      const raw = parseInt(lowInput.value);
      const val = Math.max(0, Number.isNaN(raw) ? 0 : raw);
      lowInput.value = val;
      setReplenishConfig(item.id, 'low', val);
    });
    row.appendChild(lowInput);

    const targetInput = document.createElement('input');
    targetInput.type = 'number';
    targetInput.min = '0';
    targetInput.value = entry.target;
    targetInput.title = '補貨至此數量';
    targetInput.addEventListener('change', () => {
      const raw = parseInt(targetInput.value);
      const val = Math.max(0, Number.isNaN(raw) ? 0 : raw);
      targetInput.value = val;
      setReplenishConfig(item.id, 'target', val);
    });
    row.appendChild(targetInput);

    const invSpan = document.createElement('span');
    invSpan.className = 'replenish-inv';
    row.appendChild(invSpan);

    list.appendChild(row);
  }

  renderReplenishStatus(
    state.replenishLastInventory_normal?.inventories ?? {},
    state.replenishLastInventory_isekai?.inventories ?? {},
  );
}

function renderReplenishStatus(normalInv, isekaiInv) {
  const config = getReplenishConfig();
  for (const item of REPLENISH_ITEMS) {
    const row = document.querySelector('#replenishList [data-item-id="' + item.id + '"]');
    if (!row) continue;
    const invSpan = row.querySelector('.replenish-inv');
    if (!invSpan) continue;
    const nCount = normalInv[item.id];
    const iCount = isekaiInv[item.id];
    if (nCount == null && iCount == null) {
      invSpan.textContent = '';
      invSpan.style.color = '';
      continue;
    }
    const low = (config[item.id] ?? DEFAULT_REPLENISH_CONFIG[item.id]).low;
    const nStr = nCount != null ? String(nCount) : '?';
    const iStr = iCount != null ? String(iCount) : '?';
    const nLow = nCount != null && nCount < low;
    const iLow = iCount != null && iCount < low;
    invSpan.innerHTML =
      '<span style="color:' + (nLow ? '#EF5350' : '#66BB6A') + '">N:' + nStr + '</span>' +
      ' / ' +
      '<span style="color:' + (iLow ? '#EF5350' : '#66BB6A') + '">I:' + iStr + '</span>';
  }
}

function renderReplenishLog() {
  const container = document.getElementById('replenishLog');
  if (!container) return;
  const log = state.replenishLog ?? [];
  const recent = log.slice(0, 10);
  container.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'replenish-log-heading';
  heading.textContent = '補貨記錄';
  container.appendChild(heading);

  if (recent.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'replenish-log-empty';
    empty.textContent = '尚無記錄';
    container.appendChild(empty);
    return;
  }

  const ITEM_NAME = Object.fromEntries(REPLENISH_ITEMS.map((i) => [i.id, i.name]));

  for (const entry of recent) {
    const icon = entry.overall === 'success' ? '✅' : entry.overall === 'partial' ? '⚠️' : '❌';
    const boughtItems = (entry.items ?? []).filter((r) => r.status === 'bought' || r.status === 'partial');
    const boughtCount = boughtItems.length;
    const totalItems = (entry.items ?? []).filter((r) => r.status !== 'skipped').length;
    const costStr = (entry.totalCost ?? 0).toLocaleString();
    const worldBadge = entry.world === 'normal' ? '[N]' : entry.world === 'isekai' ? '[I]' : '[?]';

    let marketUnits = 0;
    let shopUnits = 0;
    let marketCost = 0;
    for (const item of (entry.items ?? [])) {
      if (item.status !== 'bought' && item.status !== 'partial') continue;
      if (item.source === 'market') {
        marketUnits += item.units ?? 0;
        marketCost += item.cost ?? 0;
      } else if (item.source === 'shop') {
        shopUnits += item.units ?? 0;
      } else if (item.source === 'mixed') {
        marketUnits += item.marketUnits ?? 0;
        shopUnits += item.shopUnits ?? 0;
        marketCost += item.marketCost ?? 0;
      }
    }
    const sourceParts = [];
    if (marketUnits > 0) sourceParts.push('市場 ' + marketUnits + ' 件 ' + marketCost.toLocaleString() + ' C');
    if (shopUnits > 0) sourceParts.push('商店 ' + shopUnits + ' 件');
    const sourceStr = sourceParts.length ? '（' + sourceParts.join(' + ') + '）' : '';

    const row = document.createElement('div');
    row.className = 'replenish-log-row';

    const summary = document.createElement('div');
    summary.className = 'replenish-log-summary';
    summary.textContent = worldBadge + ' ' + icon + ' ' + entry.time + '  補貨 ' + boughtCount + '/' + totalItems + '，總成本 ' + costStr + ' C' + sourceStr;
    row.appendChild(summary);

    const detail = document.createElement('div');
    detail.className = 'replenish-log-detail';

    for (const item of (entry.items ?? [])) {
      if (item.status === 'skipped') continue;
      const name = ITEM_NAME[item.id] ?? item.id;
      const lineEl = document.createElement('div');
      lineEl.className = 'replenish-log-item';

      let text = '- ' + name + ': ';
      if (item.status === 'bought') {
        if (item.source === 'market') {
          const cost = typeof item.cost === 'number' ? item.cost.toLocaleString() : item.cost;
          text += 'market ' + (item.units ?? '') + ' @ ' + cost + ' C';
        } else if (item.source === 'shop') {
          text += 'shop ' + (item.units ?? '');
        } else if (item.source === 'mixed') {
          const mCost = typeof item.marketCost === 'number' ? item.marketCost.toLocaleString() : (item.marketCost ?? '?');
          text += 'mixed market×' + item.marketUnits + ' (' + mCost + ' C) + shop×' + item.shopUnits;
        } else {
          text += item.source ?? '';
        }
      } else if (item.status === 'partial') {
        text += 'partial market×' + (item.marketUnits ?? 0) + ' (shop failed)';
      } else if (item.status === 'failed') {
        text += 'failed: ' + (item.reason ?? item.marketError ?? '');
      }

      lineEl.textContent = text;
      detail.appendChild(lineEl);
    }

    row.appendChild(detail);

    summary.addEventListener('click', () => {
      const expanded = row.dataset.expanded === 'true';
      row.dataset.expanded = expanded ? 'false' : 'true';
      detail.style.display = expanded ? 'none' : 'block';
    });

    container.appendChild(row);
  }
}

function renderRepairAbortAlerts() {
  const container = document.getElementById('repairAbortAlerts');
  if (!container) return;
  container.innerHTML = '';

  for (const world of ['normal', 'isekai']) {
    const reason = state['repairAbortReason_' + world];
    if (!reason) continue;

    const alert = document.createElement('div');
    alert.className = 'replenish-abort-alert';

    const text = document.createElement('span');
    const worldLabel = world === 'normal' ? 'N' : 'I';
    const time = new Date(reason.ts).toLocaleTimeString();
    text.textContent = '⚠️ [' + worldLabel + '] 修裝失敗: ' + reason.reason + ' (' + time + ') autoArena 已自動關閉';
    alert.appendChild(text);

    const close = document.createElement('button');
    close.textContent = '✕';
    close.className = 'replenish-abort-close';
    close.addEventListener('click', async () => {
      await chrome.storage.local.remove('repairAbortReason_' + world);
      delete state['repairAbortReason_' + world];
      renderRepairAbortAlerts();
    });
    alert.appendChild(close);

    container.appendChild(alert);
  }
}

function renderRepairLog() {
  const container = document.getElementById('repairLog');
  if (!container) return;
  const log = state.repairLog ?? [];
  const recent = log.slice(0, 10);
  container.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'replenish-log-heading';
  heading.textContent = '修裝記錄';
  container.appendChild(heading);

  if (recent.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'replenish-log-empty';
    empty.textContent = '尚無記錄';
    container.appendChild(empty);
    return;
  }

  for (const entry of recent) {
    const icons = { repaired: '✅', skipped: '➖', partial: '⚠️', failed: '❌' };
    const icon = icons[entry.outcome] ?? '❓';
    const worldBadge = entry.world === 'normal' ? '[N]' : entry.world === 'isekai' ? '[I]' : '[?]';
    const reasonStr = entry.reason ? '  ' + entry.reason : '';
    const row = document.createElement('div');
    row.className = 'replenish-log-row';
    const summary = document.createElement('div');
    summary.className = 'replenish-log-summary';
    summary.textContent = worldBadge + ' ' + icon + ' ' + entry.time + '  ' + entry.outcome + reasonStr;
    row.appendChild(summary);
    container.appendChild(row);
  }
}

function renderAll() {
  updateResetTimer();
  renderControls();
  renderRbStatus();
  renderArenaProgress();
  renderStats();
  renderToggles();
  renderThresholds();
  renderStrategy();
  renderGeneralSettings();
  renderLog();
  renderTranslations();
  renderReplenishConfig();
  renderReplenishAbortAlerts();
  renderReplenishLog();
  renderRepairAbortAlerts();
  renderRepairLog();
}

document.getElementById("btnArenaSweep").addEventListener("click", async () => {
  const current = state.arenaSweepEnabled_normal ?? false;
  const next = !current;
  state.arenaSweepEnabled_normal = next;
  chrome.runtime.sendMessage({ type: "SET_ARENA_SWEEP", enabled: next, world: "normal" });
  if (next) {
    await chrome.storage.local.remove('replenishAbortReason_normal');
    delete state['replenishAbortReason_normal'];
    renderReplenishAbortAlerts();
  }
  renderControls();
});

document.getElementById("btnArenaIsekai").addEventListener("click", async () => {
  const current = state.arenaSweepEnabled_isekai ?? false;
  const next = !current;
  state.arenaSweepEnabled_isekai = next;
  chrome.runtime.sendMessage({ type: "SET_ARENA_SWEEP", enabled: next, world: "isekai" });
  if (next) {
    await chrome.storage.local.remove('replenishAbortReason_isekai');
    delete state['replenishAbortReason_isekai'];
    renderReplenishAbortAlerts();
  }
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

document.getElementById("btnRingOfBlood").addEventListener("click", async () => {
  const next = !(state.rbAutoEnabled_normal ?? false);
  state.rbAutoEnabled_normal = next;
  chrome.runtime.sendMessage({ type: "SET_RB_AUTO", enabled: next, world: "normal" });
  if (next) {
    await chrome.storage.local.remove('replenishAbortReason_normal');
    delete state['replenishAbortReason_normal'];
    renderReplenishAbortAlerts();
  }
  renderControls();
});

document.getElementById("btnRingOfBloodIsekai").addEventListener("click", async () => {
  const next = !(state.rbAutoEnabled_isekai ?? false);
  state.rbAutoEnabled_isekai = next;
  chrome.runtime.sendMessage({ type: "SET_RB_AUTO", enabled: next, world: "isekai" });
  if (next) {
    await chrome.storage.local.remove('replenishAbortReason_isekai');
    delete state['replenishAbortReason_isekai'];
    renderReplenishAbortAlerts();
  }
  renderControls();
});

document.getElementById("btnReplenishModeNormal").addEventListener("click", async () => {
  const cur = state.replenishEnabled_normal ?? false;
  const next = !cur;
  await chrome.storage.local.set({ replenishEnabled_normal: next });
  state.replenishEnabled_normal = next;
  if (next) {
    await chrome.storage.local.remove('replenishAbortReason_normal');
    delete state['replenishAbortReason_normal'];
  }
  renderControls();
  renderReplenishAbortAlerts();
});

document.getElementById("btnReplenishModeIsekai").addEventListener("click", async () => {
  const cur = state.replenishEnabled_isekai ?? false;
  const next = !cur;
  await chrome.storage.local.set({ replenishEnabled_isekai: next });
  state.replenishEnabled_isekai = next;
  if (next) {
    await chrome.storage.local.remove('replenishAbortReason_isekai');
    delete state['replenishAbortReason_isekai'];
  }
  renderControls();
  renderReplenishAbortAlerts();
});

document.getElementById("btnRepairModeNormal")?.addEventListener("click", async () => {
  const cur = state.repairEnabled_normal ?? false;
  const next = !cur;
  await chrome.storage.local.set({ repairEnabled_normal: next });
  state.repairEnabled_normal = next;
  if (next) {
    await chrome.storage.local.remove('repairAbortReason_normal');
    delete state['repairAbortReason_normal'];
  }
  renderControls();
  renderRepairAbortAlerts();
});

document.getElementById("btnRepairModeIsekai")?.addEventListener("click", async () => {
  const cur = state.repairEnabled_isekai ?? false;
  const next = !cur;
  await chrome.storage.local.set({ repairEnabled_isekai: next });
  state.repairEnabled_isekai = next;
  if (next) {
    await chrome.storage.local.remove('repairAbortReason_isekai');
    delete state['repairAbortReason_isekai'];
  }
  renderControls();
  renderRepairAbortAlerts();
});

async function runManualRepair(world) {
  const btn = document.getElementById(world === 'normal' ? 'btnRepairNormal' : 'btnRepairIsekai');
  if (!btn) return;
  let statusEl = document.getElementById('repairStatus_' + world);
  if (!statusEl) {
    statusEl = document.createElement('span');
    statusEl.id = 'repairStatus_' + world;
    statusEl.style.cssText = 'margin-left:8px;font-size:12px;color:#aaa;';
    btn.parentNode.appendChild(statusEl);
  }
  btn.disabled = true;
  statusEl.style.color = '#aaa';
  statusEl.textContent = '修裝中…';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'REPAIR_RUN', world });
    if (!resp) {
      statusEl.style.color = '#EF5350';
      statusEl.textContent = '無回應';
    } else if (!resp.success) {
      statusEl.style.color = '#EF5350';
      statusEl.textContent = '失敗: ' + (resp.error ?? '未知');
    } else if (resp.repaired) {
      statusEl.style.color = '#66BB6A';
      statusEl.textContent = '已修裝';
    } else {
      statusEl.style.color = '#66BB6A';
      statusEl.textContent = '不需修裝';
    }
    await loadState();
    renderRepairLog();
  } catch (e) {
    statusEl.style.color = '#EF5350';
    statusEl.textContent = '錯誤: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('btnRepairNormal')?.addEventListener('click', () => runManualRepair('normal'));
document.getElementById('btnRepairIsekai')?.addEventListener('click', () => runManualRepair('isekai'));

document.getElementById("btnTranslationUpdate")?.addEventListener("click", async () => {
  const btn = document.getElementById("btnTranslationUpdate");
  const status = document.getElementById("translationUpdateStatus");
  btn.disabled = true;
  status.textContent = "Checking…";
  try {
    const resp = await chrome.runtime.sendMessage({ type: "FETCH_TRANSLATIONS" });
    const counts = (resp?.results ?? []).reduce((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    status.textContent = "Done · " + Object.entries(counts).map(([k, v]) => k + "=" + v).join(", ");
  } catch (e) {
    status.textContent = "Error: " + e.message;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btnReplenish').addEventListener('click', async () => {
  const btn = document.getElementById('btnReplenish');
  let statusEl = document.getElementById('replenishStatus');
  if (!statusEl) {
    statusEl = document.createElement('span');
    statusEl.id = 'replenishStatus';
    statusEl.style.cssText = 'margin-left:8px;font-size:12px;color:#aaa;';
    btn.parentNode.appendChild(statusEl);
  }
  btn.disabled = true;
  statusEl.style.color = '#aaa';
  statusEl.textContent = '補貨中…';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'REPLENISH_RUN' });
    const worldResults = [
      { label: 'N', data: resp?.normal },
      { label: 'I', data: resp?.isekai },
    ];
    const lines = [];
    let anyFailed = false;
    for (const { label, data } of worldResults) {
      if (!data) continue;
      if (!data.success) {
        anyFailed = true;
        lines.push('[' + label + '] 錯誤: ' + (data.error ?? '未知錯誤'));
        continue;
      }
      const { results, totalCost } = data;
      const bought = results.filter((r) => r.status === 'bought');
      const failed = results.filter((r) => r.status === 'failed');
      const skipped = results.filter((r) => r.status === 'skipped');
      if (failed.length > 0) anyFailed = true;
      if (bought.length > 0) lines.push('[' + label + '] 補 ' + bought.length + ' 項 ' + (totalCost ?? 0).toLocaleString() + ' C');
      else if (skipped.length > 0) lines.push('[' + label + '] 足夠');
    }
    statusEl.style.color = anyFailed ? '#EF5350' : '#66BB6A';
    statusEl.textContent = lines.join(' | ') || '完成';
    await loadState();
    renderReplenishConfig();
    renderReplenishLog();
  } catch (e) {
    statusEl.style.color = '#EF5350';
    statusEl.textContent = '錯誤: ' + e.message;
  } finally {
    btn.disabled = false;
  }
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
  if (state.replenishConfig == null) {
    const seed = Object.fromEntries(
      Object.entries(DEFAULT_REPLENISH_CONFIG).map(([k, v]) => [k, { ...v }])
    );
    state.replenishConfig = seed;
    chrome.storage.local.set({ replenishConfig: seed });
  }
  renderAll();
})();
