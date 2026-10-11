import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 4173);
const HOST = '0.0.0.0';
const GHOST_API_BASE = (process.env.GHOST_API_BASE || 'https://ghost.thesapientcompany.com').replace(/\/$/, '');
const GHOST_API_KEY = process.env.GHOST_API_KEY || '';
const GHOST_MODEL = process.env.GHOST_MODEL || 'ghost-x';
const INDEX_PATH = fileURLToPath(new URL('./index.html', import.meta.url));
const MAX_BODY_BYTES = 1024 * 1024;

function json(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }); }
}

async function handleChat(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Use POST to start a chat response.' });
  }

  let input;
  try { input = await readJson(req); }
  catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }

  if (!input || !Array.isArray(input.messages) || input.messages.length === 0) {
    return json(res, 400, { error: 'Add at least one message before sending.' });
  }
  const requestedMode = input.mode === undefined ? (GHOST_API_KEY ? 'api' : 'http') : input.mode;
  if (!['api', 'http'].includes(requestedMode)) {
    return json(res, 400, { error: 'Mode must be "api" or "http".' });
  }
  const productionMode = requestedMode === 'api';
  if (productionMode && !GHOST_API_KEY) {
    return json(res, 503, { error: 'API mode is unavailable; configure GHOST_API_KEY on the server.' });
  }

  const messages = input.messages.map(message => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') return null;
    return { role: message.role, content: message.content };
  });
  if (messages.some(message => !message)) {
    return json(res, 400, { error: 'Each message needs a valid role and text.' });
  }

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const upstreamUrl = productionMode
      ? `${GHOST_API_BASE}/v1/chat/completions`
      : `${GHOST_API_BASE}/v1/demo`;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    };
    if (productionMode) headers.Authorization = `Bearer ${GHOST_API_KEY}`;
    const payload = productionMode
      ? { model: GHOST_MODEL, stream: true, messages }
      : { ghostOnly: true, messages };

    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for (const name of [
      'x-ghost-tokens-in',
      'x-ghost-tokens-out',
      'x-ghost-tokens-charged',
      'x-ghost-tokens-remaining',
      'x-ghost-reset',
      'x-ghost-request-id',
      'x-ghost-free-messages-left',
    ]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }

    if (!upstream.body) return res.end();
    for await (const chunk of upstream.body) {
      if (res.destroyed) break;
      if (!res.write(Buffer.from(chunk))) {
        await new Promise(resolve => {
          res.once('drain', resolve);
          res.once('close', resolve);
        });
      }
    }
    if (!res.destroyed) res.end();
  } catch (error) {
    if (res.destroyed || error.name === 'AbortError') return;
    if (res.headersSent) return res.end();
    json(res, 502, { error: 'Could not reach the Ghost endpoint. Please try again.' });
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;

  if (pathname === '/api/config') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return json(res, 405, { error: 'Method not allowed.' });
    }
    return json(res, 200, {
      mode: GHOST_API_KEY ? 'api' : 'http',
      apiAvailable: Boolean(GHOST_API_KEY),
      model: GHOST_API_KEY ? GHOST_MODEL : null,
    });
  }
  if (pathname === '/api/chat') return handleChat(req, res);
  if (pathname === '/health') return json(res, 200, { ok: true });
  if (pathname === '/favicon.ico') {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return json(res, 405, { error: 'Method not allowed.' });
  }
  if (pathname !== '/' && pathname !== '/index.html') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  try {
    const html = await readFile(INDEX_PATH);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    res.end(html);
  } catch {
    json(res, 500, { error: 'Could not load the chat app.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Ghost chat app listening on http://${HOST}:${PORT}`);
});
