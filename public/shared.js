(function () {
  function wsUrl(pathname) {
    const isHttps = window.location.protocol === "https:";
    const scheme = isHttps ? "wss:" : "ws:";
    return `${scheme}//${window.location.host}${pathname}`;
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function formatUpdatedAt(ms) {
    try {
      return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  window.Corte = { wsUrl, postJson, formatUpdatedAt };
})();
