(function () {
  const els = {
    meta: document.getElementById("tvMeta"),
    counter: document.getElementById("tvCounter"),
    updated: document.getElementById("tvUpdated"),
    matches: document.getElementById("matches"),
    benchWrap: document.getElementById("benchWrap"),
    bench: document.getElementById("bench"),
  };

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function computeGrid(courts) {
    const width = window.innerWidth || 16;
    const height = window.innerHeight || 9;
    const aspect = width / height;

    const candidates = [];
    for (let cols = 1; cols <= Math.min(8, courts); cols += 1) {
      const rows = Math.ceil(courts / cols);
      candidates.push({ cols, rows });
    }

    let best = candidates[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const c of candidates) {
      const gridAspect = c.cols / c.rows;
      const score = Math.abs(Math.log(gridAspect / aspect)) + (c.cols * c.rows - courts) * 0.15;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  function render(view) {
    const modeLabel = view.mode === "round_robin" ? "All play" : "Rotation";
    const rotationNumber = view.matches?.length ? (Number(view.roundIndex ?? 0) + 1) : null;
    const inferredSideCount = inferSideCount(view);
    const isDoubles = view.format === "doubles" || inferredSideCount === 2;
    const formatLabel = isDoubles ? "2v2" : "1v1";
    const teamsLabel =
      isDoubles
        ? view.doublesMode === "keep_teams"
          ? "Fixed teams"
          : "Rotate players"
        : null;
    const sideCount = inferredSideCount;

    els.meta.textContent = [formatLabel, teamsLabel, modeLabel, `${view.playersCount ?? 0} players`, `${view.numCourts ?? 0} courts`]
      .filter(Boolean)
      .join(" • ");
    els.counter.textContent = rotationNumber ? String(rotationNumber).padStart(2, "0") : "--";
    els.updated.textContent = view.updatedAt
      ? `Updated ${window.Corte.formatUpdatedAt(view.updatedAt)}`
      : "";

    if (!view.matches?.length) {
      els.matches.innerHTML =
        '<div class="tvEmpty"><div class="tvEmptyTitle">Add players</div><div class="tvEmptySub">Open <span class="mono">/admin</span> on a phone to start.</div></div>';
      els.benchWrap.hidden = true;
      return;
    }

    const courts = view.matches.length;
    const grid = computeGrid(courts);
    els.matches.style.setProperty("--cols", String(grid.cols));
    els.matches.style.setProperty("--rows", String(grid.rows));
    els.matches.dataset.format = isDoubles ? "doubles" : "singles";

    els.matches.innerHTML = view.matches
      .map((m) => {
        const sideA = m.sideA ?? (m.player1 != null ? [m.player1] : []);
        const sideB = m.sideB ?? (m.player2 != null ? [m.player2] : []);
        const left = normalizeSide(sideA, sideCount);
        const right = normalizeSide(sideB, sideCount);
        return `<article class="matchCard">
          <div class="matchHeader">
            <div class="courtTag">Court ${m.court}</div>
          </div>
          <div class="matchNames">
            ${teamHtml(left, "left")}
            <div class="vsBig">vs</div>
            ${teamHtml(right, "right")}
          </div>
        </article>`;
      })
      .join("");

    if (view.bench?.length) {
      els.benchWrap.hidden = false;
      els.bench.innerHTML = view.bench.map((n) => `<span class="benchChip">${escapeHtml(n)}</span>`).join("");
    } else {
      els.benchWrap.hidden = true;
      els.bench.innerHTML = "";
    }
  }

  async function refresh() {
    const res = await fetch("/api/view");
    const view = await res.json();
    render(view);
  }

  function connectWs() {
    const ws = new WebSocket(window.Corte.wsUrl("/ws"));
    ws.addEventListener("open", () => {
      stopPolling();
    });
    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type === "state") render(msg.payload);
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

  window.addEventListener("resize", () => refresh().catch(() => {}));
  let pollTimer = null;
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => refresh().catch(() => {}), 2000);
  }
  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  refresh().catch(() => {});
  startPolling();
  connectWs();

  function inferSideCount(view) {
    if (view?.format === "doubles") return 2;
    const side = Number(view?.playersPerSide);
    if (side === 2) return 2;
    const firstMatch = view?.matches?.[0];
    if (Array.isArray(firstMatch?.sideA) && firstMatch.sideA.length > 1) return 2;
    if (Array.isArray(firstMatch?.sideB) && firstMatch.sideB.length > 1) return 2;
    return 1;
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

  function teamHtml(lines, align) {
    const content = lines.map((n) => `<div class="playerLine">${escapeHtml(n)}</div>`).join("");
    return `<div class="team team--${align}">${content}</div>`;
  }
})();
