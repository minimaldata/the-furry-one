# The Furry One

A small 2D dodgeball tag game prototype.

- **Offline mode:** runs entirely in the browser (single-player + bots)
- **Online mode:** single global room using an **authoritative Node WebSocket server** that simulates at **60Hz** and broadcasts state snapshots at **20Hz**

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

### 2) Server (authoritative WS sim)
In another terminal:
```bash
cd server
npm install
npm run start
```

The server listens on `http://localhost:8080` (and WS on `ws://localhost:8080`).

### Client → Server URL
The browser client reads this env var:
- `VITE_WS_URL` (example: `ws://localhost:8080`)

Create a `.env.local` in the repo root:
```bash
VITE_WS_URL=ws://localhost:8080
```

If the client can’t connect quickly, it automatically falls back to **Offline**.

## Build
```bash
npm run build
```

## Deploy (Render)
This repo includes a Node server in `server/`.

Suggested Render settings:
- **Root Directory:** `server`
- **Build Command:** `npm install`
- **Start Command:** `node index.js`
- **Env Vars:**
  - `PORT` (Render sets this automatically)
  - `SERVE_STATIC=1` (optional: to serve `../dist`)

If you want the server to serve the built client:
1) Build the client during deploy (one approach):
   - Render build command could be something like:
     - `cd .. && npm install && npm run build && cd server && npm install`
2) Set `SERVE_STATIC=1`

Otherwise, deploy the client separately (static site) and point it at the server with:
- `VITE_WS_URL=wss://YOUR-RENDER-SERVICE.onrender.com`
