import './style.css';

// The Furry One — offline single-player + high-score service
// Gameplay runs locally in the browser; best scores can be saved via HTTP.

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
const THROW_RECLAIM_LOCK_MS = 120;

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

const SCORE_DATA_SOURCES = {
  LIVE: 'live',
  DUMMY: 'dummy',
};
const ALLOW_DUMMY_SCORE_DATA = !!import.meta.env.DEV;

const SCATTER_RANGE_MODES = {
  LAST: 'last',
  BETWEEN: 'between',
};

const SCATTER_TYPES = {
  LOSERS: 'losers',
  WINNERS: 'winners',
};

const STORAGE_KEYS = {
  profileName: 'tfo_profile_name',
  profilePassword: 'tfo_profile_password',
  scoreDataSource: 'tfo_score_data_source',
  comparePlayers: 'tfo_compare_players',
  analyticsMinRuns: 'tfo_analytics_min_runs',
  summaryWindow: 'tfo_summary_window',
  summaryMode: 'tfo_summary_mode',
  summaryStartRun: 'tfo_summary_start_run',
  summaryEndRun: 'tfo_summary_end_run',
  scatterType: 'tfo_scatter_type',
  scatterWindow: 'tfo_scatter_window',
  scatterMode: 'tfo_scatter_mode',
  scatterStartRun: 'tfo_scatter_start_run',
  scatterEndRun: 'tfo_scatter_end_run',
};

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
      <h2 id="endTitle">The Furry One</h2>
      <p id="endSub">Get furry by being closest to, but not IT</p>
      <div class="actions runActions">
        <button class="btn" id="playOffline">Start run</button>
        <button class="btn" id="switchProfile" type="button">Set profile</button>
        <div class="runProfile" id="runProfileName">Profile: Player</div>
      </div>
      <div class="rows" id="endRows"></div>
      <div class="scoreCard">
        <div class="sectionTitle" id="highScoreTitle">High Scores</div>
        <div class="scoreControls${ALLOW_DUMMY_SCORE_DATA ? '' : ' isHidden'}">
          <label for="scoreDataSource">Data</label>
          <select id="scoreDataSource" class="field fieldSelect">
            <option value="live">live</option>
            ${ALLOW_DUMMY_SCORE_DATA ? '<option value="dummy">dummy (local test)</option>' : ''}
          </select>
        </div>
        <details class="scoreSection">
          <summary class="scoreSectionSummary">Analytics Summary</summary>
          <div class="scoreSectionBody">
            <div class="scatterControlsCompact">
              <div class="scatterControlItem">
                <label for="summaryMode">Window</label>
                <select id="summaryMode" class="field fieldSelect">
                  <option value="last">Last N runs</option>
                  <option value="between">Between run N and M</option>
                </select>
              </div>
            </div>
            <div class="scatterWindowRow">
              <div class="scatterWindowGroup" id="summaryRangeLast">
                <label for="summaryWindow" id="summaryWindowLabel">Run count</label>
                <input id="summaryWindow" class="field fieldNumber" type="number" min="1" max="100" step="1" value="20" />
              </div>
              <div class="scatterWindowGroup scatterWindowGroupRange" id="summaryRangeBetween">
                <label for="summaryRunStart" id="summaryRunStartLabel">Run</label>
                <input id="summaryRunStart" class="field fieldNumber" type="number" min="1" max="10000" step="1" value="1" />
                <span class="scatterWindowSep">to</span>
                <label for="summaryRunEnd" id="summaryRunEndLabel">Run</label>
                <input id="summaryRunEnd" class="field fieldNumber" type="number" min="1" max="10000" step="1" value="20" />
              </div>
            </div>
            <div class="analyticsCards" id="analyticsCards"></div>
          </div>
        </details>
        <details class="scoreSection">
          <summary class="scoreSectionSummary">Scatter Plot</summary>
          <div class="scoreSectionBody">
            <div class="scatterControlsCompact">
              <div class="scatterControlItem">
                <label for="scatterType">Type</label>
                <select id="scatterType" class="field fieldSelect">
                  <option value="losers">Losers</option>
                  <option value="winners">Winners</option>
                </select>
              </div>
              <div class="scatterControlItem">
                <label for="scatterMode">Window</label>
                <select id="scatterMode" class="field fieldSelect">
                  <option value="last">Last N runs</option>
                  <option value="between">Between run N and M</option>
                </select>
              </div>
            </div>
            <div class="scatterWindowRow">
              <div class="scatterWindowGroup" id="scatterRangeLast">
                <label for="scatterWindow" id="scatterWindowLabel">Count</label>
                <input id="scatterWindow" class="field fieldNumber" type="number" min="1" max="100" step="1" value="5" />
              </div>
              <div class="scatterWindowGroup scatterWindowGroupRange" id="scatterRangeBetween">
                <label for="scatterRunStart" id="scatterRunStartLabel">Run</label>
                <input id="scatterRunStart" class="field fieldNumber" type="number" min="1" max="10000" step="1" value="1" />
                <span class="scatterWindowSep">to</span>
                <label for="scatterRunEnd" id="scatterRunEndLabel">Run</label>
                <input id="scatterRunEnd" class="field fieldNumber" type="number" min="1" max="10000" step="1" value="5" />
              </div>
            </div>
            <div class="scatterCard">
              <div class="scatterPlot" id="scatterPlot"></div>
              <div class="small scatterHint" id="scatterHint"></div>
            </div>
          </div>
        </details>
        <details class="scoreSection">
          <summary class="scoreSectionSummary">Player Comparison</summary>
          <div class="scoreSectionBody">
            <div class="scoreControls scoreControlsWide">
              <label for="comparePlayers">Compare</label>
              <input id="comparePlayers" class="field fieldInline" type="text" maxlength="160" placeholder="alice,bob,yoyoyo" />
              <label for="minRuns">Min Runs</label>
              <input id="minRuns" class="field fieldNumber" type="number" min="1" max="500" step="1" value="5" />
              <button class="btn" id="applyAnalytics" type="button">Apply</button>
            </div>
            <div class="rows analyticsRows" id="analyticsRows"></div>
            <div class="small" id="analyticsStatus"></div>
          </div>
        </details>
        <details class="scoreSection">
          <summary class="scoreSectionSummary">Top Runs</summary>
          <div class="scoreSectionBody">
            <div class="rows highScoreRows" id="highScoreRows"></div>
            <div class="small" id="highScoreStatus"></div>
          </div>
        </details>
        <div class="profileInline isHidden" id="profileInlineEditor">
          <div class="profileInlineGrid">
            <input id="profileName" class="field" type="text" maxlength="24" placeholder="Name" />
            <input id="profilePassword" class="field" type="password" maxlength="128" placeholder="Optional password" />
          </div>
          <div class="actions profileInlineActions">
            <button class="btn" id="saveProfile" type="button">Log in</button>
            <div class="profileInlineStatus" id="profileInlineStatus"></div>
            <button class="btn" id="clearPassword" type="button">Clear password</button>
          </div>
        </div>
        <div class="actions scoreActions" id="scoreActions">
          <button class="btn" id="submitHighScore" type="button">Submit score</button>
        </div>
      </div>
    </div>
  </div>

  <div class="help"></div>
`;

const canvas = document.querySelector('#c');
const ctx = canvas.getContext('2d');
const leaderboardEl = document.querySelector('#leaderboard');
const overlayEl = document.querySelector('#overlay');
const endTitleEl = document.querySelector('#endTitle');
const endSubEl = document.querySelector('#endSub');
const endRowsEl = document.querySelector('#endRows');
const playOfflineBtn = document.querySelector('#playOffline');
const profileInlineEditorEl = document.querySelector('#profileInlineEditor');
const runProfileNameEl = document.querySelector('#runProfileName');
const profileNameEl = document.querySelector('#profileName');
const profilePasswordEl = document.querySelector('#profilePassword');
const saveProfileBtn = document.querySelector('#saveProfile');
const profileInlineStatusEl = document.querySelector('#profileInlineStatus');
const clearPasswordBtn = document.querySelector('#clearPassword');
const highScoreTitleEl = document.querySelector('#highScoreTitle');
const scoreDataSourceEl = document.querySelector('#scoreDataSource');
const comparePlayersEl = document.querySelector('#comparePlayers');
const minRunsEl = document.querySelector('#minRuns');
const applyAnalyticsBtn = document.querySelector('#applyAnalytics');
const cdfChartEl = document.querySelector('#cdfChart');
const cdfHintEl = document.querySelector('#cdfHint');
const summaryModeEl = document.querySelector('#summaryMode');
const summaryWindowEl = document.querySelector('#summaryWindow');
const summaryRunStartEl = document.querySelector('#summaryRunStart');
const summaryRunEndEl = document.querySelector('#summaryRunEnd');
const summaryRangeLastEl = document.querySelector('#summaryRangeLast');
const summaryRangeBetweenEl = document.querySelector('#summaryRangeBetween');
const summaryWindowLabelEl = document.querySelector('#summaryWindowLabel');
const summaryRunStartLabelEl = document.querySelector('#summaryRunStartLabel');
const summaryRunEndLabelEl = document.querySelector('#summaryRunEndLabel');
const scatterTypeEl = document.querySelector('#scatterType');
const scatterModeEl = document.querySelector('#scatterMode');
const scatterWindowEl = document.querySelector('#scatterWindow');
const scatterRunStartEl = document.querySelector('#scatterRunStart');
const scatterRunEndEl = document.querySelector('#scatterRunEnd');
const scatterRangeLastEl = document.querySelector('#scatterRangeLast');
const scatterRangeBetweenEl = document.querySelector('#scatterRangeBetween');
const scatterWindowLabelEl = document.querySelector('#scatterWindowLabel');
const scatterRunStartLabelEl = document.querySelector('#scatterRunStartLabel');
const scatterRunEndLabelEl = document.querySelector('#scatterRunEndLabel');
const scatterPlotEl = document.querySelector('#scatterPlot');
const scatterHintEl = document.querySelector('#scatterHint');
const analyticsCardsEl = document.querySelector('#analyticsCards');
const analyticsRowsEl = document.querySelector('#analyticsRows');
const analyticsStatusEl = document.querySelector('#analyticsStatus');
const highScoreRowsEl = document.querySelector('#highScoreRows');
const highScoreStatusEl = document.querySelector('#highScoreStatus');
const submitHighScoreBtn = document.querySelector('#submitHighScore');
const switchProfileBtn = document.querySelector('#switchProfile');
const scoreActionsEl = document.querySelector('#scoreActions');
let leaderboardSig = '';
let highScoreSig = null;
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
      const nextRule = ok ? next : IT_TRANSFER_RULES.HYBRID;
      if (state.itTransferRule !== nextRule) {
        state.itTransferRule = nextRule;
        highScoreSig = null;
        updateHighScoreTitle();
        refreshHighScores();
      }
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

function getApiBaseUrl() {
  const env = import.meta.env?.VITE_API_URL;
  if (env && typeof env === 'string') return env.replace(/\/$/, '');
  if (window.location.port === '5173') return 'http://localhost:8080';
  return window.location.origin;
}

async function apiFetch(pathname, options = {}) {
  const url = `${getApiBaseUrl()}${pathname}`;
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

const SCORE_DIST_CHART = { width: 420, height: 170, padL: 34, padR: 12, padT: 10, padB: 24 };
const SCATTER_CHART = { width: 420, height: 220, padL: 38, padR: 14, padT: 10, padB: 30 };

function normalizeNameForKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24).toLowerCase();
}

function parseScoreDataSource(value) {
  if (!ALLOW_DUMMY_SCORE_DATA) return SCORE_DATA_SOURCES.LIVE;
  return value === SCORE_DATA_SOURCES.DUMMY ? SCORE_DATA_SOURCES.DUMMY : SCORE_DATA_SOURCES.LIVE;
}

function getStoredScoreDataSource() {
  return parseScoreDataSource(localStorage.getItem(STORAGE_KEYS.scoreDataSource) || SCORE_DATA_SOURCES.LIVE);
}

function getInitialScoreDataSource() {
  if (!ALLOW_DUMMY_SCORE_DATA) return SCORE_DATA_SOURCES.LIVE;
  const params = new URLSearchParams(window.location.search || '');
  if (params.get('dummyScores') === '1') return SCORE_DATA_SOURCES.DUMMY;
  return getStoredScoreDataSource();
}

function sanitizeComparePlayers(value) {
  return String(value || '')
    .split(',')
    .map((v) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 24))
    .filter(Boolean)
    .slice(0, 12)
    .join(',');
}

function getStoredComparePlayers() {
  return sanitizeComparePlayers(localStorage.getItem(STORAGE_KEYS.comparePlayers) || '');
}

function parseMinRuns(value, fallback = 5) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(500, n));
}

function getStoredMinRuns() {
  return parseMinRuns(localStorage.getItem(STORAGE_KEYS.analyticsMinRuns), 5);
}

function getStoredSummaryWindow() {
  return parseScatterWindow(localStorage.getItem(STORAGE_KEYS.summaryWindow), 20);
}

function getStoredSummaryMode() {
  return parseScatterMode(localStorage.getItem(STORAGE_KEYS.summaryMode));
}

function getStoredSummaryStartRun() {
  return parseScatterRunIndex(localStorage.getItem(STORAGE_KEYS.summaryStartRun), 1);
}

function getStoredSummaryEndRun() {
  return parseScatterRunIndex(localStorage.getItem(STORAGE_KEYS.summaryEndRun), 20);
}

function parseScatterWindow(value, fallback = 5) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(100, n));
}

function getStoredScatterWindow() {
  return parseScatterWindow(localStorage.getItem(STORAGE_KEYS.scatterWindow), 5);
}

function parseScatterType(value) {
  return value === SCATTER_TYPES.WINNERS ? SCATTER_TYPES.WINNERS : SCATTER_TYPES.LOSERS;
}

function getStoredScatterType() {
  return parseScatterType(localStorage.getItem(STORAGE_KEYS.scatterType));
}

function parseScatterMode(value) {
  return value === SCATTER_RANGE_MODES.BETWEEN ? SCATTER_RANGE_MODES.BETWEEN : SCATTER_RANGE_MODES.LAST;
}

function getStoredScatterMode() {
  return parseScatterMode(localStorage.getItem(STORAGE_KEYS.scatterMode));
}

function parseScatterRunIndex(value, fallback = 1) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(10000, n));
}

function normalizeScatterRange(startRun, endRun, fallbackStart = 1, fallbackEnd = 5) {
  const start = parseScatterRunIndex(startRun, fallbackStart);
  const end = parseScatterRunIndex(endRun, fallbackEnd);
  if (start <= end) return { startRun: start, endRun: end };
  return { startRun: end, endRun: start };
}

function getStoredScatterStartRun() {
  return parseScatterRunIndex(localStorage.getItem(STORAGE_KEYS.scatterStartRun), 1);
}

function getStoredScatterEndRun() {
  return parseScatterRunIndex(localStorage.getItem(STORAGE_KEYS.scatterEndRun), 5);
}

function emptyScoreStats() {
  return {
    totalRuns: 0,
    playerRuns: 0,
    pdf: {
      x: Array.from({ length: 101 }, (_, i) => i),
      all: Array.from({ length: 101 }, () => 0),
      player: Array.from({ length: 101 }, () => 0),
    },
  };
}

function emptyAnalytics() {
  return {
    minRuns: 5,
    summary: {
      mode: SCATTER_RANGE_MODES.LAST,
      windowRuns: 20,
      startRun: 1,
      endRun: 20,
      totalRuns: 0,
      totalPlayers: 0,
      currentPercentiles: {
        winRate: null,
        nonWinScore: null,
        winTime: null,
      },
      everyonePercentiles: {
        winRate: null,
        nonWinScore: null,
        winTime: null,
      },
      current: {
        name: 'Player',
        nameKey: 'player',
        totalRuns: 0,
        winCount: 0,
        winRate: 0,
        medianWinTimeMs: null,
        nonWinCount: 0,
        medianNonWinScore: null,
        meetsMinRuns: false,
      },
      everyone: {
        name: 'Everyone',
        nameKey: 'everyone',
        totalRuns: 0,
        winCount: 0,
        winRate: 0,
        medianWinTimeMs: null,
        nonWinCount: 0,
        medianNonWinScore: null,
        meetsMinRuns: false,
      },
    },
    currentPercentiles: {
      winRate: null,
      nonWinScore: null,
      winTime: null,
    },
    everyonePercentiles: {
      winRate: null,
      nonWinScore: null,
      winTime: null,
    },
    scatterKind: SCATTER_TYPES.LOSERS,
    scatterN: 5,
    scatterMode: SCATTER_RANGE_MODES.LAST,
    scatterStart: 1,
    scatterEnd: 5,
    totalRuns: 0,
    totalPlayers: 0,
    current: {
      name: 'Player',
      nameKey: 'player',
      totalRuns: 0,
      winCount: 0,
      winRate: 0,
      medianWinTimeMs: null,
      nonWinCount: 0,
      medianNonWinScore: null,
      meetsMinRuns: false,
    },
    everyone: {
      name: 'Everyone',
      nameKey: 'everyone',
      totalRuns: 0,
      winCount: 0,
      winRate: 0,
      medianWinTimeMs: null,
      nonWinCount: 0,
      medianNonWinScore: null,
      meetsMinRuns: false,
    },
    compared: [],
    availablePlayers: [],
    scatter: {
      kind: SCATTER_TYPES.LOSERS,
      mode: SCATTER_RANGE_MODES.LAST,
      windowRuns: 5,
      startRun: 1,
      endRun: 5,
      eligiblePlayers: 0,
      points: [],
    },
  };
}

function compareScoreRows(a, b) {
  if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
  const aGame = Number.isFinite(Number(a.gameTimeMs)) && Number(a.gameTimeMs) > 0 ? Number(a.gameTimeMs) : 1e12;
  const bGame = Number.isFinite(Number(b.gameTimeMs)) && Number(b.gameTimeMs) > 0 ? Number(b.gameTimeMs) : 1e12;
  if (aGame !== bGame) return aGame - bGame;
  if ((a.furryMs || 0) !== (b.furryMs || 0)) return (a.furryMs || 0) - (b.furryMs || 0);
  return String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
}

function smoothProbabilitySeries(values, radius = 2) {
  if (!values.length) return values;
  const out = values.map((_, i) => {
    let sum = 0;
    let wSum = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      const w = radius + 1 - Math.abs(j - i);
      sum += values[j] * w;
      wSum += w;
    }
    return wSum > 0 ? (sum / wSum) : 0;
  });
  const area = out.reduce((a, b) => a + b, 0);
  if (area <= 0) return out;
  return out.map((v) => v / area);
}

function buildPdfSeries(scores) {
  const xs = Array.from({ length: 101 }, (_, i) => i);
  if (!scores.length) return xs.map(() => 0);
  const counts = xs.map(() => 0);
  for (const score of scores) {
    const idx = Math.round(clamp(Number(score) || 0, 0, 100));
    counts[idx] += 1;
  }
  const probs = counts.map((c) => c / scores.length);
  return smoothProbabilitySeries(probs, 2);
}

function buildScoreStatsFromRuns(runs, profileName) {
  const pKey = normalizeNameForKey(profileName);
  const allScores = runs.map((r) => Math.round(clamp(Number(r?.score) || 0, 0, 100)));
  const myScores = runs
    .filter((r) => normalizeNameForKey(r?.name || r?.nameKey) === pKey)
    .map((r) => Math.round(clamp(Number(r?.score) || 0, 0, 100)));
  return {
    totalRuns: runs.length,
    playerRuns: myScores.length,
    pdf: {
      x: Array.from({ length: 101 }, (_, i) => i),
      all: buildPdfSeries(allScores),
      player: buildPdfSeries(myScores),
    },
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarizeRunsForAnalytics(runs, identity = {}) {
  const totalRuns = runs.length;
  const wins = runs.filter((run) => Number(run?.score || 0) >= 100);
  const winTimes = wins
    .map((run) => Number(run?.gameTimeMs))
    .filter((v) => Number.isFinite(v) && v > 0);
  const nonWinScores = runs
    .filter((run) => Number(run?.score || 0) < 100)
    .map((run) => Math.round(clamp(Number(run?.score) || 0, 0, 100)));

  return {
    name: identity.name || 'Player',
    nameKey: identity.nameKey || normalizeNameForKey(identity.name || 'Player'),
    totalRuns,
    winCount: wins.length,
    winRate: totalRuns > 0 ? (wins.length / totalRuns) : 0,
    medianWinTimeMs: median(winTimes),
    nonWinCount: nonWinScores.length,
    medianNonWinScore: median(nonWinScores),
  };
}

function comparePlayerAnalytics(a, b) {
  if ((b.winRate || 0) !== (a.winRate || 0)) return (b.winRate || 0) - (a.winRate || 0);
  if ((b.winCount || 0) !== (a.winCount || 0)) return (b.winCount || 0) - (a.winCount || 0);
  const aTime = Number.isFinite(a.medianWinTimeMs) ? a.medianWinTimeMs : 1e12;
  const bTime = Number.isFinite(b.medianWinTimeMs) ? b.medianWinTimeMs : 1e12;
  if (aTime !== bTime) return aTime - bTime;
  if ((b.medianNonWinScore || 0) !== (a.medianNonWinScore || 0)) return (b.medianNonWinScore || 0) - (a.medianNonWinScore || 0);
  if ((b.totalRuns || 0) !== (a.totalRuns || 0)) return (b.totalRuns || 0) - (a.totalRuns || 0);
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function metricPercentile(value, values, higherIsBetter = true) {
  const target = Number(value);
  const pool = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (!Number.isFinite(target) || pool.length === 0) return null;
  let better = 0;
  let equal = 0;
  for (const v of pool) {
    if (v === target) equal += 1;
    else if (higherIsBetter ? (v < target) : (v > target)) better += 1;
  }
  return clamp(((better + (equal * 0.5)) / pool.length) * 100, 0, 100);
}

function buildCurrentPercentiles(summaries, currentSummary) {
  const winRate = metricPercentile(
    currentSummary?.winRate,
    summaries.map((s) => s.winRate),
    true,
  );
  const nonWinScore = metricPercentile(
    currentSummary?.medianNonWinScore,
    summaries
      .filter((s) => Number.isFinite(s.medianNonWinScore))
      .map((s) => s.medianNonWinScore),
    true,
  );
  const winTime = metricPercentile(
    currentSummary?.medianWinTimeMs,
    summaries
      .filter((s) => Number.isFinite(s.medianWinTimeMs))
      .map((s) => s.medianWinTimeMs),
    false,
  );
  return { winRate, nonWinScore, winTime };
}

function parseComparePlayers(value) {
  return sanitizeComparePlayers(value)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name, nameKey: normalizeNameForKey(name) }));
}

function runTimestampMs(run) {
  const t = Date.parse(run?.runAt || run?.updatedAt || '');
  return Number.isFinite(t) ? t : 0;
}

function selectRunsByWindow(sortedRuns, { mode, windowRuns, startRun, endRun, requireFullLast = false } = {}) {
  if (!Array.isArray(sortedRuns) || sortedRuns.length === 0) return [];
  const modeNorm = parseScatterMode(mode);
  if (modeNorm === SCATTER_RANGE_MODES.BETWEEN) {
    if (sortedRuns.length < endRun) return [];
    return sortedRuns.slice(startRun - 1, endRun);
  }
  if (requireFullLast && sortedRuns.length < windowRuns) return [];
  return sortedRuns.slice(-windowRuns);
}

function buildScatterFromRuns(
  runs,
  { kind = SCATTER_TYPES.LOSERS, mode = SCATTER_RANGE_MODES.LAST, windowRuns = 5, startRun = 1, endRun = 5 } = {},
) {
  const scatterKind = parseScatterType(kind);
  const scatterMode = parseScatterMode(mode);
  const scatterWindow = parseScatterWindow(windowRuns, 5);
  const range = normalizeScatterRange(startRun, endRun, 1, Math.max(5, scatterWindow));
  const scatterStart = range.startRun;
  const scatterEnd = range.endRun;
  const betweenLen = Math.max(1, (scatterEnd - scatterStart) + 1);
  const byKey = new Map();
  for (const run of runs) {
    const key = normalizeNameForKey(run?.name || run?.nameKey || '');
    if (!key) continue;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { name: run?.name || key, nameKey: key, runs: [] };
      byKey.set(key, bucket);
    }
    if (run?.name) bucket.name = run.name;
    bucket.runs.push(run);
  }

  const points = [];
  for (const bucket of byKey.values()) {
    const sorted = [...bucket.runs].sort((a, b) => runTimestampMs(a) - runTimestampMs(b));
    const source = scatterKind === SCATTER_TYPES.WINNERS
      ? sorted.filter((r) => Number(r?.score || 0) >= 100)
      : sorted;
    let sample = [];
    if (scatterMode === SCATTER_RANGE_MODES.BETWEEN) {
      if (source.length < scatterEnd) continue;
      sample = source.slice(scatterStart - 1, scatterEnd);
      if (sample.length !== betweenLen) continue;
    } else {
      if (source.length < scatterWindow) continue;
      sample = source.slice(-scatterWindow);
    }
    if (!sample.length) continue;
    const basePoint = {
      name: bucket.name,
      nameKey: bucket.nameKey,
      runCount: source.length,
      sampleRuns: sample.length,
    };
    if (scatterKind === SCATTER_TYPES.WINNERS) {
      const avgGameTimeMs = sample.reduce((sum, r) => sum + Math.max(0, Number(r?.gameTimeMs) || 0), 0) / sample.length;
      const avgFurryMs = sample.reduce((sum, r) => sum + Math.max(0, Number(r?.furryMs) || 0), 0) / sample.length;
      points.push({
        ...basePoint,
        avgGameTimeMs,
        avgFurryMs,
      });
    } else {
      const avgScore = sample.reduce((sum, r) => sum + Math.round(clamp(Number(r?.score) || 0, 0, 100)), 0) / sample.length;
      const avgWinRate = sample.reduce((sum, r) => sum + ((Number(r?.score || 0) >= 100) ? 1 : 0), 0) / sample.length;
      points.push({
        ...basePoint,
        avgScore,
        avgWinRate,
      });
    }
  }

  points.sort((a, b) => {
    if ((b.runCount || 0) !== (a.runCount || 0)) return (b.runCount || 0) - (a.runCount || 0);
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  return {
    kind: scatterKind,
    mode: scatterMode,
    windowRuns: scatterWindow,
    startRun: scatterStart,
    endRun: scatterEnd,
    eligiblePlayers: points.length,
    points,
  };
}

function buildAnalyticsFromRuns(
  runs,
  {
    currentName,
    comparePlayers,
    minRuns,
    limit = 8,
    summaryN = 20,
    summaryMode = SCATTER_RANGE_MODES.LAST,
    summaryStart = 1,
    summaryEnd = 20,
    scatterN = 5,
    scatterKind = SCATTER_TYPES.LOSERS,
    scatterMode = SCATTER_RANGE_MODES.LAST,
    scatterStart = 1,
    scatterEnd = 5,
  },
) {
  const minRunsNum = parseMinRuns(minRuns, 5);
  const limitNum = Math.max(1, Math.min(50, Math.round(Number(limit) || 8)));
  const summaryWindow = parseScatterWindow(summaryN, 20);
  const summaryModeNorm = parseScatterMode(summaryMode);
  const summaryRange = normalizeScatterRange(summaryStart, summaryEnd, 1, Math.max(20, summaryWindow));
  const scatterWindow = parseScatterWindow(scatterN, 5);
  const scatterKindNorm = parseScatterType(scatterKind);
  const scatterModeNorm = parseScatterMode(scatterMode);
  const scatterRange = normalizeScatterRange(scatterStart, scatterEnd, 1, Math.max(5, scatterWindow));
  const byKey = new Map();
  for (const run of runs) {
    const key = normalizeNameForKey(run?.name || run?.nameKey || '');
    if (!key) continue;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { name: run?.name || key, nameKey: key, runs: [] };
      byKey.set(key, bucket);
    }
    if (run?.name) bucket.name = run.name;
    bucket.runs.push(run);
  }

  const summaries = [...byKey.values()].map((bucket) => summarizeRunsForAnalytics(bucket.runs, {
    name: bucket.name,
    nameKey: bucket.nameKey,
  }));
  const summaryMap = new Map(summaries.map((s) => [s.nameKey, s]));

  const currentClean = String(currentName || 'Player').trim().slice(0, 24) || 'Player';
  const currentKey = normalizeNameForKey(currentClean);
  const current = summaryMap.get(currentKey) || summarizeRunsForAnalytics([], { name: currentClean, nameKey: currentKey });
  const everyone = summarizeRunsForAnalytics(runs, { name: 'Everyone', nameKey: 'everyone' });
  const currentPercentiles = buildCurrentPercentiles(summaries, current);
  const everyonePercentiles = buildCurrentPercentiles(summaries, everyone);

  const summaryGroups = new Map();
  const summaryRuns = [];
  for (const bucket of byKey.values()) {
    const sorted = [...bucket.runs].sort((a, b) => runTimestampMs(a) - runTimestampMs(b));
    const sample = selectRunsByWindow(sorted, {
      mode: summaryModeNorm,
      windowRuns: summaryWindow,
      startRun: summaryRange.startRun,
      endRun: summaryRange.endRun,
      requireFullLast: false,
    });
    if (!sample.length) continue;
    summaryGroups.set(bucket.nameKey, { name: bucket.name, nameKey: bucket.nameKey, runs: sample });
    summaryRuns.push(...sample);
  }
  const summarySummaries = [...summaryGroups.values()].map((bucket) => summarizeRunsForAnalytics(bucket.runs, {
    name: bucket.name,
    nameKey: bucket.nameKey,
  }));
  const summaryByKey = new Map(summarySummaries.map((s) => [s.nameKey, s]));
  const summaryCurrent = summaryByKey.get(currentKey) || summarizeRunsForAnalytics([], { name: currentClean, nameKey: currentKey });
  const summaryEveryone = summarizeRunsForAnalytics(summaryRuns, { name: 'Everyone', nameKey: 'everyone' });
  const summaryCurrentPercentiles = buildCurrentPercentiles(summarySummaries, summaryCurrent);
  const summaryEveryonePercentiles = buildCurrentPercentiles(summarySummaries, summaryEveryone);

  const selected = parseComparePlayers(comparePlayers);
  let compared;
  if (selected.length > 0) {
    compared = selected.map((p) => {
      const s = summaryMap.get(p.nameKey) || summarizeRunsForAnalytics([], p);
      return { ...s, meetsMinRuns: s.totalRuns >= minRunsNum };
    });
  } else {
    compared = summaries
      .filter((s) => s.totalRuns >= minRunsNum)
      .sort(comparePlayerAnalytics)
      .slice(0, limitNum)
      .map((s) => ({ ...s, meetsMinRuns: true }));
    if (current.totalRuns > 0 && !compared.some((s) => s.nameKey === current.nameKey)) {
      compared = [{ ...current, meetsMinRuns: current.totalRuns >= minRunsNum }, ...compared].slice(0, limitNum);
    }
  }

  const availablePlayers = summaries
    .slice()
    .sort((a, b) => {
      if ((b.totalRuns || 0) !== (a.totalRuns || 0)) return (b.totalRuns || 0) - (a.totalRuns || 0);
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, 200)
    .map((s) => ({
      name: s.name,
      nameKey: s.nameKey,
      totalRuns: s.totalRuns,
      winRate: s.winRate,
    }));

  const scatter = buildScatterFromRuns(runs, {
    kind: scatterKindNorm,
    mode: scatterModeNorm,
    windowRuns: scatterWindow,
    startRun: scatterRange.startRun,
    endRun: scatterRange.endRun,
  });

  return {
    minRuns: minRunsNum,
    summary: {
      mode: summaryModeNorm,
      windowRuns: summaryWindow,
      startRun: summaryRange.startRun,
      endRun: summaryRange.endRun,
      totalRuns: summaryRuns.length,
      totalPlayers: summarySummaries.length,
      currentPercentiles: summaryCurrentPercentiles,
      everyonePercentiles: summaryEveryonePercentiles,
      current: { ...summaryCurrent, meetsMinRuns: summaryCurrent.totalRuns >= minRunsNum },
      everyone: { ...summaryEveryone, meetsMinRuns: summaryEveryone.totalRuns >= minRunsNum },
    },
    currentPercentiles,
    everyonePercentiles,
    scatterKind: scatter.kind,
    scatterN: scatterWindow,
    scatterMode: scatter.mode,
    scatterStart: scatter.startRun,
    scatterEnd: scatter.endRun,
    totalRuns: runs.length,
    totalPlayers: summaries.length,
    current: { ...current, meetsMinRuns: current.totalRuns >= minRunsNum },
    everyone: { ...everyone, meetsMinRuns: everyone.totalRuns >= minRunsNum },
    compared,
    availablePlayers,
    scatter,
  };
}

function makeDummyRuns(profileName) {
  const me = String(profileName || 'Player').trim().slice(0, 24) || 'Player';
  const names = [me, 'yoyoyo', 'Mara', 'Sable', 'Echo', 'Quinn', 'Rook', 'Tess', 'Nova', 'Kite'];
  const byKey = new Map(names.map((name) => [normalizeNameForKey(name), name]));
  const skillByKey = {
    [normalizeNameForKey('yoyoyo')]: { scoreMean: 87, scoreSpread: 8, winRate: 0.44, learnRate: 2.3, timeBias: -26000, furryBias: -4200 },
    [normalizeNameForKey('Nova')]: { scoreMean: 82, scoreSpread: 9, winRate: 0.36, learnRate: 2.0, timeBias: -20000, furryBias: -3200 },
    [normalizeNameForKey('Mara')]: { scoreMean: 76, scoreSpread: 10, winRate: 0.27, learnRate: 1.8, timeBias: -13000, furryBias: -1800 },
    [normalizeNameForKey('Tess')]: { scoreMean: 74, scoreSpread: 10, winRate: 0.24, learnRate: 1.6, timeBias: -11000, furryBias: -1300 },
    [normalizeNameForKey(me)]: { scoreMean: 73, scoreSpread: 11, winRate: 0.23, learnRate: 1.9, timeBias: -9000, furryBias: -1100 },
    [normalizeNameForKey('Quinn')]: { scoreMean: 67, scoreSpread: 12, winRate: 0.16, learnRate: 1.3, timeBias: -4000, furryBias: 300 },
    [normalizeNameForKey('Sable')]: { scoreMean: 64, scoreSpread: 12, winRate: 0.13, learnRate: 1.2, timeBias: -2000, furryBias: 900 },
    [normalizeNameForKey('Rook')]: { scoreMean: 59, scoreSpread: 13, winRate: 0.09, learnRate: 0.8, timeBias: 5000, furryBias: 1700 },
    [normalizeNameForKey('Kite')]: { scoreMean: 56, scoreSpread: 14, winRate: 0.07, learnRate: 0.7, timeBias: 7000, furryBias: 2200 },
    [normalizeNameForKey('Echo')]: { scoreMean: 52, scoreSpread: 14, winRate: 0.05, learnRate: 0.6, timeBias: 9000, furryBias: 2600 },
  };
  const defaultSkill = { scoreMean: 64, scoreSpread: 12, winRate: 0.12, learnRate: 1.0, timeBias: 0, furryBias: 0 };
  const participantPool = [
    me, me,
    'yoyoyo', 'yoyoyo', 'yoyoyo',
    'Nova', 'Nova',
    'Mara', 'Mara',
    'Tess', 'Tess',
    'Quinn',
    'Sable',
    'Rook',
    'Kite',
    'Echo',
  ];
  const rules = IT_TRANSFER_OPTIONS.map((o) => o.value);
  const now = Date.now();
  const seeded01 = (i, salt) => {
    const v = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const nameSalt = (nameKey) => {
    let h = 0;
    for (let i = 0; i < nameKey.length; i++) h = (h + nameKey.charCodeAt(i) * (i + 1)) % 9973;
    return h;
  };
  const totalRuns = 1240; // original 240 + 1000 additional runs
  const playerRunCounts = new Map();
  const runs = [];
  for (let i = 0; i < totalRuns; i++) {
    const rule = rules[i % rules.length];
    const name = participantPool[Math.floor(seeded01(i, 1) * participantPool.length) % participantPool.length];
    const key = normalizeNameForKey(name);
    const canonicalName = byKey.get(key) || name;
    const skill = skillByKey[key] || defaultSkill;
    const salt = nameSalt(key);
    const playerRunNum = (playerRunCounts.get(key) || 0) + 1;
    playerRunCounts.set(key, playerRunNum);

    const progressBonus = Math.log2(playerRunNum + 1) * skill.learnRate;
    const ruleScoreOffset = rule === IT_TRANSFER_RULES.THROW_ONLY ? -3 : (rule === IT_TRANSFER_RULES.TAG_ONLY ? 2 : 0);
    const ruleWinOffset = rule === IT_TRANSFER_RULES.THROW_ONLY ? -0.02 : (rule === IT_TRANSFER_RULES.TAG_ONLY ? 0.03 : 0);
    const noise = (seeded01(i, 2 + salt * 0.017) - 0.5) * skill.scoreSpread * 2;
    const formSwing = Math.sin((i + salt) * 0.031) * 3.2;
    const baseScore = skill.scoreMean + progressBonus + ruleScoreOffset + noise + formSwing;
    const winChance = clamp(skill.winRate + ruleWinOffset + Math.min(progressBonus * 0.004, 0.08), 0.01, 0.92);
    const didWin = seeded01(i, 3 + salt * 0.019) < winChance;
    const score = didWin
      ? 100
      : Math.round(clamp(baseScore, 0, 99));

    let gameTimeMs = 212000
      - score * 1120
      + skill.timeBias
      - progressBonus * 860
      + (seeded01(i, 4 + salt * 0.023) - 0.5) * 82000;
    if (didWin) gameTimeMs -= 18000 + seeded01(i, 5 + salt * 0.011) * 14000;
    gameTimeMs = Math.round(clamp(gameTimeMs, 9000, 340000));

    let furryMs = 26500
      - score * 130
      + skill.furryBias
      - progressBonus * 120
      + (seeded01(i, 6 + salt * 0.013) - 0.5) * 13000;
    if (didWin) furryMs -= 2400;
    furryMs = Math.round(clamp(furryMs, 300, 85000));

    const runAt = new Date(now - i * 1.2 * 60 * 60 * 1000).toISOString();
    runs.push({
      id: `dummy-${i}`,
      name: canonicalName,
      nameKey: key,
      score,
      gameTimeMs,
      furryMs,
      rule,
      runAt,
      updatedAt: runAt,
    });
  }
  return runs;
}

function listTopRunsFromRuns(runs, limit = 10) {
  return [...runs].sort(compareScoreRows).slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
}

function getStoredProfile() {
  const name = (localStorage.getItem(STORAGE_KEYS.profileName) || 'Player').trim().slice(0, 24) || 'Player';
  const password = localStorage.getItem(STORAGE_KEYS.profilePassword) || '';
  return { name, password };
}

function hasSavedProfileName() {
  const saved = localStorage.getItem(STORAGE_KEYS.profileName);
  return !!(saved && String(saved).trim());
}

function syncProfileInputs() {
  if (profileNameEl && profileNameEl.value !== (state.profile.name || '')) profileNameEl.value = state.profile.name || '';
  if (profilePasswordEl && profilePasswordEl.value !== (state.profile.password || '')) profilePasswordEl.value = state.profile.password || '';
}

function normalizeProfileInput(nameInput, passwordInput) {
  const name = String(nameInput || state.profile.name || 'Player')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24) || 'Player';
  const password = String(passwordInput || '').slice(0, 128);
  return { name, password };
}

function storeProfile(nameInput, passwordInput) {
  const { name, password } = normalizeProfileInput(nameInput, passwordInput);
  state.profile.name = name;
  state.profile.password = password;
  localStorage.setItem(STORAGE_KEYS.profileName, name);
  if (password) localStorage.setItem(STORAGE_KEYS.profilePassword, password);
  else localStorage.removeItem(STORAGE_KEYS.profilePassword);
  const me = state.players.find((p) => p.human);
  if (me) me.name = name;
  return { name, password };
}

function captureProfileFromInputs() {
  const nameSource = profileNameEl ? profileNameEl.value : state.profile.name;
  const passwordSource = profilePasswordEl ? profilePasswordEl.value : state.profile.password;
  return normalizeProfileInput(nameSource, passwordSource);
}

function profileActionLabel() {
  return hasSavedProfileName() ? 'Switch profile' : 'Set profile';
}

function runProfileLabel() {
  return `Profile: ${currentProfileName()}`;
}

function setProfileEditorOpen(open) {
  if (!profileInlineEditorEl) return;
  const nextOpen = !!open;
  profileInlineEditorEl.classList.toggle('isHidden', !nextOpen);
  if (nextOpen) syncProfileInputs();
  if (switchProfileBtn) switchProfileBtn.textContent = profileActionLabel();
  if (runProfileNameEl) runProfileNameEl.textContent = runProfileLabel();
}

function currentProfileName() {
  return (state.profile.name || 'Player').trim().slice(0, 24) || 'Player';
}

function currentHumanPlayer() {
  return state.players.find((p) => p.human) || null;
}

function currentRunScorePayload() {
  const me = currentHumanPlayer();
  if (!me || !state.over) return null;
  return {
    name: currentProfileName(),
    password: state.profile.password || '',
    score: Math.round(me.score || 0),
    gameTimeMs: Math.round(state.gameTimeMs || 0),
    furryMs: Math.round(me.furryMs || 0),
    rule: state.itTransferRule,
  };
}

function currentRunSig() {
  const payload = currentRunScorePayload();
  if (!payload) return null;
  return `${payload.name}|${payload.score}|${payload.gameTimeMs}|${payload.furryMs}|${payload.rule}`;
}

function setProfileStatus(msg, type = 'info') {
  state.profileStatus = msg || '';
  state.profileStatusType = type;
  if (profileInlineStatusEl) {
    profileInlineStatusEl.textContent = state.profileStatus;
    profileInlineStatusEl.classList.toggle('isError', type === 'error' && !!state.profileStatus);
    profileInlineStatusEl.classList.toggle('isSuccess', type === 'success' && !!state.profileStatus);
  }
  if (msg) setHighScoreStatus(msg);
}

function setHighScoreStatus(msg) {
  state.highScoreStatus = msg || '';
  if (highScoreStatusEl) highScoreStatusEl.textContent = state.highScoreStatus;
}

function activeRuleLabel() {
  const hit = IT_TRANSFER_OPTIONS.find((opt) => opt.value === state.itTransferRule);
  return hit?.label || state.itTransferRule || IT_TRANSFER_RULES.HYBRID;
}

function activeScoreSourceLabel() {
  return state.scoreDataSource === SCORE_DATA_SOURCES.DUMMY ? 'dummy' : 'live';
}

function updateHighScoreTitle() {
  if (!highScoreTitleEl) return;
  highScoreTitleEl.textContent = `High Scores (${activeRuleLabel()} · ${activeScoreSourceLabel()})`;
  if (scoreDataSourceEl && scoreDataSourceEl.value !== state.scoreDataSource) {
    scoreDataSourceEl.value = state.scoreDataSource;
  }
}

function formatRunDate(isoLike) {
  const d = new Date(isoLike || '');
  if (!Number.isFinite(d.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

function renderHighScores() {
  if (!highScoreRowsEl) return;
  const sig = state.highScores.map((row, i) => `${i}:${row.name}:${row.score}:${row.gameTimeMs}:${row.furryMs}:${row.runAt || row.updatedAt || ''}`).join('|');
  if (sig === highScoreSig) return;
  highScoreSig = sig;
  highScoreRowsEl.innerHTML = state.highScores.map((row, i) => {
    const gameSec = ((row.gameTimeMs || 0) / 1000).toFixed(1);
    const furrySec = ((row.furryMs || 0) / 1000).toFixed(1);
    const runDate = formatRunDate(row.runAt || row.updatedAt);
    return `<div class="row">
      <div><b>${i + 1}. ${escapeHtml(row.name || 'Player')}</b></div>
      <div>${Number(row.score || 0).toFixed(0)} pts · ${gameSec}s total · ${furrySec}s IT · ${escapeHtml(runDate)}</div>
    </div>`;
  }).join('') || '<div class="row"><div>No scores yet.</div><div>Play a run.</div></div>';
}

function pdfValueAt(pdfValues, x) {
  const idx = Math.round(clamp(Number(x) || 0, 0, 100));
  if (!Array.isArray(pdfValues) || pdfValues.length < 101) return 0;
  return clamp(Number(pdfValues[idx]) || 0, 0, 1);
}

function normalizedPdfSeries(stats) {
  const xs = Array.isArray(stats?.pdf?.x) && stats.pdf.x.length === 101
    ? stats.pdf.x
    : Array.from({ length: 101 }, (_, i) => i);
  const pdfAll = Array.isArray(stats?.pdf?.all) && stats.pdf.all.length === 101
    ? stats.pdf.all
    : Array.from({ length: 101 }, () => 0);
  const pdfPlayer = Array.isArray(stats?.pdf?.player) && stats.pdf.player.length === 101
    ? stats.pdf.player
    : Array.from({ length: 101 }, () => 0);
  return { xs, pdfAll, pdfPlayer };
}

function buildPdfSvg({ stats, width, height, hoverScore = null, dark = true }) {
  const { xs, pdfAll, pdfPlayer } = normalizedPdfSeries(stats);
  const padL = SCORE_DIST_CHART.padL;
  const padR = SCORE_DIST_CHART.padR;
  const padT = SCORE_DIST_CHART.padT;
  const padB = SCORE_DIST_CHART.padB;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const px = (score) => padL + (clamp(score, 0, 100) / 100) * plotW;
  const peak = Math.max(
    0.01,
    ...pdfAll.map((v) => Number(v) || 0),
    ...pdfPlayer.map((v) => Number(v) || 0),
  );
  const yMax = peak * 1.15;
  const py = (pdfValue) => padT + (1 - clamp((Number(pdfValue) || 0) / yMax, 0, 1)) * plotH;
  const polyAll = xs.map((x, idx) => `${px(x).toFixed(1)},${py(pdfAll[idx]).toFixed(1)}`).join(' ');
  const polyPlayer = xs.map((x, idx) => `${px(x).toFixed(1)},${py(pdfPlayer[idx]).toFixed(1)}`).join(' ');
  const hoverX = hoverScore == null ? null : px(hoverScore);
  const axisColor = dark ? 'rgba(255,255,255,.35)' : 'rgba(15,23,42,.5)';
  const gridColor = dark ? 'rgba(255,255,255,.10)' : 'rgba(15,23,42,.12)';
  const labelColor = dark ? 'rgba(255,255,255,.72)' : 'rgba(15,23,42,.72)';
  const bgColor = dark ? 'rgba(255,255,255,.02)' : 'rgba(2,6,23,.03)';
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Score PDF chart">
      <rect x="0" y="0" width="${width}" height="${height}" fill="${bgColor}" />
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" stroke="${axisColor}" stroke-width="1" />
      <line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" stroke="${axisColor}" stroke-width="1" />
      ${[0, 25, 50, 75, 100].map((tick) => {
        const tx = px(tick).toFixed(1);
        return `<line x1="${tx}" y1="${padT}" x2="${tx}" y2="${height - padB}" stroke="${gridColor}" stroke-width="1" />`;
      }).join('')}
      ${yTicks.map((tick) => {
        const ty = py(yMax * tick).toFixed(1);
        return `<line x1="${padL}" y1="${ty}" x2="${width - padR}" y2="${ty}" stroke="${gridColor}" stroke-width="1" />`;
      }).join('')}
      <polyline fill="none" stroke="rgba(96,165,250,.95)" stroke-width="2" points="${polyAll}" />
      <polyline fill="none" stroke="rgba(34,197,94,.95)" stroke-width="2.2" points="${polyPlayer}" />
      ${hoverX == null ? '' : `<line x1="${hoverX.toFixed(1)}" y1="${padT}" x2="${hoverX.toFixed(1)}" y2="${height - padB}" stroke="${labelColor}" stroke-width="1" stroke-dasharray="3 3" />`}
      <text x="${padL}" y="9" fill="${labelColor}" font-size="9">PDF</text>
      <text x="${padL + 2}" y="${padT + 11}" fill="${labelColor}" font-size="8">peak ${(peak * 100).toFixed(2)}%</text>
      <text x="${width - padR}" y="${height - 4}" fill="${labelColor}" font-size="9" text-anchor="end">points (0-100)</text>
    </svg>
  `;
}

function renderScorePdf() {
  if (!cdfChartEl || !cdfHintEl) return;
  const stats = state.scoreStats || emptyScoreStats();
  const hoverScore = state.scoreHoverPoint == null ? null : Math.round(clamp(state.scoreHoverPoint, 0, 100));
  const { pdfAll, pdfPlayer } = normalizedPdfSeries(stats);
  cdfChartEl.innerHTML = buildPdfSvg({
    stats,
    width: SCORE_DIST_CHART.width,
    height: SCORE_DIST_CHART.height,
    hoverScore,
    dark: true,
  });

  if (!Number.isFinite(hoverScore)) {
    cdfHintEl.textContent = `${stats.playerRuns || 0} of your runs vs ${stats.totalRuns || 0} total runs · probability density by points`;
    return;
  }

  const allPct = (pdfValueAt(pdfAll, hoverScore) * 100).toFixed(2);
  const mePct = (pdfValueAt(pdfPlayer, hoverScore) * 100).toFixed(2);
  cdfHintEl.textContent = `at ${hoverScore} pts: you ${mePct}% · everyone ${allPct}%`;
}

function formatPct(value) {
  if (!Number.isFinite(value)) return '--';
  return `${(value * 100).toFixed(1)}%`;
}

function formatMsSeconds(value) {
  if (!Number.isFinite(value)) return '--';
  return `${(value / 1000).toFixed(1)}s`;
}

function formatScoreValue(value) {
  if (!Number.isFinite(value)) return '--';
  return Number(value).toFixed(1);
}

function formatPercentile(value) {
  if (!Number.isFinite(value)) return '--';
  return `p${Math.round(value)}`;
}

function renderScatterPlot() {
  if (!scatterPlotEl || !scatterHintEl) return;
  const analytics = state.analytics || emptyAnalytics();
  const fallbackScatterType = parseScatterType(state.scatterKind);
  const fallbackScatterMode = parseScatterMode(state.scatterMode);
  const fallbackScatterWindow = parseScatterWindow(state.scatterWindow, 5);
  const fallbackScatterRange = normalizeScatterRange(state.scatterStart, state.scatterEnd, 1, Math.max(5, fallbackScatterWindow));
  const scatter = analytics.scatter && typeof analytics.scatter === 'object'
    ? analytics.scatter
    : {
      kind: fallbackScatterType,
      mode: fallbackScatterMode,
      windowRuns: fallbackScatterWindow,
      startRun: fallbackScatterRange.startRun,
      endRun: fallbackScatterRange.endRun,
      eligiblePlayers: 0,
      points: [],
    };
  const scatterType = parseScatterType(scatter.kind || analytics.scatterKind || fallbackScatterType);
  const scatterMode = parseScatterMode(scatter.mode || analytics.scatterMode || fallbackScatterMode);
  const scatterWindow = parseScatterWindow(scatter.windowRuns, fallbackScatterWindow);
  const scatterRange = normalizeScatterRange(
    scatter.startRun ?? analytics.scatterStart,
    scatter.endRun ?? analytics.scatterEnd,
    fallbackScatterRange.startRun,
    fallbackScatterRange.endRun,
  );
  const sampleUnit = scatterType === SCATTER_TYPES.WINNERS ? 'wins' : 'runs';
  const scatterLabel = scatterMode === SCATTER_RANGE_MODES.BETWEEN
    ? `${sampleUnit} ${scatterRange.startRun}-${scatterRange.endRun}`
    : `last ${scatterWindow} ${sampleUnit}`;
  const points = Array.isArray(scatter.points) ? scatter.points : [];

  const w = SCATTER_CHART.width;
  const h = SCATTER_CHART.height;
  const padL = SCATTER_CHART.padL;
  const padR = SCATTER_CHART.padR;
  const padT = SCATTER_CHART.padT;
  const padB = SCATTER_CHART.padB;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const maxXMs = Math.max(1, ...points.map((p) => Math.max(0, Number(p?.avgGameTimeMs) || 0)));
  const maxYMs = Math.max(1, ...points.map((p) => Math.max(0, Number(p?.avgFurryMs) || 0)));
  const px = (value) => {
    if (scatterType === SCATTER_TYPES.WINNERS) {
      const ratio = clamp((Number(value) || 0) / maxXMs, 0, 1);
      return padL + (1 - ratio) * plotW;
    }
    return padL + (clamp(Number(value) || 0, 0, 100) / 100) * plotW;
  };
  const py = (value) => {
    if (scatterType === SCATTER_TYPES.WINNERS) {
      const ratio = clamp((Number(value) || 0) / maxYMs, 0, 1);
      return padT + (1 - ratio) * plotH;
    }
    return padT + (1 - clamp(Number(value) || 0, 0, 1)) * plotH;
  };

  const base = points.map((p) => ({
    ...p,
    bx: scatterType === SCATTER_TYPES.WINNERS ? px(p.avgGameTimeMs) : px(p.avgScore),
    by: scatterType === SCATTER_TYPES.WINNERS ? py(p.avgFurryMs) : py(p.avgWinRate),
  }));

  const grouped = new Map();
  for (const p of base) {
    const key = `${Math.round(p.bx)}|${Math.round(p.by)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(p);
  }

  const laidOut = [];
  for (const group of grouped.values()) {
    group.sort((a, b) => String(a.nameKey || '').localeCompare(String(b.nameKey || '')));
    const n = group.length;
    for (let i = 0; i < n; i++) {
      const p = group[i];
      let ox = 0;
      let oy = 0;
      if (n > 1) {
        const perRing = 8;
        const ring = Math.floor(i / perRing);
        const pos = i % perRing;
        const radius = 4 + ring * 4;
        const angle = (TAU * pos) / Math.min(perRing, n);
        ox = Math.cos(angle) * radius;
        oy = Math.sin(angle) * radius;
      }
      laidOut.push({
        ...p,
        x: clamp(p.bx + ox, padL + 2, w - padR - 2),
        y: clamp(p.by + oy, padT + 2, h - padB - 2),
        r: clamp(3 + Math.log2((p.runCount || 0) + 1), 3, 7),
      });
    }
  }

  state.scatterRenderedPoints = laidOut.map((p) => ({
    nameKey: p.nameKey,
    name: p.name,
    x: p.x,
    y: p.y,
    r: p.r,
    avgScore: p.avgScore,
    avgWinRate: p.avgWinRate,
    avgGameTimeMs: p.avgGameTimeMs,
    avgFurryMs: p.avgFurryMs,
    runCount: p.runCount,
    sampleRuns: p.sampleRuns,
  }));

  const currentKey = normalizeNameForKey(currentProfileName());
  const hoverKey = state.scatterHoverNameKey;
  const circlesDrawOrder = [
    ...laidOut.filter((p) => p.nameKey !== currentKey),
    ...laidOut.filter((p) => p.nameKey === currentKey),
  ];
  const yAxisLabel = scatterType === SCATTER_TYPES.WINNERS
    ? 'Y: selected-window avg IT time (desc)'
    : 'Y: selected-window avg win rate';
  const xAxisLabel = scatterType === SCATTER_TYPES.WINNERS
    ? 'X: selected-window avg game time (desc)'
    : 'X: selected-window avg score';

  scatterPlotEl.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Scatter plot of selected run window">
      <rect x="0" y="0" width="${w}" height="${h}" fill="rgba(255,255,255,.02)" />
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${h - padB}" stroke="rgba(255,255,255,.35)" stroke-width="1" />
      <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}" stroke="rgba(255,255,255,.35)" stroke-width="1" />
      ${[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const tx = (padL + tick * plotW).toFixed(1);
        return `<line x1="${tx}" y1="${padT}" x2="${tx}" y2="${h - padB}" stroke="rgba(255,255,255,.09)" stroke-width="1" />`;
      }).join('')}
      ${[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const ty = (padT + (1 - tick) * plotH).toFixed(1);
        return `<line x1="${padL}" y1="${ty}" x2="${w - padR}" y2="${ty}" stroke="rgba(255,255,255,.09)" stroke-width="1" />`;
      }).join('')}
      ${circlesDrawOrder.map((p) => {
        const isCurrent = p.nameKey === currentKey;
        const isHover = hoverKey && p.nameKey === hoverKey;
        const fill = isCurrent ? 'rgba(34,197,94,.95)' : 'rgba(96,165,250,.9)';
        const stroke = isHover ? 'rgba(255,255,255,.95)' : 'rgba(0,0,0,.35)';
        const sw = isHover ? 2 : 1.2;
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" />`;
      }).join('')}
      <text x="${padL}" y="9" fill="rgba(255,255,255,.72)" font-size="9">${escapeHtml(yAxisLabel)}</text>
      <text x="${w - padR}" y="${h - 4}" fill="rgba(255,255,255,.72)" font-size="9" text-anchor="end">${escapeHtml(xAxisLabel)}</text>
    </svg>
  `;

  const hovered = state.scatterRenderedPoints.find((p) => p.nameKey === hoverKey) || null;
  if (hovered) {
    if (scatterType === SCATTER_TYPES.WINNERS) {
      scatterHintEl.textContent = `${hovered.name}: avg game ${formatMsSeconds(hovered.avgGameTimeMs)} · avg IT ${formatMsSeconds(hovered.avgFurryMs)} · ${hovered.sampleRuns}/${hovered.runCount} wins · ${scatterLabel}`;
      return;
    }
    scatterHintEl.textContent = `${hovered.name}: avg score ${hovered.avgScore.toFixed(1)} · avg win rate ${(hovered.avgWinRate * 100).toFixed(1)}% · ${hovered.sampleRuns}/${hovered.runCount} runs · ${scatterLabel}`;
    return;
  }

  const scatterTypeLabel = scatterType === SCATTER_TYPES.WINNERS ? 'Winners' : 'Losers';
  scatterHintEl.textContent = `${Number(scatter.eligiblePlayers || 0)} players shown · ${scatterTypeLabel} · ${scatterLabel} · overlap handled with radial spread for shared positions`;
}

function syncAnalyticsControls() {
  const scatterKind = parseScatterType(state.scatterKind);
  const isWinners = scatterKind === SCATTER_TYPES.WINNERS;
  const summaryMode = parseScatterMode(state.summaryMode);
  if (comparePlayersEl && comparePlayersEl.value !== state.comparePlayers) {
    comparePlayersEl.value = state.comparePlayers;
  }
  if (minRunsEl) {
    const expected = String(state.analyticsMinRuns);
    if (minRunsEl.value !== expected) minRunsEl.value = expected;
  }
  if (summaryModeEl) {
    const expected = summaryMode;
    if (summaryModeEl.value !== expected) summaryModeEl.value = expected;
  }
  if (summaryWindowEl) {
    const expected = String(state.summaryWindow);
    if (summaryWindowEl.value !== expected) summaryWindowEl.value = expected;
  }
  if (summaryRunStartEl) {
    const expected = String(state.summaryStart);
    if (summaryRunStartEl.value !== expected) summaryRunStartEl.value = expected;
  }
  if (summaryRunEndEl) {
    const expected = String(state.summaryEnd);
    if (summaryRunEndEl.value !== expected) summaryRunEndEl.value = expected;
  }
  if (summaryWindowLabelEl) summaryWindowLabelEl.textContent = 'Run count';
  if (summaryRunStartLabelEl) summaryRunStartLabelEl.textContent = 'Run';
  if (summaryRunEndLabelEl) summaryRunEndLabelEl.textContent = 'Run';
  if (scatterWindowEl) {
    const expected = String(state.scatterWindow);
    if (scatterWindowEl.value !== expected) scatterWindowEl.value = expected;
  }
  if (scatterTypeEl) {
    const expected = scatterKind;
    if (scatterTypeEl.value !== expected) scatterTypeEl.value = expected;
  }
  if (scatterModeEl?.options?.length >= 2) {
    const expectedLast = isWinners ? 'Last N wins' : 'Last N runs';
    const expectedBetween = isWinners ? 'Between win N and M' : 'Between run N and M';
    if (scatterModeEl.options[0].text !== expectedLast) scatterModeEl.options[0].text = expectedLast;
    if (scatterModeEl.options[1].text !== expectedBetween) scatterModeEl.options[1].text = expectedBetween;
  }
  if (scatterRunStartLabelEl) scatterRunStartLabelEl.textContent = isWinners ? 'Win' : 'Run';
  if (scatterRunEndLabelEl) scatterRunEndLabelEl.textContent = isWinners ? 'Win' : 'Run';
  if (scatterWindowLabelEl) scatterWindowLabelEl.textContent = isWinners ? 'Win count' : 'Run count';
  if (scatterModeEl) {
    const expected = parseScatterMode(state.scatterMode);
    if (scatterModeEl.value !== expected) scatterModeEl.value = expected;
  }
  if (scatterRunStartEl) {
    const expected = String(state.scatterStart);
    if (scatterRunStartEl.value !== expected) scatterRunStartEl.value = expected;
  }
  if (scatterRunEndEl) {
    const expected = String(state.scatterEnd);
    if (scatterRunEndEl.value !== expected) scatterRunEndEl.value = expected;
  }
  const betweenMode = parseScatterMode(state.scatterMode) === SCATTER_RANGE_MODES.BETWEEN;
  const summaryBetweenMode = summaryMode === SCATTER_RANGE_MODES.BETWEEN;
  if (summaryWindowEl) summaryWindowEl.disabled = summaryBetweenMode;
  if (summaryRunStartEl) summaryRunStartEl.disabled = !summaryBetweenMode;
  if (summaryRunEndEl) summaryRunEndEl.disabled = !summaryBetweenMode;
  if (summaryRangeLastEl) summaryRangeLastEl.classList.toggle('isHidden', summaryBetweenMode);
  if (summaryRangeBetweenEl) summaryRangeBetweenEl.classList.toggle('isHidden', !summaryBetweenMode);
  if (scatterWindowEl) scatterWindowEl.disabled = betweenMode;
  if (scatterRunStartEl) scatterRunStartEl.disabled = !betweenMode;
  if (scatterRunEndEl) scatterRunEndEl.disabled = !betweenMode;
  if (scatterRangeLastEl) scatterRangeLastEl.classList.toggle('isHidden', betweenMode);
  if (scatterRangeBetweenEl) scatterRangeBetweenEl.classList.toggle('isHidden', !betweenMode);
}

function renderAnalytics() {
  const analytics = state.analytics || emptyAnalytics();
  const summary = analytics.summary && typeof analytics.summary === 'object' ? analytics.summary : null;
  syncAnalyticsControls();

  if (analyticsCardsEl) {
    const current = summary?.current || analytics.current || {};
    const everyone = summary?.everyone || analytics.everyone || {};
    const p = summary?.currentPercentiles || analytics.currentPercentiles || {};
    const qualifiedPlayers = Math.max(0, Number(summary?.totalPlayers || 0));
    const qualifiedText = `${qualifiedPlayers} qualifying players`;
    analyticsCardsEl.innerHTML = [
      {
        label: '1) Win Rate',
        current: formatPct(current.winRate),
        currentMeta: `${Number(current.winCount || 0)}/${Number(current.totalRuns || 0)} wins · ${formatPercentile(p.winRate)} percentile`,
        everyone: formatPct(everyone.winRate),
        everyoneMeta: `${Number(everyone.winCount || 0)}/${Number(everyone.totalRuns || 0)} wins · ${qualifiedText}`,
      },
      {
        label: '2) Non-Win Score',
        current: `${formatScoreValue(current.medianNonWinScore)} median`,
        currentMeta: `${Number(current.nonWinCount || 0)} non-wins · ${formatPercentile(p.nonWinScore)} percentile`,
        everyone: `${formatScoreValue(everyone.medianNonWinScore)} median`,
        everyoneMeta: qualifiedText,
      },
      {
        label: '3) Win Time',
        current: `${formatMsSeconds(current.medianWinTimeMs)} median`,
        currentMeta: `${Number(current.winCount || 0)} wins · ${formatPercentile(p.winTime)} percentile`,
        everyone: `${formatMsSeconds(everyone.medianWinTimeMs)} median`,
        everyoneMeta: qualifiedText,
      },
    ].map((card) => `<div class="analyticsMetric">
      <div class="analyticsMetricTitle">${escapeHtml(card.label)}</div>
      <div class="analyticsMetricRow"><span>You</span><b>${escapeHtml(card.current)}</b></div>
      <div class="analyticsMetricSub">${escapeHtml(card.currentMeta)}</div>
      <div class="analyticsMetricRow"><span>Everyone</span><b>${escapeHtml(card.everyone)}</b></div>
      <div class="analyticsMetricSub">${escapeHtml(card.everyoneMeta)}</div>
    </div>`).join('');
  }

  if (analyticsRowsEl) {
    const rows = Array.isArray(analytics.compared) ? analytics.compared : [];
    analyticsRowsEl.innerHTML = rows.map((row, i) => {
      const lowN = row.meetsMinRuns ? '' : ' <span class="lowN">low n</span>';
      return `<div class="row analyticsRow">
        <div><b>${i + 1}. ${escapeHtml(row.name || 'Player')}</b>${lowN}</div>
        <div>${Number(row.totalRuns || 0)} runs · ${formatPct(row.winRate)} win · ${formatMsSeconds(row.medianWinTimeMs)} win time · ${formatScoreValue(row.medianNonWinScore)} non-win</div>
      </div>`;
    }).join('') || '<div class="row analyticsRow"><div>No players match this filter.</div><div>Try lowering min runs.</div></div>';
  }

  if (analyticsStatusEl) {
    const summaryMode = parseScatterMode(summary?.mode || state.summaryMode);
    const summaryWindow = parseScatterWindow(summary?.windowRuns, state.summaryWindow || 20);
    const summaryRange = normalizeScatterRange(
      summary?.startRun ?? state.summaryStart,
      summary?.endRun ?? state.summaryEnd,
      state.summaryStart || 1,
      state.summaryEnd || Math.max(20, summaryWindow),
    );
    const summaryLabel = summaryMode === SCATTER_RANGE_MODES.BETWEEN
      ? `summary runs ${summaryRange.startRun}-${summaryRange.endRun}`
      : `summary last ${summaryWindow} runs`;
    analyticsStatusEl.textContent = `Compared ${Number(analytics.compared?.length || 0)} players · min runs ${Number(analytics.minRuns || state.analyticsMinRuns || 5)} · ${Number(analytics.totalRuns || 0)} runs total · ${summaryLabel}`;
  }
}

function applyAnalyticsFilters({ includePlayerComparison = true } = {}) {
  const nextPlayers = includePlayerComparison
    ? sanitizeComparePlayers(comparePlayersEl?.value || state.comparePlayers)
    : sanitizeComparePlayers(state.comparePlayers);
  const nextMinRuns = includePlayerComparison
    ? parseMinRuns(minRunsEl?.value, state.analyticsMinRuns || 5)
    : parseMinRuns(state.analyticsMinRuns, 5);
  const nextSummaryMode = parseScatterMode(summaryModeEl?.value || state.summaryMode);
  const nextSummaryWindow = parseScatterWindow(summaryWindowEl?.value, state.summaryWindow || 20);
  const nextSummaryRange = normalizeScatterRange(
    summaryRunStartEl?.value ?? state.summaryStart,
    summaryRunEndEl?.value ?? state.summaryEnd,
    state.summaryStart || 1,
    state.summaryEnd || Math.max(20, nextSummaryWindow),
  );
  const nextScatterKind = parseScatterType(scatterTypeEl?.value || state.scatterKind);
  const nextScatterMode = parseScatterMode(scatterModeEl?.value || state.scatterMode);
  const nextScatterWindow = parseScatterWindow(scatterWindowEl?.value, state.scatterWindow || 5);
  const nextScatterRange = normalizeScatterRange(
    scatterRunStartEl?.value ?? state.scatterStart,
    scatterRunEndEl?.value ?? state.scatterEnd,
    state.scatterStart || 1,
    state.scatterEnd || Math.max(5, nextScatterWindow),
  );
  state.comparePlayers = nextPlayers;
  state.analyticsMinRuns = nextMinRuns;
  state.summaryMode = nextSummaryMode;
  state.summaryWindow = nextSummaryWindow;
  state.summaryStart = nextSummaryRange.startRun;
  state.summaryEnd = nextSummaryRange.endRun;
  state.scatterKind = nextScatterKind;
  state.scatterMode = nextScatterMode;
  state.scatterWindow = nextScatterWindow;
  state.scatterStart = nextScatterRange.startRun;
  state.scatterEnd = nextScatterRange.endRun;
  state.scatterHoverNameKey = null;
  if (includePlayerComparison) {
    localStorage.setItem(STORAGE_KEYS.comparePlayers, nextPlayers);
    localStorage.setItem(STORAGE_KEYS.analyticsMinRuns, String(nextMinRuns));
  }
  localStorage.setItem(STORAGE_KEYS.summaryMode, nextSummaryMode);
  localStorage.setItem(STORAGE_KEYS.summaryWindow, String(nextSummaryWindow));
  localStorage.setItem(STORAGE_KEYS.summaryStartRun, String(nextSummaryRange.startRun));
  localStorage.setItem(STORAGE_KEYS.summaryEndRun, String(nextSummaryRange.endRun));
  localStorage.setItem(STORAGE_KEYS.scatterType, nextScatterKind);
  localStorage.setItem(STORAGE_KEYS.scatterMode, nextScatterMode);
  localStorage.setItem(STORAGE_KEYS.scatterWindow, String(nextScatterWindow));
  localStorage.setItem(STORAGE_KEYS.scatterStartRun, String(nextScatterRange.startRun));
  localStorage.setItem(STORAGE_KEYS.scatterEndRun, String(nextScatterRange.endRun));
  syncAnalyticsControls();
  refreshHighScores();
}

let nonComparisonAutoApplyTimer = 0;
function applyNonComparisonFiltersNow() {
  if (nonComparisonAutoApplyTimer) {
    clearTimeout(nonComparisonAutoApplyTimer);
    nonComparisonAutoApplyTimer = 0;
  }
  applyAnalyticsFilters({ includePlayerComparison: false });
}

function scheduleNonComparisonAutoApply(delayMs = 180) {
  if (nonComparisonAutoApplyTimer) clearTimeout(nonComparisonAutoApplyTimer);
  nonComparisonAutoApplyTimer = setTimeout(() => {
    nonComparisonAutoApplyTimer = 0;
    applyAnalyticsFilters({ includePlayerComparison: false });
  }, delayMs);
}

async function refreshHighScores() {
  const rule = state.itTransferRule || IT_TRANSFER_RULES.HYBRID;
  const myName = currentProfileName();
  const minRuns = parseMinRuns(state.analyticsMinRuns, 5);
  const summaryMode = parseScatterMode(state.summaryMode);
  const summaryWindow = parseScatterWindow(state.summaryWindow, 20);
  const summaryRange = normalizeScatterRange(state.summaryStart, state.summaryEnd, 1, Math.max(20, summaryWindow));
  const scatterKind = parseScatterType(state.scatterKind);
  const scatterMode = parseScatterMode(state.scatterMode);
  const scatterWindow = parseScatterWindow(state.scatterWindow, 5);
  const scatterRange = normalizeScatterRange(state.scatterStart, state.scatterEnd, 1, Math.max(5, scatterWindow));
  const comparePlayers = sanitizeComparePlayers(state.comparePlayers);
  state.analyticsMinRuns = minRuns;
  state.summaryMode = summaryMode;
  state.summaryWindow = summaryWindow;
  state.summaryStart = summaryRange.startRun;
  state.summaryEnd = summaryRange.endRun;
  state.scatterKind = scatterKind;
  state.scatterMode = scatterMode;
  state.scatterWindow = scatterWindow;
  state.scatterStart = scatterRange.startRun;
  state.scatterEnd = scatterRange.endRun;
  state.comparePlayers = comparePlayers;
  syncAnalyticsControls();
  if (state.scoreDataSource === SCORE_DATA_SOURCES.DUMMY) {
    state.dummyRuns = makeDummyRuns(myName);
    const filteredRuns = state.dummyRuns.filter((run) => run.rule === rule);
    state.highScores = listTopRunsFromRuns(filteredRuns, 10);
    state.scoreStats = buildScoreStatsFromRuns(filteredRuns, myName);
    state.analytics = buildAnalyticsFromRuns(filteredRuns, {
      currentName: myName,
      comparePlayers,
      minRuns,
      limit: 8,
      summaryN: summaryWindow,
      summaryMode,
      summaryStart: summaryRange.startRun,
      summaryEnd: summaryRange.endRun,
      scatterKind,
      scatterN: scatterWindow,
      scatterMode,
      scatterStart: scatterRange.startRun,
      scatterEnd: scatterRange.endRun,
    });
    renderHighScores();
    renderScorePdf();
    renderAnalytics();
    renderScatterPlot();
    setHighScoreStatus(`Showing dummy local test data for "${activeRuleLabel()}".`);
    return;
  }

  try {
    const ruleQuery = encodeURIComponent(rule);
    const nameQuery = encodeURIComponent(myName);
    const playersQuery = encodeURIComponent(comparePlayers);
    const summaryModeQuery = encodeURIComponent(summaryMode);
    const scatterKindQuery = encodeURIComponent(scatterKind);
    const scatterModeQuery = encodeURIComponent(scatterMode);
    const [scoreResult, analyticsResult] = await Promise.allSettled([
      apiFetch(`/api/highscores?limit=10&rule=${ruleQuery}&name=${nameQuery}`),
      apiFetch(`/api/analytics?rule=${ruleQuery}&name=${nameQuery}&players=${playersQuery}&minRuns=${minRuns}&limit=8&summaryN=${summaryWindow}&summaryMode=${summaryModeQuery}&summaryStart=${summaryRange.startRun}&summaryEnd=${summaryRange.endRun}&scatterKind=${scatterKindQuery}&scatterN=${scatterWindow}&scatterMode=${scatterModeQuery}&scatterStart=${scatterRange.startRun}&scatterEnd=${scatterRange.endRun}`),
    ]);
    if (scoreResult.status !== 'fulfilled') throw scoreResult.reason;
    const scoreData = scoreResult.value;
    state.highScores = Array.isArray(scoreData.scores) ? scoreData.scores : [];
    state.scoreStats = scoreData?.stats && typeof scoreData.stats === 'object'
      ? scoreData.stats
      : buildScoreStatsFromRuns(state.highScores, myName);
    state.analytics = analyticsResult.status === 'fulfilled'
      && analyticsResult.value?.analytics
      && typeof analyticsResult.value.analytics === 'object'
      ? analyticsResult.value.analytics
      : buildAnalyticsFromRuns(state.highScores, {
        currentName: myName,
        comparePlayers,
        minRuns,
        limit: 8,
        summaryN: summaryWindow,
        summaryMode,
        summaryStart: summaryRange.startRun,
        summaryEnd: summaryRange.endRun,
        scatterKind,
        scatterN: scatterWindow,
        scatterMode,
        scatterStart: scatterRange.startRun,
        scatterEnd: scatterRange.endRun,
      });
    renderHighScores();
    renderScorePdf();
    renderAnalytics();
    renderScatterPlot();
    setHighScoreStatus(`Showing top 10 for "${activeRuleLabel()}" from ${state.scoreStats?.totalRuns || 0} saved runs.`);
  } catch (err) {
    state.highScores = [];
    state.scoreStats = emptyScoreStats();
    state.analytics = emptyAnalytics();
    renderHighScores();
    renderScorePdf();
    renderAnalytics();
    renderScatterPlot();
    setHighScoreStatus(err.message || 'Unable to load high scores.');
  }
}

async function saveProfile(profileOverride = null) {
  const pending = profileOverride
    ? normalizeProfileInput(profileOverride.name, profileOverride.password)
    : captureProfileFromInputs();
  const { name, password } = pending;
  try {
    const data = await apiFetch('/api/profile', {
      method: 'POST',
      body: JSON.stringify({ name, password }),
    });
    const savedName = data.profile?.name || name;
    storeProfile(savedName, password);
    setProfileStatus(data.profile?.claimed
      ? `Logged in as "${savedName}".`
      : `Logged in as "${savedName}" (name is not password-protected).`, 'success');
    await refreshHighScores();
  } catch (err) {
    setProfileStatus(err.message || 'Log in failed.', 'error');
  }
}

async function submitHighScore() {
  if (state.scoreDataSource === SCORE_DATA_SOURCES.DUMMY) {
    setHighScoreStatus('Switch score data to "live" to submit runs to the server.');
    return;
  }
  const payload = currentRunScorePayload();
  if (!payload) {
    setHighScoreStatus('Finish a run before submitting a score.');
    return;
  }
  const pendingProfile = captureProfileFromInputs();
  payload.name = pendingProfile.name;
  payload.password = pendingProfile.password;
  try {
    const data = await apiFetch('/api/highscores', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    storeProfile(pendingProfile.name, pendingProfile.password);
    syncProfileInputs();
    state.highScores = Array.isArray(data.scores) ? data.scores : state.highScores;
    state.scoreStats = data?.stats && typeof data.stats === 'object'
      ? data.stats
      : state.scoreStats;
    state.analytics = data?.analytics && typeof data.analytics === 'object'
      ? data.analytics
      : state.analytics;
    renderHighScores();
    renderScorePdf();
    renderAnalytics();
    renderScatterPlot();
    state.lastSubmittedRunSig = currentRunSig();
    const rankMsg = `Run saved. Current rank: #${data.rank || '?'}.`;
    await refreshHighScores();
    setHighScoreStatus(rankMsg);
  } catch (err) {
    setHighScoreStatus(err.message || 'Unable to submit score.');
  }
}

async function autoSubmitIfEligible() {
  if (state.scoreDataSource !== SCORE_DATA_SOURCES.LIVE) return;
  const runSig = currentRunSig();
  if (!runSig) return;
  if (state.lastSubmittedRunSig === runSig) return;
  if (state.lastAutoSubmitAttemptSig === runSig || state.autoSubmitInFlight) return;
  const rawName = String(state.profile.name ?? '').trim();
  if (!rawName) return;

  state.lastAutoSubmitAttemptSig = runSig;
  state.autoSubmitInFlight = true;
  try {
    await submitHighScore();
  } finally {
    state.autoSubmitInFlight = false;
  }
}

// Input
const keys = new Set();

function isTextEntryTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable) return true;
  const el = target;
  const tag = String(el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

window.addEventListener('keydown', (e) => {
  if (isTextEntryTarget(e.target)) return;
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

// Offline simulation state
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

  mode: null, // null | 'offline'
  online: false,
  wsReady: false,
  playerId: 'me',
  devColorMode: DEV_COLOR_MODES.NONE,
  itTransferRule: IT_TRANSFER_RULES.HYBRID,
  profile: getStoredProfile(),
  profileStatus: '',
  profileStatusType: 'info',
  highScores: [],
  highScoreStatus: '',
  scoreStats: emptyScoreStats(),
  analytics: emptyAnalytics(),
  comparePlayers: getStoredComparePlayers(),
  analyticsMinRuns: getStoredMinRuns(),
  summaryMode: getStoredSummaryMode(),
  summaryWindow: getStoredSummaryWindow(),
  summaryStart: getStoredSummaryStartRun(),
  summaryEnd: getStoredSummaryEndRun(),
  scatterKind: getStoredScatterType(),
  scatterMode: getStoredScatterMode(),
  scatterWindow: getStoredScatterWindow(),
  scatterStart: getStoredScatterStartRun(),
  scatterEnd: getStoredScatterEndRun(),
  scoreDataSource: getInitialScoreDataSource(),
  scoreHoverPoint: null,
  scatterHoverNameKey: null,
  scatterRenderedPoints: [],
  dummyRuns: [],
  lastSubmittedRunSig: null,
  lastAutoSubmitAttemptSig: null,
  autoSubmitInFlight: false,
  gameTimeMs: 0,

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
  state.ball.pickupIgnoreId = null;
  state.ball.pickupLockUntil = -1e9;
  state.itHasBall = true;
  state.itLostBallAtMs = now;
  state.itBalllessMs = 0;
}

function resetGameOffline() {
  state.nowMs = performance.now();
  state.lastT = performance.now();
  state.lastSubmittedRunSig = null;
  state.lastAutoSubmitAttemptSig = null;
  state.autoSubmitInFlight = false;
  state.gameTimeMs = 0;

  state.players = [makePlayer('me', currentProfileName(), true)];
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
    pickupIgnoreId: null,
    pickupLockUntil: -1e9,
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
      const ballDist = vecLen(b.x - p.x, b.y - p.y);
      const chaseLeadT = clamp(vecLen(b.vx, b.vy) / 1250, 0.02, 0.14);
      tx = b.x + b.vx * chaseLeadT;
      ty = b.y + b.vy * chaseLeadT;
      if (ballDist < 170) {
        tx = b.x;
        ty = b.y;
      }
      speed = lerp(1120, 1320, winPush);
      snap = lerp(0.0032, 0.0011, winPush);
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
  b.pickupIgnoreId = thrower.id;
  b.pickupLockUntil = now + THROW_RECLAIM_LOCK_MS;
  b.x = thrower.x + nx * (PLAYER_RADIUS + BALL_RADIUS + 2);
  b.y = thrower.y + ny * (PLAYER_RADIUS + BALL_RADIUS + 2);
  b.vx = nx * speed;
  b.vy = ny * speed;
}

function updateOffline(dt) {
  const now = state.nowMs;
  if (state.over) return;
  state.gameTimeMs += dt * 1000;
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
      void autoSubmitIfEligible();
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
      const pickupLocked = b.pickupIgnoreId === it.id && now < (b.pickupLockUntil || -1e9);
      if (!pickupLocked && dItBall <= IT_PICKUP_RADIUS) {
        b.heldBy = it.id;
        b.lastThrower = null;
        b.armed = false;
        b.vx = 0;
        b.vy = 0;
        b.pickupIgnoreId = null;
        b.pickupLockUntil = -1e9;
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

  // choose state for rendering
  const R = getRenderSnapshot();
  const players = R.players || [];
  const obstacles = R.obstacles || [];
  const ball = R.ball || null;
  const it = players.find(p => p.it);

  // overlay: mode picker (pre-game) OR offline end screen
  if (!state.mode) {
    overlayEl?.classList.add('on');
    if (endTitleEl) endTitleEl.textContent = 'The Furry One';
    if (endSubEl) endSubEl.textContent = 'Get furry by being closest to, but not IT';
    if (endRowsEl) endRowsEl.innerHTML = '';
    if (playOfflineBtn) playOfflineBtn.textContent = 'Start run';
    if (switchProfileBtn) switchProfileBtn.textContent = profileActionLabel();
    if (runProfileNameEl) runProfileNameEl.textContent = runProfileLabel();
    if (scoreActionsEl) scoreActionsEl.style.display = 'none';
  } else if (state.mode === 'offline' && state.over && state.winnerId) {
    overlayEl?.classList.add('on');
    const wP = state.players.find(p => p.id === state.winnerId);
    const runSec = ((state.gameTimeMs || 0) / 1000).toFixed(1);
    if (endTitleEl) endTitleEl.textContent = `${wP?.name || 'Someone'} wins!`;
    if (endSubEl) endSubEl.textContent = `First to ${WIN_POINTS} points in ${runSec}s. Press Enter or Reset.`;
    if (playOfflineBtn) playOfflineBtn.textContent = 'Play again';
    if (scoreActionsEl) scoreActionsEl.style.display = 'flex';
    if (switchProfileBtn) {
      switchProfileBtn.textContent = profileActionLabel();
    }
    if (runProfileNameEl) runProfileNameEl.textContent = runProfileLabel();
    if (submitHighScoreBtn) {
      const runSig = currentRunSig();
      const alreadySubmitted = runSig && state.lastSubmittedRunSig === runSig;
      const autoSubmitting = runSig && state.autoSubmitInFlight && state.lastAutoSubmitAttemptSig === runSig;
      submitHighScoreBtn.disabled = !!alreadySubmitted || !!autoSubmitting;
      submitHighScoreBtn.textContent = alreadySubmitted ? 'Score submitted' : (autoSubmitting ? 'Submitting...' : 'Submit score');
    }
    if (endRowsEl) {
      const sorted = [...state.players].sort((a,b) => (b.score||0) - (a.score||0));
      endRowsEl.innerHTML = sorted.map(p => {
        const pts = (p.score || 0).toFixed(0);
        const furry = (p.furryMs/1000).toFixed(1);
        const you = p.id === (state.playerId || 'me') ? ' (you)' : (p.human ? ' (player)' : '');
        return `<div class="row"><div><b>${p.name}${you}</b></div><div>${pts} pts · ${furry}s it</div></div>`;
      }).join('');
    }
  } else {
    overlayEl?.classList.remove('on');
    setProfileEditorOpen(false);
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
    const botColor = state.mode === 'offline' ? getOfflineBotColor(p, it, state.nowMs) : COLORS.bot;
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
  const mode = 'Offline';
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

function getRenderSnapshot() {
  return { players: state.players, obstacles: state.obstacles, ball: state.ball };
}

function loop() {
  const now = performance.now();
  const dt = clamp((now - state.lastT) / 1000, 0, 0.05);
  state.lastT = now;

  if (state.mode === 'offline') {
    state.nowMs = now;
    updateOffline(dt);
  }

  draw();
  requestAnimationFrame(loop);
}

const resetBtn = document.querySelector('#reset');
resetBtn.addEventListener('click', () => {
  state.mode = 'offline';
  resetGameOffline();
});

playOfflineBtn?.addEventListener('click', () => {
  state.mode = 'offline';
  resetGameOffline();
});

switchProfileBtn?.addEventListener('click', () => {
  const isOpen = !!(profileInlineEditorEl && !profileInlineEditorEl.classList.contains('isHidden'));
  setProfileEditorOpen(!isOpen);
  if (!isOpen && profileNameEl) profileNameEl.focus();
});

saveProfileBtn?.addEventListener('click', () => {
  saveProfile();
});

clearPasswordBtn?.addEventListener('click', () => {
  if (profilePasswordEl) profilePasswordEl.value = '';
  state.profile.password = '';
  localStorage.removeItem(STORAGE_KEYS.profilePassword);
  setProfileStatus('Stored password cleared in this browser.', 'info');
});

profileNameEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  saveProfile();
});

profilePasswordEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  saveProfile();
});

submitHighScoreBtn?.addEventListener('click', () => {
  submitHighScore();
});

applyAnalyticsBtn?.addEventListener('click', () => {
  applyAnalyticsFilters();
});

comparePlayersEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  applyAnalyticsFilters();
});

minRunsEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  applyAnalyticsFilters();
});

summaryModeEl?.addEventListener('change', () => {
  applyNonComparisonFiltersNow();
});

summaryWindowEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  applyNonComparisonFiltersNow();
});
summaryWindowEl?.addEventListener('input', () => {
  scheduleNonComparisonAutoApply();
});
summaryWindowEl?.addEventListener('change', () => {
  applyNonComparisonFiltersNow();
});

summaryRunStartEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  applyNonComparisonFiltersNow();
});
summaryRunStartEl?.addEventListener('input', () => {
  scheduleNonComparisonAutoApply();
});
summaryRunStartEl?.addEventListener('change', () => {
  applyNonComparisonFiltersNow();
});

summaryRunEndEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  applyNonComparisonFiltersNow();
});
summaryRunEndEl?.addEventListener('input', () => {
  scheduleNonComparisonAutoApply();
});
summaryRunEndEl?.addEventListener('change', () => {
  applyNonComparisonFiltersNow();
});

scatterTypeEl?.addEventListener('change', () => {
  applyNonComparisonFiltersNow();
});

scatterModeEl?.addEventListener('change', () => {
  applyNonComparisonFiltersNow();
});

scatterWindowEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  applyNonComparisonFiltersNow();
});
scatterWindowEl?.addEventListener('input', () => {
  scheduleNonComparisonAutoApply();
});
scatterWindowEl?.addEventListener('change', () => {
  applyNonComparisonFiltersNow();
});

scatterRunStartEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  applyNonComparisonFiltersNow();
});
scatterRunStartEl?.addEventListener('input', () => {
  scheduleNonComparisonAutoApply();
});
scatterRunStartEl?.addEventListener('change', () => {
  applyNonComparisonFiltersNow();
});

scatterRunEndEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  applyNonComparisonFiltersNow();
});
scatterRunEndEl?.addEventListener('input', () => {
  scheduleNonComparisonAutoApply();
});
scatterRunEndEl?.addEventListener('change', () => {
  applyNonComparisonFiltersNow();
});

scoreDataSourceEl?.addEventListener('change', () => {
  state.scoreDataSource = parseScoreDataSource(scoreDataSourceEl.value);
  localStorage.setItem(STORAGE_KEYS.scoreDataSource, state.scoreDataSource);
  state.scoreHoverPoint = null;
  state.scatterHoverNameKey = null;
  highScoreSig = null;
  updateHighScoreTitle();
  refreshHighScores();
});

cdfChartEl?.addEventListener('mousemove', (e) => {
  const rect = cdfChartEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const plotLeft = (SCORE_DIST_CHART.padL / SCORE_DIST_CHART.width) * rect.width;
  const plotRight = rect.width - (SCORE_DIST_CHART.padR / SCORE_DIST_CHART.width) * rect.width;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const x = clamp(e.clientX - rect.left, plotLeft, plotRight);
  const score = ((x - plotLeft) / plotWidth) * 100;
  const rounded = Math.round(clamp(score, 0, 100));
  if (rounded === state.scoreHoverPoint) return;
  state.scoreHoverPoint = rounded;
  renderScorePdf();
});

cdfChartEl?.addEventListener('mouseleave', () => {
  if (state.scoreHoverPoint == null) return;
  state.scoreHoverPoint = null;
  renderScorePdf();
});

scatterPlotEl?.addEventListener('mousemove', (e) => {
  const rect = scatterPlotEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const sx = ((e.clientX - rect.left) / rect.width) * SCATTER_CHART.width;
  const sy = ((e.clientY - rect.top) / rect.height) * SCATTER_CHART.height;
  let best = null;
  let bestD2 = Infinity;
  for (const p of state.scatterRenderedPoints || []) {
    const dx = sx - p.x;
    const dy = sy - p.y;
    const d2 = dx * dx + dy * dy;
    const hitR = Math.max(9, (p.r || 3) + 3);
    if (d2 <= hitR * hitR && d2 < bestD2) {
      best = p;
      bestD2 = d2;
    }
  }
  const next = best?.nameKey || null;
  if (next === state.scatterHoverNameKey) return;
  state.scatterHoverNameKey = next;
  renderScatterPlot();
});

scatterPlotEl?.addEventListener('mouseleave', () => {
  if (!state.scatterHoverNameKey) return;
  state.scatterHoverNameKey = null;
  renderScatterPlot();
});

window.addEventListener('keydown', (e) => {
  if (isTextEntryTarget(e.target)) return;
  if (e.key === 'Enter' && state.over) {
    state.mode = 'offline';
    resetGameOffline();
  }
});

resize();
syncProfileInputs();
setProfileEditorOpen(false);
updateHighScoreTitle();
setProfileStatus('');
setHighScoreStatus('Loading high scores…');
renderHighScores();
renderScorePdf();
renderAnalytics();
renderScatterPlot();
resetGameOffline();
state.mode = null;
state.online = false;
state.wsReady = false;
refreshHighScores();
loop();
