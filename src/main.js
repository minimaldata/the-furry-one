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

// Proximity scoring (only when you're NOT it): reward staying near danger.
const PROX_MAX_DIST = 260; // px; beyond this, no points
const PROX_POINTS_PER_SEC = 12; // max points/sec at distance ~0

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
    proxPoints: 0,
    lastHitAt: -1e9,
    lastThrowAt: -1e9,
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
}

const state = {
  time0: performance.now(),
  lastT: performance.now(),
  players: [],
  obstacles: [],
  ball: null,
  throwCharge: 0,
  wasMouseDown: false,
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
    // flee from the real threat: the ball-in-flight (primary) otherwise the furry one.
    let threatX = it.x;
    let threatY = it.y;

    if (b && !b.heldBy) {
      // predict where the ball will be shortly (gives bots a chance to dodge)
      const tLead = clamp(vecLen(b.vx, b.vy) / 900, 0.10, 0.30);
      threatX = b.x + b.vx * tLead;
      threatY = b.y + b.vy * tLead;

      // if the predicted ball is nowhere near us, fallback to the furry one
      const dBall = vecLen(p.x - threatX, p.y - threatY);
      if (dBall > 420) {
        threatX = it.x;
        threatY = it.y;
      }
    }

    const dx = p.x - threatX;
    const dy = p.y - threatY;
    const [nx, ny] = vecNorm(dx, dy);

    // small orbit / lateral juke (prevents edge glue)
    const ox = -ny;
    const oy = nx;
    const wob = Math.sin(performance.now()/520 + p.id.length) * 0.8;

    tx = p.x + nx * 140 + ox * 70 * wob;
    ty = p.y + ny * 140 + oy * 70 * wob;
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

    // Keep it simple: throw fairly often once within range.
    // (Bots should visibly "use the ball" even in this prototype.)
    const inRange = best < 820;
    const cooldownOk = (now - p.lastThrowAt) > 900;

    if (inRange && cooldownOk) {
      // throw harder when farther (but not always max)
      const dist01 = clamp(best / 820, 0, 1);
      const charge = clamp(0.45 + 0.45 * dist01 + 0.10 * rand01(), 0.35, 0.95);
      botThrow(p, nearest, charge);
      p.lastThrowAt = now;
    }
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

  // accumulate furry time + proximity points
  const it = currentIt();
  for (const p of state.players) {
    if (p.it) p.furryMs += dt * 1000;
    else if (it) {
      const d = vecLen(p.x - it.x, p.y - it.y);
      const closeness01 = clamp(1 - (d / PROX_MAX_DIST), 0, 1);
      // reward near-danger time; taper nonlinearly so "very close" is meaningfully better
      const pts = PROX_POINTS_PER_SEC * (closeness01 ** 1.6) * dt;
      p.proxPoints += pts;
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

      // human throw
      if (holder.human && holder.it) {
        const md = mouse.down;
        if (md) {
          const t = clamp((now - mouse.downAt) / CHARGE_MS, 0, 1);
          state.throwCharge = t;
        }
        if (!md && state.wasMouseDown) {
          releaseThrow(holder, mouse.x, mouse.y, state.throwCharge);
          state.throwCharge = 0;
        }
        state.wasMouseDown = md;
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

  // aim indicator for human when it
  const me = state.players.find(p => p.human);
  if (me?.it && state.ball?.heldBy === me.id) {
    const dx = mouse.x - me.x;
    const dy = mouse.y - me.y;
    const [nx, ny] = vecNorm(dx, dy);
    const charge = mouse.down ? clamp((performance.now() - mouse.downAt)/CHARGE_MS, 0, 1) : 0;
    const len = lerp(60, 160, charge);

    ctx.strokeStyle = COLORS.aim;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(me.x, me.y);
    ctx.lineTo(me.x + nx * len, me.y + ny * len);
    ctx.stroke();

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 14, 0, TAU);
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
  const sorted = [...state.players].sort((a,b) => a.furryMs - b.furryMs);
  scoreEl.innerHTML = `<b>Least furry time wins</b><br><span style="color:rgba(255,255,255,.7)">(+ proximity points when not it)</span><br>` + sorted.map(p => {
    const s = (p.furryMs/1000).toFixed(1);
    const pts = Math.floor(p.proxPoints);
    const tag = p.it ? ' <span style="color:#f59e0b">(it)</span>' : '';
    const you = p.human ? ' <span style="color:#22c55e">(you)</span>' : '';
    return `${p.name}: ${s}s · ${pts}pts${you}${tag}`;
  }).join('<br>');
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

resize();
resetGame();
loop();
