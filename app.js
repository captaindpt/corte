const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const PUBLIC_DIR = path.join(__dirname, "public");
const COOKIE_NAME = "corte_admin";
const SESSION_MAX_AGE_SECONDS = 60 * 90; // 90 minutes

function clampNumber(value, { min, max, fallback }) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizePlayers(input) {
  if (Array.isArray(input)) {
    return input
      .map((name) => String(name ?? "").trim())
      .filter((name) => name.length > 0);
  }
  if (typeof input !== "string") return [];

  return input
    .split(/[\n,]+/g)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

function normalizeMatchFormat(value) {
  return value === "doubles" ? "doubles" : "singles";
}

function normalizeDoublesMode(value) {
  return value === "keep_teams" ? "keep_teams" : "rotate_players";
}

function rotateArray(array, steps) {
  if (array.length === 0) return [];
  const normalizedSteps = ((steps % array.length) + array.length) % array.length;
  if (normalizedSteps === 0) return array.slice();
  return array.slice(normalizedSteps).concat(array.slice(0, normalizedSteps));
}

function shuffleArray(array) {
  const shuffled = array.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function generateRoundRobinSchedule(players) {
  const list = players.slice();
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  if (n < 2) return [];

  let roundList = list.slice();
  const rounds = [];

  for (let round = 0; round < n - 1; round += 1) {
    const pairs = [];
    for (let i = 0; i < n / 2; i += 1) {
      const left = roundList[i];
      const right = roundList[n - 1 - i];
      if (left && right) pairs.push([left, right]);
    }
    rounds.push(pairs);

    const fixed = roundList[0];
    const rest = roundList.slice(1);
    rest.unshift(rest.pop());
    roundList = [fixed, ...rest];
  }

  return rounds;
}

function computeMode({ playersCount, numCourts, matchFormat }) {
  if (matchFormat === "singles" && playersCount <= 2 * numCourts) return "round_robin";
  return "rotation";
}

function computeView(state) {
  const players = Array.isArray(state.players) ? state.players : [];
  const numCourts = clampNumber(state.numCourts, { min: 1, max: 24, fallback: 4 });
  const matchFormat = normalizeMatchFormat(state.matchFormat ?? state.format);
  const doublesMode = normalizeDoublesMode(state.doublesMode);
  const playersPerSide = matchFormat === "doubles" ? 2 : 1;
  const playersPerMatch = playersPerSide * 2;
  const roundIndex = clampNumber(state.roundIndex, {
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    fallback: 0,
  });
  const rotationStepFallback =
    matchFormat === "doubles" && doublesMode === "keep_teams" ? numCourts * 2 : numCourts;
  const rotationStepStored = clampNumber(state.rotationStep, {
    min: 1,
    max: 24,
    fallback: rotationStepFallback,
  });
  const mode = computeMode({ playersCount: players.length, numCourts, matchFormat });

  if (players.length < playersPerMatch) {
    return {
      playersCount: players.length,
      players,
      numCourts,
      mode,
      format: matchFormat,
      doublesMode,
      playersPerSide,
      roundIndex,
      rotationStep: rotationStepStored,
      roundLabel: "Add players to start",
      matches: [],
      bench: [],
      updatedAt: state.updatedAt ?? Date.now(),
    };
  }

  if (mode === "round_robin") {
    const rounds = generateRoundRobinSchedule(players);
    const totalRounds = rounds.length || 1;
    const effectiveIndex = roundIndex % totalRounds;
    const pairs = rounds[effectiveIndex] ?? [];

    const matches = [];
    for (let court = 1; court <= numCourts; court += 1) {
      const pair = pairs[court - 1];
      if (!pair) {
        matches.push({ court, sideA: [], sideB: [] });
        continue;
      }
      matches.push({ court, sideA: [pair[0]], sideB: [pair[1]] });
    }

    return {
      playersCount: players.length,
      players,
      numCourts,
      mode,
      format: matchFormat,
      doublesMode,
      playersPerSide,
      roundIndex: effectiveIndex,
      rotationStep: rotationStepStored,
      roundLabel: `Rotation ${effectiveIndex + 1} / ${totalRounds}`,
      matches,
      bench: [],
      updatedAt: state.updatedAt ?? Date.now(),
    };
  }

  if (matchFormat === "singles") {
    const stepDefault = Math.max(1, Math.min(numCourts, players.length - 1));
    const rotationStep = clampNumber(state.rotationStep, {
      min: 1,
      max: Math.max(1, players.length - 1),
      fallback: stepDefault,
    });
    const rotated = rotateArray(players, roundIndex * rotationStep);
    const maxActive = 2 * numCourts;
    const activeCount = Math.min(rotated.length, maxActive);
    const usedCount = Math.floor(activeCount / 2) * 2;
    const active = rotated.slice(0, usedCount);
    const bench = rotated.slice(usedCount);

    const matches = [];
    for (let i = 0; i < active.length / 2; i += 1) {
      const court = i + 1;
      const player1 = active[i];
      const player2 = active[active.length - 1 - i];
      matches.push({ court, sideA: [player1], sideB: [player2] });
    }

    return {
      playersCount: players.length,
      players,
      numCourts,
      mode,
      format: matchFormat,
      doublesMode,
      playersPerSide,
      roundIndex,
      rotationStep,
      roundLabel: `Rotation ${roundIndex + 1}`,
      matches,
      bench,
      updatedAt: state.updatedAt ?? Date.now(),
    };
  }

  if (doublesMode === "keep_teams") {
    const teams = [];
    const unpaired = [];
    for (let i = 0; i < players.length; i += 2) {
      const a = players[i];
      const b = players[i + 1];
      if (a && b) teams.push([a, b]);
      else if (a) unpaired.push(a);
    }

    if (teams.length < 2) {
      return {
        playersCount: players.length,
        players,
        numCourts,
        mode,
        format: matchFormat,
        doublesMode,
        playersPerSide,
        roundIndex,
        rotationStep: rotationStepStored,
        roundLabel: "Add 4+ players to start",
        matches: [],
        bench: players.slice(),
        updatedAt: state.updatedAt ?? Date.now(),
      };
    }

    const stepDefault = Math.max(1, Math.min(numCourts * 2, teams.length - 1));
    const rotationStep = clampNumber(state.rotationStep, {
      min: 1,
      max: Math.max(1, teams.length - 1),
      fallback: stepDefault,
    });

    const rotatedTeams = rotateArray(teams, roundIndex * rotationStep);
    const maxTeamsActive = 2 * numCourts;
    const activeTeamsCount = Math.min(rotatedTeams.length, maxTeamsActive);
    const usedTeamsCount = Math.floor(activeTeamsCount / 2) * 2;
    const activeTeams = rotatedTeams.slice(0, usedTeamsCount);
    const benchTeams = rotatedTeams.slice(usedTeamsCount);

    const matches = [];
    for (let i = 0; i < activeTeams.length / 2; i += 1) {
      const court = i + 1;
      const sideA = activeTeams[i];
      const sideB = activeTeams[activeTeams.length - 1 - i];
      matches.push({ court, sideA, sideB });
    }

    const bench = unpaired.concat(benchTeams.flat());

    return {
      playersCount: players.length,
      players,
      numCourts,
      mode,
      format: matchFormat,
      doublesMode,
      playersPerSide,
      roundIndex,
      rotationStep,
      roundLabel: `Rotation ${roundIndex + 1}`,
      matches,
      bench,
      updatedAt: state.updatedAt ?? Date.now(),
    };
  }

  const stepDefault = Math.max(1, Math.min(numCourts * 2, players.length - 1));
  const rotationStep = clampNumber(state.rotationStep, {
    min: 1,
    max: Math.max(1, players.length - 1),
    fallback: stepDefault,
  });
  const rotated = rotateArray(players, roundIndex * rotationStep);
  const maxActive = 4 * numCourts;
  const activeCount = Math.min(rotated.length, maxActive);
  const usedCount = Math.floor(activeCount / 4) * 4;
  const active = rotated.slice(0, usedCount);
  const bench = rotated.slice(usedCount);

  const matches = [];
  for (let i = 0; i < active.length / 4; i += 1) {
    const court = i + 1;
    const [a, b, c, d] = active.slice(i * 4, i * 4 + 4);
    const even = roundIndex % 2 === 0;
    const sideA = even ? [a, b] : [a, d];
    const sideB = even ? [c, d] : [b, c];
    matches.push({ court, sideA, sideB });
  }

  return {
    playersCount: players.length,
    players,
    numCourts,
    mode,
    format: matchFormat,
    doublesMode,
    playersPerSide,
    roundIndex,
    rotationStep,
    roundLabel: `Rotation ${roundIndex + 1}`,
    matches,
    bench,
    updatedAt: state.updatedAt ?? Date.now(),
  };
}

function defaultState() {
  return {
    players: [],
    numCourts: 4,
    roundIndex: 0,
    rotationStep: 4,
    matchFormat: "singles",
    doublesMode: "rotate_players",
    updatedAt: Date.now(),
    version: 1,
  };
}

const STATE_KEY = "corte:state";

function createStateStore() {
  const requested = process.env.STATE_STORE;
  const useKv = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;
  const type = requested || (useKv ? "kv" : process.env.VERCEL ? "memory" : "file");

  if (type === "kv") {
    const { kv } = require("@vercel/kv");
    let cachedState = null;
    let cacheTime = 0;
    const CACHE_TTL = 500; // 500ms cache to reduce KV reads

    return {
      async load() {
        const now = Date.now();
        if (cachedState && now - cacheTime < CACHE_TTL) {
          return cachedState;
        }
        try {
          const stored = await kv.get(STATE_KEY);
          cachedState = stored ? { ...defaultState(), ...stored } : defaultState();
          cacheTime = now;
          return cachedState;
        } catch (err) {
          console.error("KV load error:", err);
          return cachedState || defaultState();
        }
      },
      async save(nextState) {
        const stateWithVersion = { ...nextState, version: (nextState.version || 0) + 1 };
        try {
          await kv.set(STATE_KEY, stateWithVersion);
          cachedState = stateWithVersion;
          cacheTime = Date.now();
        } catch (err) {
          console.error("KV save error:", err);
        }
        return stateWithVersion;
      },
      type,
      async: true,
    };
  }

  if (type === "memory") {
    let state = defaultState();
    return {
      load() {
        return state;
      },
      save(nextState) {
        state = { ...nextState, version: (nextState.version || 0) + 1 };
        return state;
      },
      type,
      async: false,
    };
  }

  const dataDir = path.join(__dirname, "data");
  const statePath = path.join(dataDir, "state.json");

  return {
    load() {
      try {
        const raw = fs.readFileSync(statePath, "utf8");
        const parsed = JSON.parse(raw);
        return { ...defaultState(), ...parsed };
      } catch {
        return defaultState();
      }
    },
    save(nextState) {
      const stateWithVersion = { ...nextState, version: (nextState.version || 0) + 1 };
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify(stateWithVersion, null, 2) + "\n", "utf8");
      } catch {
        // ignore (serverless / read-only filesystems)
      }
      return stateWithVersion;
    },
    type,
    async: false,
  };
}

function base64UrlToBuffer(str) {
  return Buffer.from(str, "base64url");
}

function timingSafeEqualStrings(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function parseScryptHash(stored) {
  const value = String(stored ?? "").trim();
  const parts = value.split("$");
  if (parts.length !== 3) return null;
  const [kind, saltB64, hashB64] = parts;
  if (kind !== "scrypt") return null;
  if (!saltB64 || !hashB64) return null;
  try {
    return { salt: base64UrlToBuffer(saltB64), hash: base64UrlToBuffer(hashB64) };
  } catch {
    return null;
  }
}

function verifyPassword(password, storedHash) {
  const parsed = parseScryptHash(storedHash);
  if (!parsed) return false;
  const derived = crypto.scryptSync(String(password ?? ""), parsed.salt, parsed.hash.length);
  if (derived.length !== parsed.hash.length) return false;
  return crypto.timingSafeEqual(derived, parsed.hash);
}

function parseCookies(req) {
  const header = String(req.headers.cookie ?? "");
  const pairs = header.split(";").map((s) => s.trim());
  const cookies = {};
  for (const pair of pairs) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function parseBearerToken(req) {
  const header = String(req.headers.authorization ?? "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isHttps(req) {
  if (req.secure) return true;
  const proto = String(req.headers["x-forwarded-proto"] ?? "").toLowerCase();
  return proto === "https";
}

function signSession(payloadB64, secret) {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function createSessionToken({ secret, maxAgeSeconds }) {
  const now = Date.now();
  const payload = { v: 1, iat: now, exp: now + maxAgeSeconds * 1000 };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = signSession(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

function verifySessionToken(token, { secret }) {
  const raw = String(token ?? "");
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;
  const expectedSig = signSession(payloadB64, secret);
  if (!timingSafeEqualStrings(sig, expectedSig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (payload?.v !== 1) return null;
    if (!Number.isFinite(payload?.exp) || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function createApp({ onStateChange } = {}) {
  const store = createStateStore();
  let state = null; // Will be loaded on first request
  let stateLoaded = false;

  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const authEnabled = Boolean(passwordHash && parseScryptHash(passwordHash));
  const sessionSecret = process.env.ADMIN_SESSION_SECRET || passwordHash || "dev-secret";

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  // Middleware to ensure state is loaded before handling API requests
  async function ensureState(req, res, next) {
    if (!stateLoaded) {
      state = await Promise.resolve(store.load());
      stateLoaded = true;
    } else if (store.async) {
      // For async stores, always load fresh state on mutating requests
      if (req.method === "POST") {
        state = await Promise.resolve(store.load());
      }
    }
    next();
  }

  function requireAdmin(req, res, next) {
    if (!authEnabled) return next();
    const cookies = parseCookies(req);
    const token = cookies[COOKIE_NAME];
    const bearer = parseBearerToken(req);
    const payload = verifySessionToken(token || bearer, { secret: sessionSecret });
    if (!payload) return res.status(401).json({ ok: false, error: "unauthorized" });
    return next();
  }

  app.use(express.static(PUBLIC_DIR));

  app.get("/", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
  app.get("/admin", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
  });
  app.get("/tv", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "tv.html"));
  });

  app.get("/api/view", ensureState, async (req, res) => {
    res.json(computeView(state));
  });

  app.get("/api/auth/status", (req, res) => {
    if (!authEnabled) return res.json({ ok: true, enabled: false });
    const cookies = parseCookies(req);
    const token = cookies[COOKIE_NAME];
    const bearer = parseBearerToken(req);
    const payload = (token || bearer) ? verifySessionToken(token || bearer, { secret: sessionSecret }) : null;
    if (!payload) return res.status(401).json({ ok: false, enabled: true });
    return res.json({ ok: true, enabled: true });
  });

  app.post("/api/auth/login", (req, res) => {
    if (!authEnabled) return res.status(400).json({ ok: false, error: "auth_not_configured" });
    const password = String(req.body?.password ?? "");
    const ok = verifyPassword(password, passwordHash);
    if (!ok) return res.status(401).json({ ok: false, error: "invalid_password" });

    const token = createSessionToken({ secret: sessionSecret, maxAgeSeconds: SESSION_MAX_AGE_SECONDS });
    const cookieParts = [
      `${COOKIE_NAME}=${encodeURIComponent(token)}`,
      "Path=/",
      `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
      "HttpOnly",
      "SameSite=Lax",
    ];
    if (isHttps(req)) cookieParts.push("Secure");
    res.setHeader("Set-Cookie", cookieParts.join("; "));
    return res.json({ ok: true, token });
  });

  app.post("/api/auth/logout", (req, res) => {
    const cookieParts = [
      `${COOKIE_NAME}=`,
      "Path=/",
      "Max-Age=0",
      "HttpOnly",
      "SameSite=Lax",
    ];
    if (isHttps(req)) cookieParts.push("Secure");
    res.setHeader("Set-Cookie", cookieParts.join("; "));
    return res.json({ ok: true });
  });

  async function commit(nextState) {
    const stateWithTimestamp = { ...nextState, updatedAt: Date.now() };
    state = await Promise.resolve(store.save(stateWithTimestamp));
    const view = computeView(state);
    if (typeof onStateChange === "function") onStateChange(view);
    return view;
  }

  app.post("/api/setup", requireAdmin, ensureState, async (req, res) => {
    const players = normalizePlayers(req.body?.players ?? req.body?.playersText);
    const numCourts = clampNumber(req.body?.numCourts, { min: 1, max: 24, fallback: 4 });
    const matchFormat = normalizeMatchFormat(req.body?.matchFormat ?? req.body?.format ?? state.matchFormat);
    const doublesMode = normalizeDoublesMode(req.body?.doublesMode ?? req.body?.teamMode ?? state.doublesMode);
    const rotationStepDefault =
      matchFormat === "doubles" && doublesMode === "keep_teams" ? numCourts * 2 : numCourts;
    const rotationStep = clampNumber(req.body?.rotationStep, {
      min: 1,
      max: 24,
      fallback: rotationStepDefault,
    });

    // Preserve roundIndex if only changing settings (not players)
    const currentPlayers = Array.isArray(state.players) ? state.players : [];
    const playersChanged = players.length !== currentPlayers.length ||
      players.some((p, i) => p !== currentPlayers[i]);
    const roundIndex = playersChanged ? 0 : (state.roundIndex ?? 0);

    const view = await commit({
      ...state,
      players,
      numCourts,
      roundIndex,
      rotationStep,
      matchFormat,
      doublesMode,
    });
    res.json(view);
  });

  app.post("/api/next", requireAdmin, ensureState, async (req, res) => {
    const view = computeView(state);
    if (view.mode === "round_robin") {
      const totalRounds = generateRoundRobinSchedule(view.players).length || 1;
      res.json(await commit({ ...state, roundIndex: (view.roundIndex + 1) % totalRounds }));
      return;
    }
    res.json(await commit({ ...state, roundIndex: (state.roundIndex ?? 0) + 1 }));
  });

  app.post("/api/prev", requireAdmin, ensureState, async (req, res) => {
    const view = computeView(state);
    if (view.mode === "round_robin") {
      const totalRounds = generateRoundRobinSchedule(view.players).length || 1;
      const nextIndex = (view.roundIndex + totalRounds - 1) % totalRounds;
      res.json(await commit({ ...state, roundIndex: nextIndex }));
      return;
    }
    const current = clampNumber(state.roundIndex, {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      fallback: 0,
    });
    res.json(await commit({ ...state, roundIndex: Math.max(0, current - 1) }));
  });

  app.post("/api/shuffle", requireAdmin, ensureState, async (req, res) => {
    const players = shuffleArray(Array.isArray(state.players) ? state.players : []);
    res.json(await commit({ ...state, players, roundIndex: 0 }));
  });

  app.post("/api/reset", requireAdmin, ensureState, async (req, res) => {
    res.json(await commit(defaultState()));
  });

  return app;
}

module.exports = { createApp };
