chrome.runtime.sendMessage({
  type: "INJECT_TRANSLATIONS",
  host: location.hostname,
}).catch(() => {});
