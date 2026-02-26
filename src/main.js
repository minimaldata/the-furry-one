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

// Shared constants (keep in sync with server/sim.js)
const ARENA_W = 1200;
const ARENA_H = 720;

const PLAYER_RADIUS = 14;
const BALL_RADIUS = 9;
const MAX_THROW_SPEED = 820;
const MIN_THROW_SPEED = 220;
const CHARGE_MS = 900;
const FRICTION = 0.90;
const BALL_FRICTION = 0.992;
const BOT_COUNT = 14;
const HIT_COOLDOWN_MS = 450;
const TOUCH_TAG_COOLDOWN_MS = 650;

const WIN_POINTS = 100;
const PROX_MAX_DIST = 260;
const PROX_POINTS_PER_SEC = 16;
const IT_BLEED_POINTS_PER_SEC = 6;

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
      <div class="subtitle">Move: WASD/Arrows · Aim: mouse · Throw (when IT): hold mouse or Space, release</div>
    </div>
    <div class="hud">
      <div class="pill" id="status">Loading…</div>
      <div class="pill" id="meStats">You: —</div>
      <div class="pill" id="goal">Goal: avoid IT</div>
      <button class="btn" id="reset">Reset</button>
    </div>
  </div>
  <div class="canvasWrap"><canvas id="c"></canvas></div>

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
  state.wasMouseDown = false;
  state.wasSpaceDown = false;
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
    furryMs: 0,
    score: 0,
    lastHitAt: -1e9,
    lastThrowAt: -1e9,

    aiming: false,
    aimCharge: 0,
    aimX: 0,
    aimY: 0,
    throwPlan: null,
  };
}

const state = {
  nowMs: performance.now(),
  lastT: performance.now(),

  mode: null, // 'offline' | 'online'
  online: false,
  wsReady: false,
  playerId: null,

  players: [],
  obstacles: [],
  ball: null,
  wasMouseDown: false,
  wasSpaceDown: false,
  spaceDownAt: 0,

  over: false,
  winnerId: null,
};

function currentIt() { return state.players.find(p => p.it); }

function setIt(playerId) {
  for (const p of state.players) p.it = (p.id === playerId);
  state.ball.heldBy = playerId;
  state.ball.vx = 0;
  state.ball.vy = 0;
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

  state.players[Math.floor(rand01() * state.players.length)].it = true;
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

  state.wasMouseDown = false;
  state.wasSpaceDown = false;
  state.spaceDownAt = 0;

  for (const p of state.players) {
    p.aiming = false;
    p.aimCharge = 0;
    p.aimX = p.x;
    p.aimY = p.y;
    p.throwPlan = null;
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

  const speed = 1080;
  p.vx = lerp(p.vx, nx * speed, 1 - Math.pow(0.001, dt));
  p.vy = lerp(p.vy, ny * speed, 1 - Math.pow(0.001, dt));

  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.vx *= Math.pow(FRICTION, dt*60);
  p.vy *= Math.pow(FRICTION, dt*60);
}

function moveBot(p, dt) {
  const it = currentIt();
  if (!it) return;

  const targets = state.players.filter(q => q.id !== p.id);

  let nearest = targets[0];
  let best = 1e9;
  for (const q of targets) {
    const d = vecLen(q.x - p.x, q.y - p.y);
    if (d < best) { best = d; nearest = q; }
  }

  let throwTarget = nearest;
  let throwBest = -1e18;
  for (const q of targets) {
    const d = vecLen(q.x - p.x, q.y - p.y);
    const leader01 = clamp((q.score || 0) / WIN_POINTS, 0, 1);
    const closish01 = clamp(1 - d / 900, 0, 1);
    const los = hasClearThrow(p.x, p.y, q.x, q.y) ? 1 : 0;
    const s = (2.2 * leader01 + 0.9 * closish01 + 0.4 * rand01()) * (0.25 + 0.75 * los);
    if (s > throwBest) {
      throwBest = s;
      throwTarget = q;
    }
  }

  let tx = p.x, ty = p.y;
  const b = state.ball;
  if (p.it) {
    if (b && !b.heldBy) { tx = b.x; ty = b.y; }
    else { tx = nearest.x; ty = nearest.y; }
  } else {
    // Not IT: stay close to IT to farm points.
    // If IT doesn't have the ball AND the ball is loose/slow, it's a "safe window" to crowd them.
    const bestScoreNow = Math.max(...state.players.map(x => x.score || 0));
    const behind01 = clamp((bestScoreNow - (p.score || 0)) / WIN_POINTS, 0, 1);
    const risk = 0.55 + 0.35 * behind01;

    const itHasBall = (b && b.heldBy === it.id);
    const ballIsLooseSlow = (b && !b.heldBy && vecLen(b.vx, b.vy) < 220);
    const safeWindow = (!itHasBall) && ballIsLooseSlow;

    const SWEET = safeWindow ? 80 : 140;
    const FAR = safeWindow ? 170 : 280;
    const desiredDist = lerp(FAR, SWEET, risk);

    const dxIT = p.x - it.x;
    const dyIT = p.y - it.y;
    const dIT = vecLen(dxIT, dyIT) || 1;
    const nxIT = dxIT / dIT;
    const nyIT = dyIT / dIT;
    const oxIT = -nyIT;
    const oyIT = nxIT;

    const radialSign = (dIT > desiredDist) ? -1 : 1;
    const wob = Math.sin(state.nowMs/520 + p.id.length) * 0.9;

    let vxGoal = nxIT * radialSign * 1.0 + oxIT * 0.9 * wob;
    let vyGoal = nyIT * radialSign * 1.0 + oyIT * 0.9 * wob;

    if (b && !b.heldBy) {
      const tLead = clamp(vecLen(b.vx, b.vy) / 900, 0.10, 0.30);
      const bx = b.x + b.vx * tLead;
      const by = b.y + b.vy * tLead;
      const dBall = vecLen(p.x - bx, p.y - by);
      if (dBall < 460) {
        const [nbx, nby] = vecNorm(p.x - bx, p.y - by);
        vxGoal += nbx * 1.8;
        vyGoal += nby * 1.8;
      }
    }

    const [nx, ny] = vecNorm(vxGoal, vyGoal);
    tx = p.x + nx * 160;
    ty = p.y + ny * 160;
  }

  const dx = tx - p.x;
  const dy = ty - p.y;
  const [nx, ny] = vecNorm(dx, dy);
  const speed = 820;
  p.vx = lerp(p.vx, nx * speed, 1 - Math.pow(0.01, dt));
  p.vy = lerp(p.vy, ny * speed, 1 - Math.pow(0.01, dt));

  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.vx *= Math.pow(FRICTION, dt*60);
  p.vy *= Math.pow(FRICTION, dt*60);

  // bot throw logic
  if (p.it && state.ball.heldBy === p.id) {
    const now = state.nowMs;
    const inRange = vecLen(throwTarget.x - p.x, throwTarget.y - p.y) < 900;
    const cooldownOk = (now - p.lastThrowAt) > 950;

    if (!p.throwPlan && inRange && cooldownOk) {
      const dist01 = clamp(vecLen(throwTarget.x - p.x, throwTarget.y - p.y) / 900, 0, 1);
      const targetCharge = clamp(0.40 + 0.50 * dist01 + 0.10 * rand01(), 0.30, 0.95);

      const tgt = throwTarget;
      const leadT = 0.16 + 0.14 * rand01();
      const aimX = tgt.x + tgt.vx * leadT;
      const aimY = tgt.y + tgt.vy * leadT;

      p.throwPlan = {
        startAt: now,
        aimX,
        aimY,
        targetCharge,
        windupMs: 420 + 220 * rand01(),
      };
      p.aiming = true;
      p.aimCharge = 0;
      p.aimX = aimX;
      p.aimY = aimY;
    }

    if (p.throwPlan) {
      const t = clamp((now - p.throwPlan.startAt) / p.throwPlan.windupMs, 0, 1);
      p.aiming = true;
      p.aimX = p.throwPlan.aimX;
      p.aimY = p.throwPlan.aimY;
      p.aimCharge = t * p.throwPlan.targetCharge;

      if (t >= 1) {
        releaseThrow(p, p.throwPlan.aimX, p.throwPlan.aimY, p.throwPlan.targetCharge);
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

function releaseThrow(thrower, aimX, aimY, charge01) {
  const b = state.ball;
  if (!b || b.heldBy !== thrower.id) return;

  const now = state.nowMs;

  const dx = aimX - thrower.x;
  const dy = aimY - thrower.y;
  let [nx, ny] = vecNorm(dx, dy);

  const moveNoise = clamp(vecLen(thrower.vx, thrower.vy) / 540, 0, 1);
  const baseDeg = 3.5;
  const extraDeg = 10.0;
  const noiseDeg = baseDeg + extraDeg * (0.65 * (1 - charge01) + 0.35 * moveNoise);
  const noiseRad = (noiseDeg * Math.PI / 180) * randN();
  const c = Math.cos(noiseRad), s = Math.sin(noiseRad);
  const rx = nx * c - ny * s;
  const ry = nx * s + ny * c;
  nx = rx; ny = ry;

  const speed = lerp(MIN_THROW_SPEED, MAX_THROW_SPEED, charge01);

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

      if (it && holder.id === it.id) {
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
        const md = mouse.down;

        holder.aiming = md || space;
        holder.aimX = mouse.x;
        holder.aimY = mouse.y;

        if (space && !state.wasSpaceDown) state.spaceDownAt = now;

        const charging = md || space;
        if (charging) {
          const start = md ? mouse.downAt : state.spaceDownAt;
          const t = clamp((now - start) / CHARGE_MS, 0, 1);
          holder.aimCharge = t;
        }

        const releasedMouse = (!md && state.wasMouseDown);
        const releasedSpace = (!space && state.wasSpaceDown);
        if (releasedMouse || releasedSpace) {
          releaseThrow(holder, mouse.x, mouse.y, holder.aimCharge || 0);
          holder.aiming = false;
          holder.aimCharge = 0;
        }

        state.wasMouseDown = md;
        state.wasSpaceDown = space;
      }
    }
  } else {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vx *= Math.pow(BALL_FRICTION, dt*60);
    b.vy *= Math.pow(BALL_FRICTION, dt*60);
    ballBounds(b);

    for (const p of state.players) {
      const d = vecLen(p.x - b.x, p.y - b.y);
      if (d > PLAYER_RADIUS + BALL_RADIUS) continue;

      if (it && p.id === it.id && !b.heldBy) {
        const sp = vecLen(b.vx, b.vy);
        if (sp < 220) {
          b.heldBy = it.id;
          b.lastThrower = null;
          b.armed = false;
          b.vx = 0; b.vy = 0;
          break;
        }
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
    ctx.fillStyle = isMe ? COLORS.me : (p.human ? 'rgba(255,255,255,.86)' : COLORS.bot);
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

  if (state.over && state.winnerId) {
    const wP = state.players.find(p => p.id === state.winnerId);
    statusEl.textContent = `${mode} · ${wP?.name || 'Someone'} wins — press Reset (or Enter)`;
  }
}

// Online networking
let ws = null;
let inputSeq = 0;
let inputTimer = null;

// Client-side prediction (for your own player) to make online feel responsive
const pendingInputs = []; // {seq,t,up,dn,lf,rt}
let predictedMe = null; // {x,y,vx,vy}
let lastServerSeq = 0;
let lastInputT = null;

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
      // reset prediction
      pendingInputs.length = 0;
      predictedMe = null;
      lastServerSeq = 0;
      lastInputT = null;

      applyServerState(msg.state);
      startInputLoop();
      return;
    }

    if (msg.type === 'state' && msg.state) {
      applyServerState(msg.state);
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

  // reconcile local prediction using authoritative player + acked seq
  const myId = state.playerId;
  if (myId && snap.players?.length) {
    const me = snap.players.find(p => p.id === myId);
    if (me) {
      // stash nowMs for reconciliation math (optional)
      me.nowMs = snap.nowMs;
      reconcileFromServer(me);
    }
  }
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

function stepPredictedMe(dt, input) {
  if (!predictedMe) return;
  let ax = 0, ay = 0;
  if (input.up) ay -= 1;
  if (input.dn) ay += 1;
  if (input.lf) ax -= 1;
  if (input.rt) ax += 1;
  const [nx, ny] = vecNorm(ax, ay);

  const speed = 1080;
  predictedMe.vx = lerp(predictedMe.vx, nx * speed, 1 - Math.pow(0.001, dt));
  predictedMe.vy = lerp(predictedMe.vy, ny * speed, 1 - Math.pow(0.001, dt));

  predictedMe.x += predictedMe.vx * dt;
  predictedMe.y += predictedMe.vy * dt;
  predictedMe.vx *= Math.pow(FRICTION, dt * 60);
  predictedMe.vy *= Math.pow(FRICTION, dt * 60);

  // bounds only (ignore obstacles for now; server will correct)
  predictedMe.x = clamp(predictedMe.x, PLAYER_RADIUS, ARENA_W - PLAYER_RADIUS);
  predictedMe.y = clamp(predictedMe.y, PLAYER_RADIUS, ARENA_H - PLAYER_RADIUS);
}

function reconcileFromServer(serverPlayer) {
  if (!serverPlayer) return;
  const serverSeq = serverPlayer.lastSeq || 0;
  lastServerSeq = Math.max(lastServerSeq, serverSeq);

  // reset prediction to authoritative state
  predictedMe = {
    x: serverPlayer.x,
    y: serverPlayer.y,
    vx: serverPlayer.vx || 0,
    vy: serverPlayer.vy || 0,
  };

  // drop acked inputs
  while (pendingInputs.length && pendingInputs[0].seq <= serverSeq) pendingInputs.shift();

  // replay remaining inputs
  for (let i = 0; i < pendingInputs.length; i++) {
    const cur = pendingInputs[i];
    const prevT = (i === 0) ? (cur.t - 20) : pendingInputs[i - 1].t;
    const dt = clamp((cur.t - prevT) / 1000, 0, 0.05);
    stepPredictedMe(dt || 0.02, cur);
  }
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
  const myId = state.playerId;

  for (const id of ids) {
    const pa = mapA.get(id);
    const pb = mapB.get(id);

    // Use predicted local player if available
    if (myId && id === myId && predictedMe) {
      const src = pb || pa || {};
      const p = { ...src, ...predictedMe };
      p.id = src.id;
      p.name = src.name;
      p.human = src.human;
      p.it = src.it;
      p.score = src.score;
      p.furryMs = src.furryMs;
      p.aiming = src.aiming;
      p.aimCharge = src.aimCharge;
      p.aimX = src.aimX;
      p.aimY = src.aimY;
      p.disconnected = src.disconnected;
      players.push(p);
      continue;
    }

    const p = lerpObj(pa, pb, t);
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

  const t = performance.now();
  if (up || dn || lf || rt) state.lastMoveAtMs = t;

  const seq = ++inputSeq;

  // prediction bookkeeping
  if (state.mode === 'online' && state.wsReady) {
    pendingInputs.push({ seq, t, up, dn, lf, rt });
    if (!predictedMe) predictedMe = { x: ARENA_W/2, y: ARENA_H/2, vx: 0, vy: 0 };

    const dt = lastInputT ? clamp((t - lastInputT) / 1000, 0, 0.05) : 0.02;
    lastInputT = t;
    stepPredictedMe(dt, { up, dn, lf, rt });
  }

  return {
    type: 'input',
    seq,
    clientTime: t,
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
