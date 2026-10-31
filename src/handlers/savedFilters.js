'use strict';

/**
 * /api/v1/spaces/:spaceId/filters: filters people keep, for themselves or for the team.
 *
 * Anyone can keep their own. A filter of the team needs a member. Whoever made it changes it,
 * and an admin can rename or delete it. Filters of others that are not shared do not exist for anyone else,
 * admins included.
 */

const { sendJSON, sendError, parseBody } = require('../utils/http');
const { validSavedFilters } = require('../utils/issueFilters');

const NAME_MAX_LEN = 80;
const MAX_PER_PERSON = 100;

const isAdmin = (user) => user.role === 'admin';
const mayShare = (user) => user.role !== 'viewer';

/**
 * Whether someone may change it. Whoever made a filter of the team and can no longer share
 * loses it to the admins, or they could point what everyone sees wherever they like.
 */
function mayChange(user, saved) {
  const mine = saved.ownerId === user.id;
  return (mine && (!saved.shared || mayShare(user))) || (saved.shared && isAdmin(user));
}

/** What the person asking sees of a saved filter. */
function asSeenBy(user, saved) {
  const { ownerId, ...rest } = saved;
  return { ...rest, mine: ownerId === user.id, canChange: mayChange(user, saved) };
}

/** @returns {{ name?: string, shared?: boolean, filters?: object } | { error: string }} */
function readFields(body, { required }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Request body must be a JSON object' };
  const fields = {};
  if ('name' in body || required) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length === 0) return { error: 'name is required' };
    if (name.length > NAME_MAX_LEN) return { error: `name must not exceed ${NAME_MAX_LEN} characters` };
    fields.name = name;
  }
  if ('shared' in body) {
    if (typeof body.shared !== 'boolean') return { error: 'shared must be true or false' };
    fields.shared = body.shared;
  }
  if ('filters' in body || required) {
    const checked = validSavedFilters(body.filters);
    if (checked.error) return { error: checked.error };
    fields.filters = checked.filters;
  }
  return fields;
}

async function readBody(req, res) {
  try {
    return { body: await parseBody(req) };
  } catch (err) {
    if (err.message === 'PAYLOAD_TOO_LARGE') sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 512 KB limit');
    else sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
    return null;
  }
}

/** Whether its owner already keeps another one of that name. */
function nameTaken(store, spaceId, ownerId, name, exceptId) {
  const lower = name.toLowerCase();
  return store.listSavedFilters(spaceId, ownerId)
    .some((saved) => saved.ownerId === ownerId && saved.id !== exceptId && saved.name.toLowerCase() === lower);
}

const NOT_ALLOWED = 'Only whoever saved it or an admin can change a filter of the team.';

async function handleSavedFilters(req, res, store, spaceId, filterId) {
  const { method } = req;
  try {
    if (!filterId) {
      if (method === 'GET') {
        return sendJSON(res, 200, { filters: store.listSavedFilters(spaceId, req.user.id).map((saved) => asSeenBy(req.user, saved)) });
      }
      if (method !== 'POST') return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);

      const read = await readBody(req, res);
      if (!read) return undefined;
      // From here on with no await, so what is checked is what is written. Reading the body may
      // have found a different person: a change of role takes effect there.
      const { user } = req;
      const fields = readFields(read.body, { required: true });
      if (fields.error) return sendError(res, 400, 'VALIDATION_ERROR', fields.error);
      if (fields.shared && !mayShare(user)) return sendError(res, 403, 'FORBIDDEN', 'Only members can save a filter for the team.');
      if (store.countOwnSavedFilters(spaceId, user.id) >= MAX_PER_PERSON) {
        return sendError(res, 400, 'VALIDATION_ERROR', `You can keep up to ${MAX_PER_PERSON} filters in a space`);
      }
      if (nameTaken(store, spaceId, user.id, fields.name)) return sendError(res, 409, 'NAME_TAKEN', `You already have a filter called "${fields.name}"`);
      const created = store.createSavedFilter(spaceId, { ownerId: user.id, shared: false, ...fields });
      return sendJSON(res, 201, asSeenBy(user, created));
    }

    if (method !== 'PUT' && method !== 'DELETE') return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);

    const read = method === 'PUT' ? await readBody(req, res) : { body: null };
    if (!read) return undefined;

    const { user } = req;
    const saved = store.getSavedFilter(spaceId, filterId);
    if (!saved || (!saved.shared && saved.ownerId !== user.id)) {
      return sendError(res, 404, 'FILTER_NOT_FOUND', `Filter '${filterId}' not found`);
    }
    if (!mayChange(user, saved)) return sendError(res, 403, 'FORBIDDEN', NOT_ALLOWED);

    if (method === 'DELETE') {
      store.deleteSavedFilter(spaceId, filterId);
      return sendJSON(res, 200, { deleted: true, id: filterId });
    }

    const fields = readFields(read.body, { required: false });
    if (fields.error) return sendError(res, 400, 'VALIDATION_ERROR', fields.error);
    if (Object.keys(fields).length === 0) return sendError(res, 400, 'VALIDATION_ERROR', 'At least one of name, shared or filters is required');
    // An admin looks after the names and the list, not what a filter of someone else means or
    // who it is for: taken off the team, it would be out of their reach too.
    if (saved.ownerId !== user.id && ('filters' in fields || 'shared' in fields)) {
      return sendError(res, 403, 'FORBIDDEN', 'An admin can only rename or delete a filter of someone else.');
    }
    if (fields.shared && !saved.shared && !mayShare(user)) return sendError(res, 403, 'FORBIDDEN', 'Only members can save a filter for the team.');
    if (fields.name && nameTaken(store, spaceId, saved.ownerId, fields.name, filterId)) {
      return sendError(res, 409, 'NAME_TAKEN', saved.ownerId === user.id
        ? `You already have a filter called "${fields.name}"`
        : `Its owner already has a filter called "${fields.name}"`);
    }
    return sendJSON(res, 200, asSeenBy(user, store.updateSavedFilter(spaceId, filterId, fields)));
  } catch (err) {
    console.error('saved filters error:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to handle the saved filter');
  }
}

module.exports = { handleSavedFilters };
