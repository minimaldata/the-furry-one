import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = process.env.SCORES_FILE || path.join(DATA_DIR, 'scores.json');

const EMPTY_DB = {
  profiles: {},
  entries: {},
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

function compareEntries(a, b) {
  if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
  const aGame = Number.isFinite(Number(a.gameTimeMs)) ? Number(a.gameTimeMs) : 1e12;
  const bGame = Number.isFinite(Number(b.gameTimeMs)) ? Number(b.gameTimeMs) : 1e12;
  if (aGame !== bGame) return aGame - bGame;
  if ((a.furryMs || 0) !== (b.furryMs || 0)) return (a.furryMs || 0) - (b.furryMs || 0);
  return String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
}

function isBetterScore(next, prev) {
  if (!prev) return true;
  return compareEntries(next, prev) < 0;
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
    db = {
      profiles: parsed?.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {},
      entries: parsed?.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
    };
  } catch {
    db = structuredClone(EMPTY_DB);
    await saveDb();
  }
}

export function listHighScores(limit = 10) {
  return Object.values(db.entries)
    .sort(compareEntries)
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
}

export function getRankForName(name) {
  const key = nameKey(name);
  const sorted = Object.values(db.entries).sort(compareEntries);
  const idx = sorted.findIndex((entry) => entry.nameKey === key);
  return idx >= 0 ? idx + 1 : null;
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

  if (db.entries[key]) {
    db.entries[key].name = cleanName;
    db.entries[key].updatedAt = existing.updatedAt;
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
  const scoreNum = clampNumber(score, 0, 9999);
  const gameTimeMsNum = clampNumber(gameTimeMs, 0, 60 * 60 * 1000);
  const furryMsNum = clampNumber(furryMs, 0, 10 * 60 * 1000);
  const key = nameKey(cleanName);

  await saveProfile({ name: cleanName, password: cleanPassword });

  const now = new Date().toISOString();
  const nextEntry = {
    nameKey: key,
    name: cleanName,
    score: scoreNum,
    gameTimeMs: gameTimeMsNum,
    furryMs: furryMsNum,
    rule: typeof rule === 'string' ? rule.slice(0, 24) : 'hybrid',
    updatedAt: now,
  };

  const prev = db.entries[key];
  const improved = isBetterScore(nextEntry, prev);
  if (improved) db.entries[key] = nextEntry;

  await saveDb();
  return {
    improved,
    rank: getRankForName(cleanName),
    score: db.entries[key] || nextEntry,
    scores: listHighScores(10),
    claimed: !!db.profiles[key]?.passwordHash,
  };
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
