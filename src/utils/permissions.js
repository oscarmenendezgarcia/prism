/**
 * Prism — what each role may do, for every route, in one place.
 *
 * What is not listed is decided by the method: anyone signed in can read, and only an admin
 * can change. So a new route that writes is closed until someone opens it here.
 */

'use strict';

const RANK = { viewer: 0, member: 1, admin: 2 };

const TASKS = '/api/v1(?:/spaces/[^/]+)?/tasks';
const ISSUE = `${TASKS}/[^/]+`;

/** [methods, path, the least role that may]. The first that matches decides. */
const RULES = [
  ['GET',            /^\/api\/v1\/runs\/[^/]+\/(diff|log)$/, 'member'],
  ['DELETE',         new RegExp(`^${TASKS}$`), 'admin'],
  ['POST',           new RegExp(`^${TASKS}$`), 'member'],
  ['PATCH',          new RegExp(`^${TASKS}/rank$`), 'member'],
  ['PUT DELETE',     new RegExp(`^${ISSUE}$`), 'member'],
  ['PUT',            new RegExp(`^${ISSUE}/move$`), 'member'],
  ['PATCH',          new RegExp(`^${ISSUE}/rank$`), 'member'],
  ['PUT PATCH',      new RegExp(`^${ISSUE}/attachments$`), 'member'],
  ['POST',           new RegExp(`^${ISSUE}/comments$`), 'member'],
  ['PATCH',          new RegExp(`^${ISSUE}/comments/[^/]+$`), 'member'],
  ['POST',           new RegExp(`^${ISSUE}/(run|request-changes|close|pr)$`), 'member'],
  ['POST',           /^\/api\/v1\/runs\/[^/]+\/(stop|resume)$/, 'member'],
];

/**
 * @param {string} method
 * @param {string} urlPath
 * @returns {'viewer'|'member'|'admin'}
 */
function leastRole(method, urlPath) {
  for (const [methods, path, role] of RULES) {
    if (methods.split(' ').includes(method) && path.test(urlPath)) return role;
  }
  return method === 'GET' || method === 'HEAD' ? 'viewer' : 'admin';
}

/**
 * @param {{ role: string }} user
 * @param {string} method
 * @param {string} urlPath
 * @returns {boolean}
 */
function mayRequest(user, method, urlPath) {
  return RANK[user.role] >= RANK[leastRole(method, urlPath)];
}

module.exports = { leastRole, mayRequest };
