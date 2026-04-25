const TRANSLATION_REGISTRY = {
  "hv-main":     { name: "HentaiVerse汉化",     scriptId: 404118 },
  "battlelog":   { name: "HV - 战斗日志汉化",    scriptId: 445520 },
  "img-buttons": { name: "HV 图片按钮汉化",      scriptId: 425529 },
  "items":       { name: "HV 物品装备汉化",      scriptId: 404119 },
};

const TRANSLATION_BASE_URL = "https://update.sleazyfork.org/scripts";
const TRANSLATION_KEY_PREFIX = "translation:";
const TRANSLATION_SETTINGS_KEY = "translation:settings";
const TRANSLATION_UPDATE_ALARM = "translationUpdate";
const TRANSLATION_UPDATE_INTERVAL_MIN = 60 * 24;

const TRANSLATION_DEFAULT_SETTINGS = {
  "hv-main": true,
  "battlelog": true,
  "img-buttons": true,
  "items": true,
};

const TRANSLATION_HENTAIVERSE_IDS = ["hv-main", "battlelog", "img-buttons", "items"];
const TRANSLATION_CROSS_DOMAIN_IDS = ["items"];
