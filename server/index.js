import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAnalytics, getScoreStats, initStore, listHighScores, saveProfile, submitScore } from './store.js';

const PORT = Number(process.env.PORT || 8080);
const serveStatic = process.env.SERVE_STATIC !== '0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, '..', 'dist');

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}

async function readJsonBody(req) {
  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        reject(Object.assign(new Error('Request body too large.'), { status: 413 }));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function serveStaticFile(res, reqPath) {
  const normalized = reqPath === '/' ? '/index.html' : reqPath;
  const filePath = path.join(distDir, normalized);
  if (!filePath.startsWith(distDir)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.js' ? 'application/javascript; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8'
      : ext === '.json' ? 'application/json; charset=utf-8'
      : 'application/octet-stream';
    sendText(res, 200, file, type);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      sendText(res, 204, '');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/highscores') {
      const limit = Number(url.searchParams.get('limit') || 10);
      const rule = url.searchParams.get('rule');
      const name = url.searchParams.get('name') || '';
      sendJson(res, 200, {
        ok: true,
        scores: listHighScores(limit, rule),
        stats: getScoreStats({ rule, name }),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/analytics') {
      const rule = url.searchParams.get('rule');
      const name = url.searchParams.get('name') || '';
      const players = url.searchParams.get('players') || '';
      const minRuns = Number(url.searchParams.get('minRuns') || 5);
      const limit = Number(url.searchParams.get('limit') || 8);
      const summaryN = Number(url.searchParams.get('summaryN') || 20);
      const summaryMode = url.searchParams.get('summaryMode') || 'last';
      const summaryStart = Number(url.searchParams.get('summaryStart') || 1);
      const summaryEnd = Number(url.searchParams.get('summaryEnd') || 20);
      const scatterKind = url.searchParams.get('scatterKind') || 'losers';
      const scatterN = Number(url.searchParams.get('scatterN') || 5);
      const scatterMode = url.searchParams.get('scatterMode') || 'last';
      const scatterStart = Number(url.searchParams.get('scatterStart') || 1);
      const scatterEnd = Number(url.searchParams.get('scatterEnd') || 5);
      sendJson(res, 200, {
        ok: true,
        analytics: getAnalytics({
          rule,
          name,
          players,
          minRuns,
          limit,
          summaryN,
          summaryMode,
          summaryStart,
          summaryEnd,
          scatterKind,
          scatterN,
          scatterMode,
          scatterStart,
          scatterEnd,
        }),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/profile') {
      const body = await readJsonBody(req);
      const profile = await saveProfile({ name: body?.name, password: body?.password });
      sendJson(res, 200, { ok: true, profile });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/highscores') {
      const body = await readJsonBody(req);
      const result = await submitScore({
        name: body?.name,
        password: body?.password,
        score: body?.score,
        gameTimeMs: body?.gameTimeMs,
        furryMs: body?.furryMs,
        rule: body?.rule,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (serveStatic && req.method === 'GET') {
      await serveStaticFile(res, url.pathname);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found.' });
  } catch (err) {
    sendJson(res, Number(err?.status || 500), {
      ok: false,
      error: err?.message || 'Unexpected server error.',
    });
  }
});

await initStore();

server.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
  if (serveStatic) console.log('[server] serving ../dist');
});
