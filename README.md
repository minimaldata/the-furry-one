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
Scores are ranked by:
1) higher total points
2) lower total game time
3) lower time spent as IT
