/**
 * Prism — people: accounts, sessions, and the links that invite someone or reset a password.
 *
 * Passwords are kept as scrypt hashes. Session tokens and links are long random values, so a
 * SHA-256 of them is enough: a copy of the database gives no way in.
 */

'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const ROLES = ['admin', 'member', 'viewer'];
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const RESET_DAYS = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A session used within this time is not written again: every request would be a write. */
const SESSION_TOUCH_MS = 60 * 60 * 1000;

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;

const ACCOUNTS_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    last_seen_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    used_at    TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS account_links (
    id         TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    kind       TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
    email      TEXT NOT NULL,
    role       TEXT,
    user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL,
    created_by_id TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const inDays = (days) => new Date(Date.now() + days * DAY_MS).toISOString();

/** @param {string} password */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/**
 * @param {string} password
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(actual, expected);
}

/** Checked against when the email is unknown, so that the answer takes as long either way. */
const NOBODY_HASH = hashPassword(newToken());

const normalizeEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

const publicUser = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  active: row.active === 1,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
});

/**
 * @param {import('better-sqlite3').Database} db
 */
function createAccounts(db) {
  const stmts = {
    countUsers:   db.prepare('SELECT COUNT(*) AS n FROM users'),
    listUsers:    db.prepare('SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE'),
    getUser:      db.prepare('SELECT * FROM users WHERE id = ?'),
    getByEmail:   db.prepare('SELECT * FROM users WHERE email = ?'),
    insertUser:   db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
    setPassword:  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    setRole:      db.prepare('UPDATE users SET role = ? WHERE id = ?'),
    setActive:    db.prepare('UPDATE users SET active = ? WHERE id = ?'),
    countAdmins:  db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`),
    dropUserLinks: db.prepare('DELETE FROM account_links WHERE user_id = ?'),
    dropLinksMadeBy: db.prepare('DELETE FROM account_links WHERE created_by_id = ?'),
    listNames:    db.prepare('SELECT name FROM users'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, used_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    findSession:  db.prepare(`
      SELECT s.used_at, s.expires_at, u.*
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`),
    touchSession: db.prepare('UPDATE sessions SET used_at = ?, expires_at = ? WHERE token_hash = ?'),
    touchUser:    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?'),
    dropSession:  db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    dropSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    dropExpired:  db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    insertLink:   db.prepare(`
      INSERT INTO account_links (id, token_hash, kind, email, role, user_id, created_by, created_by_id, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    findLink:     db.prepare('SELECT * FROM account_links WHERE token_hash = ?'),
    listInvites:  db.prepare(`SELECT * FROM account_links WHERE kind = 'invite' AND expires_at > ? ORDER BY created_at DESC`),
    dropLink:     db.prepare('DELETE FROM account_links WHERE id = ?'),
    dropInvite:   db.prepare(`DELETE FROM account_links WHERE id = ? AND kind = 'invite'`),
    dropLinksFor: db.prepare('DELETE FROM account_links WHERE kind = ? AND email = ?'),
  };

  const hasUsers = () => stmts.countUsers.get().n > 0;

  function insertUser({ email, name, passwordHash, role }) {
    const id = crypto.randomUUID();
    stmts.insertUser.run(id, email, name, passwordHash, role, new Date().toISOString());
    return stmts.getUser.get(id);
  }

  /** @returns {object|null} The new admin, or null if someone got there first. */
  async function createFirstAdmin({ email, name, password }) {
    const passwordHash = await hashPassword(password);
    return db.transaction(() => {
      if (hasUsers()) return null;
      return publicUser(insertUser({ email: normalizeEmail(email), name, passwordHash, role: 'admin' }));
    })();
  }

  /**
   * Sign in. The account is read again after the slow part, in one go with making the session,
   * so that a reset or a deactivation in between is not outlived by a session.
   *
   * @returns {Promise<{ user: object, token: string }|null>} Null if these are not right.
   */
  async function signIn(email, password) {
    const normalized = normalizeEmail(email);
    const row = stmts.getByEmail.get(normalized);
    const matches = await verifyPassword(password, row?.password_hash ?? await NOBODY_HASH);
    if (!row || !matches) return null;
    const current = stmts.getByEmail.get(normalized);
    if (current?.id !== row.id || current.password_hash !== row.password_hash || current.active !== 1) return null;
    return { user: publicUser(current), token: createSession(current.id).token };
  }

  /** @returns {{ token: string, expiresAt: string }} */
  function createSession(userId) {
    const now = new Date().toISOString();
    stmts.dropExpired.run(now);
    const token = newToken();
    const expiresAt = inDays(SESSION_DAYS);
    stmts.insertSession.run(hashToken(token), userId, now, now, expiresAt);
    stmts.touchUser.run(now, userId);
    return { token, expiresAt };
  }

  /** @returns {{ user: object, renewed: boolean }|null} Who holds this session. One in use is renewed. */
  function sessionFor(token) {
    const tokenHash = hashToken(token);
    const row = stmts.findSession.get(tokenHash);
    if (!row || row.active !== 1) return null;
    const now = Date.now();
    if (Date.parse(row.expires_at) <= now) {
      stmts.dropSession.run(tokenHash);
      return null;
    }
    const renewed = now - Date.parse(row.used_at) > SESSION_TOUCH_MS;
    if (renewed) {
      const iso = new Date(now).toISOString();
      stmts.touchSession.run(iso, inDays(SESSION_DAYS), tokenHash);
      stmts.touchUser.run(iso, row.id);
    }
    return { user: publicUser(row), renewed };
  }

  const endSession = (token) => stmts.dropSession.run(hashToken(token));

  function createLink(kind, { email, role = null, userId = null, createdBy, createdById = null, days }) {
    const token = newToken();
    const id = crypto.randomUUID();
    const expiresAt = inDays(days);
    stmts.dropLinksFor.run(kind, email);
    stmts.insertLink.run(id, hashToken(token), kind, email, role, userId, createdBy, createdById, new Date().toISOString(), expiresAt);
    return { id, token, email, role, expiresAt };
  }

  /** A new invite takes the place of an earlier one for the same email. */
  function createInvite({ email, role, createdBy, createdById }) {
    return createLink('invite', { email: normalizeEmail(email), role, createdBy, createdById, days: INVITE_DAYS });
  }

  /** @returns {object|null} The link, or null if there is no such active user. */
  function createResetLink({ userId, createdBy, createdById }) {
    const user = stmts.getUser.get(userId);
    if (!user || user.active !== 1) return null;
    return createLink('reset', { email: user.email, userId, createdBy, createdById, days: RESET_DAYS });
  }

  function validLink(token) {
    const link = stmts.findLink.get(hashToken(token));
    if (!link || Date.parse(link.expires_at) <= Date.now()) return null;
    if (link.kind === 'reset' && stmts.getUser.get(link.user_id)?.active !== 1) return null;
    return link;
  }

  /** What the page of a link needs to show. */
  function describeLink(token) {
    const link = validLink(token);
    return link && { kind: link.kind, email: link.email, role: link.role, createdBy: link.created_by };
  }

  /**
   * Use a link: an invite makes the account, a reset changes the password and ends every session.
   * A link works once, even if two requests race for it.
   *
   * @returns {Promise<object|{ error: string }>} The user.
   */
  async function useLink(token, { name, password }) {
    const passwordHash = await hashPassword(password);
    return db.transaction(() => {
      const link = validLink(token);
      if (!link) return { error: 'LINK_INVALID' };
      if (link.kind === 'reset') {
        stmts.dropLink.run(link.id);
        stmts.setPassword.run(passwordHash, link.user_id);
        stmts.dropSessions.run(link.user_id);
        return publicUser(stmts.getUser.get(link.user_id));
      }
      if (stmts.getByEmail.get(link.email)) return { error: 'EMAIL_TAKEN' };
      // Everything is signed by name, so two people cannot share one.
      if (stmts.listNames.all().some((u) => u.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return { error: 'NAME_TAKEN' };
      stmts.dropLink.run(link.id);
      return publicUser(insertUser({ email: link.email, name, passwordHash, role: link.role }));
    })();
  }

  /**
   * Change a role or turn an account off. Turning it off ends its sessions and links, so that
   * turning it back on does not revive them. Whoever stops being an active admin also loses the
   * links they made, or they could use one to come back. There is always an active admin left.
   *
   * @returns {object|{ error: string }} The user.
   */
  function updateUser(id, { role, active }) {
    return db.transaction(() => {
      const user = stmts.getUser.get(id);
      if (!user) return { error: 'NOT_FOUND' };
      const wasActiveAdmin = user.role === 'admin' && user.active === 1;
      const staysActiveAdmin = (role ?? user.role) === 'admin' && (active ?? user.active === 1);
      if (wasActiveAdmin && !staysActiveAdmin && stmts.countAdmins.get().n === 1) return { error: 'LAST_ADMIN' };
      if (role !== undefined) stmts.setRole.run(role, id);
      if (active !== undefined) stmts.setActive.run(active ? 1 : 0, id);
      if (active === false) {
        stmts.dropSessions.run(id);
        stmts.dropUserLinks.run(id);
      }
      if (wasActiveAdmin && !staysActiveAdmin) stmts.dropLinksMadeBy.run(id);
      return publicUser(stmts.getUser.get(id));
    })();
  }

  return {
    hasUsers,
    updateUser,
    createFirstAdmin,
    signIn,
    createSession,
    sessionFor,
    endSession,
    createInvite,
    createResetLink,
    describeLink,
    useLink,
    listUsers: () => stmts.listUsers.all().map(publicUser),
    getUser: (id) => { const row = stmts.getUser.get(id); return row ? publicUser(row) : null; },
    getUserByEmail: (email) => { const row = stmts.getByEmail.get(normalizeEmail(email)); return row ? publicUser(row) : null; },
    listInvites: () => stmts.listInvites.all(new Date().toISOString()).map((l) => ({
      id: l.id, email: l.email, role: l.role, createdBy: l.created_by, createdAt: l.created_at, expiresAt: l.expires_at,
    })),
    deleteInvite: (id) => stmts.dropInvite.run(id).changes > 0,
  };
}

module.exports = { ACCOUNTS_SQL, ROLES, createAccounts, normalizeEmail };
