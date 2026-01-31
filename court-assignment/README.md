# corte

Local‑network court rotation for a racket club: one URL for phone input, one URL for the TV.

## Quick start

1) Install deps:

```bash
npm install
```

2) Run the server:

```bash
npm start
```

3) Open on the same network:

- Coach/phone: `http://<server-ip>:3000/admin`
- TV display: `http://<server-ip>:3000/tv`

`<server-ip>` must be the LAN IP of the machine running the server (not `localhost`).

## How it works

- Enter player names (one per line) and the number of courts on `/admin`.
- Choose `1v1` (singles) or `2v2` (doubles). For doubles, choose whether teams stay together or players rotate into new teams.
- The TV page `/tv` updates instantly when you press **Start / Update** or **Next Rotation**.
- `1v1`: if `players <= 2 * courts`, everyone plays (all‑play). Otherwise it rotates who plays and shows a “Sitting out” list.
- `2v2`: each court uses 4 players; if you have more than `4 * courts`, it shows “Sitting out”.

## Using on iPhone

1) Make sure your iPhone is on the same Wi‑Fi as the computer running `corte`.
2) Find the computer’s LAN IP (macOS: System Settings → Network → Wi‑Fi → Details).
3) On iPhone Safari, open `http://<server-ip>:3000/admin`.

Tip: In Safari, Share → **Add to Home Screen** to get an “app” icon.

## Config

- Port: set `PORT`, e.g. `PORT=8080 npm start`

## Admin password

By default, `/admin` is unlocked. To require a password, set these env vars:

1) Generate values:

```bash
npm run hash-password -- "your password"
```

2) Set the printed `ADMIN_PASSWORD_HASH` (and optionally `ADMIN_SESSION_SECRET`) in your environment.
Sessions last 90 minutes by default.

## Deploy to Vercel

This repo includes `vercel.json` + `api/index.js` for Vercel.

- Set `ADMIN_PASSWORD_HASH` in Vercel Environment Variables to protect `/admin`.
- Note: Vercel serverless does not support WebSockets here, so `/tv` and `/admin` fall back to polling for updates.
- Note: state is in-memory on Vercel (`STATE_STORE=memory`), so it can reset on cold starts/redeploys.
