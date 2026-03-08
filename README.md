# The Furry One

A small 2D dodgeball tag game prototype.

- **Offline mode:** runs entirely in the browser (single-player + bots)
- **High scores:** optional HTTP score service for saving best runs by name

## Controls
- Move: WASD / Arrow Keys
- Aim: Move in the direction you want to throw
- Throw (only when you are **IT**): hold Space to charge, release to throw

Goal: spend the least total time as **IT**.

## Local Dev

### 1) Client (Vite)
```bash
npm install
npm run dev
```

### 2) Server (high score API)
In another terminal:
```bash
cd server
npm install
npm run start
```

The server listens on `http://localhost:8080`.

### Client → Server URL
The browser client reads this env var:
- `VITE_API_URL` (example: `http://localhost:8080`)

Create a `.env.local` in the repo root:
```bash
VITE_API_URL=http://localhost:8080
```

If the score server is unavailable, the game still runs fully offline; only score saving/loading is affected.

## Build
```bash
npm run build
```

## Deploy (Render)
This repo includes a small Node HTTP server in `server/`.

Suggested Render settings:
- **Root Directory:** `server`
- **Build Command:** `npm install`
- **Start Command:** `node index.js`
- **Env Vars:**
  - `PORT` (Render sets this automatically)
  - `SERVE_STATIC=1` (optional: to serve `../dist`)
  - `DATA_DIR=/var/data` (recommended if you attach a persistent disk)

If you want the server to serve the built client:
1) Build the client during deploy (one approach):
   - Render build command could be something like:
     - `cd .. && npm install && npm run build && cd server && npm install`
2) Set `SERVE_STATIC=1`

Otherwise, deploy the client separately (static site) and point it at the server with:
- `VITE_API_URL=https://YOUR-RENDER-SERVICE.onrender.com`

### Password-Protected Names
- You can save a name without a password, but that name remains unprotected.
- If you set a password, future score submissions for that name require the same password.
- Passwords are stored server-side as hashes.

### High Score Ranking
All submitted runs are stored (not only each player's best run).

High scores are shown separately per IT rule (`hybrid`, `throw-only`, `tag-only`), and each table is the top runs for that rule.

Scores are ranked by:
1) higher total points
2) lower total game time
3) lower time spent as IT

### Score Distribution Chart
The high score modal includes an interactive PDF (probability density function) chart (x-axis: points 0-100):
- blue line: score density for everyone
- green line: score density for the current profile name

Hover the chart to compare density at an exact score (`N points`).

### Player Analytics (Min Runs Filter)
The score card now includes comparison analytics across three core questions:
1) when a player wins (`100 pts`), how long it takes (median win time)
2) how often they win (win rate)
3) when they do not win, what score they usually get (median non-win score)

Use:
- `Compare` input: comma-separated player names (example: `alice,bob,yoyoyo`)
- `Min Runs`: default `5` (players below threshold are marked `low n`)

When no compare names are entered, the app auto-shows top comparable players who meet the run threshold.

### Scatter Plot (Run Window)
The score card includes a `Scatter Plot` section:
- each dot: one player
- `Losers` mode: X axis is average score over selected runs; Y axis is average win rate over selected runs
- `Winners` mode: X axis is average game time over selected wins (descending); Y axis is average IT time over selected wins (descending)

Window options:
- `Last N ...` (runs for Losers, wins for Winners; default `N=5`)
- `Between ... N and M` (inclusive, by each player's ordered history of runs/wins for the selected type)

If multiple players land in the same plotted position, dots are radially spread so overlaps remain visible.

### Dummy Local Test Data
Use local dummy score data by opening the app with:
```bash
http://localhost:5173/?dummyScores=1
```
Or switch the "Data" selector in the high score card to `dummy (local test)`.
