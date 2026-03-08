import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = process.env.SCORES_FILE || path.join(DATA_DIR, 'scores.json');

const RULE_HYBRID = 'hybrid';
const RULE_THROW_ONLY = 'throw-only';
const RULE_TAG_ONLY = 'tag-only';
const VALID_RULES = new Set([RULE_HYBRID, RULE_THROW_ONLY, RULE_TAG_ONLY]);

const MAX_SCORE = 9999;
const MAX_GAME_TIME_MS = 60 * 60 * 1000;
const MAX_FURRY_MS = 10 * 60 * 1000;
const SCORE_AXIS_MAX = 100;
const SCATTER_RUN_INDEX_MAX = 10000;
const SCATTER_MODE_LAST = 'last';
const SCATTER_MODE_BETWEEN = 'between';
const SCATTER_KIND_LOSERS = 'losers';
const SCATTER_KIND_WINNERS = 'winners';

const EMPTY_DB = {
  profiles: {},
  runs: [],
};

let db = structuredClone(EMPTY_DB);
let saveChain = Promise.resolve();

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function nameKey(name) {
  return normalizeName(name).toLowerCase();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHex) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function normalizeRule(rule) {
  const v = String(rule || '').trim().toLowerCase();
  return VALID_RULES.has(v) ? v : RULE_HYBRID;
}

function normalizeRuleFilter(rule) {
  const v = String(rule || '').trim().toLowerCase();
  if (!v || v === 'all') return null;
  return VALID_RULES.has(v) ? v : null;
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeScatterMode(value) {
  return String(value || '').trim().toLowerCase() === SCATTER_MODE_BETWEEN
    ? SCATTER_MODE_BETWEEN
    : SCATTER_MODE_LAST;
}

function normalizeScatterKind(value) {
  return String(value || '').trim().toLowerCase() === SCATTER_KIND_WINNERS
    ? SCATTER_KIND_WINNERS
    : SCATTER_KIND_LOSERS;
}

function normalizeScatterWindow(value, fallback = 5) {
  const v = Number(value);
  if (!Number.isFinite(v)) return Math.max(1, Math.min(100, fallback));
  return Math.max(1, Math.min(100, Math.round(v)));
}

function normalizeScatterRunIndex(value, fallback = 1) {
  const v = Number(value);
  if (!Number.isFinite(v)) return Math.max(1, Math.min(SCATTER_RUN_INDEX_MAX, fallback));
  return Math.max(1, Math.min(SCATTER_RUN_INDEX_MAX, Math.round(v)));
}

function normalizeScatterRange(startRun, endRun, fallbackStart = 1, fallbackEnd = 5) {
  const start = normalizeScatterRunIndex(startRun, fallbackStart);
  const end = normalizeScatterRunIndex(endRun, fallbackEnd);
  if (start <= end) return { startRun: start, endRun: end };
  return { startRun: end, endRun: start };
}

function normalizeGameTimeMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return clampNumber(n, 1, MAX_GAME_TIME_MS);
}

function sortableGameTimeMs(value) {
  return normalizeGameTimeMs(value) ?? 1e12;
}

function clampScoreAxis(value) {
  return Math.round(clampNumber(value, 0, SCORE_AXIS_MAX));
}

function ensureIso(value, fallbackIso) {
  const d = new Date(value || '');
  if (!Number.isFinite(d.getTime())) return fallbackIso;
  return d.toISOString();
}

function normalizeRunId(value) {
  const v = String(value || '').trim();
  if (v && v.length <= 64) return v;
  return crypto.randomBytes(8).toString('hex');
}

function normalizeRunInput(run, fallbackIso = new Date().toISOString()) {
  const cleanName = normalizeName(run?.name || run?.nameKey || 'Player') || 'Player';
  const key = nameKey(cleanName);
  const updatedAt = ensureIso(run?.updatedAt, fallbackIso);
  return {
    id: normalizeRunId(run?.id),
    nameKey: key,
    name: cleanName,
    score: clampNumber(run?.score, 0, MAX_SCORE),
    gameTimeMs: normalizeGameTimeMs(run?.gameTimeMs) ?? MAX_GAME_TIME_MS,
    furryMs: clampNumber(run?.furryMs, 0, MAX_FURRY_MS),
    rule: normalizeRule(run?.rule),
    runAt: ensureIso(run?.runAt, updatedAt),
    updatedAt,
  };
}

function compareEntries(a, b) {
  if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
  const aGame = sortableGameTimeMs(a.gameTimeMs);
  const bGame = sortableGameTimeMs(b.gameTimeMs);
  if (aGame !== bGame) return aGame - bGame;
  if ((a.furryMs || 0) !== (b.furryMs || 0)) return (a.furryMs || 0) - (b.furryMs || 0);
  return String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
}

function runsForRule(rule = null) {
  const normalizedRule = normalizeRuleFilter(rule);
  if (!normalizedRule) return db.runs;
  return db.runs.filter((run) => normalizeRule(run?.rule) === normalizedRule);
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

function buildPdf(scores) {
  const x = Array.from({ length: SCORE_AXIS_MAX + 1 }, (_, i) => i);
  if (!scores.length) return { x, y: x.map(() => 0) };
  const counts = x.map(() => 0);
  for (const score of scores) counts[clampScoreAxis(score)] += 1;
  const probs = counts.map((v) => v / scores.length);
  return { x, y: smoothProbabilitySeries(probs, 2) };
}

function scoreIsWin(score) {
  return Number(score) >= SCORE_AXIS_MAX;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarizeRuns(runs, identity = {}) {
  const totalRuns = runs.length;
  const wins = runs.filter((run) => scoreIsWin(run?.score));
  const winTimes = wins
    .map((run) => normalizeGameTimeMs(run?.gameTimeMs))
    .filter((v) => Number.isFinite(v));
  const nonWinScores = runs
    .filter((run) => !scoreIsWin(run?.score))
    .map((run) => clampScoreAxis(run?.score));
  const winCount = wins.length;
  const nonWinCount = nonWinScores.length;
  return {
    name: identity.name || 'Player',
    nameKey: identity.nameKey || 'player',
    totalRuns,
    winCount,
    winRate: totalRuns > 0 ? (winCount / totalRuns) : 0,
    medianWinTimeMs: median(winTimes),
    nonWinCount,
    medianNonWinScore: median(nonWinScores),
  };
}

function comparePlayerSummary(a, b) {
  if ((b.winRate || 0) !== (a.winRate || 0)) return (b.winRate || 0) - (a.winRate || 0);
  if ((b.winCount || 0) !== (a.winCount || 0)) return (b.winCount || 0) - (a.winCount || 0);
  const aWinTime = Number.isFinite(a.medianWinTimeMs) ? a.medianWinTimeMs : 1e12;
  const bWinTime = Number.isFinite(b.medianWinTimeMs) ? b.medianWinTimeMs : 1e12;
  if (aWinTime !== bWinTime) return aWinTime - bWinTime;
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
  return clampNumber(((better + (equal * 0.5)) / pool.length) * 100, 0, 100);
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

function parsePlayersFilter(players) {
  const raw = Array.isArray(players) ? players.join(',') : String(players || '');
  const names = raw.split(',').map((v) => normalizeName(v)).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const n of names) {
    const k = nameKey(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name: n, nameKey: k });
  }
  return out;
}

function runTimestampMs(run) {
  const t = Date.parse(run?.runAt || run?.updatedAt || '');
  if (Number.isFinite(t)) return t;
  return 0;
}

function selectRunsByWindow(sortedRuns, { mode, windowRuns, startRun, endRun, requireFullLast = false } = {}) {
  if (!Array.isArray(sortedRuns) || sortedRuns.length === 0) return [];
  const modeNorm = normalizeScatterMode(mode);
  if (modeNorm === SCATTER_MODE_BETWEEN) {
    if (sortedRuns.length < endRun) return [];
    return sortedRuns.slice(startRun - 1, endRun);
  }
  if (requireFullLast && sortedRuns.length < windowRuns) return [];
  return sortedRuns.slice(-windowRuns);
}

function buildScatterPoints(
  groups,
  { kind = SCATTER_KIND_LOSERS, mode = SCATTER_MODE_LAST, windowRuns = 5, startRun = 1, endRun = 5 } = {},
) {
  const scatterKind = normalizeScatterKind(kind);
  const scatterMode = normalizeScatterMode(mode);
  const scatterWindow = normalizeScatterWindow(windowRuns, 5);
  const scatterRange = normalizeScatterRange(startRun, endRun, 1, Math.max(5, scatterWindow));
  const betweenLen = Math.max(1, (scatterRange.endRun - scatterRange.startRun) + 1);
  const points = [];
  for (const bucket of groups.values()) {
    if (!Array.isArray(bucket.runs)) continue;
    const sorted = [...bucket.runs].sort((a, b) => runTimestampMs(a) - runTimestampMs(b));
    const source = scatterKind === SCATTER_KIND_WINNERS
      ? sorted.filter((run) => scoreIsWin(run?.score))
      : sorted;
    const sample = selectRunsByWindow(source, {
      mode: scatterMode,
      windowRuns: scatterWindow,
      startRun: scatterRange.startRun,
      endRun: scatterRange.endRun,
      requireFullLast: true,
    });
    if (sample.length !== betweenLen && scatterMode === SCATTER_MODE_BETWEEN) continue;
    if (!sample.length) continue;
    const basePoint = {
      name: bucket.name || 'Player',
      nameKey: bucket.nameKey,
      runCount: source.length,
      sampleRuns: sample.length,
    };
    if (scatterKind === SCATTER_KIND_WINNERS) {
      const avgGameTimeMs = sample.reduce((sum, run) => sum + (normalizeGameTimeMs(run?.gameTimeMs) ?? MAX_GAME_TIME_MS), 0) / sample.length;
      const avgFurryMs = sample.reduce((sum, run) => sum + clampNumber(run?.furryMs, 0, MAX_FURRY_MS), 0) / sample.length;
      points.push({
        ...basePoint,
        avgGameTimeMs,
        avgFurryMs,
      });
    } else {
      const avgScore = sample.reduce((sum, run) => sum + clampScoreAxis(run?.score), 0) / sample.length;
      const avgWinRate = sample.reduce((sum, run) => sum + (scoreIsWin(run?.score) ? 1 : 0), 0) / sample.length;
      points.push({
        ...basePoint,
        avgScore,
        avgWinRate,
      });
    }
  }
  return points.sort((a, b) => {
    if ((b.runCount || 0) !== (a.runCount || 0)) return (b.runCount || 0) - (a.runCount || 0);
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function getRankForRun(runId, rule = null) {
  const sorted = runsForRule(rule).slice().sort(compareEntries);
  const idx = sorted.findIndex((entry) => entry.id === runId);
  return idx >= 0 ? idx + 1 : null;
}

async function saveDb() {
  saveChain = saveChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
  });
  return saveChain;
}

export async function initStore() {
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    const profiles = parsed?.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {};
    const runList = Array.isArray(parsed?.runs) ? parsed.runs : [];
    const legacyEntries = parsed?.entries && typeof parsed.entries === 'object' ? Object.values(parsed.entries) : [];
    const merged = [...runList, ...legacyEntries];
    const nowIso = new Date().toISOString();
    const normalizedRuns = merged.map((run) => normalizeRunInput(run, nowIso));

    db = {
      profiles,
      runs: normalizedRuns,
    };

    const needsSave = !Array.isArray(parsed?.runs) || legacyEntries.length > 0 || normalizedRuns.length !== merged.length;
    if (needsSave) await saveDb();
  } catch {
    db = structuredClone(EMPTY_DB);
    await saveDb();
  }
}

export function listHighScores(limit = 10, rule = null) {
  return runsForRule(rule)
    .slice()
    .sort(compareEntries)
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
}

export function getScoreStats({ rule = null, name = '' } = {}) {
  const filtered = runsForRule(rule);
  const targetKey = name ? nameKey(name) : '';

  const allScores = filtered.map((run) => clampScoreAxis(run?.score));
  const playerScores = targetKey
    ? filtered.filter((run) => run.nameKey === targetKey).map((run) => clampScoreAxis(run?.score))
    : [];

  const allPdf = buildPdf(allScores);
  const playerPdf = buildPdf(playerScores);

  return {
    totalRuns: filtered.length,
    playerRuns: playerScores.length,
    pdf: {
      x: allPdf.x,
      all: allPdf.y,
      player: playerPdf.y,
    },
  };
}

export function getAnalytics({
  rule = null,
  name = '',
  players = '',
  minRuns = 5,
  limit = 8,
  summaryN = 20,
  summaryMode = SCATTER_MODE_LAST,
  summaryStart = 1,
  summaryEnd = 20,
  scatterKind = SCATTER_KIND_LOSERS,
  scatterN = 5,
  scatterMode = SCATTER_MODE_LAST,
  scatterStart = 1,
  scatterEnd = 5,
} = {}) {
  const filtered = runsForRule(rule);
  const minRunsNum = Math.max(1, Math.min(500, Math.round(clampNumber(minRuns, 1, 500))));
  const limitNum = Math.max(1, Math.min(50, Math.round(clampNumber(limit, 1, 50))));
  const summaryWindowNum = normalizeScatterWindow(summaryN, 20);
  const summaryModeNorm = normalizeScatterMode(summaryMode);
  const summaryRange = normalizeScatterRange(summaryStart, summaryEnd, 1, Math.max(20, summaryWindowNum));
  const scatterKindNorm = normalizeScatterKind(scatterKind);
  const scatterWindowNum = normalizeScatterWindow(scatterN, 5);
  const scatterModeNorm = normalizeScatterMode(scatterMode);
  const scatterRange = normalizeScatterRange(scatterStart, scatterEnd, 1, Math.max(5, scatterWindowNum));
  const currentName = normalizeName(name) || 'Player';
  const currentKey = nameKey(currentName);

  const groups = new Map();
  for (const run of filtered) {
    const k = run?.nameKey || nameKey(run?.name);
    if (!k) continue;
    let bucket = groups.get(k);
    if (!bucket) {
      bucket = {
        nameKey: k,
        name: run?.name || k,
        runs: [],
      };
      groups.set(k, bucket);
    }
    if (run?.name && String(run.name).length > 0) bucket.name = run.name;
    bucket.runs.push(run);
  }

  const summaries = [...groups.values()].map((bucket) => summarizeRuns(bucket.runs, {
    name: bucket.name,
    nameKey: bucket.nameKey,
  }));
  const byKey = new Map(summaries.map((s) => [s.nameKey, s]));

  const everyone = summarizeRuns(filtered, { name: 'Everyone', nameKey: 'everyone' });
  const current = byKey.get(currentKey) || summarizeRuns([], { name: currentName, nameKey: currentKey });
  const currentPercentiles = buildCurrentPercentiles(summaries, current);
  const everyonePercentiles = buildCurrentPercentiles(summaries, everyone);

  const summaryGroups = new Map();
  const summaryRuns = [];
  for (const bucket of groups.values()) {
    const sorted = [...bucket.runs].sort((a, b) => runTimestampMs(a) - runTimestampMs(b));
    const sample = selectRunsByWindow(sorted, {
      mode: summaryModeNorm,
      windowRuns: summaryWindowNum,
      startRun: summaryRange.startRun,
      endRun: summaryRange.endRun,
      requireFullLast: false,
    });
    if (!sample.length) continue;
    summaryGroups.set(bucket.nameKey, { name: bucket.name, nameKey: bucket.nameKey, runs: sample });
    summaryRuns.push(...sample);
  }
  const summarySummaries = [...summaryGroups.values()].map((bucket) => summarizeRuns(bucket.runs, {
    name: bucket.name,
    nameKey: bucket.nameKey,
  }));
  const summaryByKey = new Map(summarySummaries.map((s) => [s.nameKey, s]));
  const summaryCurrent = summaryByKey.get(currentKey) || summarizeRuns([], { name: currentName, nameKey: currentKey });
  const summaryEveryone = summarizeRuns(summaryRuns, { name: 'Everyone', nameKey: 'everyone' });
  const summaryCurrentPercentiles = buildCurrentPercentiles(summarySummaries, summaryCurrent);
  const summaryEveryonePercentiles = buildCurrentPercentiles(summarySummaries, summaryEveryone);
  const selected = parsePlayersFilter(players);

  let compared;
  if (selected.length > 0) {
    compared = selected.map((p) => {
      const s = byKey.get(p.nameKey) || summarizeRuns([], p);
      return { ...s, meetsMinRuns: s.totalRuns >= minRunsNum };
    });
  } else {
    compared = summaries
      .filter((s) => s.totalRuns >= minRunsNum)
      .sort(comparePlayerSummary)
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

  const scatterPoints = buildScatterPoints(groups, {
    kind: scatterKindNorm,
    mode: scatterModeNorm,
    windowRuns: scatterWindowNum,
    startRun: scatterRange.startRun,
    endRun: scatterRange.endRun,
  });

  return {
    minRuns: minRunsNum,
    summary: {
      mode: summaryModeNorm,
      windowRuns: summaryWindowNum,
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
    scatterKind: scatterKindNorm,
    scatterN: scatterWindowNum,
    scatterMode: scatterModeNorm,
    scatterStart: scatterRange.startRun,
    scatterEnd: scatterRange.endRun,
    totalRuns: filtered.length,
    totalPlayers: summaries.length,
    current: { ...current, meetsMinRuns: current.totalRuns >= minRunsNum },
    everyone: { ...everyone, meetsMinRuns: everyone.totalRuns >= minRunsNum },
    compared,
    availablePlayers,
    scatter: {
      kind: scatterKindNorm,
      mode: scatterModeNorm,
      windowRuns: scatterWindowNum,
      startRun: scatterRange.startRun,
      endRun: scatterRange.endRun,
      eligiblePlayers: scatterPoints.length,
      points: scatterPoints,
    },
  };
}

export async function saveProfile({ name, password }) {
  const cleanName = normalizeName(name);
  if (!cleanName) {
    const err = new Error('Name is required.');
    err.status = 400;
    throw err;
  }

  const cleanPassword = String(password || '').slice(0, 128);
  const key = nameKey(cleanName);
  const existing = db.profiles[key];

  if (!existing) {
    const salt = cleanPassword ? crypto.randomBytes(16).toString('hex') : null;
    db.profiles[key] = {
      nameKey: key,
      name: cleanName,
      passwordSalt: salt,
      passwordHash: cleanPassword ? hashPassword(cleanPassword, salt) : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveDb();
    return { name: cleanName, claimed: !!cleanPassword };
  }

  if (existing.passwordHash) {
    if (!cleanPassword || !verifyPassword(cleanPassword, existing.passwordSalt, existing.passwordHash)) {
      const err = new Error('That name is protected. Enter the correct password.');
      err.status = 401;
      throw err;
    }
  } else if (cleanPassword) {
    existing.passwordSalt = crypto.randomBytes(16).toString('hex');
    existing.passwordHash = hashPassword(cleanPassword, existing.passwordSalt);
  }

  existing.name = cleanName;
  existing.updatedAt = new Date().toISOString();

  for (const run of db.runs) {
    if (run?.nameKey !== key) continue;
    run.name = cleanName;
    run.updatedAt = existing.updatedAt;
  }

  await saveDb();
  return { name: cleanName, claimed: !!existing.passwordHash };
}

export async function submitScore({ name, password, score, gameTimeMs, furryMs, rule }) {
  const cleanName = normalizeName(name);
  if (!cleanName) {
    const err = new Error('Name is required to submit a score.');
    err.status = 400;
    throw err;
  }

  const cleanPassword = String(password || '').slice(0, 128);
  const key = nameKey(cleanName);
  const nowIso = new Date().toISOString();
  const normalizedRule = normalizeRule(rule);

  await saveProfile({ name: cleanName, password: cleanPassword });

  const run = normalizeRunInput({
    id: crypto.randomBytes(8).toString('hex'),
    nameKey: key,
    name: cleanName,
    score,
    gameTimeMs,
    furryMs,
    rule: normalizedRule,
    runAt: nowIso,
    updatedAt: nowIso,
  }, nowIso);

  db.runs.push(run);
  await saveDb();

  return {
    improved: true,
    rank: getRankForRun(run.id, normalizedRule),
    score: run,
    scores: listHighScores(10, normalizedRule),
    stats: getScoreStats({ rule: normalizedRule, name: cleanName }),
    analytics: getAnalytics({ rule: normalizedRule, name: cleanName, minRuns: 5, limit: 8, scatterN: 5 }),
    claimed: !!db.profiles[key]?.passwordHash,
  };
}
