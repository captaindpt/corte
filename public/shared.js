(function () {
  const TOKEN_KEY = "corte_admin_token";

  function wsUrl(pathname) {
    const isHttps = window.location.protocol === "https:";
    const scheme = isHttps ? "wss:" : "ws:";
    return `${scheme}//${window.location.host}${pathname}`;
  }

  function getAuthToken() {
    try {
      return window.localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function setAuthToken(token) {
    try {
      if (!token) window.localStorage.removeItem(TOKEN_KEY);
      else window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // ignore
    }
  }

  async function postJson(url, body) {
    const token = getAuthToken();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
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

  async function getJson(url) {
    const token = getAuthToken();
    const res = await fetch(url, {
      method: "GET",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      credentials: "same-origin",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${res.statusText}`);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  function formatUpdatedAt(ms) {
    try {
      return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  window.Corte = { wsUrl, postJson, getJson, getAuthToken, setAuthToken, formatUpdatedAt };
})();
