/**
 * Prism — who may talk to this server.
 *
 * By default Prism listens on loopback and needs no token, but a loopback server is
 * still reachable from any web page in the user's browser. So requests must carry a
 * loopback Host (blocks DNS rebinding) and a same-site Origin (blocks cross-site
 * requests). The terminal WebSocket is a shell, so this matters.
 *
 * Listening on anything else requires a token: PRISM_TOKEN, or one generated once and
 * kept in <dataDir>/auth-token. Clients send it as `Authorization: Bearer <token>`.
 * Browsers open `/?token=<token>` once and keep it in an HttpOnly cookie.
 *
 * Environment variables:
 *   PRISM_HOST      - Address to listen on (default: 127.0.0.1)
 *   PRISM_TOKEN     - Access token (default: none on loopback, generated otherwise)
 *   ALLOWED_ORIGINS - Extra allowed Origins, comma-separated
 *   ALLOWED_HOSTS   - Extra allowed Host names on loopback, comma-separated
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const DEFAULT_HOST   = '127.0.0.1';
const COOKIE_PREFIX  = 'prism_token';
const TOKEN_FILE     = 'auth-token';
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Dev server origins, plus the default port's own. */
const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'];

const splitList = (value) => (value || '').split(',').map((item) => item.trim()).filter(Boolean);

/**
 * @param {string} host
 * @returns {boolean}
 */
function isLoopback(host) {
  return LOOPBACK_NAMES.has(host) || /^127(\.\d{1,3}){3}$/.test(host);
}

/**
 * Read the generated token, creating it on first use. Only the owner can read it.
 *
 * @param {string} dataDir
 * @returns {string}
 */
function loadOrCreateToken(dataDir) {
  const file = path.join(dataDir, TOKEN_FILE);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

/**
 * Decide the listen address and token for this server.
 *
 * @param {object} options
 * @param {string} [options.host]    - Overrides PRISM_HOST.
 * @param {string} options.dataDir
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{ host: string, token: string|null, generated: boolean }}
 */
function resolveAccess({ host, dataDir, env = process.env }) {
  const listenHost = host || env.PRISM_HOST || DEFAULT_HOST;
  if (env.PRISM_TOKEN) return { host: listenHost, token: env.PRISM_TOKEN, generated: false };
  if (isLoopback(listenHost)) return { host: listenHost, token: null, generated: false };
  return { host: listenHost, token: loadOrCreateToken(dataDir), generated: true };
}

function tokensMatch(a, b) {
  const hash = (value) => crypto.createHash('sha256').update(value).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

/** Cookies ignore the port, so instances on one machine need different names. */
function cookieName(req) {
  const port = /:(\d+)$/.exec(req.headers.host || '');
  return `${COOKIE_PREFIX}_${port ? port[1] : 'default'}`;
}

function tokenFromCookie(req) {
  const wanted = cookieName(req);
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== wanted) continue;
    try {
      return decodeURIComponent(rest.join('='));
    } catch {
      return null;
    }
  }
  return null;
}

function tokenFromHeader(req) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  return match ? match[1] : null;
}

/**
 * Whether a browser Origin may reach this server: the explicit allowlist, or
 * same-origin (Origin host equals the request's Host header).
 *
 * @param {string} origin
 * @param {import('http').IncomingMessage} req
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isAllowedOrigin(origin, req, env = process.env) {
  if (!origin) return false;
  const allowed = env.ALLOWED_ORIGINS ? splitList(env.ALLOWED_ORIGINS) : DEFAULT_ORIGINS;
  if (allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Without a token, a loopback server trusts its callers, so the Host header has to
 * name this machine. Otherwise a page on evil.example that re-resolves to 127.0.0.1
 * would count as same-origin.
 */
function isAllowedHost(req, env = process.env) {
  const header = req.headers.host || '';
  const name   = header.replace(/:\d+$/, '').toLowerCase();
  return isLoopback(name) || splitList(env.ALLOWED_HOSTS).map((h) => h.toLowerCase()).includes(name);
}

/**
 * @param {{ token: string|null }} access
 * @param {import('http').IncomingMessage} req
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {null|{ status: number, code: string, message: string }} Why it is refused.
 */
function refusal(access, req, env = process.env) {
  if (access.token) {
    const presented = tokenFromHeader(req) || tokenFromCookie(req);
    if (!presented || !tokensMatch(presented, access.token)) {
      return { status: 401, code: 'UNAUTHORIZED', message: 'A valid access token is required.' };
    }
  } else if (!isAllowedHost(req, env)) {
    return { status: 403, code: 'FORBIDDEN_HOST', message: `Host '${req.headers.host}' is not allowed. Add it to ALLOWED_HOSTS.` };
  }

  // Browsers send Origin on cross-site requests. Clients like the MCP server do not.
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin, req, env)) {
    return { status: 403, code: 'FORBIDDEN_ORIGIN', message: `Origin '${origin}' is not allowed. Add it to ALLOWED_ORIGINS.` };
  }
  return null;
}

/**
 * Exchange `?token=` for the cookie and redirect to the same URL without it, so the
 * token does not stay in the address bar or the history. SameSite=Lax rather than
 * Strict, or arriving from a link in another app would 401 after this redirect.
 * Cross-site writes are stopped by the Origin check.
 *
 * @returns {boolean} Whether the response was sent.
 */
function handleTokenLogin(access, req, res) {
  if (!access.token || req.method !== 'GET') return false;
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return false; // Malformed target: the token check refuses it.
  }
  const token = url.searchParams.get('token');
  if (!token || !tokensMatch(token, access.token)) return false;

  url.searchParams.delete('token');
  res.writeHead(302, {
    'Set-Cookie': `${cookieName(req)}=${encodeURIComponent(access.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`,
    Location:     url.pathname + url.search,
  });
  res.end();
  return true;
}

/**
 * Gate an HTTP request.
 *
 * @returns {boolean} true when the request may continue; false when a response was sent.
 */
function allowRequest(access, req, res) {
  if (handleTokenLogin(access, req, res)) return false;

  const refused = refusal(access, req);
  if (!refused) return true;

  const payload = JSON.stringify({ error: { code: refused.code, message: refused.message } });
  res.writeHead(refused.status, {
    'Content-Type':   'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
  return false;
}

/**
 * Gate a WebSocket upgrade. Browsers always send Origin on these, so a missing one
 * is refused too.
 *
 * @returns {boolean}
 */
function allowUpgrade(access, req) {
  return Boolean(req.headers.origin) && !refusal(access, req);
}

module.exports = { resolveAccess, allowRequest, allowUpgrade, isAllowedOrigin, isLoopback };
