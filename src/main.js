import './style.css';

// The Furry One — single-device prototype (player + bots)
// Goal: spend the least time as "the furry one".
// Mechanics:
// - Move: WASD/Arrows
// - If you're it: click+hold to charge throw at mouse position, release to throw
// - Imperfect aim: random spread + a bit of movement-based noise

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

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="top">
    <div class="brand">
      <div class="title">The Furry One</div>
      <div class="subtitle">Dodgeball tag — avoid being it.</div>
    </div>
    <div class="hud">
      <div class="pill" id="status">Loading…</div>
      <button class="btn" id="reset">Reset</button>
    </div>
  </div>
  <div class="canvasWrap"><canvas id="c"></canvas></div>
  <div class="help">
    <div class="card"><div class="small"><b>Move</b>: WASD / Arrows<br><b>Throw</b> (only when it): mouse aim + hold/release</div></div>
    <div class="card"><div class="small" id="score"></div></div>
  </div>
`;

const canvas = document.querySelector('#c');
const ctx = canvas.getContext('2d');

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','W','A','S','D',' '].includes(e.key)) e.preventDefault();
  keys.add(e.key);
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

const mouse = { x: 0, y: 0, down: false, downAt: 0 };
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouse.x = e.clientX - r.left;
  mouse.y = e.clientY - r.top;
});
canvas.addEventListener('mousedown', () => { mouse.down = true; mouse.downAt = performance.now(); });
window.addEventListener('mouseup', () => { mouse.down = false; });

const W = () => canvas.clientWidth;
const H = () => canvas.clientHeight;

// Game constants
const PLAYER_RADIUS = 14;
const BALL_RADIUS = 9;
const MAX_THROW_SPEED = 820; // px/s
const MIN_THROW_SPEED = 220;
const CHARGE_MS = 900;
const FRICTION = 0.90;
const BALL_FRICTION = 0.992;
const BOT_COUNT = 14;
const HIT_COOLDOWN_MS = 450;

// Scoring:
// - First to 100 points wins.
// - When you're NOT it: earn points for staying close to the furry one.
// - When you ARE it: you bleed points over time.
const WIN_POINTS = 100;
const PROX_MAX_DIST = 260; // px; beyond this, no points
const PROX_POINTS_PER_SEC = 16; // max points/sec at distance ~0
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

function makePlayer(id, name, isHuman=false) {
  const pad = 60;
  return {
    id,
    name,
    human: isHuman,
    x: pad + rand01() * (W() - pad*2),
    y: pad + rand01() * (H() - pad*2),
    vx: 0,
    vy: 0,
    it: false,
    furryMs: 0,
    score: 0,
    lastHitAt: -1e9,
    lastThrowAt: -1e9,

    // telegraphing
    aiming: false,
    aimCharge: 0,
    aimX: 0,
    aimY: 0,
    throwPlan: null,
  };
}

function resetGame() {
  state.time0 = performance.now();
  state.lastT = performance.now();
  state.players = [makePlayer('me', 'You', true)];
  for (let i=0;i<BOT_COUNT;i++) state.players.push(makePlayer('b'+i, 'Bot ' + (i+1)));

  // simple obstacles (rectangles)
  const w = W(), h = H();
  state.obstacles = [
    // center blocks
    { x: w*0.50 - 70, y: h*0.50 - 18, w: 140, h: 36 },
    { x: w*0.50 - 18, y: h*0.50 - 70, w: 36, h: 140 },
    // side blocks
    { x: w*0.18 - 44, y: h*0.30 - 28, w: 88, h: 56 },
    { x: w*0.82 - 44, y: h*0.70 - 28, w: 88, h: 56 },
  ];
  // choose random it
  state.players[Math.floor(rand01()*state.players.length)].it = true;
  state.over = false;
  state.winnerId = null;

  state.ball = {
    x: W()/2,
    y: H()/2,
    vx: 0,
    vy: 0,
    heldBy: state.players.find(p => p.it)?.id || null,
    lastThrower: null,
    armed: false,
    thrownAt: -1e9,
  };
  state.throwCharge = 0;
  state.wasMouseDown = false;
  state.wasSpaceDown = false;
  state.spaceDownAt = 0;

  // clear bot telegraph state
  for (const p of state.players) {
    p.aiming = false;
    p.aimCharge = 0;
    p.aimX = p.x;
    p.aimY = p.y;
    p.throwPlan = null;
  }
}

const state = {
  time0: performance.now(),
  lastT: performance.now(),
  players: [],
  obstacles: [],
  ball: null,
  throwCharge: 0,
  wasMouseDown: false,
  wasSpaceDown: false,
  spaceDownAt: 0,
  over: false,
  winnerId: null,
};

function currentIt() { return state.players.find(p => p.it); }

function setIt(playerId) {
  for (const p of state.players) p.it = (p.id === playerId);
  // give ball to new it
  state.ball.heldBy = playerId;
  state.ball.vx = 0;
  state.ball.vy = 0;
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

  // simple behavior:
  // - if bot is it: chase nearest target and throw when "good-ish" line
  // - else: run away from it; slight orbit so it doesn't get stuck

  const targets = state.players.filter(q => q.id !== p.id);
  let nearest = targets[0];
  let best = 1e9;
  for (const q of targets) {
    const d = vecLen(q.x - p.x, q.y - p.y);
    if (d < best) { best = d; nearest = q; }
  }

  let tx = p.x, ty = p.y;

  const b = state.ball;
  if (p.it) {
    // If you're IT and the ball isn't in your hand, your #1 job is to go pick it up.
    if (b && !b.heldBy) {
      tx = b.x;
      ty = b.y;
    } else {
      // otherwise chase a target
      tx = nearest.x;
      ty = nearest.y;
    }
  } else {
    // Not IT: bots should try to WIN.
    // That means hovering near IT (to gain points) while dodging the ball-in-flight.

    // Desired "sweet spot" distance (closer earns points, but too close is risky).
    const SWEET = 140;
    const FAR = 280;

    // If you're behind in score, take more risk (play closer).
    const bestScore = Math.max(...state.players.map(x => x.score || 0));
    const behind01 = clamp((bestScore - (p.score || 0)) / WIN_POINTS, 0, 1);
    const risk = 0.55 + 0.35 * behind01; // 0.55..0.90

    let desiredDist = lerp(FAR, SWEET, risk);

    // Build an "orbit near IT" target.
    const dxIT = p.x - it.x;
    const dyIT = p.y - it.y;
    const dIT = vecLen(dxIT, dyIT) || 1;
    const [nxIT, nyIT] = [dxIT / dIT, dyIT / dIT];
    const oxIT = -nyIT;
    const oyIT = nxIT;

    // If too far: move toward IT; if too close: move away; always add orbit.
    const radialSign = (dIT > desiredDist) ? -1 : 1;
    const wob = Math.sin(performance.now()/520 + p.id.length) * 0.9;

    let vxGoal = nxIT * radialSign * 1.0 + oxIT * 0.9 * wob;
    let vyGoal = nyIT * radialSign * 1.0 + oyIT * 0.9 * wob;

    // Dodge ball-in-flight more aggressively when nearby.
    if (b && !b.heldBy) {
      const tLead = clamp(vecLen(b.vx, b.vy) / 900, 0.10, 0.30);
      const bx = b.x + b.vx * tLead;
      const by = b.y + b.vy * tLead;
      const dBall = vecLen(p.x - bx, p.y - by);
      if (dBall < 460) {
        const [nbx, nby] = vecNorm(p.x - bx, p.y - by);
        // push away from predicted ball path
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

  // bot throw logic (only if it + holding ball)
  if (p.it && state.ball.heldBy === p.id) {
    const now = performance.now();

    // Telegraph + then throw (so humans can dodge the aim, not just the ball).
    const inRange = best < 900;
    const cooldownOk = (now - p.lastThrowAt) > 950;

    if (!p.throwPlan && inRange && cooldownOk) {
      // plan a throw
      const dist01 = clamp(best / 900, 0, 1);
      const targetCharge = clamp(0.40 + 0.50 * dist01 + 0.10 * rand01(), 0.30, 0.95);

      // lead slightly
      const leadT = 0.16 + 0.12 * rand01();
      const aimX = nearest.x + nearest.vx * leadT;
      const aimY = nearest.y + nearest.vy * leadT;

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
    // clear telegraph if not holding
    p.throwPlan = null;
    p.aiming = false;
    p.aimCharge = 0;
  }
}

function resolveCircleRect(px, py, r, rect) {
  // closest point on rect to circle center
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
  const w = W(), h = H();
  p.x = clamp(p.x, r, w - r);
  p.y = clamp(p.y, r, h - r);

  // obstacles
  for (const ob of state.obstacles) {
    const hit = resolveCircleRect(p.x, p.y, r, ob);
    if (!hit) continue;
    p.x += hit.nx * hit.push;
    p.y += hit.ny * hit.push;
    // damp velocity when scraping
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
  const w = W(), h = H();
  if (b.x < r) { b.x = r; b.vx *= -0.72; }
  if (b.x > w - r) { b.x = w - r; b.vx *= -0.72; }
  if (b.y < r) { b.y = r; b.vy *= -0.72; }
  if (b.y > h - r) { b.y = h - r; b.vy *= -0.72; }

  // bounce off obstacles
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

  const now = performance.now();

  // imperfect aim: add angular noise that increases with movement + lower charge
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

function botThrow(bot, target, charge01) {
  // lead slightly
  const leadT = 0.18 + 0.12 * rand01();
  const aimX = target.x + target.vx * leadT;
  const aimY = target.y + target.vy * leadT;
  releaseThrow(bot, aimX, aimY, charge01);
}

function update(dt) {
  const now = performance.now();

  if (state.over) return;

  // scoring + furry time
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

  // movement
  for (const p of state.players) {
    if (p.human) moveHuman(p, dt);
    else moveBot(p, dt);
    keepInBounds(p);
  }

  // ball follow/physics
  const b = state.ball;

  // Invariants: only the current "it" can hold the ball.
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

      // human throw (mouse OR spacebar)
      if (holder.human && holder.it) {
        const space = keys.has(' ');
        const md = mouse.down;

        // update telegraph so others can see your aim/power
        holder.aiming = md || space;
        holder.aimX = mouse.x;
        holder.aimY = mouse.y;

        if (space && !state.wasSpaceDown) state.spaceDownAt = now;

        const charging = md || space;
        if (charging) {
          const start = md ? mouse.downAt : state.spaceDownAt;
          const t = clamp((now - start) / CHARGE_MS, 0, 1);
          state.throwCharge = t;
          holder.aimCharge = t;
        }

        // release on mouse up OR space up
        const releasedMouse = (!md && state.wasMouseDown);
        const releasedSpace = (!space && state.wasSpaceDown);
        if (releasedMouse || releasedSpace) {
          releaseThrow(holder, mouse.x, mouse.y, state.throwCharge);
          state.throwCharge = 0;
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

    // collision rules:
    // - IT can pick up a loose ball by running over it (even if it was recently thrown),
    //   as long as it's slowed down enough to be realistically "grabbed".
    // - If the ball is "armed" and moving, it can tag someone (transfer IT).
    for (const p of state.players) {
      const d = vecLen(p.x - b.x, p.y - b.y);
      if (d > PLAYER_RADIUS + BALL_RADIUS) continue;

      // pickup (priority): only current IT can collect a loose ball
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
        // prevent immediate self-tag; also allow only if not in cooldown
        if (p.id === b.lastThrower) continue;
        if ((now - p.lastHitAt) < HIT_COOLDOWN_MS) continue;

        p.lastHitAt = now;
        setIt(p.id);
        break;
      }
    }

    // If the ball slows, it becomes "unarmed" and stays on the ground.
    // The furry one must run over it to pick it up.
    if (vecLen(b.vx, b.vy) < 55) {
      b.armed = false;
    }
  }
}

function draw() {
  const w = W(), h = H();

  // background
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COLORS.arena;
  ctx.fillRect(0,0,w,h);

  // subtle grid
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  const step = 60;
  for (let x=0; x<=w; x+=step) {
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
  }
  for (let y=0; y<=h; y+=step) {
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
  }

  const it = currentIt();

  // obstacles
  for (const ob of state.obstacles) {
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(ob.x, ob.y, ob.w, ob.h, 10);
    ctx.fill();
    ctx.stroke();
  }

  // aim indicator for anyone who is IT and currently aiming/charging
  for (const p of state.players) {
    if (!p.it) continue;
    if (!p.aiming) continue;
    if (!state.ball?.heldBy || state.ball.heldBy !== p.id) continue;

    const dx = (p.aimX ?? p.x) - p.x;
    const dy = (p.aimY ?? p.y) - p.y;
    const [nx, ny] = vecNorm(dx, dy);
    const charge = clamp(p.aimCharge || 0, 0, 1);
    const len = lerp(70, 220, charge);

    ctx.strokeStyle = p.human ? 'rgba(34,197,94,.30)' : COLORS.aim;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + nx * len, p.y + ny * len);
    ctx.stroke();

    // small target ring (subtle)
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.beginPath();
    ctx.arc(p.x + nx * (len + 18), p.y + ny * (len + 18), 12, 0, TAU);
    ctx.stroke();
  }

  // players
  for (const p of state.players) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, TAU);
    ctx.fillStyle = p.human ? COLORS.me : COLORS.bot;
    ctx.globalAlpha = 1;
    ctx.fill();

    // ring if it
    if (p.it) {
      ctx.strokeStyle = COLORS.it;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PLAYER_RADIUS + 6, 0, TAU);
      ctx.stroke();
    }

    // name label
    ctx.fillStyle = 'rgba(255,255,255,.82)';
    ctx.font = '12px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - PLAYER_RADIUS - 12);

    // extra clarity
    if (p.it) {
      ctx.fillStyle = 'rgba(245,158,11,.95)';
      ctx.font = '11px ui-sans-serif, system-ui';
      ctx.fillText('IT', p.x, p.y + PLAYER_RADIUS + 16);
    }
  }

  // ball
  const b = state.ball;
  if (b) {
    // If held, draw a small tether so it's obvious who has it.
    if (b.heldBy) {
      const holder = state.players.find(p => p.id === b.heldBy);
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

  // top status + score
  const statusEl = document.querySelector('#status');
  if (it) statusEl.textContent = `${it.name} is the furry one`;

  const scoreEl = document.querySelector('#score');
  const sorted = [...state.players].sort((a,b) => b.score - a.score);
  scoreEl.innerHTML = `<b>First to ${WIN_POINTS} wins</b><br><span style="color:rgba(255,255,255,.7)">Gain points near IT · Lose points while IT</span><br>` + sorted.map(p => {
    const s = (p.furryMs/1000).toFixed(1);
    const pts = p.score.toFixed(0);
    const tag = p.it ? ' <span style="color:#f59e0b">(it)</span>' : '';
    const you = p.human ? ' <span style="color:#22c55e">(you)</span>' : '';
    return `${p.name}: ${pts} · ${s}s${you}${tag}`;
  }).join('<br>');

  if (state.over && state.winnerId) {
    const w = state.players.find(p => p.id === state.winnerId);
    const statusEl = document.querySelector('#status');
    statusEl.textContent = `${w?.name || 'Someone'} wins — press Reset (or Enter)`;
  }
}

function loop() {
  const now = performance.now();
  const dt = clamp((now - state.lastT) / 1000, 0, 0.05);
  state.lastT = now;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

document.querySelector('#reset').addEventListener('click', resetGame);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state.over) resetGame();
});

resize();
resetGame();
loop();
