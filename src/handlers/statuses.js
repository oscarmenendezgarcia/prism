'use strict';

/**
 * PUT /api/v1/spaces/:spaceId/statuses: replace a space's statuses in one go.
 *
 * Body: { statuses: [{ id?, name, category }], moves?: { removedId: targetId } }
 * The order given is the order of the board. A status without id is new.
 */

const { CATEGORIES } = require('../constants');
const { sendJSON, sendError, parseBody, readActor } = require('../utils/http');
const taskRunner = require('../services/taskRunner');

const STATUS_NAME_MAX_LEN = 30;
const STATUSES_MAX_COUNT  = 12;

/**
 * @param {unknown} body
 * @param {Array<{ id: string }>} current - The space's statuses now.
 * @returns {string|null} What is wrong, or null.
 */
function validateStatuses(body, current) {
  const list = body?.statuses;
  if (!Array.isArray(list) || list.length === 0) return 'statuses must be a non-empty array';
  if (list.length > STATUSES_MAX_COUNT) return `A space can have up to ${STATUSES_MAX_COUNT} statuses`;

  const known = new Set(current.map((s) => s.id));
  const ids   = new Set();
  const names = new Set();
  for (const status of list) {
    if (!status || typeof status !== 'object') return 'Each status must be an object';
    const name = typeof status.name === 'string' ? status.name.trim() : '';
    if (name.length === 0) return 'Each status needs a name';
    if (name.length > STATUS_NAME_MAX_LEN) return `A status name must not exceed ${STATUS_NAME_MAX_LEN} characters`;
    if (names.has(name.toLowerCase())) return `There are two statuses called "${name}"`;
    names.add(name.toLowerCase());
    if (!CATEGORIES.includes(status.category)) return `category must be one of: ${CATEGORIES.join(', ')}`;
    if (status.id !== undefined) {
      if (!known.has(status.id)) return `Unknown status id: ${status.id}`;
      if (ids.has(status.id)) return `Status id appears twice: ${status.id}`;
      ids.add(status.id);
    }
  }
  for (const category of CATEGORIES) {
    if (!list.some((s) => s.category === category)) {
      return `A space needs at least one status in the category "${category}"`;
    }
  }
  return null;
}

async function handleUpdateStatuses(req, res, store, spaceId) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    if (err.message === 'PAYLOAD_TOO_LARGE') {
      return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 512 KB limit');
    }
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  const current = store.getStatuses(spaceId);
  const error = validateStatuses(body, current);
  if (error) return sendError(res, 400, 'VALIDATION_ERROR', error);

  const statuses = body.statuses.map((s) => ({ id: s.id, name: s.name.trim(), category: s.category }));
  const moves    = body.moves && typeof body.moves === 'object' ? body.moves : {};
  const kept     = new Map(statuses.filter((s) => s.id).map((s) => [s.id, s]));
  const removed  = current.filter((s) => !kept.has(s.id));

  for (const status of removed) {
    if (store.countTasksInStatus(spaceId, status.id) === 0) continue;
    if (!kept.has(moves[status.id])) {
      return sendError(res, 409, 'STATUS_IN_USE',
        `"${status.name}" still has issues. Say which status they move to.`, { statusId: status.id });
    }
  }

  // A running agent's card must not end up done, or nowhere, under it.
  const meaningChanges = removed.length > 0
    || current.some((s) => kept.has(s.id) && kept.get(s.id).category !== s.category);
  if (meaningChanges && taskRunner.spaceHasActiveRun(spaceId)) {
    return sendError(res, 409, 'SPACE_RUN_ACTIVE', 'Wait for the running tasks to finish before changing this.');
  }

  try {
    store.setStatuses(spaceId, statuses, moves, { actor: readActor(req) });
    return sendJSON(res, 200, store.getSpace(spaceId));
  } catch (err) {
    console.error(`PUT spaces/${spaceId}/statuses error:`, err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to save the statuses');
  }
}

module.exports = { handleUpdateStatuses };
