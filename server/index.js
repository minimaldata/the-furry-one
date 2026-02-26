import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { createWorld } from './sim.js';

const PORT = Number(process.env.PORT || 8080);
const SNAP_HZ = Number(process.env.SNAP_HZ || 20);
const TICK_HZ = Number(process.env.TICK_HZ || 60);
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS || 30_000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Optional static hosting for the built client (dist/)
const serveStatic = process.env.SERVE_STATIC !== '0';
if (serveStatic) {
  const distDir = path.join(__dirname, '..', 'dist');
  app.use(express.static(distDir));
  app.get('/', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.get('/healthz', (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const sim = createWorld();

/** @type {Map<string, { ws: import('ws').WebSocket, playerId: string, name: string }>} */
const clients = new Map();

function wsSend(ws, obj) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(obj));
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const { ws } of clients.values()) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function makePlayerId() {
  return `p_${crypto.randomUUID()}`;
}

function safeParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

wss.on('connection', (ws) => {
  const connId = crypto.randomUUID();
  let playerId = null;

  ws.on('message', (data) => {
    const msg = safeParse(data.toString());
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      const desiredId = typeof msg.playerId === 'string' ? msg.playerId : null;
      const name = (typeof msg.name === 'string' ? msg.name : 'Player').slice(0, 24);

      // Reconnect if possible
      if (desiredId) {
        const existing = sim.getPlayer(desiredId);
        if (existing && existing.human) {
          playerId = desiredId;
          existing.name = name;
          sim.markReconnected(playerId);
        }
      }

      if (!playerId) {
        playerId = makePlayerId();
        sim.addHumanPlayer({ id: playerId, name });
      }

      clients.set(connId, { ws, playerId, name });

      wsSend(ws, { type: 'welcome', playerId, state: sim.snapshot() });
      broadcast({ type: 'presence', event: 'join', playerId, name });
      return;
    }

    if (!playerId) return;

    if (msg.type === 'input') {
      sim.applyInput(playerId, msg);
      return;
    }

    if (msg.type === 'reset') {
      // allow anyone to reset
      sim.reset();
      broadcast({ type: 'state', state: sim.snapshot() });
      return;
    }
  });

  ws.on('close', () => {
    const c = clients.get(connId);
    if (c?.playerId) {
      sim.markDisconnected(c.playerId);
      broadcast({ type: 'presence', event: 'leave', playerId: c.playerId });
    }
    clients.delete(connId);
  });
});

// Simulation tick loop
setInterval(() => {
  const dt = 1 / TICK_HZ;
  sim.step(dt);
  sim.pruneDisconnected(DISCONNECT_GRACE_MS);
}, Math.floor(1000 / TICK_HZ));

// Snapshot broadcast loop
setInterval(() => {
  broadcast({ type: 'state', state: sim.snapshot() });
}, Math.floor(1000 / SNAP_HZ));

server.listen(PORT, () => {
  console.log(`[server] listening on :${PORT} (tick ${TICK_HZ}hz, snap ${SNAP_HZ}hz)`);
  if (serveStatic) console.log('[server] serving ../dist');
});
