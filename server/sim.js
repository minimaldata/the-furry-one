// Authoritative game simulation for The Furry One (server-side)
// ESM module. No DOM. Fixed arena size.

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

export const CONSTANTS = {
  ARENA_W: 1200,
  ARENA_H: 720,

  PLAYER_RADIUS: 14,
  BALL_RADIUS: 9,

  MAX_THROW_SPEED: 820,
  MIN_THROW_SPEED: 220,
  CHARGE_MS: 900,

  FRICTION: 0.90,
  BALL_FRICTION: 0.992,

  BOT_COUNT: 14,
  HIT_COOLDOWN_MS: 450,
  TOUCH_TAG_COOLDOWN_MS: 650,

  WIN_POINTS: 100,
  PROX_MAX_DIST: 260,
  PROX_POINTS_PER_SEC: 16,
  IT_BLEED_POINTS_PER_SEC: 6,
};

function makePlayer({ id, name, human = false, arenaW, arenaH }) {
  const pad = 60;
  return {
    id,
    name,
    human,
    x: pad + rand01() * (arenaW - pad * 2),
    y: pad + rand01() * (arenaH - pad * 2),
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

    // server-only input bookkeeping
    input: {
      seq: 0,
      up: false,
      dn: false,
      lf: false,
      rt: false,
      mouseX: arenaW / 2,
      mouseY: arenaH / 2,
      mouseDown: false,
      spaceDown: false,
      clientTime: 0,
    },
    // edge detection / charge timing
    wasMouseDown: false,
    wasSpaceDown: false,
    mouseDownAt: 0,
    spaceDownAt: 0,

    disconnectedAt: null,
  };
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

export function createWorld(opts = {}) {
  const C = CONSTANTS;
  const arenaW = opts.arenaW ?? C.ARENA_W;
  const arenaH = opts.arenaH ?? C.ARENA_H;

  const world = {
    arenaW,
    arenaH,
    nowMs: 0,
    over: false,
    winnerId: null,
    players: [],
    obstacles: [],
    ball: null,
  };

  function reset() {
    world.nowMs = 0;
    world.over = false;
    world.winnerId = null;

    // obstacles
    const w = arenaW, h = arenaH;
    world.obstacles = [
      { x: w * 0.50 - 70, y: h * 0.50 - 18, w: 140, h: 36 },
      { x: w * 0.50 - 18, y: h * 0.50 - 70, w: 36, h: 140 },
      { x: w * 0.18 - 44, y: h * 0.30 - 28, w: 88, h: 56 },
      { x: w * 0.82 - 44, y: h * 0.70 - 28, w: 88, h: 56 },
    ];

    // keep existing humans, regenerate bots
    const humans = world.players.filter(p => p.human);
    world.players = [...humans];

    // ensure bot population
    const botsNeeded = C.BOT_COUNT;
    for (let i = 0; i < botsNeeded; i++) {
      world.players.push(makePlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, human: false, arenaW, arenaH }));
    }

    // random IT among everyone
    const idx = Math.floor(rand01() * world.players.length);
    for (let i = 0; i < world.players.length; i++) world.players[i].it = (i === idx);

    const it = currentIt();
    world.ball = {
      x: arenaW / 2,
      y: arenaH / 2,
      vx: 0,
      vy: 0,
      heldBy: it?.id ?? null,
      lastThrower: null,
      armed: false,
      thrownAt: -1e9,
    };

    // clear telegraphs
    for (const p of world.players) {
      p.aiming = false;
      p.aimCharge = 0;
      p.aimX = p.x;
      p.aimY = p.y;
      p.throwPlan = null;
      p.wasMouseDown = false;
      p.wasSpaceDown = false;
      p.mouseDownAt = 0;
      p.spaceDownAt = 0;
    }
  }

  function currentIt() { return world.players.find(p => p.it); }

  function setIt(playerId) {
    for (const p of world.players) p.it = (p.id === playerId);
    // ball to new it
    const b = world.ball;
    b.heldBy = playerId;
    b.vx = 0;
    b.vy = 0;
  }

  function hasClearThrow(fromX, fromY, toX, toY) {
    for (const ob of world.obstacles) {
      if (segmentIntersectsRect(fromX, fromY, toX, toY, ob)) return false;
    }
    return true;
  }

  function keepInBounds(p) {
    const r = C.PLAYER_RADIUS;
    const w = arenaW, h = arenaH;
    p.x = clamp(p.x, r, w - r);
    p.y = clamp(p.y, r, h - r);

    for (const ob of world.obstacles) {
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
    const r = C.BALL_RADIUS;
    const w = arenaW, h = arenaH;
    if (b.x < r) { b.x = r; b.vx *= -0.72; }
    if (b.x > w - r) { b.x = w - r; b.vx *= -0.72; }
    if (b.y < r) { b.y = r; b.vy *= -0.72; }
    if (b.y > h - r) { b.y = h - r; b.vy *= -0.72; }

    for (const ob of world.obstacles) {
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
    const b = world.ball;
    if (!b || b.heldBy !== thrower.id) return;

    const now = world.nowMs;

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

    const speed = lerp(C.MIN_THROW_SPEED, C.MAX_THROW_SPEED, charge01);

    b.heldBy = null;
    b.lastThrower = thrower.id;
    b.armed = true;
    b.thrownAt = now;
    b.x = thrower.x + nx * (C.PLAYER_RADIUS + C.BALL_RADIUS + 2);
    b.y = thrower.y + ny * (C.PLAYER_RADIUS + C.BALL_RADIUS + 2);
    b.vx = nx * speed;
    b.vy = ny * speed;
  }

  function moveHuman(p, dt) {
    const input = p.input;
    let ax = 0, ay = 0;
    if (input.up) ay -= 1;
    if (input.dn) ay += 1;
    if (input.lf) ax -= 1;
    if (input.rt) ax += 1;
    const [nx, ny] = vecNorm(ax, ay);

    const speed = 1080;
    p.vx = lerp(p.vx, nx * speed, 1 - Math.pow(0.001, dt));
    p.vy = lerp(p.vy, ny * speed, 1 - Math.pow(0.001, dt));

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(C.FRICTION, dt * 60);
    p.vy *= Math.pow(C.FRICTION, dt * 60);
  }

  function moveBot(p, dt) {
    const it = currentIt();
    if (!it) return;

    const targets = world.players.filter(q => q.id !== p.id);

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
      const leader01 = clamp((q.score || 0) / C.WIN_POINTS, 0, 1);
      const closish01 = clamp(1 - d / 900, 0, 1);
      const los = hasClearThrow(p.x, p.y, q.x, q.y) ? 1 : 0;
      const s = (2.2 * leader01 + 0.9 * closish01 + 0.4 * rand01()) * (0.25 + 0.75 * los);
      if (s > throwBest) {
        throwBest = s;
        throwTarget = q;
      }
    }

    let tx = p.x, ty = p.y;
    const b = world.ball;
    if (p.it) {
      if (b && !b.heldBy) {
        tx = b.x; ty = b.y;
      } else {
        tx = nearest.x; ty = nearest.y;
      }
    } else {
      // Not IT: farm points by staying close to IT, but manage threat.
      // Key idea: if IT doesn't have the ball, it's a "safe window" to get closer.
      const bestScoreNow = Math.max(...world.players.map(x => x.score || 0));
      const behind01 = clamp((bestScoreNow - (p.score || 0)) / C.WIN_POINTS, 0, 1);
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
      const wob = Math.sin(world.nowMs / 520 + p.id.length) * 0.9;

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
    p.vx *= Math.pow(C.FRICTION, dt * 60);
    p.vy *= Math.pow(C.FRICTION, dt * 60);

    if (p.it && world.ball.heldBy === p.id) {
      const now = world.nowMs;
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

  const ENDLESS_ONLINE = process.env.ENDLESS_ONLINE !== '0';

  function step(dt) {
    world.nowMs += dt * 1000;
    const now = world.nowMs;

    // scoring (+ optional win)
    const it = currentIt();
    for (const p of world.players) {
      if (p.it) {
        p.furryMs += dt * 1000;
        p.score = Math.max(0, p.score - C.IT_BLEED_POINTS_PER_SEC * dt);
      } else if (it) {
        const d = vecLen(p.x - it.x, p.y - it.y);
        const closeness01 = clamp(1 - (d / C.PROX_MAX_DIST), 0, 1);
        const pts = C.PROX_POINTS_PER_SEC * (closeness01 ** 1.6) * dt;
        p.score += pts;
      }
      if (!ENDLESS_ONLINE && p.score >= C.WIN_POINTS && !world.over) {
        world.over = true;
        world.winnerId = p.id;
      }
    }

    // movement
    for (const p of world.players) {
      if (p.human) moveHuman(p, dt);
      else moveBot(p, dt);
      keepInBounds(p);
    }

    // separation
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < world.players.length; i++) {
        for (let j = i + 1; j < world.players.length; j++) {
          const a = world.players[i];
          const c = world.players[j];
          const dx = c.x - a.x;
          const dy = c.y - a.y;
          const d = Math.hypot(dx, dy) || 1e-6;
          const minD = C.PLAYER_RADIUS * 2;
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

    // ball
    const b = world.ball;

    // invariant: only current it can hold
    if (it && b.heldBy && b.heldBy !== it.id) {
      b.heldBy = it.id;
      b.lastThrower = null;
    }

    if (b.heldBy) {
      const holder = world.players.find(p => p.id === b.heldBy);
      if (holder) {
        b.x = holder.x;
        b.y = holder.y;
        b.vx = 0;
        b.vy = 0;

        // touch-tag
        if (it && holder.id === it.id) {
          for (const other of world.players) {
            if (other.id === holder.id) continue;
            const d = vecLen(other.x - holder.x, other.y - holder.y);
            if (d > C.PLAYER_RADIUS * 2) continue;

            const canTag = (now - holder.lastHitAt) > C.TOUCH_TAG_COOLDOWN_MS && (now - other.lastHitAt) > C.TOUCH_TAG_COOLDOWN_MS;
            if (!canTag) continue;

            holder.lastHitAt = now;
            other.lastHitAt = now;
            setIt(other.id);
            break;
          }
        }

        // human throw based on input
        if (holder.human && holder.it) {
          const input = holder.input;
          const md = !!input.mouseDown;
          const space = !!input.spaceDown;

          holder.aiming = md || space;
          holder.aimX = input.mouseX;
          holder.aimY = input.mouseY;

          if (md && !holder.wasMouseDown) holder.mouseDownAt = now;
          if (space && !holder.wasSpaceDown) holder.spaceDownAt = now;

          const charging = md || space;
          if (charging) {
            const start = md ? holder.mouseDownAt : holder.spaceDownAt;
            const t = clamp((now - start) / C.CHARGE_MS, 0, 1);
            holder.aimCharge = t;
          }

          const releasedMouse = (!md && holder.wasMouseDown);
          const releasedSpace = (!space && holder.wasSpaceDown);
          if (releasedMouse || releasedSpace) {
            releaseThrow(holder, input.mouseX, input.mouseY, holder.aimCharge || 0);
            holder.aiming = false;
            holder.aimCharge = 0;
          }

          holder.wasMouseDown = md;
          holder.wasSpaceDown = space;
        }
      }
    } else {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= Math.pow(C.BALL_FRICTION, dt * 60);
      b.vy *= Math.pow(C.BALL_FRICTION, dt * 60);
      ballBounds(b);

      for (const p of world.players) {
        const d = vecLen(p.x - b.x, p.y - b.y);
        if (d > C.PLAYER_RADIUS + C.BALL_RADIUS) continue;

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
          if ((now - p.lastHitAt) < C.HIT_COOLDOWN_MS) continue;

          p.lastHitAt = now;
          setIt(p.id);
          break;
        }
      }

      if (vecLen(b.vx, b.vy) < 55) {
        b.armed = false;
      }
    }
  }

  function snapshot() {
    // minimal state for clients
    return {
      nowMs: world.nowMs,
      arenaW,
      arenaH,
      over: world.over,
      winnerId: world.winnerId,
      obstacles: world.obstacles,
      ball: world.ball,
      players: world.players.map(p => ({
        id: p.id,
        name: p.name,
        human: p.human,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        it: p.it,
        furryMs: p.furryMs,
        score: p.score,
        aiming: p.aiming,
        aimCharge: p.aimCharge,
        aimX: p.aimX,
        aimY: p.aimY,
        disconnected: !!p.disconnectedAt,
      })),
    };
  }

  reset();

  return {
    world,
    reset,
    step,
    snapshot,
    addHumanPlayer({ id, name }) {
      const p = makePlayer({ id, name, human: true, arenaW, arenaH });
      world.players.unshift(p);
      // ensure exactly one IT; if none (shouldn't happen), set this one
      if (!currentIt()) setIt(p.id);
      return p;
    },
    getPlayer(id) { return world.players.find(p => p.id === id); },
    removePlayer(id) {
      world.players = world.players.filter(p => p.id !== id);
      // if removed IT, assign IT to someone else
      if (!currentIt() && world.players.length) {
        setIt(world.players[Math.floor(rand01() * world.players.length)].id);
      }
      // keep bots count steady
      const bots = world.players.filter(p => !p.human);
      const humans = world.players.filter(p => p.human);
      if (bots.length < CONSTANTS.BOT_COUNT) {
        const start = bots.length;
        for (let i = start; i < CONSTANTS.BOT_COUNT; i++) {
          world.players.push(makePlayer({ id: `bot_${i}`, name: `Bot ${i + 1}`, human: false, arenaW, arenaH }));
        }
      }
      // reorder: humans first
      world.players = [...humans, ...world.players.filter(p => !p.human)];
    },
    applyInput(playerId, input) {
      const p = world.players.find(x => x.id === playerId);
      if (!p || !p.human) return;
      const seq = Number(input.seq || 0);
      if (seq <= p.input.seq) return;
      p.input = {
        seq,
        up: !!input.up,
        dn: !!input.dn,
        lf: !!input.lf,
        rt: !!input.rt,
        mouseX: clamp(Number(input.mouseX ?? p.input.mouseX), 0, arenaW),
        mouseY: clamp(Number(input.mouseY ?? p.input.mouseY), 0, arenaH),
        mouseDown: !!input.mouseDown,
        spaceDown: !!input.spaceDown,
        clientTime: Number(input.clientTime || 0),
      };
    },
    markDisconnected(playerId, now = Date.now()) {
      const p = world.players.find(x => x.id === playerId);
      if (p) p.disconnectedAt = now;
    },
    markReconnected(playerId) {
      const p = world.players.find(x => x.id === playerId);
      if (p) p.disconnectedAt = null;
    },
    pruneDisconnected(maxAgeMs, now = Date.now()) {
      const toRemove = world.players
        .filter(p => p.human && p.disconnectedAt && (now - p.disconnectedAt) > maxAgeMs)
        .map(p => p.id);
      for (const id of toRemove) this.removePlayer(id);
    },
  };
}
