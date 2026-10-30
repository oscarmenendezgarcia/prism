/**
 * Prism — who is making a request, and the routes of accounts.
 *
 * Every /api/ route needs a signed-in person, except the few that get someone signed in.
 * The frontend itself is public: it holds no data, and it has to show the sign-in page.
 */

'use strict';

const crypto = require('crypto');
const { sendJSON, sendError, parseBody } = require('../utils/http');
const { ROLES, normalizeEmail } = require('../services/accounts');

const COOKIE_PREFIX = 'prism_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

const NAME_MAX = 50;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Failures from one address for one email, and for one email from anywhere. */
const LOGIN_LIMIT_PER_ADDRESS = 10;
const LOGIN_LIMIT_PER_EMAIL = 50;

const PUBLIC_ROUTES = [
  /^GET \/api\/v1\/auth\/status$/,
  /^POST \/api\/v1\/auth\/(setup|login|logout)$/,
  /^(GET|POST) \/api\/v1\/auth\/links\/[^/]+$/,
];

const INVITE_ROUTE = /^\/api\/v1\/invites\/([^/]+)$/;
const RESET_LINK_ROUTE = /^\/api\/v1\/users\/([^/]+)\/reset-link$/;
const LINK_ROUTE = /^\/api\/v1\/auth\/links\/([^/]+)$/;

/** Cookies ignore the port, so instances on one machine need different names. */
function cookieName(req) {
  const port = /:(\d+)$/.exec(req.headers.host || '');
  return `${COOKIE_PREFIX}_${port ? port[1] : 'default'}`;
}

function sessionToken(req) {
  const wanted = cookieName(req);
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === wanted) return rest.join('=');
  }
  return null;
}

function setSessionCookie(req, res, token) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  // Lax rather than Strict, or arriving from a link in another app would look signed out.
  // Cross-site writes are stopped by the Origin check.
  res.setHeader('Set-Cookie', `${cookieName(req)}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}${secure}`);
}

function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie', `${cookieName(req)}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/** @returns {string|null} What is wrong with these, if anything. */
function invalidEmail(email) {
  const clean = normalizeEmail(email);
  return clean.length <= EMAIL_MAX && /^[^\s@]+@[^\s@]+$/.test(clean) ? null : 'Enter a valid email.';
}

function invalidName(name) {
  const clean = typeof name === 'string' ? name.trim() : '';
  return clean && clean.length <= NAME_MAX ? null : `The name must have 1 to ${NAME_MAX} characters.`;
}

function invalidPassword(password) {
  return typeof password === 'string' && password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX
    ? null
    : `The password must have ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`;
}

function sameSecret(a, b) {
  const hash = (value) => crypto.createHash('sha256').update(String(value)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

/** Failed sign-ins, kept in memory: a restart forgets them, and that is fine. */
function createLoginLimiter() {
  const failures = new Map();

  function count(key) {
    const entry = failures.get(key);
    if (!entry) return 0;
    if (entry.resetAt <= Date.now()) {
      failures.delete(key);
      return 0;
    }
    return entry.count;
  }

  function bump(key) {
    const entry = failures.get(key);
    if (entry && entry.resetAt > Date.now()) entry.count += 1;
    else failures.set(key, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
  }

  const keys = (address, email) => [`${address}|${email}`, `|${email}`];

  return {
    blocked(address, email) {
      const [one, all] = keys(address, email);
      return count(one) >= LOGIN_LIMIT_PER_ADDRESS || count(all) >= LOGIN_LIMIT_PER_EMAIL;
    },
    failed(address, email) {
      if (failures.size > 10000) failures.clear();
      keys(address, email).forEach(bump);
    },
    succeeded(address, email) {
      failures.delete(keys(address, email)[0]);
    },
  };
}

/**
 * @param {object} deps
 * @param {ReturnType<import('../services/accounts').createAccounts>} deps.accounts
 * @param {boolean} deps.required - False only from code, for the tests of what comes after this.
 * @param {string|null} [deps.setupCode] - Asked of whoever makes the first account, if set.
 */
function createAuth({ accounts, required, setupCode = null }) {
  const limiter = createLoginLimiter();

  /**
   * Work out who is asking, and stop the request if it needs someone and there is no one.
   *
   * @returns {boolean} true when the request may continue; false when a response was sent.
   */
  function admit(req, res) {
    if (!required) {
      req.user = { id: 'system', name: 'System', email: '', role: 'admin', active: true };
      return true;
    }
    const token = sessionToken(req);
    req.user = token ? accounts.userForSession(token) : null;
    const urlPath = req.url.split('?')[0];
    if (req.user || !urlPath.startsWith('/api/')) return true;
    if (PUBLIC_ROUTES.some((route) => route.test(`${req.method} ${urlPath}`))) return true;
    sendError(res, 401, 'UNAUTHENTICATED', 'Sign in to continue.');
    return false;
  }

  async function readBody(req, res) {
    try {
      const body = await parseBody(req);
      return body && typeof body === 'object' ? body : {};
    } catch (err) {
      if (err.message === 'PAYLOAD_TOO_LARGE') sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
      else sendError(res, 400, 'INVALID_JSON', 'The request is not valid JSON.');
      return null;
    }
  }

  function signIn(req, res, status, user) {
    const { token } = accounts.createSession(user.id);
    setSessionCookie(req, res, token);
    sendJSON(res, status, { user });
  }

  function requireAdmin(req, res) {
    if (req.user?.role === 'admin') return true;
    sendError(res, 403, 'FORBIDDEN', 'Only an admin can do this.');
    return false;
  }

  async function handleSetup(req, res) {
    const body = await readBody(req, res);
    if (!body) return;
    if (accounts.hasUsers()) return sendError(res, 409, 'ALREADY_SET_UP', 'This server already has an admin.');
    if (setupCode && !sameSecret(body.setupCode ?? '', setupCode)) {
      return sendError(res, 403, 'SETUP_CODE_INVALID', 'That is not the setup code in the server log.');
    }
    const invalid = invalidName(body.name) || invalidEmail(body.email) || invalidPassword(body.password);
    if (invalid) return sendError(res, 400, 'VALIDATION_ERROR', invalid);
    const user = await accounts.createFirstAdmin({ email: body.email, name: body.name.trim(), password: body.password });
    if (!user) return sendError(res, 409, 'ALREADY_SET_UP', 'This server already has an admin.');
    signIn(req, res, 201, user);
  }

  async function handleLogin(req, res) {
    const body = await readBody(req, res);
    if (!body) return;
    const email = normalizeEmail(body.email);
    const address = req.socket.remoteAddress ?? '';
    if (limiter.blocked(address, email)) {
      res.setHeader('Retry-After', String(LOGIN_WINDOW_MS / 1000));
      return sendError(res, 429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Try again in 15 minutes.');
    }
    const password = typeof body.password === 'string' ? body.password.slice(0, PASSWORD_MAX) : '';
    const user = await accounts.checkPassword(email, password);
    if (!user) {
      limiter.failed(address, email);
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Wrong email or password.');
    }
    limiter.succeeded(address, email);
    signIn(req, res, 200, user);
  }

  function handleLogout(req, res) {
    const token = sessionToken(req);
    if (token) accounts.endSession(token);
    clearSessionCookie(req, res);
    sendJSON(res, 200, { ok: true });
  }

  async function handleUseLink(req, res, token) {
    const body = await readBody(req, res);
    if (!body) return;
    const link = accounts.describeLink(token);
    if (!link) return sendError(res, 404, 'LINK_INVALID', 'This link is not valid any more.');
    const invalid = (link.kind === 'invite' && invalidName(body.name)) || invalidPassword(body.password);
    if (invalid) return sendError(res, 400, 'VALIDATION_ERROR', invalid);
    const result = await accounts.useLink(token, { name: body.name?.trim(), password: body.password });
    if (result.error === 'LINK_INVALID') return sendError(res, 404, 'LINK_INVALID', 'This link is not valid any more.');
    if (result.error === 'EMAIL_TAKEN') return sendError(res, 409, 'EMAIL_TAKEN', 'There is already an account with this email.');
    signIn(req, res, 200, result);
  }

  async function handleCreateInvite(req, res) {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req, res);
    if (!body) return;
    const invalid = invalidEmail(body.email);
    if (invalid) return sendError(res, 400, 'VALIDATION_ERROR', invalid);
    if (!ROLES.includes(body.role)) return sendError(res, 400, 'VALIDATION_ERROR', `The role must be one of: ${ROLES.join(', ')}.`);
    if (accounts.getUserByEmail(body.email)) return sendError(res, 409, 'EMAIL_TAKEN', 'There is already an account with this email.');
    const { token, ...invite } = accounts.createInvite({ email: body.email, role: body.role, createdBy: req.user.name });
    sendJSON(res, 201, { ...invite, path: `/invite/${token}` });
  }

  /**
   * @returns {Promise<boolean>} Whether this was a route of accounts.
   */
  async function handle(req, res) {
    const { method } = req;
    const urlPath = req.url.split('?')[0];
    if (!urlPath.startsWith('/api/v1/')) return false;

    if (urlPath === '/api/v1/auth/status' && method === 'GET') {
      const needsSetup = required && !accounts.hasUsers();
      sendJSON(res, 200, { needsSetup, setupCodeRequired: needsSetup && !!setupCode, user: req.user ?? null });
      return true;
    }
    if (urlPath === '/api/v1/auth/setup' && method === 'POST') { await handleSetup(req, res); return true; }
    if (urlPath === '/api/v1/auth/login' && method === 'POST') { await handleLogin(req, res); return true; }
    if (urlPath === '/api/v1/auth/logout' && method === 'POST') { handleLogout(req, res); return true; }

    const link = LINK_ROUTE.exec(urlPath);
    if (link && method === 'GET') {
      const found = accounts.describeLink(link[1]);
      if (found) sendJSON(res, 200, found);
      else sendError(res, 404, 'LINK_INVALID', 'This link is not valid any more.');
      return true;
    }
    if (link && method === 'POST') { await handleUseLink(req, res, link[1]); return true; }

    if (urlPath === '/api/v1/users' && method === 'GET') {
      sendJSON(res, 200, accounts.listUsers());
      return true;
    }

    if (urlPath === '/api/v1/invites' && method === 'GET') {
      if (requireAdmin(req, res)) sendJSON(res, 200, accounts.listInvites());
      return true;
    }
    if (urlPath === '/api/v1/invites' && method === 'POST') { await handleCreateInvite(req, res); return true; }

    const invite = INVITE_ROUTE.exec(urlPath);
    if (invite && method === 'DELETE') {
      if (!requireAdmin(req, res)) return true;
      if (accounts.deleteInvite(invite[1])) sendJSON(res, 200, { deleted: true, id: invite[1] });
      else sendError(res, 404, 'NOT_FOUND', 'There is no such invite.');
      return true;
    }

    const resetLink = RESET_LINK_ROUTE.exec(urlPath);
    if (resetLink && method === 'POST') {
      if (!requireAdmin(req, res)) return true;
      const created = accounts.createResetLink({ userId: resetLink[1], createdBy: req.user.name });
      if (!created) return sendError(res, 404, 'NOT_FOUND', 'There is no such active user.'), true;
      sendJSON(res, 201, { expiresAt: created.expiresAt, path: `/reset/${created.token}` });
      return true;
    }

    return false;
  }

  return { admit, handle };
}

module.exports = { createAuth };
