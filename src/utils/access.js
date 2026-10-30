/**
 * Prism — which requests may reach this server at all, before asking who is making them.
 *
 * A server on loopback is still reachable from any web page in the user's browser. So its
 * requests must carry a loopback Host (blocks DNS rebinding, which matters most before the
 * first account exists), and all requests a same-site Origin (blocks cross-site requests).
 *
 * Environment variables:
 *   PRISM_HOST      - Address to listen on (default: 127.0.0.1)
 *   ALLOWED_ORIGINS - Extra allowed Origins, comma-separated
 *   ALLOWED_HOSTS   - Extra allowed Host names on loopback, comma-separated
 */

'use strict';

const DEFAULT_HOST   = '127.0.0.1';
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
 * Decide the listen address for this server.
 *
 * @param {object} options
 * @param {string} [options.host]    - Overrides PRISM_HOST.
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{ host: string, loopback: boolean }}
 */
function resolveAccess({ host, env = process.env }) {
  const listenHost = host || env.PRISM_HOST || DEFAULT_HOST;
  return { host: listenHost, loopback: isLoopback(listenHost) };
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
 * The Host header of a loopback server has to name this machine. Otherwise a page on
 * evil.example that re-resolves to 127.0.0.1 would count as same-origin.
 */
function isAllowedHost(req, env = process.env) {
  const header = req.headers.host || '';
  const name   = header.replace(/:\d+$/, '').toLowerCase();
  return isLoopback(name) || splitList(env.ALLOWED_HOSTS).map((h) => h.toLowerCase()).includes(name);
}

/**
 * @param {{ loopback: boolean }} access
 * @param {import('http').IncomingMessage} req
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {null|{ status: number, code: string, message: string }} Why it is refused.
 */
function refusal(access, req, env = process.env) {
  if (access.loopback && !isAllowedHost(req, env)) {
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
 * Gate an HTTP request.
 *
 * @returns {boolean} true when the request may continue; false when a response was sent.
 */
function allowRequest(access, req, res) {
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

module.exports = { resolveAccess, allowRequest, isAllowedOrigin, isLoopback };
