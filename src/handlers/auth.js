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
const { mayRequest } = require('../utils/permissions');
const { isAgentId } = require('../utils/agents');

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
/** More than attackers can reach in a window at the rate logins are allowed to run. */
const LOGIN_MAX_ENTRIES = 200000;
/** Checking a password is slow on purpose, so only so many run at once. */
const LOGIN_MAX_RUNNING = 16;

const PUBLIC_ROUTES = [
  /^GET \/api\/v1\/auth\/status$/,
  /^POST \/api\/v1\/auth\/(setup|login|logout)$/,
  /^(GET|POST) \/api\/v1\/auth\/links\/[^/]+$/,
];

const TOKEN_ROUTE = /^\/api\/v1\/tokens\/([^/]+)$/;
const TOKEN_DAYS = [30, 90, 365];
const CLAIM_ROUTE = /^\/api\/v1\/users\/([^/]+)\/claim-assignee$/;
const USER_ROUTE = /^\/api\/v1\/users\/([^/]+)$/;
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
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const secure = req.socket.encrypted || proto === 'https' ? '; Secure' : '';
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

/**
 * Failed sign-ins, kept in memory: a restart forgets them, and that is fine. An attempt counts
 * from when it starts, or a burst would all get through before the first one failed.
 */
function createLoginLimiter({ maxEntries = LOGIN_MAX_ENTRIES } = {}) {
  const attempts = new Map();

  function count(key) {
    const entry = attempts.get(key);
    if (!entry) return 0;
    if (entry.resetAt <= Date.now()) {
      attempts.delete(key);
      return 0;
    }
    return entry.count;
  }

  function bump(key) {
    if (count(key) > 0) {
      attempts.get(key).count += 1;
      return;
    }
    attempts.set(key, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
    // The oldest go first: a flood of new emails must not wipe the counts of a real target.
    if (attempts.size > maxEntries) attempts.delete(attempts.keys().next().value);
  }

  const keys = (address, email) => [`${address}|${email}`, `|${email}`];

  return {
    /** @returns {boolean} Whether this attempt may go ahead. It counts if it does. */
    attempt(address, email) {
      const [one, all] = keys(address, email);
      if (count(one) >= LOGIN_LIMIT_PER_ADDRESS || count(all) >= LOGIN_LIMIT_PER_EMAIL) return false;
      bump(one);
      bump(all);
      return true;
    },
    succeeded(address, email) {
      const [one, all] = keys(address, email);
      attempts.delete(one);
      const entry = attempts.get(all);
      if (entry && --entry.count <= 0) attempts.delete(all);
    },
    get size() { return attempts.size; },
  };
}

/**
 * @param {object} deps
 * @param {import('../services/store').Store} deps.store
 * @param {boolean} deps.required - False only from code, for the tests of what comes after this.
 * @param {string|null} [deps.setupCode] - Asked of whoever makes the first account.
 * @param {Function} [deps.onSetUp] - Called once the first account exists.
 * @param {boolean} [deps.trustProxy] - Take the client's address from X-Forwarded-For.
 */
function createAuth({ store: { accounts, assignees, renameAssignee }, required, setupCode = null, onSetUp = () => {}, trustProxy = false }) {
  const limiter = createLoginLimiter();
  let loginsRunning = 0;

  /** The closest address is the one the proxy added: the rest, the client could have sent. */
  function clientAddress(req) {
    const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').pop().trim() : '';
    return forwarded || (req.socket.remoteAddress ?? '');
  }

  /**
   * Work out who is asking, and stop the request if it needs someone and there is no one.
   *
   * @returns {boolean} true when the request may continue; false when a response was sent.
   */
  function admit(req, res) {
    if (!required) {
      req.user = { id: 'system', name: 'System', email: '', role: 'admin', active: true, unverified: true };
      return true;
    }
    const urlPath = req.url.split('?')[0];
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    if (bearer) return admitToken(req, res, bearer, urlPath);
    const token = sessionToken(req);
    const session = token ? accounts.sessionFor(token) : null;
    req.user = session?.user ?? null;
    if (session?.renewed) setSessionCookie(req, res, token);
    // A body can take minutes to arrive. What it asks for is judged by who they are by then.
    if (session) {
      req.stillAllowed = () => {
        const now = accounts.sessionFor(token)?.user;
        if (!now || !mayRequest(now, req.method, urlPath)) return false;
        req.user = now;
        return true;
      };
    }
    if (!urlPath.startsWith('/api/')) return true;
    if (PUBLIC_ROUTES.some((route) => route.test(`${req.method} ${urlPath}`))) return true;
    if (!req.user) {
      sendError(res, 401, 'UNAUTHENTICATED', 'Sign in to continue.');
      return false;
    }
    if (!mayRequest(req.user, req.method, urlPath)) {
      sendError(res, 403, 'FORBIDDEN', 'Your role does not allow this.');
      return false;
    }
    return true;
  }

  /** A token counts for the request alone. A wrong one does not fall back to a cookie. */
  function admitToken(req, res, bearer, urlPath) {
    req.user = accounts.identityForToken(bearer);
    if (!urlPath.startsWith('/api/')) return true;
    if (!req.user) {
      sendError(res, 401, 'UNAUTHENTICATED', 'That token is not valid. It may have expired or been revoked.');
      return false;
    }
    if (!mayRequest(req.user, req.method, urlPath)) {
      sendError(res, 403, 'FORBIDDEN', 'This token does not allow this.');
      return false;
    }
    req.stillAllowed = () => {
      const now = accounts.identityForToken(bearer);
      if (!now || !mayRequest(now, req.method, urlPath)) return false;
      req.user = now;
      return true;
    };
    return true;
  }

  async function readBody(req, res) {
    try {
      const body = await parseBody(req);
      return body && typeof body === 'object' ? body : {};
    } catch (err) {
      if (err.message === 'PAYLOAD_TOO_LARGE') sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
      else if (err.message === 'ACCESS_CHANGED') sendError(res, 403, 'FORBIDDEN', 'Your access changed while this was on its way.');
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
      return sendError(res, 403, 'SETUP_CODE_INVALID', 'That is not the setup code of this server.');
    }
    const invalid = invalidName(body.name) || invalidEmail(body.email) || invalidPassword(body.password);
    if (invalid) return sendError(res, 400, 'VALIDATION_ERROR', invalid);
    const user = await accounts.createFirstAdmin({ email: body.email, name: body.name.trim(), password: body.password });
    if (!user) return sendError(res, 409, 'ALREADY_SET_UP', 'This server already has an admin.');
    onSetUp();
    signIn(req, res, 201, user);
  }

  async function handleLogin(req, res) {
    const body = await readBody(req, res);
    if (!body) return;
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    // No account has these, and a long email would stay in memory as a key of the limiter.
    if (!email || email.length > EMAIL_MAX || password.length > PASSWORD_MAX) {
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Wrong email or password.');
    }
    const address = clientAddress(req);
    if (!limiter.attempt(address, email)) {
      res.setHeader('Retry-After', String(LOGIN_WINDOW_MS / 1000));
      return sendError(res, 429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Try again in 15 minutes.');
    }
    if (loginsRunning >= LOGIN_MAX_RUNNING) {
      res.setHeader('Retry-After', '5');
      return sendError(res, 503, 'BUSY', 'The server is busy. Try again in a moment.');
    }
    loginsRunning += 1;
    let session;
    try {
      session = await accounts.signIn(email, password);
    } finally {
      loginsRunning -= 1;
    }
    if (!session) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Wrong email or password.');
    limiter.succeeded(address, email);
    setSessionCookie(req, res, session.token);
    sendJSON(res, 200, { user: session.user });
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
    const result = await accounts.useLink(token, { name: link.kind === 'invite' ? body.name.trim() : undefined, password: body.password });
    if (result.error === 'LINK_INVALID') return sendError(res, 404, 'LINK_INVALID', 'This link is not valid any more.');
    if (result.error === 'EMAIL_TAKEN') return sendError(res, 409, 'EMAIL_TAKEN', 'There is already an account with this email.');
    if (result.error === 'NAME_TAKEN') return sendError(res, 409, 'NAME_TAKEN', 'Someone here already has that name. Add a surname or an initial.');
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
    const { token, ...invite } = accounts.createInvite({ email: body.email, role: body.role, createdBy: req.user.name, createdById: req.user.id });
    sendJSON(res, 201, { ...invite, path: `/invite/${token}` });
  }

  /** Names issues are assigned to from before accounts, which nobody answers to yet. */
  function unlinkedAssignees() {
    const known = new Set(accounts.listUsers().map((u) => u.name));
    return [...new Set(assignees())].filter((name) => !known.has(name) && !isAgentId(name)).sort();
  }

  async function handleClaimAssignee(req, res, userId) {
    const body = await readBody(req, res);
    if (!body) return;
    const user = accounts.getUser(userId);
    if (!user?.active) return sendError(res, 404, 'NOT_FOUND', 'There is no such active user.');
    if (typeof body.name !== 'string' || !unlinkedAssignees().includes(body.name)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'That is not an old assignee.');
    }
    sendJSON(res, 200, { moved: renameAssignee(body.name, user.name) });
  }

  async function handleCreateToken(req, res) {
    const body = await readBody(req, res);
    if (!body) return;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > NAME_MAX) return sendError(res, 400, 'VALIDATION_ERROR', `The name must have 1 to ${NAME_MAX} characters.`);
    if (!['full', 'read'].includes(body.access)) return sendError(res, 400, 'VALIDATION_ERROR', 'access must be full or read.');
    if (body.days !== null && !TOKEN_DAYS.includes(body.days)) return sendError(res, 400, 'VALIDATION_ERROR', `days must be null or one of: ${TOKEN_DAYS.join(', ')}.`);
    sendJSON(res, 201, accounts.createApiToken({ userId: req.user.id, name, access: body.access, days: body.days }));
  }

  async function handleUpdateUser(req, res, userId) {
    const body = await readBody(req, res);
    if (!body) return;
    if (body.role !== undefined && !ROLES.includes(body.role)) {
      return sendError(res, 400, 'VALIDATION_ERROR', `The role must be one of: ${ROLES.join(', ')}.`);
    }
    if (body.active !== undefined && typeof body.active !== 'boolean') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'active must be true or false.');
    }
    if (body.role === undefined && body.active === undefined) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Nothing to change.');
    }
    const result = accounts.updateUser(userId, { role: body.role, active: body.active });
    if (result.error === 'NOT_FOUND') return sendError(res, 404, 'NOT_FOUND', 'There is no such user.');
    if (result.error === 'LAST_ADMIN') return sendError(res, 409, 'LAST_ADMIN', 'This is the last admin. Make someone else admin first.');
    sendJSON(res, 200, result);
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
      sendJSON(res, 200, { needsSetup, user: req.user ?? null });
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

    if (urlPath === '/api/v1/tokens' && method === 'GET') {
      sendJSON(res, 200, accounts.listApiTokens(req.user.id));
      return true;
    }
    if (urlPath === '/api/v1/tokens' && method === 'POST') { await handleCreateToken(req, res); return true; }
    const apiToken = TOKEN_ROUTE.exec(urlPath);
    if (apiToken && method === 'DELETE') {
      if (accounts.deleteApiToken(apiToken[1], req.user.id)) sendJSON(res, 200, { deleted: true, id: apiToken[1] });
      else sendError(res, 404, 'NOT_FOUND', 'You have no such token.');
      return true;
    }

    if (urlPath === '/api/v1/assignees/unlinked' && method === 'GET') {
      if (requireAdmin(req, res)) sendJSON(res, 200, unlinkedAssignees());
      return true;
    }
    const claim = CLAIM_ROUTE.exec(urlPath);
    if (claim && method === 'POST') {
      if (requireAdmin(req, res)) await handleClaimAssignee(req, res, claim[1]);
      return true;
    }

    const user = USER_ROUTE.exec(urlPath);
    if (user && method === 'PATCH') {
      if (requireAdmin(req, res)) await handleUpdateUser(req, res, user[1]);
      return true;
    }

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
      const created = accounts.createResetLink({ userId: resetLink[1], createdBy: req.user.name, createdById: req.user.id });
      if (!created) return sendError(res, 404, 'NOT_FOUND', 'There is no such active user.'), true;
      sendJSON(res, 201, { expiresAt: created.expiresAt, path: `/reset/${created.token}` });
      return true;
    }

    return false;
  }

  return { admit, handle };
}

module.exports = { createAuth, createLoginLimiter };
