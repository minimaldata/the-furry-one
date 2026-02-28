import './style.css';

// The Furry One — offline single-player + online multiplayer (single global room)
// Offline (fallback): client sim
// Online: authoritative server sim via WebSocket snapshots

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function rand01() { return Math.random(); }
function randN() {
  // rough normal via Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

function vecLen(x, y) { return Math.hypot(x, y); }
function vecNorm(x, y) {
  const L = Math.hypot(x, y) || 1;
  return [x / L, y / L];
}
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => (
    ch === '&' ? '&amp;'
    : ch === '<' ? '&lt;'
    : ch === '>' ? '&gt;'
    : ch === '"' ? '&quot;'
    : '&#39;'
  ));
}

// Shared constants (keep in sync with server/sim.js)
const ARENA_W = 1200;
const ARENA_H = 720;

const PLAYER_RADIUS = 14;
const BALL_RADIUS = 9;
const MAX_THROW_SPEED = 1060;
const MIN_THROW_SPEED = 320;
const CHARGE_MS = 620;
const FRICTION = 0.90;
const BALL_FRICTION = 0.992;
const BOT_COUNT = 14;
const HIT_COOLDOWN_MS = 450;
const TOUCH_TAG_COOLDOWN_MS = 650;
const IT_PICKUP_RADIUS = PLAYER_RADIUS + BALL_RADIUS + 8;

const WIN_POINTS = 100;
const PROX_MAX_DIST = 260;
const PROX_POINTS_PER_SEC = 16;
const IT_BLEED_POINTS_PER_SEC = 6;

const BOT_STATES = {
  FARM_IT: 'FARM_IT',
  EVADE_IT: 'EVADE_IT',
  AVOID_LOOSE_BALL: 'AVOID_LOOSE_BALL',
  CONTEST_BALL: 'CONTEST_BALL',
  DODGE_THROW: 'DODGE_THROW',
  PANIC: 'PANIC',
  IT_TAG_RUSH: 'IT_TAG_RUSH',
  IT_HUNT: 'IT_HUNT',
  IT_CHASE_BALL: 'IT_CHASE_BALL',
  IT_WINDUP: 'IT_WINDUP',
};

const BOT_STATE_COLORS = {
  [BOT_STATES.FARM_IT]: '#14b8a6',
  [BOT_STATES.EVADE_IT]: '#eab308',
  [BOT_STATES.AVOID_LOOSE_BALL]: '#38bdf8',
  [BOT_STATES.CONTEST_BALL]: '#a78bfa',
  [BOT_STATES.DODGE_THROW]: '#fb7185',
  [BOT_STATES.PANIC]: '#f43f5e',
  [BOT_STATES.IT_TAG_RUSH]: '#fb923c',
  [BOT_STATES.IT_HUNT]: '#ef4444',
  [BOT_STATES.IT_CHASE_BALL]: '#60a5fa',
  [BOT_STATES.IT_WINDUP]: '#f97316',
};

const DEV_COLOR_MODES = {
  NONE: 'none',
  STATE: 'state',
  TARGETED: 'targeted',
  PANIC: 'panic',
  BOLDNESS: 'boldness',
  CONFIDENCE: 'confidence',
};

const DEV_COLOR_OPTIONS = [
  { value: DEV_COLOR_MODES.NONE, label: 'none' },
  { value: DEV_COLOR_MODES.STATE, label: 'active state' },
  { value: DEV_COLOR_MODES.TARGETED, label: 'targeted' },
  { value: DEV_COLOR_MODES.PANIC, label: 'panic level' },
  { value: DEV_COLOR_MODES.BOLDNESS, label: 'boldness' },
  { value: DEV_COLOR_MODES.CONFIDENCE, label: 'confidence' },
];

const IT_TRANSFER_RULES = {
  HYBRID: 'hybrid',
  THROW_ONLY: 'throw-only',
  TAG_ONLY: 'tag-only',
};

const IT_TRANSFER_OPTIONS = [
  { value: IT_TRANSFER_RULES.HYBRID, label: 'hybrid' },
  { value: IT_TRANSFER_RULES.THROW_ONLY, label: 'always throw' },
  { value: IT_TRANSFER_RULES.TAG_ONLY, label: 'always tag' },
];

const COLORS = {
  arena: '#0a0d14',
  grid: 'rgba(255,255,255,.04)',
  text: 'rgba(255,255,255,.90)',
  muted: 'rgba(255,255,255,.60)',
  me: '#22c55e',
  bot: 'rgba(255,255,255,.86)',
  it: '#f59e0b',
  ball: '#a78bfa',
  aim: 'rgba(167,139,250,.35)',
};

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="top">
    <div class="brand">
      <div class="title">The Furry One</div>
      <div class="subtitle">Move: WASD/Arrows · Aim by movement · Throw (when IT): hold Space, release</div>
    </div>
    <div class="hud">
      <div class="pill" id="status">Loading…</div>
      <div class="pill" id="meStats">You: —</div>
      <div class="pill" id="goal">Goal: avoid IT</div>
      <button class="btn" id="reset">Reset</button>
    </div>
  </div>
  <div class="canvasWrap">
    <canvas id="c"></canvas>
    <div class="leaderboard" id="leaderboard"></div>
  </div>

  <div class="overlay" id="overlay">
    <div class="modal">
      <h2 id="endTitle">Choose mode</h2>
      <p id="endSub">Play offline (first to 100) or join the live online game (endless).</p>
      <div class="rows" id="endRows"></div>
      <div class="actions">
        <button class="btn" id="playOffline">Play offline</button>
        <button class="btn" id="playOnline">Play online</button>
      </div>
    </div>
  </div>

  <div class="help"></div>
`;

const canvas = document.querySelector('#c');
const ctx = canvas.getContext('2d');
const leaderboardEl = document.querySelector('#leaderboard');
let leaderboardSig = '';
let leaderboardRowsEl = null;
let leaderboardDevSelectEl = null;
let leaderboardRuleSelectEl = null;
if (leaderboardEl) {
  leaderboardEl.addEventListener('change', (e) => {
    const t = e.target;
    if (!t) return;
    if (t.id === 'devColorMode') {
      const next = String(t.value || DEV_COLOR_MODES.NONE);
      const ok = DEV_COLOR_OPTIONS.some(o => o.value === next);
      state.devColorMode = ok ? next : DEV_COLOR_MODES.NONE;
      return;
    }
    if (t.id === 'itTransferRule') {
      const next = String(t.value || IT_TRANSFER_RULES.HYBRID);
      const ok = IT_TRANSFER_OPTIONS.some(o => o.value === next);
      state.itTransferRule = ok ? next : IT_TRANSFER_RULES.HYBRID;
    }
  });
}

const view = { scale: 1, offX: 0, offY: 0 };

function updateView() {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const s = Math.min(cw / ARENA_W, ch / ARENA_H);
  view.scale = s;
  view.offX = (cw - ARENA_W * s) / 2;
  view.offY = (ch - ARENA_H * s) / 2;
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  // map drawing commands to CSS pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateView();
}
window.addEventListener('resize', resize);

function screenToWorld(sx, sy) {
  // sx,sy in CSS px relative to canvas
  return {
    x: clamp((sx - view.offX) / view.scale, 0, ARENA_W),
    y: clamp((sy - view.offY) / view.scale, 0, ARENA_H),
  };
}

function ensureLeaderboardUi() {
  if (!leaderboardEl) return false;
  if (leaderboardRowsEl && leaderboardDevSelectEl && leaderboardRuleSelectEl) {
    if (leaderboardDevSelectEl.value !== state.devColorMode) leaderboardDevSelectEl.value = state.devColorMode;
    if (leaderboardRuleSelectEl.value !== state.itTransferRule) leaderboardRuleSelectEl.value = state.itTransferRule;
    return true;
  }

  const devOptions = DEV_COLOR_OPTIONS.map((o) => (
    `<option value="${o.value}"${state.devColorMode === o.value ? ' selected' : ''}>${o.label}</option>`
  )).join('');
  const ruleOptions = IT_TRANSFER_OPTIONS.map((o) => (
    `<option value="${o.value}"${state.itTransferRule === o.value ? ' selected' : ''}>${o.label}</option>`
  )).join('');

  leaderboardEl.innerHTML = `
    <div class="leaderTitle">Leaderboard</div>
    <div class="leaderRows" id="leaderRows"></div>
    <div class="leaderDev">
      <label class="leaderDevLabel" for="devColorMode">Dev Mode</label>
      <select id="devColorMode" class="leaderSelect">${devOptions}</select>
    </div>
    <div class="leaderDev">
      <label class="leaderDevLabel" for="itTransferRule">IT Rule</label>
      <select id="itTransferRule" class="leaderSelect">${ruleOptions}</select>
    </div>
  `;
  leaderboardRowsEl = leaderboardEl.querySelector('#leaderRows');
  leaderboardDevSelectEl = leaderboardEl.querySelector('#devColorMode');
  leaderboardRuleSelectEl = leaderboardEl.querySelector('#itTransferRule');
  return !!leaderboardRowsEl;
}

function updateLeaderboard(players, myId) {
  if (!ensureLeaderboardUi()) return;
  const sorted = [...players].sort((a,b) => (b.score || 0) - (a.score || 0));
  const sig = sorted.map((p, i) => `${i}:${p.id}:${(p.score || 0).toFixed(0)}:${p.it ? 1 : 0}:${p.id === myId ? 1 : 0}`).join('|');
  if (sig !== leaderboardSig) {
    leaderboardSig = sig;
    leaderboardRowsEl.innerHTML = sorted.map((p, i) => {
      const isMe = p.id === myId;
      const itTag = p.it ? ' <span class="itTag">IT</span>' : '';
      const youTag = isMe ? ' <span class="youTag">YOU</span>' : '';
      return `<div class="leaderRow${isMe ? ' me' : ''}">
        <div class="leaderLeft">
          <span class="leaderRank">${i + 1}.</span>
          <span class="leaderName">${escapeHtml(p.name)}${youTag}${itTag}</span>
        </div>
        <div class="leaderScore">${(p.score || 0).toFixed(0)}</div>
      </div>`;
    }).join('');
  }
  if (leaderboardDevSelectEl && leaderboardDevSelectEl.value !== state.devColorMode) leaderboardDevSelectEl.value = state.devColorMode;
  if (leaderboardRuleSelectEl && leaderboardRuleSelectEl.value !== state.itTransferRule) leaderboardRuleSelectEl.value = state.itTransferRule;

  const me = players.find(p => p.id === myId);
  if (!me) {
    leaderboardEl.classList.remove('occluded');
    return;
  }

  const lb = leaderboardEl.getBoundingClientRect();
  if (lb.width <= 0 || lb.height <= 0) return;
  const c = canvas.getBoundingClientRect();
  const meX = c.left + view.offX + me.x * view.scale;
  const meY = c.top + view.offY + me.y * view.scale;
  const pad = 14;
  const occluded = meX >= (lb.left - pad) && meX <= (lb.right + pad) && meY >= (lb.top - pad) && meY <= (lb.bottom + pad);
  leaderboardEl.classList.toggle('occluded', occluded);
}

// Input
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','W','A','S','D',' '].includes(e.key)) e.preventDefault();
  keys.add(e.key);
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

const mouse = { sx: 0, sy: 0, x: ARENA_W/2, y: ARENA_H/2, down: false, downAt: 0 };
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouse.sx = e.clientX - r.left;
  mouse.sy = e.clientY - r.top;
  const w = screenToWorld(mouse.sx, mouse.sy);
  mouse.x = w.x;
  mouse.y = w.y;
});
canvas.addEventListener('mousedown', () => { mouse.down = true; mouse.downAt = performance.now(); });
window.addEventListener('mouseup', () => { mouse.down = false; });

function clearKeys() {
  keys.clear();
  state.wasSpaceDown = false;
  state.spaceDownAt = 0;
}
window.addEventListener('blur', clearKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearKeys(); });
window.addEventListener('focus', clearKeys);

// Offline simulation state (also reused as container for online snapshots)
function makePlayer(id, name, isHuman = false) {
  const pad = 60;
  return {
    id,
    name,
    human: isHuman,
    x: pad + rand01() * (ARENA_W - pad*2),
    y: pad + rand01() * (ARENA_H - pad*2),
    vx: 0,
    vy: 0,
    it: false,
    itStartAt: -1e9,
    furryMs: 0,
    score: 0,
    lastHitAt: -1e9,
    lastThrowAt: -1e9,

    aiming: false,
    aimCharge: 0,
    aimX: 0,
    aimY: 0,
    throwPlan: null,
    faceX: 1,
    faceY: 0,
    botState: isHuman ? null : BOT_STATES.FARM_IT,
    botStateSince: 0,
    botBoldBase: isHuman ? 0 : (0.35 + 0.60 * rand01()),
    botBoldPhase: isHuman ? 0 : (rand01() * TAU),
    botBoldTempoMs: isHuman ? 0 : (800 + rand01() * 2200),
    botStuckMs: 0,
    botPanicUntil: 0,
    botPanicRetargetAt: 0,
    botPanicDirX: 1,
    botPanicDirY: 0,
    botOrbitSign: isHuman ? 0 : (rand01() < 0.5 ? -1 : 1),
    botPerceptionLagMs: isHuman ? 0 : (95 + rand01() * 75),
    botPerception: isHuman ? null : {},
    botITTargetId: null,
    botITTargetSince: 0,
    botITRetargetAt: 0,
    botThrowConfidence: 0,
  };
}

const state = {
  nowMs: performance.now(),
  lastT: performance.now(),

  mode: null, // 'offline' | 'online'
  online: false,
  wsReady: false,
  playerId: null,
  devColorMode: DEV_COLOR_MODES.NONE,
  itTransferRule: IT_TRANSFER_RULES.HYBRID,

  players: [],
  obstacles: [],
  ball: null,
  itHasBall: false,
  itLostBallAtMs: 0,
  itBalllessMs: 0,
  wasSpaceDown: false,
  spaceDownAt: 0,

  over: false,
  winnerId: null,
};

function currentIt() { return state.players.find(p => p.it); }

function refreshItBallTracking(nowMs) {
  const it = currentIt();
  const hasBallNow = !!(it && state.ball && state.ball.heldBy === it.id);
  if (hasBallNow !== state.itHasBall) {
    state.itHasBall = hasBallNow;
    if (!hasBallNow) state.itLostBallAtMs = nowMs;
  }
  state.itBalllessMs = hasBallNow ? 0 : Math.max(0, nowMs - (state.itLostBallAtMs || nowMs));
  return hasBallNow;
}

function canItTagTransfer() {
  return state.itTransferRule !== IT_TRANSFER_RULES.THROW_ONLY;
}

function canItThrowTransfer() {
  return state.itTransferRule !== IT_TRANSFER_RULES.TAG_ONLY;
}

function setIt(playerId) {
  const now = state.nowMs;
  for (const p of state.players) {
    const next = (p.id === playerId);
    p.it = next;
    p.itStartAt = next ? now : -1e9;
  }
  state.ball.heldBy = playerId;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.itHasBall = true;
  state.itLostBallAtMs = now;
  state.itBalllessMs = 0;
}

function resetGameOffline() {
  state.nowMs = performance.now();
  state.lastT = performance.now();

  state.players = [makePlayer('me', 'You', true)];
  for (let i = 0; i < BOT_COUNT; i++) state.players.push(makePlayer('b' + i, 'Bot ' + (i + 1)));

  state.obstacles = [
    { x: ARENA_W*0.50 - 70, y: ARENA_H*0.50 - 18, w: 140, h: 36 },
    { x: ARENA_W*0.50 - 18, y: ARENA_H*0.50 - 70, w: 36, h: 140 },
    { x: ARENA_W*0.18 - 44, y: ARENA_H*0.30 - 28, w: 88, h: 56 },
    { x: ARENA_W*0.82 - 44, y: ARENA_H*0.70 - 28, w: 88, h: 56 },
  ];

  const itIdx = Math.floor(rand01() * state.players.length);
  for (let i = 0; i < state.players.length; i++) {
    const isIt = (i === itIdx);
    state.players[i].it = isIt;
    state.players[i].itStartAt = isIt ? state.nowMs : -1e9;
  }
  state.over = false;
  state.winnerId = null;

  state.ball = {
    x: ARENA_W / 2,
    y: ARENA_H / 2,
    vx: 0,
    vy: 0,
    heldBy: state.players.find(p => p.it)?.id || null,
    lastThrower: null,
    armed: false,
    thrownAt: -1e9,
  };

  state.itHasBall = true;
  state.itLostBallAtMs = state.nowMs;
  state.itBalllessMs = 0;

  state.wasSpaceDown = false;
  state.spaceDownAt = 0;

  for (const p of state.players) {
    p.aiming = false;
    p.aimCharge = 0;
    p.aimX = p.x;
    p.aimY = p.y;
    p.throwPlan = null;
    if (!p.human) {
      p.botState = BOT_STATES.FARM_IT;
      p.botStateSince = state.nowMs;
      p.botStuckMs = 0;
      p.botPanicUntil = 0;
      p.botPanicRetargetAt = 0;
      p.botPanicDirX = p.faceX || 1;
      p.botPanicDirY = p.faceY || 0;
      p.botPerception = {};
      p.botITTargetId = null;
      p.botITTargetSince = 0;
      p.botITRetargetAt = 0;
    }
  }
}

function segmentIntersectsRect(x1, y1, x2, y2, r) {
  const minX = r.x, maxX = r.x + r.w;
  const minY = r.y, maxY = r.y + r.h;
  let t0 = 0, t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;

  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };

  if (
    clip(-dx, x1 - minX) &&
    clip(dx, maxX - x1) &&
    clip(-dy, y1 - minY) &&
    clip(dy, maxY - y1)
  ) {
    return t0 <= t1;
  }
  return false;
}

function hasClearThrow(fromX, fromY, toX, toY) {
  for (const ob of state.obstacles) {
    if (segmentIntersectsRect(fromX, fromY, toX, toY, ob)) return false;
  }
  return true;
}

function setBotState(p, nextState) {
  if (p.botState === nextState) return;
  p.botState = nextState;
  p.botStateSince = state.nowMs;
}

function throwSpeedForCharge(charge01) {
  const c = clamp(charge01 || 0, 0, 1);
  const shaped = Math.pow(c, 0.74);
  return lerp(MIN_THROW_SPEED, MAX_THROW_SPEED, shaped);
}

function moveToward(p, dt, tx, ty, speed = 820, snap = 0.01) {
  const dx = tx - p.x;
  const dy = ty - p.y;
  const [nx, ny] = vecNorm(dx, dy);
  p.vx = lerp(p.vx, nx * speed, 1 - Math.pow(snap, dt));
  p.vy = lerp(p.vy, ny * speed, 1 - Math.pow(snap, dt));

  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.vx *= Math.pow(FRICTION, dt*60);
  p.vy *= Math.pow(FRICTION, dt*60);
  const sp = vecLen(p.vx, p.vy);
  if (sp > 30) {
    p.faceX = p.vx / sp;
    p.faceY = p.vy / sp;
  }
}

function isBallThreatening(p, b) {
  if (!b || b.heldBy || !b.armed) return false;
  const speed = vecLen(b.vx, b.vy);
  if (speed < 180) return false;

  const toPX = p.x - b.x;
  const toPY = p.y - b.y;
  const along = (toPX * b.vx + toPY * b.vy) / speed;
  if (along <= 0 || along > 520) return false;

  const lateral = Math.abs(toPX * (-b.vy / speed) + toPY * (b.vx / speed));
  return lateral < (PLAYER_RADIUS + BALL_RADIUS + 18);
}

function getBotBoldness(p, nowMs) {
  const base = clamp(Number(p.botBoldBase ?? 0.55), 0.08, 1);
  const phase = Number(p.botBoldPhase || 0);
  const tempo = Math.max(300, Number(p.botBoldTempoMs || 1400));
  const wave = Math.sin(nowMs / tempo + phase);
  const pulse = Math.sin(nowMs / (tempo * 0.53) + phase * 1.7);
  return clamp(base + wave * 0.18 + pulse * 0.08, 0.08, 1);
}

function getEndgameBoldnessBoost(p, players) {
  if (!Array.isArray(players) || players.length === 0) return 0;
  const bestScoreNow = Math.max(...players.map(x => x.score || 0));
  const lead01 = clamp(bestScoreNow / WIN_POINTS, 0, 1);
  const endgame01 = clamp((lead01 - 0.72) / 0.28, 0, 1);
  const ramp = endgame01 ** 1.55;
  const isLeader = (p.score || 0) >= (bestScoreNow - 0.01);
  const everybodyBoost = 0.14 * ramp;
  const chaseBoost = (isLeader ? 0.05 : 0.22) * ramp;
  return everybodyBoost + chaseBoost;
}

function getBotEffectiveBoldness(p, nowMs, players) {
  const base = getBotBoldness(p, nowMs);
  return clamp(base + getEndgameBoldnessBoost(p, players), 0.08, 1);
}

function getPerceivedTarget(bot, target, nowMs, lagMs) {
  if (!bot.botPerception) bot.botPerception = {};
  const k = String(target.id);
  const p = bot.botPerception[k];
  const intervalMs = Math.max(60, lagMs * (0.85 + 0.35 * rand01()));

  if (!p || nowMs >= p.nextRefreshAt) {
    const vel01 = clamp(vecLen(target.vx, target.vy) / 1050, 0, 1);
    const noisePx = 2 + 7 * vel01;
    bot.botPerception[k] = {
      x: target.x + randN() * noisePx,
      y: target.y + randN() * noisePx,
      vx: target.vx,
      vy: target.vy,
      score: target.score || 0,
      nextRefreshAt: nowMs + intervalMs,
    };
  }

  const s = bot.botPerception[k];
  return {
    id: target.id,
    name: target.name,
    score: s.score || 0,
    x: clamp(s.x, 0, ARENA_W),
    y: clamp(s.y, 0, ARENA_H),
    vx: s.vx || 0,
    vy: s.vy || 0,
  };
}

function getForwardDir(p) {
  const sp = vecLen(p.vx, p.vy);
  if (sp > 40) return [p.vx / sp, p.vy / sp];
  const fx = Number(p.faceX ?? 1);
  const fy = Number(p.faceY ?? 0);
  const fsp = vecLen(fx, fy);
  if (fsp > 0.01) return [fx / fsp, fy / fsp];
  return [1, 0];
}

function targetCluster01(target, nearbyTargets) {
  if (!target || !Array.isArray(nearbyTargets) || nearbyTargets.length < 2) return 0;
  let mass = 0;
  for (const q of nearbyTargets) {
    if (!q || q.id === target.id) continue;
    const d = vecLen((q.x || 0) - (target.x || 0), (q.y || 0) - (target.y || 0));
    if (d > 250) continue;
    mass += clamp(1 - d / 250, 0, 1);
  }
  return clamp(mass / 2.2, 0, 1);
}

function estimateThrowConfidence(thrower, target, charge01, nearbyTargets = null) {
  if (!thrower || !target) return 0;
  const charge = clamp(charge01 || 0, 0, 1);
  const [fx, fy] = getForwardDir(thrower);
  const speed = throwSpeedForCharge(charge);

  const dx0 = target.x - thrower.x;
  const dy0 = target.y - thrower.y;
  const along0 = dx0 * fx + dy0 * fy;
  if (along0 <= 0) return 0.02;

  const t = clamp(along0 / Math.max(220, speed), 0, 0.9);
  const px = target.x + (target.vx || 0) * t;
  const py = target.y + (target.vy || 0) * t;

  const dx = px - thrower.x;
  const dy = py - thrower.y;
  const dist = vecLen(dx, dy);
  if (dist > 1200) return 0.01;

  const along = dx * fx + dy * fy;
  if (along <= 0) return 0.02;

  const lateral = Math.abs(dx * (-fy) + dy * fx);
  const cos01 = clamp((along / (dist || 1) + 1) * 0.5, 0, 1);
  const speed01 = clamp((speed - MIN_THROW_SPEED) / (MAX_THROW_SPEED - MIN_THROW_SPEED), 0, 1);
  const laneHalf = PLAYER_RADIUS + BALL_RADIUS + 22 + 60 * (1 - charge) + 8 * speed01;
  const lane01 = clamp(1 - (lateral / laneHalf), 0, 1);
  const range01 = clamp(1 - dist / 1180, 0, 1);
  const los01 = hasClearThrow(thrower.x, thrower.y, px, py) ? 1 : 0.20;

  const targetLatV = Math.abs((target.vx || 0) * (-fy) + (target.vy || 0) * fx);
  const motion01 = clamp(1 - targetLatV / 900, 0, 1);

  const base = (cos01 ** 1.28) * (lane01 ** 1.04) * (0.36 + 0.64 * range01) * los01 * (0.58 + 0.42 * motion01) * (0.84 + 0.16 * speed01);

  let clusterBonus = 0;
  let isolationPenalty = 0;
  if (Array.isArray(nearbyTargets) && nearbyTargets.length > 1) {
    let clusterMass = 0;
    for (const q of nearbyTargets) {
      if (!q || q.id === target.id) continue;
      const qx = (q.x || 0) + (q.vx || 0) * t;
      const qy = (q.y || 0) + (q.vy || 0) * t;
      const qdx = qx - thrower.x;
      const qdy = qy - thrower.y;
      const qalong = qdx * fx + qdy * fy;
      if (qalong < along * 0.55 || qalong > along + 220) continue;
      const spread = vecLen(qx - px, qy - py);
      if (spread > 220) continue;
      clusterMass += clamp(1 - spread / 220, 0, 1);
    }
    const density01 = clamp(clusterMass / 2.0, 0, 1);
    clusterBonus = 0.38 * density01 * (0.62 + 0.38 * lane01);
    const isolated01 = 1 - density01;
    isolationPenalty = 0.16 * isolated01 * range01 * (0.58 + 0.42 * (1 - lane01));
  }

  return clamp(base + clusterBonus - isolationPenalty, 0, 1);
}

function choosePanicDir(p, it) {
  let wx = 0, wy = 0;
  if (p.x < 130) wx += 1;
  if (p.x > ARENA_W - 130) wx -= 1;
  if (p.y < 110) wy += 1;
  if (p.y > ARENA_H - 110) wy -= 1;

  let ox = 0, oy = 0;
  for (const ob of state.obstacles) {
    const cx = ob.x + ob.w * 0.5;
    const cy = ob.y + ob.h * 0.5;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = vecLen(dx, dy);
    if (d >= 210) continue;
    const w = (210 - d) / 210;
    ox += (dx / (d || 1)) * w;
    oy += (dy / (d || 1)) * w;
  }

  const [ix, iy] = vecNorm(p.x - it.x, p.y - it.y);
  const a = rand01() * TAU;
  const rx = Math.cos(a);
  const ry = Math.sin(a);
  const [nx, ny] = vecNorm(wx * 1.4 + ox * 1.8 + ix * 0.7 + rx * 1.25, wy * 1.4 + oy * 1.8 + iy * 0.7 + ry * 1.25);
  return [nx, ny];
}

function getOfflineBotColor(p, it, nowMs) {
  const mode = state.devColorMode || DEV_COLOR_MODES.NONE;
  if (mode === DEV_COLOR_MODES.NONE) return COLORS.bot;
  if (mode === DEV_COLOR_MODES.STATE) return BOT_STATE_COLORS[p.botState] || COLORS.bot;

  if (mode === DEV_COLOR_MODES.TARGETED) {
    const targetId = it?.botITTargetId || null;
    if (!targetId) return p.it ? COLORS.it : 'rgba(255,255,255,.60)';
    if (p.id === targetId) return '#ef4444';
    if (p.it) return '#f59e0b';
    return 'rgba(255,255,255,.30)';
  }

  if (mode === DEV_COLOR_MODES.PANIC) {
    const panicNow = (p.botPanicUntil && nowMs < p.botPanicUntil) ? 1 : 0;
    const buildup = clamp((p.botStuckMs || 0) / 340, 0, 1);
    const panic01 = Math.max(panicNow, buildup);
    const hue = Math.round(lerp(135, 0, panic01));
    return `hsl(${hue} 84% 56%)`;
  }

  if (mode === DEV_COLOR_MODES.BOLDNESS) {
    const b01 = clamp(getBotEffectiveBoldness(p, nowMs, state.players), 0, 1);
    const hue = Math.round(lerp(210, 20, b01));
    return `hsl(${hue} 86% 58%)`;
  }

  if (mode === DEV_COLOR_MODES.CONFIDENCE) {
    if (!p.it) return 'rgba(255,255,255,.22)';
    const c01 = clamp(p.botThrowConfidence || 0, 0, 1);
    const hue = Math.round(lerp(0, 132, c01));
    return `hsl(${hue} 88% 56%)`;
  }

  return COLORS.bot;
}

function moveHuman(p, dt) {
  let ax = 0, ay = 0;
  const up = keys.has('ArrowUp') || keys.has('w') || keys.has('W');
  const dn = keys.has('ArrowDown') || keys.has('s') || keys.has('S');
  const lf = keys.has('ArrowLeft') || keys.has('a') || keys.has('A');
  const rt = keys.has('ArrowRight') || keys.has('d') || keys.has('D');
  if (up) ay -= 1;
  if (dn) ay += 1;
  if (lf) ax -= 1;
  if (rt) ax += 1;
  const [nx, ny] = vecNorm(ax, ay);

  let speed = 1080;
  if (p.it) speed *= 0.88;
  if (p.it && canItThrowTransfer() && state.ball?.heldBy === p.id && keys.has(' ')) {
    if (state.spaceDownAt <= 0) state.spaceDownAt = state.nowMs;
    const start = state.spaceDownAt > 0 ? state.spaceDownAt : state.nowMs;
    const charge01 = clamp((state.nowMs - start) / CHARGE_MS, 0, 1);
    speed *= lerp(1, 0.60, charge01);
  }
  p.vx = lerp(p.vx, nx * speed, 1 - Math.pow(0.001, dt));
  p.vy = lerp(p.vy, ny * speed, 1 - Math.pow(0.001, dt));

  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.vx *= Math.pow(FRICTION, dt*60);
  p.vy *= Math.pow(FRICTION, dt*60);
  const sp = vecLen(p.vx, p.vy);
  if (sp > 30) {
    p.faceX = p.vx / sp;
    p.faceY = p.vy / sp;
  }
}

function moveBot(p, dt) {
  const it = currentIt();
  if (!it) return;

  const now = state.nowMs;
  const itHasBallNow = refreshItBallTracking(now);
  const allowTagTransfer = canItTagTransfer();
  const allowThrowTransfer = canItThrowTransfer();
  const b = state.ball;
  const targets = state.players.filter(q => q.id !== p.id);
  const bestScoreNow = Math.max(...state.players.map(x => x.score || 0));
  const behind01 = clamp((bestScoreNow - (p.score || 0)) / WIN_POINTS, 0, 1);
  const boldness = getBotEffectiveBoldness(p, now, state.players);
  const ballless01 = clamp((state.itBalllessMs || 0) / 900, 0, 1);
  const possessionBold = itHasBallNow
    ? (p.it ? -0.02 : -0.06)
    : (p.it ? (0.08 + 0.10 * ballless01) : (0.14 + 0.20 * ballless01));
  const winPush = clamp(boldness + possessionBold + 0.30 * behind01, 0.08, 1);
  const awarenessLagMs = p.it ? clamp((p.botPerceptionLagMs || 130) * lerp(1.0, 0.78, winPush), 70, 180) : 0;
  const sensedTargets = p.it
    ? targets.map(q => getPerceivedTarget(p, q, now, awarenessLagMs))
    : targets;

  let nearest = sensedTargets[0];
  let best = 1e9;
  for (const q of sensedTargets) {
    const d = vecLen(q.x - p.x, q.y - p.y);
    if (d < best) { best = d; nearest = q; }
  }
  const nearestDist = best;

  let throwTarget = nearest;
  let throwTargetGroup01 = targetCluster01(throwTarget, sensedTargets);
  let throwBest = -1e18;
  const itDurationMs = p.it ? Math.max(0, now - (p.itStartAt || now)) : 0;
  const shedUrgency = clamp(itDurationMs / 3200, 0, 1);
  for (const q of sensedTargets) {
    const d = vecLen(q.x - p.x, q.y - p.y);
    const leader01 = clamp((q.score || 0) / WIN_POINTS, 0, 1);
    const closish01 = clamp(1 - d / 900, 0, 1);
    const los = hasClearThrow(p.x, p.y, q.x, q.y) ? 1 : 0;
    let losMult = 1;
    let leaderWeight = 1.6 + 1.6 * winPush;
    let closeWeight = 1.05 - 0.45 * winPush;
    let jitterWeight = 0.55 - 0.30 * winPush;
    let groupWeight = 0;
    let isolationPenalty = 0;
    const group01 = targetCluster01(q, sensedTargets);

    if (p.it) {
      // As IT, urgency rises over time: prioritize any fast handoff instead of tunneling the leader.
      losMult = los ? 1 : lerp(0.22, 0.60, shedUrgency);
      leaderWeight = lerp(1.8, 0.70, shedUrgency) + 0.40 * winPush;
      closeWeight = lerp(0.9, 2.7, shedUrgency) + 0.35 * winPush;
      jitterWeight = 0.30 + 0.18 * (1 - shedUrgency);
      groupWeight = lerp(0.95, 1.70, shedUrgency) + 0.35 * winPush;
      isolationPenalty = (1 - group01) * lerp(0.16, 0.34, shedUrgency);
    } else {
      losMult = los ? 1 : lerp(0.10, 0.42, winPush);
    }

    const s = (leaderWeight * leader01 + closeWeight * closish01 + jitterWeight * rand01() + groupWeight * group01) * losMult - isolationPenalty;
    if (s > throwBest) {
      throwBest = s;
      throwTarget = q;
      throwTargetGroup01 = group01;
    }
  }

  if (p.it && shedUrgency > 0.55) {
    const dBest = vecLen(throwTarget.x - p.x, throwTarget.y - p.y);
    const dNear = vecLen(nearest.x - p.x, nearest.y - p.y);
    if (dNear < dBest * 0.86) {
      throwTarget = nearest;
      throwTargetGroup01 = targetCluster01(nearest, sensedTargets);
    }
  }
  let focusDist = vecLen(throwTarget.x - p.x, throwTarget.y - p.y);
  if (p.it) {
    const byId = new Map(sensedTargets.map(q => [q.id, q]));
    const current = p.botITTargetId ? byId.get(p.botITTargetId) : null;
    const shouldRetarget = !current || now >= (p.botITRetargetAt || 0);
    let chosen = current || throwTarget;

    if (shouldRetarget) {
      chosen = throwTarget;
    } else if (throwTarget.id !== current.id) {
      const dCur = vecLen(current.x - p.x, current.y - p.y);
      const dCand = vecLen(throwTarget.x - p.x, throwTarget.y - p.y);
      const leadDiff = (throwTarget.score || 0) - (current.score || 0);
      if (dCand + 90 < dCur || leadDiff > 12) chosen = throwTarget;
    }

    if (!p.botITTargetId || !current || chosen.id !== p.botITTargetId) {
      p.botITTargetSince = now;
    }
    p.botITTargetId = chosen.id;
    p.botITRetargetAt = now + 120 + 160 * rand01();
    throwTarget = chosen;
    throwTargetGroup01 = targetCluster01(throwTarget, sensedTargets);
    focusDist = vecLen(throwTarget.x - p.x, throwTarget.y - p.y);
  } else {
    p.botITTargetId = null;
    p.botITTargetSince = 0;
    p.botITRetargetAt = 0;
  }

  let tx = p.x, ty = p.y;
  let speed = 820;
  let snap = 0.01;
  const tagRushDist = lerp(72, 130, winPush);
  let preferTag = false;
  let throwAggroNow = 0;
  let shotConfidenceNow = 0;
  if (p.it && b && b.heldBy === p.id) {
    if (!allowThrowTransfer) {
      preferTag = true;
      p.botThrowConfidence = 0;
    } else {
      throwAggroNow = clamp(0.62 * winPush + 0.38 * shedUrgency, 0, 1);
      const windProgNow = p.throwPlan
        ? clamp((now - p.throwPlan.startAt) / Math.max(1, p.throwPlan.windupMs || 1), 0, 1)
        : 0;
      const releaseChargeNow = p.throwPlan
        ? clamp((p.throwPlan.targetCharge || 0) * windProgNow, 0.06, 0.98)
        : clamp(0.20 + 0.36 * throwAggroNow, 0.16, 0.90);
      shotConfidenceNow = estimateThrowConfidence(p, throwTarget, releaseChargeNow, sensedTargets);
      p.botThrowConfidence = shotConfidenceNow;

      const expectedWindupMs = lerp(460, 150, throwAggroNow) + 60;
      const expectedCharge = clamp(0.24 + 0.36 * throwAggroNow, 0.18, 0.98);
      const expectedThrowSpeed = throwSpeedForCharge(expectedCharge);
      const throwEtaMs = expectedWindupMs + (focusDist / Math.max(220, expectedThrowSpeed)) * 1000;
      const tagSpeed = Math.max(360, lerp(900, 1060, winPush) * 0.82);
      const tagEtaMs = (focusDist / tagSpeed) * 1000;
      const lowShotConfidence = shotConfidenceNow < lerp(0.62, 0.42, winPush);
      preferTag = focusDist < tagRushDist && tagEtaMs < throwEtaMs * 0.50 && lowShotConfidence;
      const focusMsNow = now - (p.botITTargetSince || now);
      if (focusMsNow > 520 && shotConfidenceNow > 0.30) preferTag = false;
      if (p.throwPlan) {
        const windProg = clamp((now - p.throwPlan.startAt) / Math.max(1, p.throwPlan.windupMs || 1), 0, 1);
        if (windProg > 0.55) preferTag = false;
      }
      if (!allowTagTransfer) preferTag = false;
    }
  } else if (p.it) {
    p.botThrowConfidence = 0;
  } else {
    p.botThrowConfidence = 0;
  }
  const itBallLoose = !!(p.it && b && !b.heldBy);
  let nextState = BOT_STATES.FARM_IT;
  if (p.it) {
    if (itBallLoose) {
      nextState = BOT_STATES.IT_CHASE_BALL;
      const chaseLeadT = clamp(vecLen(b.vx, b.vy) / 980, 0.06, 0.24);
      tx = b.x + b.vx * chaseLeadT;
      ty = b.y + b.vy * chaseLeadT;
      speed = lerp(1000, 1160, winPush);
      snap = lerp(0.0046, 0.0018, winPush);
    } else if (b && b.heldBy === p.id && allowTagTransfer && preferTag) {
      nextState = BOT_STATES.IT_TAG_RUSH;
      tx = nearest.x;
      ty = nearest.y;
      speed = lerp(900, 1060, winPush);
      snap = lerp(0.006, 0.0022, winPush);
    } else if (b && b.heldBy === p.id && allowThrowTransfer && p.throwPlan) {
      nextState = BOT_STATES.IT_WINDUP;
      tx = throwTarget.x;
      ty = throwTarget.y;
      speed = lerp(520, 700, winPush);
      snap = lerp(0.03, 0.016, winPush);
    } else {
      nextState = BOT_STATES.IT_HUNT;
      tx = throwTarget.x;
      ty = throwTarget.y;
      speed = lerp(760, 960, winPush);
      snap = lerp(0.016, 0.006, winPush);
    }
  } else {
    const itHasBall = !!itHasBallNow;
    const ballIsLoose = !!(b && !b.heldBy);
    const ballSpeed = ballIsLoose ? vecLen(b.vx, b.vy) : 0;
    const ballIsOpen = ballIsLoose && (!b.armed || ballSpeed < 260);
    const ballIsLooseSlow = (b && !b.heldBy && vecLen(b.vx, b.vy) < 220);
    const ballLeadT = ballIsLoose ? clamp(ballSpeed / 900, 0.08, 0.28) : 0;
    const ballLeadX = ballIsLoose ? (b.x + b.vx * ballLeadT) : p.x;
    const ballLeadY = ballIsLoose ? (b.y + b.vy * ballLeadT) : p.y;
    const ballLeadDist = ballIsLoose ? vecLen(p.x - ballLeadX, p.y - ballLeadY) : 1e9;
    const itDist = vecLen(p.x - it.x, p.y - it.y);
    const dodgeChance = lerp(0.95, 0.45, winPush);
    const evadeChance = lerp(0.96, 0.42, winPush);
    const evadeDist = lerp(260, 150, winPush);
    const contestDist = lerp(280, 560, winPush);
    const avoidLooseDist = lerp(260, 136, winPush);
    const avoidOpenBall = ballIsOpen && ballLeadDist < avoidLooseDist;
    const desperateContest = ballIsLooseSlow && ballLeadDist < contestDist && behind01 > 0.28 && winPush > 0.86 && rand01() < 0.42;

    if (isBallThreatening(p, b) && rand01() < dodgeChance) {
      nextState = BOT_STATES.DODGE_THROW;
      const speedNow = vecLen(b.vx, b.vy) || 1;
      const tangentX = -b.vy / speedNow;
      const tangentY = b.vx / speedNow;
      const sign = Math.sin(now / 180 + p.id.length) > 0 ? 1 : -1;
      tx = p.x + tangentX * sign * 190 + (p.x - b.x) * 0.45;
      ty = p.y + tangentY * sign * 190 + (p.y - b.y) * 0.45;
      speed = lerp(940, 1080, winPush);
      snap = lerp(0.004, 0.0022, winPush);
    } else if (itHasBall && itDist < evadeDist && rand01() < evadeChance) {
      nextState = BOT_STATES.EVADE_IT;
      const dxIT = p.x - it.x;
      const dyIT = p.y - it.y;
      const [nxIT, nyIT] = vecNorm(dxIT, dyIT);
      const oxIT = -nyIT;
      const oyIT = nxIT;
      const wob = Math.sin(now / 310 + p.id.length * 0.8);
      const retreat = lerp(250, 180, winPush);
      const orbit = lerp(130, 95, winPush);
      tx = p.x + nxIT * retreat + oxIT * wob * orbit;
      ty = p.y + nyIT * retreat + oyIT * wob * orbit;
      speed = lerp(860, 980, winPush);
      snap = lerp(0.006, 0.0035, winPush);
    } else if (avoidOpenBall && !desperateContest) {
      nextState = BOT_STATES.AVOID_LOOSE_BALL;
      const [nbx, nby] = vecNorm(p.x - ballLeadX, p.y - ballLeadY);
      const ox = -nby;
      const oy = nbx;
      const [nix, niy] = vecNorm(p.x - it.x, p.y - it.y);
      const wob = Math.sin(now / 240 + p.id.length * 1.3);
      const retreat = lerp(300, 190, winPush);
      const orbit = lerp(145, 84, winPush) * ((p.botOrbitSign || 1) + 0.28 * wob);
      tx = p.x + nbx * retreat + ox * orbit + nix * 46;
      ty = p.y + nby * retreat + oy * orbit + niy * 46;
      speed = lerp(960, 840, winPush);
      snap = lerp(0.005, 0.0025, winPush);
    } else if (ballIsLooseSlow && b && vecLen(p.x - b.x, p.y - b.y) < contestDist) {
      nextState = BOT_STATES.CONTEST_BALL;
      const tLead = clamp(vecLen(b.vx, b.vy) / 900, 0.10, lerp(0.22, 0.34, winPush));
      tx = b.x + b.vx * tLead;
      ty = b.y + b.vy * tLead;
      speed = lerp(820, 920, winPush);
      snap = lerp(0.01, 0.005, winPush);
    } else {
      nextState = BOT_STATES.FARM_IT;
      // Not IT: stay close to IT to farm points.
      // If IT doesn't have the ball AND the ball is loose/slow, it's a "safe window" to crowd them.
      const risk = clamp(0.48 + 0.30 * behind01 + 0.28 * winPush, 0.35, 0.98);
      const safeWindow = (!itHasBall) && ballIsLooseSlow;

      const SWEET = safeWindow ? lerp(110, 62, winPush) : lerp(160, 96, winPush);
      const FAR = safeWindow ? lerp(200, 130, winPush) : lerp(310, 180, winPush);
      const braveBias = lerp(1.12, 0.72, winPush);
      const minStandoff = itHasBall ? lerp(190, 130, winPush) : lerp(130, 88, winPush);
      const desiredDist = Math.max(minStandoff, lerp(FAR, SWEET, risk) * braveBias);

      const dxIT = p.x - it.x;
      const dyIT = p.y - it.y;
      const dIT = vecLen(dxIT, dyIT) || 1;
      const nxIT = dxIT / dIT;
      const nyIT = dyIT / dIT;
      const oxIT = -nyIT;
      const oyIT = nxIT;
      if (itHasBall && dIT < minStandoff * 0.82) {
        nextState = BOT_STATES.EVADE_IT;
        const retreat = lerp(240, 180, winPush);
        const orbit = lerp(135, 92, winPush) * (p.botOrbitSign || 1);
        tx = p.x + nxIT * retreat + oxIT * orbit;
        ty = p.y + nyIT * retreat + oyIT * orbit;
        speed = lerp(900, 1020, winPush);
        snap = lerp(0.006, 0.003, winPush);
      } else {
        const closePress = clamp(1 - dIT / (desiredDist + 1), 0, 1);
        const radialSign = (dIT > desiredDist * 1.05) ? -1 : 1;
        const wob = Math.sin(state.nowMs/520 + p.id.length) * 0.75;
        const orbitSign = p.botOrbitSign || 1;
        const tangential = orbitSign * (0.55 + 0.65 * closePress);

        let vxGoal = nxIT * radialSign * (0.95 + 0.70 * closePress) + oxIT * tangential + oxIT * wob * 0.35;
        let vyGoal = nyIT * radialSign * (0.95 + 0.70 * closePress) + oyIT * tangential + oyIT * wob * 0.35;

        if (vecLen(p.vx, p.vy) < 110) {
          vxGoal += oxIT * orbitSign * 0.9;
          vyGoal += oyIT * orbitSign * 0.9;
        }

        if (b && !b.heldBy) {
          const tLead = clamp(vecLen(b.vx, b.vy) / 900, 0.10, lerp(0.26, 0.34, winPush));
          const bx = b.x + b.vx * tLead;
          const by = b.y + b.vy * tLead;
          const dBall = vecLen(p.x - bx, p.y - by);
          if (dBall < lerp(380, 520, winPush)) {
            const [nbx, nby] = vecNorm(p.x - bx, p.y - by);
            const ballPressure = lerp(1.0, 1.9, winPush);
            vxGoal += nbx * ballPressure;
            vyGoal += nby * ballPressure;
          }
        }

        const [nx, ny] = vecNorm(vxGoal, vyGoal);
        const steerLen = lerp(150, 205, closePress);
        tx = p.x + nx * steerLen;
        ty = p.y + ny * steerLen;
      }
    }
  }

  if (p.it && !itBallLoose) {
    speed *= 0.90;
    if (b && b.heldBy === p.id && p.throwPlan) {
      const wind = Math.max(1, p.throwPlan.windupMs || 1);
      const charge01 = clamp((now - p.throwPlan.startAt) / wind, 0, 1);
      speed *= lerp(1, 0.58, charge01);
    }
  }

  const panicSuppressedForBall = itBallLoose;
  if (panicSuppressedForBall && p.botPanicUntil > now) {
    p.botPanicUntil = 0;
    p.botPanicRetargetAt = 0;
  }
  const panicActive = !panicSuppressedForBall && now < (p.botPanicUntil || 0);
  if (panicActive) {
    nextState = BOT_STATES.PANIC;
    if ((p.botPanicRetargetAt || 0) <= now) {
      const [nx, ny] = choosePanicDir(p, it);
      p.botPanicDirX = nx;
      p.botPanicDirY = ny;
      p.botPanicRetargetAt = now + 120 + 220 * rand01();
    }
    const dashLen = 160 + 130 * rand01();
    tx = p.x + (p.botPanicDirX || 1) * dashLen;
    ty = p.y + (p.botPanicDirY || 0) * dashLen;
    speed = Math.max(speed, 960 + 120 * winPush);
    snap = Math.min(snap, 0.003);
  }

  const plannedDist = vecLen(tx - p.x, ty - p.y);
  const prevX = p.x;
  const prevY = p.y;
  setBotState(p, nextState);
  moveToward(p, dt, tx, ty, speed, snap);

  const movedDist = vecLen(p.x - prevX, p.y - prevY);
  const wantsMove = plannedDist > 120;
  if (!panicActive && wantsMove && movedDist < (1.6 + dt * 5.5)) {
    p.botStuckMs = (p.botStuckMs || 0) + dt * 1000;
  } else if (!panicActive) {
    p.botStuckMs = Math.max(0, (p.botStuckMs || 0) - dt * 850);
  } else {
    p.botStuckMs = 0;
  }

  if (!panicActive && (p.botStuckMs || 0) > 340) {
    p.botStuckMs = 0;
    p.botPanicUntil = now + 1500 + 1700 * rand01();
    p.botPanicRetargetAt = 0;
  }

  // bot throw logic
  if (p.it && allowThrowTransfer && state.ball.heldBy === p.id) {
    const canStartNewThrowPlan = now >= (p.botPanicUntil || 0);
    const throwMode = state.itTransferRule === IT_TRANSFER_RULES.THROW_ONLY
      ? 'throw-only'
      : (state.itTransferRule === IT_TRANSFER_RULES.HYBRID ? 'hybrid' : 'other');
    const group01 = clamp(throwTargetGroup01 || 0, 0, 1);
    const isolation01 = 1 - group01;
    const throwDist = vecLen(throwTarget.x - p.x, throwTarget.y - p.y);
    const throwAggro = clamp(0.62 * winPush + 0.38 * shedUrgency, 0, 1);
    const throwRange = lerp(900, 1180, clamp(0.70 * winPush + 0.30 * shedUrgency, 0, 1));
    const throwCooldownMs = lerp(760, 250, clamp(0.55 * winPush + 0.45 * shedUrgency, 0, 1));
    const focusMs = now - (p.botITTargetSince || now);
    const isolationGate = (throwMode === 'throw-only' ? 0.08 : (throwMode === 'hybrid' ? 0.12 : 0.05)) * isolation01;
    const forceShotConfMin = (throwMode === 'throw-only' ? 0.72 : (throwMode === 'hybrid' ? 0.67 : 0.62)) + isolationGate;
    const focusThrowConfMin = (throwMode === 'throw-only' ? 0.48 : (throwMode === 'hybrid' ? 0.42 : 0.34)) + isolationGate * 0.82;
    const focusThrowMs = throwMode === 'throw-only' ? 560 : (throwMode === 'hybrid' ? 490 : 420);
    const forceThrow = !preferTag
      && (((focusMs > focusThrowMs) && shotConfidenceNow > focusThrowConfMin) || shotConfidenceNow > forceShotConfMin)
      && throwDist > (PLAYER_RADIUS * 2.6);
    const forceThrowCooldownMs = Math.min(240, throwCooldownMs);
    const inRange = throwDist < throwRange;
    const cooldownOk = (now - p.lastThrowAt) > (forceThrow ? forceThrowCooldownMs : throwCooldownMs);

    if (canStartNewThrowPlan && !preferTag && !p.throwPlan && inRange && cooldownOk) {
      const dist01 = clamp(throwDist / throwRange, 0, 1);
      const shotAggro = clamp(throwAggro + (forceThrow ? 0.20 : 0), 0, 1);
      const probeCharge = clamp(0.24 + 0.54 * shotAggro, 0.18, 0.98);
      const planConfidence = estimateThrowConfidence(p, throwTarget, probeCharge, sensedTargets);
      const minPlanConfidence = throwMode === 'throw-only'
        ? lerp(0.58, 0.44, shotAggro)
        : (throwMode === 'hybrid' ? lerp(0.50, 0.36, shotAggro) : lerp(0.42, 0.28, shotAggro));
      const requiredPlanConfidence = minPlanConfidence + isolationGate;
      if (planConfidence < requiredPlanConfidence && !forceThrow) {
        p.botThrowConfidence = Math.max(p.botThrowConfidence || 0, planConfidence);
      } else {
        const confidenceScale = lerp(1.10, 0.80, planConfidence);
        const targetCharge = clamp((0.24 + 0.28 * dist01 + 0.36 * shotAggro + 0.10 * rand01()) * confidenceScale, 0.18, 0.98);
        const windupBase = forceThrow ? lerp(220, 90, shotAggro) : lerp(430, 140, shotAggro);
        const windupMs = windupBase * lerp(1.08, 0.66, planConfidence) + 100 * rand01();

        p.throwPlan = {
          startAt: now,
          targetCharge,
          windupMs,
        };
        p.aiming = true;
        p.aimCharge = 0;
      }
    }

    if (p.throwPlan) {
      const t = clamp((now - p.throwPlan.startAt) / p.throwPlan.windupMs, 0, 1);
      const [fx, fy] = getForwardDir(p);
      p.aiming = true;
      p.aimX = p.x + fx * 220;
      p.aimY = p.y + fy * 220;
      p.aimCharge = t * p.throwPlan.targetCharge;

      if (t >= 1) {
        releaseThrow(p, p.throwPlan.targetCharge);
        p.lastThrowAt = now;
        p.throwPlan = null;
        p.aiming = false;
        p.aimCharge = 0;
      }
    }
  } else {
    p.throwPlan = null;
    p.aiming = false;
    p.aimCharge = 0;
  }
}

function resolveCircleRect(px, py, r, rect) {
  const cx = clamp(px, rect.x, rect.x + rect.w);
  const cy = clamp(py, rect.y, rect.y + rect.h);
  const dx = px - cx;
  const dy = py - cy;
  const d = Math.hypot(dx, dy);
  if (d >= r || d === 0) return null;
  const push = (r - d);
  return { nx: dx / d, ny: dy / d, push };
}

function keepInBounds(p) {
  const r = PLAYER_RADIUS;
  p.x = clamp(p.x, r, ARENA_W - r);
  p.y = clamp(p.y, r, ARENA_H - r);

  for (const ob of state.obstacles) {
    const hit = resolveCircleRect(p.x, p.y, r, ob);
    if (!hit) continue;
    p.x += hit.nx * hit.push;
    p.y += hit.ny * hit.push;
    const vn = p.vx * hit.nx + p.vy * hit.ny;
    if (vn < 0) {
      p.vx -= vn * hit.nx;
      p.vy -= vn * hit.ny;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
  }
}

function ballBounds(b) {
  const r = BALL_RADIUS;
  if (b.x < r) { b.x = r; b.vx *= -0.72; }
  if (b.x > ARENA_W - r) { b.x = ARENA_W - r; b.vx *= -0.72; }
  if (b.y < r) { b.y = r; b.vy *= -0.72; }
  if (b.y > ARENA_H - r) { b.y = ARENA_H - r; b.vy *= -0.72; }

  for (const ob of state.obstacles) {
    const hit = resolveCircleRect(b.x, b.y, r, ob);
    if (!hit) continue;
    b.x += hit.nx * hit.push;
    b.y += hit.ny * hit.push;
    const vn = b.vx * hit.nx + b.vy * hit.ny;
    if (vn < 0) {
      b.vx -= 1.65 * vn * hit.nx;
      b.vy -= 1.65 * vn * hit.ny;
      b.vx *= 0.88;
      b.vy *= 0.88;
    }
  }
}

function releaseThrow(thrower, charge01) {
  const b = state.ball;
  if (!b || b.heldBy !== thrower.id) return;
  if (thrower.it && !canItThrowTransfer()) return;

  const now = state.nowMs;

  let [nx, ny] = getForwardDir(thrower);

  const moveNoise = clamp(vecLen(thrower.vx, thrower.vy) / 540, 0, 1);
  const baseDeg = 3.5;
  const extraDeg = 10.0;
  const noiseDeg = baseDeg + extraDeg * (0.65 * (1 - charge01) + 0.35 * moveNoise);
  const noiseRad = (noiseDeg * Math.PI / 180) * randN();
  const c = Math.cos(noiseRad), s = Math.sin(noiseRad);
  const rx = nx * c - ny * s;
  const ry = nx * s + ny * c;
  nx = rx; ny = ry;

  const speed = throwSpeedForCharge(charge01);

  b.heldBy = null;
  b.lastThrower = thrower.id;
  b.armed = true;
  b.thrownAt = now;
  b.x = thrower.x + nx * (PLAYER_RADIUS + BALL_RADIUS + 2);
  b.y = thrower.y + ny * (PLAYER_RADIUS + BALL_RADIUS + 2);
  b.vx = nx * speed;
  b.vy = ny * speed;
}

function updateOffline(dt) {
  const now = state.nowMs;
  if (state.over) return;
  refreshItBallTracking(now);

  const it = currentIt();
  for (const p of state.players) {
    if (p.it) {
      p.furryMs += dt * 1000;
      p.score = Math.max(0, p.score - IT_BLEED_POINTS_PER_SEC * dt);
    } else if (it) {
      const d = vecLen(p.x - it.x, p.y - it.y);
      const closeness01 = clamp(1 - (d / PROX_MAX_DIST), 0, 1);
      const pts = PROX_POINTS_PER_SEC * (closeness01 ** 1.6) * dt;
      p.score += pts;
    }

    if (p.score >= WIN_POINTS && !state.over) {
      state.over = true;
      state.winnerId = p.id;
    }
  }

  for (const p of state.players) {
    if (p.human) moveHuman(p, dt);
    else moveBot(p, dt);
    keepInBounds(p);
  }

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < state.players.length; i++) {
      for (let j = i + 1; j < state.players.length; j++) {
        const a = state.players[i];
        const c = state.players[j];
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const minD = PLAYER_RADIUS * 2;
        if (d >= minD) continue;

        const overlap = (minD - d);
        const nx = dx / d;
        const ny = dy / d;

        a.x -= nx * (overlap * 0.5);
        a.y -= ny * (overlap * 0.5);
        c.x += nx * (overlap * 0.5);
        c.y += ny * (overlap * 0.5);

        const rvx = c.vx - a.vx;
        const rvy = c.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const impulse = -vn * 0.35;
          a.vx -= impulse * nx;
          a.vy -= impulse * ny;
          c.vx += impulse * nx;
          c.vy += impulse * ny;
        }

        keepInBounds(a);
        keepInBounds(c);
      }
    }
  }

  const b = state.ball;
  if (!b) return;

  if (it && b.heldBy && b.heldBy !== it.id) {
    b.heldBy = it.id;
    b.lastThrower = null;
  }

  if (b.heldBy) {
    const holder = state.players.find(p => p.id === b.heldBy);
    if (holder) {
      b.x = holder.x;
      b.y = holder.y;
      b.vx = 0;
      b.vy = 0;

      if (it && holder.id === it.id && canItTagTransfer()) {
        for (const other of state.players) {
          if (other.id === holder.id) continue;
          const d = vecLen(other.x - holder.x, other.y - holder.y);
          if (d > PLAYER_RADIUS * 2) continue;

          const canTag = (now - holder.lastHitAt) > TOUCH_TAG_COOLDOWN_MS && (now - other.lastHitAt) > TOUCH_TAG_COOLDOWN_MS;
          if (!canTag) continue;

          holder.lastHitAt = now;
          other.lastHitAt = now;
          setIt(other.id);
          break;
        }
      }

      if (holder.human && holder.it) {
        const space = keys.has(' ');
        const canThrow = canItThrowTransfer();
        const [fx, fy] = getForwardDir(holder);

        holder.aiming = canThrow && space;
        holder.aimX = holder.x + fx * 220;
        holder.aimY = holder.y + fy * 220;

        if (canThrow && space && !state.wasSpaceDown) state.spaceDownAt = now;

        let throwCharge = holder.aimCharge || 0;
        if (canThrow && space) {
          const start = state.spaceDownAt > 0 ? state.spaceDownAt : now;
          const t = clamp((now - start) / CHARGE_MS, 0, 1);
          holder.aimCharge = t;
          throwCharge = holder.aimCharge;
        } else {
          holder.aimCharge = 0;
          state.spaceDownAt = 0;
        }

        const releasedSpace = canThrow && !space && state.wasSpaceDown;
        if (releasedSpace) {
          releaseThrow(holder, throwCharge);
          holder.aiming = false;
          holder.aimCharge = 0;
          state.spaceDownAt = 0;
        }

        state.wasSpaceDown = canThrow ? space : false;
      }
    }
  } else {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vx *= Math.pow(BALL_FRICTION, dt*60);
    b.vy *= Math.pow(BALL_FRICTION, dt*60);
    ballBounds(b);

    // IT should be able to reclaim the ball immediately when close.
    if (it && !b.heldBy) {
      const dItBall = vecLen(it.x - b.x, it.y - b.y);
      if (dItBall <= IT_PICKUP_RADIUS) {
        b.heldBy = it.id;
        b.lastThrower = null;
        b.armed = false;
        b.vx = 0;
        b.vy = 0;
      }
    }

    for (const p of state.players) {
      const d = vecLen(p.x - b.x, p.y - b.y);
      if (d > PLAYER_RADIUS + BALL_RADIUS) continue;

      if (it && p.id !== it.id && !b.heldBy) {
        if ((now - p.lastHitAt) < HIT_COOLDOWN_MS) continue;
        p.lastHitAt = now;
        setIt(p.id);
        b.armed = false;
        break;
      }

      if (b.armed) {
        if (p.id === b.lastThrower) continue;
        if ((now - p.lastHitAt) < HIT_COOLDOWN_MS) continue;
        p.lastHitAt = now;
        setIt(p.id);
        break;
      }
    }

    if (vecLen(b.vx, b.vy) < 55) b.armed = false;
  }

  refreshItBallTracking(now);
}

function draw() {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;

  // choose state for rendering (interpolated when online)
  const R = getRenderSnapshot();
  const players = R.players || [];
  const obstacles = R.obstacles || [];
  const ball = R.ball || null;
  const it = players.find(p => p.it);

  // overlay: mode picker (pre-game) OR offline end screen
  const overlay = document.querySelector('#overlay');
  const endTitle = document.querySelector('#endTitle');
  const endSub = document.querySelector('#endSub');
  const endRows = document.querySelector('#endRows');

  if (!state.mode) {
    overlay?.classList.add('on');
    if (endTitle) endTitle.textContent = 'Choose mode';
    if (endSub) endSub.textContent = 'Play offline (first to 100) or join the live online game (endless).';
    if (endRows) endRows.innerHTML = '';
  } else if (state.mode === 'offline' && state.over && state.winnerId) {
    overlay?.classList.add('on');
    const wP = state.players.find(p => p.id === state.winnerId);
    if (endTitle) endTitle.textContent = `${wP?.name || 'Someone'} wins!`;
    if (endSub) endSub.textContent = `First to ${WIN_POINTS} points. Press Enter or Reset.`;
    if (endRows) {
      const sorted = [...state.players].sort((a,b) => (b.score||0) - (a.score||0));
      endRows.innerHTML = sorted.map(p => {
        const pts = (p.score || 0).toFixed(0);
        const furry = (p.furryMs/1000).toFixed(1);
        const you = p.id === (state.playerId || 'me') ? ' (you)' : (p.human ? ' (player)' : '');
        return `<div class="row"><div><b>${p.name}${you}</b></div><div>${pts} pts · ${furry}s it</div></div>`;
      }).join('');
    }
  } else {
    overlay?.classList.remove('on');
  }

  // background
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = COLORS.arena;
  ctx.fillRect(0, 0, cw, ch);

  // world transform
  ctx.save();
  ctx.translate(view.offX, view.offY);
  ctx.scale(view.scale, view.scale);

  // grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  const step = 60;
  for (let x = 0; x <= ARENA_W; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); ctx.stroke();
  }
  for (let y = 0; y <= ARENA_H; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); ctx.stroke();
  }

  // obstacles
  for (const ob of obstacles) {
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(ob.x, ob.y, ob.w, ob.h, 10);
    ctx.fill();
    ctx.stroke();
  }

  // aim indicator
  for (const p of players) {
    if (!p.it) continue;
    if (!p.aiming) continue;
    if (!ball?.heldBy || ball.heldBy !== p.id) continue;

    const dx = (p.aimX ?? p.x) - p.x;
    const dy = (p.aimY ?? p.y) - p.y;
    const [nx, ny] = vecNorm(dx, dy);
    const charge = clamp(p.aimCharge || 0, 0, 1);
    const len = lerp(70, 220, charge);

    ctx.strokeStyle = (p.id === (state.playerId || 'me')) ? 'rgba(34,197,94,.30)' : COLORS.aim;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + nx * len, p.y + ny * len);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.beginPath();
    ctx.arc(p.x + nx * (len + 18), p.y + ny * (len + 18), 12, 0, TAU);
    ctx.stroke();
  }

  // leader fur
  let leader = players[0];
  for (const p of players) if (leader && (p.score || 0) > (leader.score || 0)) leader = p;

  for (const p of players) {
    if (leader && p.id === leader.id) {
      const t = performance.now() / 1000;
      const win01 = clamp((p.score || 0) / WIN_POINTS, 0, 1);
      const strands = 46;
      const baseR = PLAYER_RADIUS + 3;
      const maxLen = 8 + 28 * (win01 ** 1.25);

      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(245,158,11,.72)';

      for (let i = 0; i < strands; i++) {
        const seed = (p.id.length * 97 + i * 31);
        const jitterA = Math.sin(seed * 12.9898) * 43758.5453;
        const r01 = jitterA - Math.floor(jitterA);

        const a = (i / strands) * TAU + (r01 - 0.5) * 0.28;
        const wob = 0.55 + 0.45 * Math.sin(t * (2.2 + 0.6 * r01) + i * 0.37);
        const len = maxLen * (0.35 + 0.65 * wob) * (0.55 + 0.45 * r01);

        const bend = (r01 - 0.5) * 0.9;
        const nx = Math.cos(a);
        const ny = Math.sin(a);
        const tx = -ny;
        const ty = nx;

        const x0 = p.x + nx * baseR;
        const y0 = p.y + ny * baseR;
        const x2 = p.x + nx * (baseR + len);
        const y2 = p.y + ny * (baseR + len);
        const x1 = p.x + nx * (baseR + len * 0.55) + tx * bend * (6 + 10 * win01);
        const y1 = p.y + ny * (baseR + len * 0.55) + ty * bend * (6 + 10 * win01);

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(x1, y1, x2, y2);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(245,158,11,.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU + Math.sin(t * 2 + i) * 0.1;
        const nx = Math.cos(a);
        const ny = Math.sin(a);
        const len = 6 + 10 * win01;
        ctx.beginPath();
        ctx.moveTo(p.x + nx * (PLAYER_RADIUS + 1), p.y + ny * (PLAYER_RADIUS + 1));
        ctx.lineTo(p.x + nx * (PLAYER_RADIUS + 1 + len), p.y + ny * (PLAYER_RADIUS + 1 + len));
        ctx.stroke();
      }
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, TAU);
    const isMe = p.id === (state.playerId || 'me');
    const botColor = (state.mode === 'offline' && !state.online) ? getOfflineBotColor(p, it, state.nowMs) : COLORS.bot;
    ctx.fillStyle = isMe ? COLORS.me : (p.human ? 'rgba(255,255,255,.86)' : botColor);
    ctx.globalAlpha = p.disconnected ? 0.35 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;

    if (p.it) {
      ctx.strokeStyle = COLORS.it;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PLAYER_RADIUS + 6, 0, TAU);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,.82)';
    ctx.font = '12px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - PLAYER_RADIUS - 12);

    if (p.it) {
      ctx.fillStyle = 'rgba(245,158,11,.95)';
      ctx.font = '11px ui-sans-serif, system-ui';
      ctx.fillText('IT', p.x, p.y + PLAYER_RADIUS + 16);
    }
  }

  // ball
  const b = ball;
  if (b) {
    if (b.heldBy) {
      const holder = players.find(p => p.id === b.heldBy);
      if (holder) {
        ctx.strokeStyle = 'rgba(167,139,250,.35)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(holder.x, holder.y);
        ctx.lineTo(b.x, b.y - (PLAYER_RADIUS + 10));
        ctx.stroke();
      }
    }

    const by = b.heldBy ? (b.y - (PLAYER_RADIUS + 10)) : b.y;
    ctx.beginPath();
    ctx.arc(b.x, by, BALL_RADIUS, 0, TAU);
    ctx.fillStyle = COLORS.ball;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();

  // HUD
  const statusEl = document.querySelector('#status');
  const mode = state.online ? (state.wsReady ? 'Online' : 'Connecting…') : 'Offline';
  if (it) statusEl.textContent = `${mode} · ${it.name} is IT`;
  else statusEl.textContent = `${mode} · waiting for IT…`;

  const meStatsEl = document.querySelector('#meStats');
  const goalEl = document.querySelector('#goal');
  const sorted = [...players].sort((a,b) => (b.score || 0) - (a.score || 0));
  const myId = (state.playerId || 'me');
  const me = players.find(p => p.id === myId);
  if (meStatsEl && me) {
    const rank = sorted.findIndex(p => p.id === myId) + 1;
    const pts = (me.score || 0).toFixed(0);
    const total = sorted.length;
    meStatsEl.textContent = `You: ${pts} pts · #${rank}/${total}`;
  } else if (meStatsEl) {
    meStatsEl.textContent = 'You: —';
  }
  if (goalEl) {
    const ruleText = state.itTransferRule === IT_TRANSFER_RULES.THROW_ONLY
      ? 'IT must throw'
      : (state.itTransferRule === IT_TRANSFER_RULES.TAG_ONLY ? 'IT must tag' : 'IT can throw or tag');
    goalEl.textContent = `Goal: avoid IT · ${ruleText}`;
  }
  updateLeaderboard(players, myId);

  if (state.over && state.winnerId) {
    const wP = state.players.find(p => p.id === state.winnerId);
    statusEl.textContent = `${mode} · ${wP?.name || 'Someone'} wins — press Reset (or Enter)`;
  }
}

// Online networking
let ws = null;
let inputSeq = 0;
let inputTimer = null;

// Inactivity kick
const INACTIVITY_KICK_MS = 5000;
state.lastMoveAtMs = performance.now();

// Net smoothing
const RENDER_DELAY_MS = 50; // interpolate slightly "in the past" for smoothness
const MAX_SNAPSHOT_AGE_MS = 2000;
state.snapshots = []; // { recvMs, nowMs, players, obstacles, ball, over, winnerId }

function getWsUrl() {
  const env = import.meta.env?.VITE_WS_URL;
  if (env && typeof env === 'string') return env;
  // default dev
  return 'ws://localhost:8080';
}

function getPlayerName() {
  const k = 'tfo_name';
  let name = localStorage.getItem(k);
  if (!name) {
    name = (prompt('Name for online play?', 'Player') || 'Player').trim();
    if (!name) name = 'Player';
    localStorage.setItem(k, name);
  }
  return name.slice(0, 24);
}

function connectOnline() {
  const url = getWsUrl();
  state.online = true;
  state.wsReady = false;

  const storedId = localStorage.getItem('tfo_playerId');
  const name = getPlayerName();

  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    state.lastMoveAtMs = performance.now();
    ws.send(JSON.stringify({ type: 'join', playerId: storedId, name }));
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === 'welcome') {
      state.wsReady = true;
      state.playerId = msg.playerId;
      localStorage.setItem('tfo_playerId', msg.playerId);
      state.pendingServerState = msg.state;
      startInputLoop();
      return;
    }

    if (msg.type === 'state' && msg.state) {
      // keep only the latest snapshot; apply once per frame in loop()
      state.pendingServerState = msg.state;
      return;
    }
  });

  const goOffline = () => {
    state.online = false;
    state.wsReady = false;
    stopInputLoop();
    ws = null;
  };

  ws.addEventListener('close', goOffline);
  ws.addEventListener('error', goOffline);
}

function applyServerState(s) {
  const recvMs = performance.now();
  const snap = {
    recvMs,
    nowMs: s.nowMs ?? 0,
    players: s.players ?? [],
    obstacles: s.obstacles ?? [],
    ball: s.ball ?? null,
    over: !!s.over,
    winnerId: s.winnerId ?? null,
  };

  state.snapshots.push(snap);

  // keep only recent snapshots
  const cutoff = recvMs - MAX_SNAPSHOT_AGE_MS;
  state.snapshots = state.snapshots.filter(x => x.recvMs >= cutoff);

  // keep a non-interpolated "latest" copy for non-positional fields
  state.nowMs = snap.nowMs;
  state.obstacles = snap.obstacles;
  state.over = snap.over;
  state.winnerId = snap.winnerId;
}

function lerpObj(a, b, t) {
  if (!a) return b;
  if (!b) return a;
  const out = { ...b };
  for (const k of ['x','y','vx','vy','aimX','aimY','aimCharge']) {
    if (typeof a[k] === 'number' && typeof b[k] === 'number') out[k] = lerp(a[k], b[k], t);
  }
  return out;
}

function getRenderSnapshot() {
  if (!state.online || !state.snapshots?.length) {
    return { players: state.players, obstacles: state.obstacles, ball: state.ball };
  }

  const snaps = state.snapshots;
  const latest = snaps[snaps.length - 1];
  const targetNowMs = (latest.nowMs || 0) - RENDER_DELAY_MS;

  // If we're very close to latest, allow a tiny extrapolation window to reduce "behind" feel.
  const EXTRAP_MAX_MS = 90;

  // Find two snapshots around targetNowMs
  let a = null;
  let b = latest;

  // If target is newer than latest snapshot, extrapolate from latest for a short window.
  if (targetNowMs > (latest.nowMs || 0)) {
    const ahead = clamp(targetNowMs - (latest.nowMs || 0), 0, EXTRAP_MAX_MS);

    const players = (latest.players || []).map(p => {
      const out = { ...p };
      if (typeof out.x === 'number' && typeof out.vx === 'number') out.x = out.x + out.vx * (ahead / 1000);
      if (typeof out.y === 'number' && typeof out.vy === 'number') out.y = out.y + out.vy * (ahead / 1000);
      return out;
    });

    let ball = latest.ball ? { ...latest.ball } : null;
    if (ball && !ball.heldBy) {
      if (typeof ball.x === 'number' && typeof ball.vx === 'number') ball.x = ball.x + ball.vx * (ahead / 1000);
      if (typeof ball.y === 'number' && typeof ball.vy === 'number') ball.y = ball.y + ball.vy * (ahead / 1000);
    }

    return { players, obstacles: latest.obstacles || [], ball };
  }
  for (let i = snaps.length - 1; i >= 0; i--) {
    if ((snaps[i].nowMs || 0) <= targetNowMs) {
      a = snaps[i];
      b = snaps[Math.min(i + 1, snaps.length - 1)];
      break;
    }
  }
  if (!a) {
    // If we're too early, just use the oldest
    a = snaps[0];
    b = snaps[0];
  }

  const denom = ((b.nowMs || 0) - (a.nowMs || 0)) || 1;
  const t = clamp((targetNowMs - (a.nowMs || 0)) / denom, 0, 1);

  // players by id
  const mapA = new Map((a.players || []).map(p => [p.id, p]));
  const mapB = new Map((b.players || []).map(p => [p.id, p]));
  const ids = new Set([...mapA.keys(), ...mapB.keys()]);
  const players = [];
  for (const id of ids) {
    const pa = mapA.get(id);
    const pb = mapB.get(id);
    const p = lerpObj(pa, pb, t);
    // keep discrete fields from newer snapshot
    const src = pb || pa || {};
    p.id = src.id;
    p.name = src.name;
    p.human = src.human;
    p.it = src.it;
    p.score = src.score;
    p.furryMs = src.furryMs;
    p.aiming = src.aiming;
    p.disconnected = src.disconnected;
    players.push(p);
  }

  // ball
  const ball = lerpObj(a.ball, b.ball, t);
  if (ball) {
    const src = b.ball || a.ball || {};
    ball.heldBy = src.heldBy;
    ball.armed = src.armed;
    ball.lastThrower = src.lastThrower;
  }

  return { players, obstacles: latest.obstacles || b.obstacles || a.obstacles || [], ball };
}

function buildInput() {
  const up = keys.has('ArrowUp') || keys.has('w') || keys.has('W');
  const dn = keys.has('ArrowDown') || keys.has('s') || keys.has('S');
  const lf = keys.has('ArrowLeft') || keys.has('a') || keys.has('A');
  const rt = keys.has('ArrowRight') || keys.has('d') || keys.has('D');
  const spaceDown = keys.has(' ');

  if (up || dn || lf || rt) state.lastMoveAtMs = performance.now();

  return {
    type: 'input',
    seq: ++inputSeq,
    clientTime: performance.now(),
    up, dn, lf, rt,
    mouseX: mouse.x,
    mouseY: mouse.y,
    mouseDown: mouse.down,
    spaceDown,
  };
}

function startInputLoop() {
  stopInputLoop();
  inputTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!state.wsReady) return;
    ws.send(JSON.stringify(buildInput()));
  }, 20); // higher input rate helps perceived latency
}

function stopInputLoop() {
  if (inputTimer) clearInterval(inputTimer);
  inputTimer = null;
}

// Main loop
function kickToHome(reason = 'inactive') {
  state.mode = null;
  state.online = false;
  state.wsReady = false;
  stopInputLoop();
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  // reset offline so the background isn't stale
  resetGameOffline();
  state.lastMoveAtMs = performance.now();

  const statusEl = document.querySelector('#status');
  if (statusEl && reason === 'inactive') statusEl.textContent = 'Offline · kicked for inactivity';
}

function loop() {
  const now = performance.now();
  const dt = clamp((now - state.lastT) / 1000, 0, 0.05);
  state.lastT = now;

  // Apply at most one server state per frame (prevents backlog/freezes).
  if (state.mode === 'online' && state.wsReady && state.pendingServerState) {
    applyServerState(state.pendingServerState);
    state.pendingServerState = null;
  }

  // inactivity kick (online only)
  if (state.mode === 'online' && state.wsReady) {
    if ((now - (state.lastMoveAtMs || now)) > INACTIVITY_KICK_MS) {
      kickToHome('inactive');
    }
  }

  if (!state.online) {
    state.nowMs = now;
    updateOffline(dt);
  }

  draw();
  requestAnimationFrame(loop);
}

// Buttons
const resetBtn = document.querySelector('#reset');
resetBtn.addEventListener('click', () => {
  if (state.online && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'reset' }));
  } else {
    resetGameOffline();
  }
});

// Mode selection buttons
const playOfflineBtn = document.querySelector('#playOffline');
const playOnlineBtn = document.querySelector('#playOnline');

playOfflineBtn?.addEventListener('click', () => {
  state.mode = 'offline';
  state.online = false;
  state.wsReady = false;
  stopInputLoop();
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  resetGameOffline();
});

playOnlineBtn?.addEventListener('click', () => {
  state.mode = 'online';
  state.lastMoveAtMs = performance.now();
  try { connectOnline(); } catch {
    state.mode = null;
    state.online = false;
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state.over) {
    if (state.online && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'reset' }));
    else resetGameOffline();
  }
});

// Boot
resize();
resetGameOffline();

// Start with mode picker.
state.mode = null;
state.online = false;
state.wsReady = false;

loop();
