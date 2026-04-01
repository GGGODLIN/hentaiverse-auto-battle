(() => {
  let _apiResolve = null;
  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._hvUrl = url;
    return _origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this._hvUrl && this._hvUrl.includes("/json") && _apiResolve) {
      this.addEventListener("load", () => {
        if (_apiResolve) {
          _apiResolve();
          _apiResolve = null;
        }
      }, { once: true });
    }
    return _origSend.apply(this, arguments);
  };

  function waitForApi(timeout = 5000) {
    return new Promise((resolve) => {
      _apiResolve = resolve;
      setTimeout(() => {
        if (_apiResolve) {
          _apiResolve();
          _apiResolve = null;
        }
      }, timeout);
    });
  }

  window.addEventListener("__hv_cmd", async (e) => {
    const { action, id } = e.detail;
    if (action === "waitForApi") {
      await waitForApi(e.detail.timeout ?? 5000);
      window.dispatchEvent(new CustomEvent("__hv_resp", {
        detail: { id, action: "apiReady" }
      }));
    }
    if (action === "battleContinue") {
      window.battle?.battle_continue?.();
    }
  });

  window.dispatchEvent(new CustomEvent("__hv_resp", {
    detail: { action: "injected" }
  }));
})();
