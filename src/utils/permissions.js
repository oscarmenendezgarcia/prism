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
  ['POST',           /^\/api\/v1\/tokens$/, 'viewer'],
  ['DELETE',         /^\/api\/v1\/tokens\/[^/]+$/, 'viewer'],
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
 * What an agent may do with the token of its run: read the space it works in, and comment on
 * and update its own issue. Nothing about accounts, other spaces or the server.
 *
 * @param {{ spaceId: string, taskId: string, taskKey: string|null }} run
 * @param {string} method
 * @param {string} urlPath
 * @returns {boolean}
 */
function runMayRequest(run, method, urlPath) {
  // The legacy routes are the default space, except a search, which covers them all.
  if (urlPath === '/api/v1/tasks/search') return false;
  const path = urlPath.replace(/^\/api\/v1\/tasks(?=\/|$)/, '/api/v1/spaces/default/tasks');
  const space = `/api/v1/spaces/${run.spaceId}`;
  const own = [run.taskId, run.taskKey].filter(Boolean).some((ref) => path === `${space}/tasks/${ref}` || path.startsWith(`${space}/tasks/${ref}/`));

  if (method === 'GET') {
    return path === '/api/v1/spaces' || path === space || path === `${space}/board` || path === `${space}/tasks` || path.startsWith(`${space}/tasks/`);
  }
  if (!own) return false;
  const rest = path.slice(path.indexOf('/tasks/') + '/tasks/'.length).split('/').slice(1).join('/');
  if (method === 'PUT') return rest === '';
  if (method === 'POST') return rest === 'comments';
  if (method === 'PATCH') return rest === 'attachments' || /^comments\/[^/]+$/.test(rest);
  return false;
}

/** With a token, nothing that gives more access: only someone signed in manages accounts. */
const ACCOUNT_ROUTES = /^\/api\/v1\/(tokens|invites|assignees|users\/)/;

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
  if (user.run) return runMayRequest(user.run, method, urlPath);
  if (user.viaToken && ACCOUNT_ROUTES.test(urlPath)) return false;
  return RANK[user.role] >= RANK[leastRole(method, urlPath)];
}

module.exports = { leastRole, mayRequest, runMayRequest };
