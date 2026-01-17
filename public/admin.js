(function () {
  const els = {
    players: document.getElementById("players"),
    format: document.getElementById("format"),
    doublesModeField: document.getElementById("doublesModeField"),
    doublesMode: document.getElementById("doublesMode"),
    courts: document.getElementById("courts"),
    rotationStep: document.getElementById("rotationStep"),
    setupBtn: document.getElementById("setupBtn"),
    nextBtn: document.getElementById("nextBtn"),
    prevBtn: document.getElementById("prevBtn"),
    shuffleBtn: document.getElementById("shuffleBtn"),
    resetBtn: document.getElementById("resetBtn"),
    preview: document.getElementById("preview"),
    statusTitle: document.getElementById("statusTitle"),
    statusSubtitle: document.getElementById("statusSubtitle"),
    tvUrl: document.getElementById("tvUrl"),
    authOverlay: document.getElementById("authOverlay"),
    adminPassword: document.getElementById("adminPassword"),
    loginBtn: document.getElementById("loginBtn"),
    cancelLoginBtn: document.getElementById("cancelLoginBtn"),
    authError: document.getElementById("authError"),
  };

  els.tvUrl.textContent = `${window.location.origin}/tv`;

  let authEnabled = false;
  let pollTimer = null;

  function parsePlayers(text) {
    return String(text ?? "")
      .split(/[\n,]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function normalizePlayersSideCount(view) {
    if (view?.format === "doubles") return 2;
    const side = Number(view?.playersPerSide);
    if (side === 2) return 2;
    const firstMatch = view?.matches?.[0];
    if (Array.isArray(firstMatch?.sideA) && firstMatch.sideA.length > 1) return 2;
    if (Array.isArray(firstMatch?.sideB) && firstMatch.sideB.length > 1) return 2;
    return 1;
  }

  function showAuthOverlay() {
    els.authOverlay.hidden = false;
    els.authError.hidden = true;
    requestAnimationFrame(() => els.adminPassword?.focus?.());
  }

  function hideAuthOverlay() {
    els.authOverlay.hidden = true;
    els.authError.hidden = true;
    if (els.adminPassword) els.adminPassword.value = "";
  }

  async function checkAuthStatus() {
    try {
      const data = await window.Corte.getJson("/api/auth/status");
      authEnabled = Boolean(data?.enabled);
      hideAuthOverlay();
    } catch (err) {
      // If status fails but we already have a token, don't force a re-login loop.
      // Protected actions will 401 and re-open the overlay when needed.
      const token = window.Corte.getAuthToken?.() || "";
      if (token) return;
      authEnabled = true;
      showAuthOverlay();
    }
  }

  async function login() {
    els.loginBtn.disabled = true;
    els.cancelLoginBtn.disabled = true;
    try {
      const password = String(els.adminPassword.value ?? "");
      const res = await window.Corte.postJson("/api/auth/login", { password });
      if (res?.token) window.Corte.setAuthToken(res.token);
      hideAuthOverlay();
      await refreshPreview();
    } catch (err) {
      if (err?.status === 401) {
        els.authError.hidden = false;
        requestAnimationFrame(() => els.adminPassword?.focus?.());
      } else if (err?.status === 400) {
        alert("Admin password is not configured on the server.");
        hideAuthOverlay();
      } else if (err?.status === 404) {
        alert("Login endpoint not found. If you're on Vercel, make sure the deployment includes `/api/index.js` and `vercel.json`.");
      } else {
        alert(err?.message ?? String(err));
      }
    } finally {
      els.loginBtn.disabled = false;
      els.cancelLoginBtn.disabled = false;
    }
  }

  function handleAuthError(err) {
    if (!authEnabled) return false;
    if (err?.status !== 401) return false;
    showAuthOverlay();
    return true;
  }

  function normalizeSide(side, count) {
    const list = Array.isArray(side)
      ? side
          .map((n) => String(n ?? "").trim())
          .filter(Boolean)
          .slice(0, count)
      : [];
    while (list.length < count) list.push("—");
    return list;
  }

  function sideLabel(side, count) {
    const list = normalizeSide(side, count);
    if (count === 1) return escapeHtml(list[0]);
    return `${escapeHtml(list[0])} + ${escapeHtml(list[1])}`;
  }

  function syncFormatUi({ format, doublesMode }) {
    const currentFormat = format ?? els.format.value ?? "singles";
    const isDoubles = currentFormat === "doubles";
    els.doublesModeField.hidden = !isDoubles;
    if (isDoubles && doublesMode) els.doublesMode.value = doublesMode;
    if (!isDoubles) els.doublesMode.value = "rotate_players";

    els.players.placeholder = isDoubles
      ? "Team 1 player 1\nTeam 1 player 2\nTeam 2 player 1\nTeam 2 player 2"
      : "Sam\nAlex\nJordan\nTaylor";
  }

  function renderPreview(view) {
    els.statusTitle.textContent = view.roundLabel ?? "—";
    const modeLabel = view.mode === "round_robin" ? "All play" : "Rotation";
    const formatLabel = view.format === "doubles" ? "2v2" : "1v1";
    const teamsLabel =
      view.format === "doubles"
        ? view.doublesMode === "keep_teams"
          ? "Fixed teams"
          : "Rotate players"
        : null;
    els.statusSubtitle.textContent = [formatLabel, teamsLabel, `${view.playersCount ?? 0} players`, `${view.numCourts ?? 0} courts`, modeLabel]
      .filter(Boolean)
      .join(" • ");

    if (!view.matches?.length) {
      els.preview.innerHTML = `<div class="empty">No matches yet. Add players and tap “Start / Update”.</div>`;
      return;
    }

    const sideCount = normalizePlayersSideCount(view);
    const matchesHtml = view.matches
      .map((m) => {
        const sideA = m.sideA ?? (m.player1 != null ? [m.player1] : []);
        const sideB = m.sideB ?? (m.player2 != null ? [m.player2] : []);
        const left = sideLabel(sideA, sideCount);
        const right = sideLabel(sideB, sideCount);
        return `<div class="previewMatch"><div class="pill">Court ${m.court}</div><div class="previewNames">${left} <span class="vs">vs</span> ${right}</div></div>`;
      })
      .join("");

    const benchHtml =
      view.bench?.length > 0
        ? `<div class="previewBench"><div class="previewBenchTitle">Sitting out</div><div class="previewBenchList">${view.bench
            .map((n) => `<span class="chip">${escapeHtml(n)}</span>`)
            .join("")}</div></div>`
        : "";

    els.preview.innerHTML = matchesHtml + benchHtml;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function refresh() {
    const res = await fetch("/api/view");
    const view = await res.json();

    els.format.value = view.format === "doubles" ? "doubles" : "singles";
    syncFormatUi({ format: view.format, doublesMode: view.doublesMode });
    els.courts.value = String(view.numCourts ?? 4);
    els.rotationStep.value = String(view.rotationStep ?? view.numCourts ?? 4);
    els.players.value = Array.isArray(view.players) ? view.players.join("\n") : "";

    renderPreview(view);
  }

  async function refreshPreview() {
    const res = await fetch("/api/view");
    const view = await res.json();
    renderPreview(view);
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => refreshPreview().catch(() => {}), 2000);
  }

  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  els.format.addEventListener("change", () => {
    syncFormatUi({ format: els.format.value, doublesMode: els.doublesMode.value });
  });
  els.doublesMode.addEventListener("change", () => {
    syncFormatUi({ format: els.format.value, doublesMode: els.doublesMode.value });
  });

  els.setupBtn.addEventListener("click", async () => {
    els.setupBtn.disabled = true;
    try {
      const players = parsePlayers(els.players.value);
      const numCourts = Number(els.courts.value);
      const rotationStep = Number(els.rotationStep.value);
      const format = els.format.value === "doubles" ? "doubles" : "singles";
      const doublesMode = els.doublesMode.value === "keep_teams" ? "keep_teams" : "rotate_players";
      const view = await window.Corte.postJson("/api/setup", { players, numCourts, rotationStep, format, doublesMode });
      renderPreview(view);
    } catch (err) {
      if (!handleAuthError(err)) alert(err?.message ?? String(err));
    } finally {
      els.setupBtn.disabled = false;
    }
  });

  els.nextBtn.addEventListener("click", async () => {
    els.nextBtn.disabled = true;
    try {
      const view = await window.Corte.postJson("/api/next");
      renderPreview(view);
    } catch (err) {
      if (!handleAuthError(err)) alert(err?.message ?? String(err));
    } finally {
      els.nextBtn.disabled = false;
    }
  });

  els.prevBtn.addEventListener("click", async () => {
    els.prevBtn.disabled = true;
    try {
      const view = await window.Corte.postJson("/api/prev");
      renderPreview(view);
    } catch (err) {
      if (!handleAuthError(err)) alert(err?.message ?? String(err));
    } finally {
      els.prevBtn.disabled = false;
    }
  });

  els.shuffleBtn.addEventListener("click", async () => {
    els.shuffleBtn.disabled = true;
    try {
      const view = await window.Corte.postJson("/api/shuffle");
      els.players.value = Array.isArray(view.players) ? view.players.join("\n") : "";
      renderPreview(view);
    } catch (err) {
      if (!handleAuthError(err)) alert(err?.message ?? String(err));
    } finally {
      els.shuffleBtn.disabled = false;
    }
  });

  els.resetBtn.addEventListener("click", async () => {
    const ok = confirm("Reset players and rounds?");
    if (!ok) return;
    els.resetBtn.disabled = true;
    try {
      const view = await window.Corte.postJson("/api/reset");
      els.players.value = "";
      els.format.value = view.format === "doubles" ? "doubles" : "singles";
      syncFormatUi({ format: view.format, doublesMode: view.doublesMode });
      els.courts.value = String(view.numCourts ?? 4);
      els.rotationStep.value = String(view.rotationStep ?? view.numCourts ?? 4);
      renderPreview(view);
    } catch (err) {
      if (!handleAuthError(err)) alert(err?.message ?? String(err));
    } finally {
      els.resetBtn.disabled = false;
    }
  });

  function connectWs() {
    const ws = new WebSocket(window.Corte.wsUrl("/ws"));
    ws.addEventListener("open", () => {
      stopPolling();
    });
    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type === "state") renderPreview(msg.payload);
      } catch {
        // ignore
      }
    });
    ws.addEventListener("error", () => {
      startPolling();
    });
    ws.addEventListener("close", () => {
      startPolling();
      setTimeout(connectWs, 1000);
    });
  }

  els.loginBtn?.addEventListener("click", () => login().catch(() => {}));
  els.cancelLoginBtn?.addEventListener("click", () => hideAuthOverlay());
  els.adminPassword?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") login().catch(() => {});
  });

  refresh()
    .then(() => checkAuthStatus())
    .catch(() => {});
  startPolling();
  connectWs();
})();
