function GM_addStyle(css) {
  const s = document.createElement("style");
  s.textContent = css;
  (document.head ?? document.documentElement).appendChild(s);
  return s;
}

var unsafeWindow = window;
