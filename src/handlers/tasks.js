'use strict';

/**
 * Task router factory.
 *
 * ADR-002 (SQLite edition): Persistence via Store (better-sqlite3).
 *
 * createApp(spaceId, store) returns an isolated router for a specific space.
 * All storage calls are delegated to the Store instance — no direct file I/O.
 */

const path = require('path');

const { CATEGORIES }                       = require('../constants');
const { sendJSON, sendError, parseBody, readActor } = require('../utils/http');
const taskRunner                           = require('../services/taskRunner');

// ---------------------------------------------------------------------------
// Validation constraints
// ---------------------------------------------------------------------------

const VALID_TYPES          = ['feature', 'bug', 'tech-debt', 'chore', 'epic'];
const VALID_PRIORITIES     = ['urgent', 'high', 'medium', 'low'];
const TITLE_MAX_LEN        = 200;
const DESCRIPTION_MAX_LEN  = 20000;
const ASSIGNED_MAX_LEN     = 50;
const LABEL_MAX_LEN        = 40;
const LABELS_MAX_COUNT     = 20;
const ESTIMATE_MAX         = 9999;

const ATTACHMENT_MAX_COUNT         = 20;
const DEPENDS_ON_MAX_COUNT         = 20;
const ATTACHMENT_NAME_MAX_LEN      = 100;
const ATTACHMENT_TEXT_MAX_BYTES    = 100 * 1024;
const ATTACHMENT_FILE_MAX_BYTES    = 5 * 1024 * 1024;
const VALID_ATTACHMENT_TYPES       = ['text', 'file', 'link'];
const ATTACHMENT_LINK_MAX_LEN      = 2048;
const LINK_SCHEME_ALLOWLIST        = ['http:', 'https:'];

// ---------------------------------------------------------------------------
// Route patterns
// ---------------------------------------------------------------------------

const TASK_MOVE_ROUTE               = /^\/tasks\/([^/]+)\/move$/;
const TASK_RANK_ROUTE               = /^\/tasks\/([^/]+)\/rank$/;
const TASK_ATTACHMENTS_ROUTE        = /^\/tasks\/([^/]+)\/attachments$/;
const TASK_ATTACHMENT_CONTENT_ROUTE = /^\/tasks\/([^/]+)\/attachments\/(\d+)$/;
const TASK_HISTORY_ROUTE            = /^\/tasks\/([^/]+)\/history$/;
const TASK_SINGLE_ROUTE             = /^\/tasks\/([^/]+)$/;

// ---------------------------------------------------------------------------
// Field validation helpers (shared between create + update paths)
//
// These are pure, module-scope helpers — same precedent as `validateDependsOnField`
// below — so they can be unit-tested without an HTTP server or a Store instance.
// They own the message templates for the two checks that were previously
// hand-copied across the create and update paths (blueprint §3.2). Presence /
// required semantics deliberately stay at the call site (ADR-1) because they
// legitimately differ between POST (required) and PUT (patch).
// ---------------------------------------------------------------------------

/**
 * Validate a string field's max length. Caller guarantees `value` is a string.
 *
 * @param {string} name  Field name for the error message.
 * @param {string} value String value already asserted by the caller.
 * @param {number} max   Inclusive maximum length (measured AFTER trim()).
 * @returns {string|null} Error message, or null when valid.
 */
function validateFieldLength(name, value, max) {
  if (value.trim().length > max) {
    return `${name} must not exceed ${max} characters`;
  }
  return null;
}

/**
 * Validate an optional string field: type guard, then max length.
 * The caller decides presence — this is only called for fields the client sent.
 *
 * @param {string}  name
 * @param {unknown} value
 * @param {number}  max
 * @returns {string|null} Error message, or null when valid.
 */
function validateOptionalStringField(name, value, max) {
  if (typeof value !== 'string') {
    return `${name} must be a string when provided`;
  }
  return validateFieldLength(name, value, max);
}

// Spec table driving the create + update loops. Order matters: it fixes the
// order in which errors appear in the `; `-joined message (blueprint §6).
const OPTIONAL_STRING_FIELDS = [
  { name: 'description', max: DESCRIPTION_MAX_LEN },
  { name: 'assigned',    max: ASSIGNED_MAX_LEN },
];

/**
 * Validate the fields that are the same when creating and when updating.
 * Only checks the ones the client sent; null clears an optional one.
 *
 * @param {object} body
 * @returns {string[]} Error messages.
 */
function validateIssueFields(body) {
  const errors = [];
  // Arcs became epics: saying nothing would lose what the caller meant to group.
  if ('arc' in body) errors.push('arc is no longer supported: use parentId with the id or key of an epic');
  if ('priority' in body && !VALID_PRIORITIES.includes(body.priority)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
  }
  if ('labels' in body) {
    const { labels } = body;
    if (!Array.isArray(labels) || labels.some((l) => typeof l !== 'string' || l.trim().length === 0)) {
      errors.push('labels must be an array of non-empty strings');
    } else if (labels.length > LABELS_MAX_COUNT) {
      errors.push(`labels must not exceed ${LABELS_MAX_COUNT} items`);
    } else if (labels.some((l) => l.trim().length > LABEL_MAX_LEN)) {
      errors.push(`each label must not exceed ${LABEL_MAX_LEN} characters`);
    } else if (labels.some((l) => l.includes(','))) {
      errors.push('labels must not contain commas');
    }
  }
  if ('parentId' in body && body.parentId !== null && (typeof body.parentId !== 'string' || body.parentId.length === 0)) {
    errors.push('parentId must be a task ID or null');
  }
  if ('dueDate' in body && body.dueDate !== null && !isRealDate(body.dueDate)) {
    errors.push('dueDate must be a date as YYYY-MM-DD, or null');
  }
  if ('estimate' in body && body.estimate !== null
    && (typeof body.estimate !== 'number' || !isFinite(body.estimate) || body.estimate < 0 || body.estimate > ESTIMATE_MAX)) {
    errors.push(`estimate must be a number from 0 to ${ESTIMATE_MAX}, or null`);
  }
  return errors;
}

function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !isNaN(date) && date.toISOString().slice(0, 10) === value;
}

/** Labels without surrounding spaces or repeats. */
function cleanLabels(labels) {
  return [...new Set(labels.map((l) => l.trim()))];
}

/**
 * Validate the `dependsOn` field from an incoming request body.
 *
 * @param {unknown} value
 * @returns {{ valid: boolean, data: string[] | undefined, error?: string }}
 */
function validateDependsOnField(value) {
  if (value === undefined) {
    return { valid: true, data: undefined };
  }
  if (!Array.isArray(value)) {
    return { valid: false, error: 'dependsOn must be an array of task ID strings' };
  }
  if (value.length === 0) {
    return { valid: true, data: [] };
  }
  if (value.length > DEPENDS_ON_MAX_COUNT) {
    return { valid: false, error: `dependsOn must not exceed ${DEPENDS_ON_MAX_COUNT} items` };
  }
  // Check for duplicates
  const seen = new Set();
  for (let i = 0; i < value.length; i++) {
    const id = value[i];
    if (typeof id !== 'string' || id.trim().length === 0) {
      return { valid: false, error: `dependsOn[${i}] must be a non-empty string` };
    }
    if (seen.has(id)) {
      return { valid: false, error: `dependsOn contains duplicate ID: ${id}` };
    }
    seen.add(id);
  }
  return { valid: true, data: value };
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

/**
 * Create a router and supporting helpers bound to the given space.
 *
 * @param {string}               spaceId - The space ID this router serves.
 * @param {import('../services/store').Store} store   - The open Store instance.
 * @returns {{ router: Function, ensureDataFiles: Function }}
 */
function createApp(spaceId, store) {
  // -------------------------------------------------------------------------
  // Attachment validation
  // -------------------------------------------------------------------------

  function validateAttachments(attachments) {
    if (attachments === undefined) {
      return { valid: true, errors: [], data: [] };
    }

    if (!Array.isArray(attachments)) {
      return { valid: false, errors: ['attachments must be an array'], data: [] };
    }

    if (attachments.length > ATTACHMENT_MAX_COUNT) {
      return {
        valid:  false,
        errors: [`attachments must not exceed ${ATTACHMENT_MAX_COUNT} items`],
        data:   [],
      };
    }

    const errors = [];
    const data   = [];

    for (let i = 0; i < attachments.length; i++) {
      const item   = attachments[i];
      const prefix = `attachments[${i}]`;

      if (!item || typeof item !== 'object') {
        errors.push(`${prefix} must be an object`);
        continue;
      }

      const { name, type, content } = item;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        errors.push(`${prefix}.name is required and must be a non-empty string`);
      } else if (name.trim().length > ATTACHMENT_NAME_MAX_LEN) {
        errors.push(`${prefix}.name must not exceed ${ATTACHMENT_NAME_MAX_LEN} characters`);
      }

      if (!type || !VALID_ATTACHMENT_TYPES.includes(type)) {
        errors.push(`${prefix}.type is required and must be one of: ${VALID_ATTACHMENT_TYPES.join(', ')}`);
      }

      if (!content || typeof content !== 'string' || content.length === 0) {
        errors.push(`${prefix}.content is required and must be a non-empty string`);
      } else if (type === 'text' && Buffer.byteLength(content, 'utf8') > ATTACHMENT_TEXT_MAX_BYTES) {
        errors.push(`${prefix}.content exceeds 100 KB limit for text attachments`);
      } else if (type === 'file' && !content.startsWith('/')) {
        errors.push(`${prefix}.content must be an absolute path (starting with /) for file attachments`);
      } else if (type === 'file' && path.normalize(content) !== content) {
        errors.push(`${prefix}.content must not contain path traversal segments`);
      } else if (type === 'link') {
        if (content.length > ATTACHMENT_LINK_MAX_LEN) {
          errors.push(`${prefix}.content must not exceed ${ATTACHMENT_LINK_MAX_LEN} characters for link attachments`);
        } else {
          let parsed;
          try {
            parsed = new URL(content);
          } catch {
            errors.push(`${prefix}.content must be a valid http(s) URL`);
          }
          if (parsed && !LINK_SCHEME_ALLOWLIST.includes(parsed.protocol)) {
            errors.push(`${prefix}.content must be a valid http(s) URL (scheme '${parsed.protocol}' is not allowed)`);
          }
        }
      }

      const itemErrors = errors.filter((e) => e.startsWith(prefix));
      if (itemErrors.length === 0) {
        data.push({ name: name.trim(), type, content });
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors, data: [] };
    }

    return { valid: true, errors: [], data };
  }

  // -------------------------------------------------------------------------
  // Task payload validation
  // -------------------------------------------------------------------------

  /** A parent or a dependency can be given by key, such as WEB-142, like any route. */
  function resolveIssueRefs(body) {
    if (!body || typeof body !== 'object') return;
    const toId = (ref) => {
      const found = typeof ref === 'string' ? store.getTaskByKey(ref) : null;
      return found?.spaceId === spaceId ? found.task.id : ref;
    };
    if (body.parentId) body.parentId = toId(body.parentId);
    if (Array.isArray(body.dependsOn)) body.dependsOn = body.dependsOn.map(toId);
  }

  function validateCreatePayload(body) {
    const errors = [];

    if (!body || typeof body !== 'object') {
      return { valid: false, errors: ['Request body must be a JSON object'], data: null };
    }

    const { title, type, description, assigned } = body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      errors.push('title is required and must be a non-empty string');
    } else {
      const err = validateFieldLength('title', title, TITLE_MAX_LEN);
      if (err) errors.push(err);
    }

    if (!type || !VALID_TYPES.includes(type)) {
      errors.push(`type is required and must be one of: ${VALID_TYPES.join(', ')}`);
    }

    for (const { name, max } of OPTIONAL_STRING_FIELDS) {
      if (body[name] === undefined) continue;                // create's existing gate
      const err = validateOptionalStringField(name, body[name], max);
      if (err) errors.push(err);
    }

    errors.push(...validateIssueFields(body));

    if (errors.length > 0) {
      return { valid: false, errors, data: null };
    }

    return {
      valid:  true,
      errors: [],
      data: {
        title:       title.trim(),
        type,
        description: typeof description === 'string' ? description.trim() : undefined,
        assigned:    typeof assigned === 'string' && assigned.trim().length > 0
                       ? assigned.trim()
                       : undefined,
        priority:    body.priority,
        labels:      Array.isArray(body.labels) && body.labels.length > 0 ? cleanLabels(body.labels) : undefined,
        parentId:    body.parentId ?? undefined,
        dueDate:     body.dueDate ?? undefined,
        estimate:    body.estimate ?? undefined,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Attachment content strip helper
  // -------------------------------------------------------------------------

  function stripAttachmentContent(task) {
    if (!task.attachments || task.attachments.length === 0) {
      const { attachments: _omit, ...rest } = task;
      return rest;
    }
    return {
      ...task,
      attachments: task.attachments.map((att) => {
        // Link attachments: preserve content so the frontend can extract the hostname
        // without a second API round-trip. URLs are not sensitive.
        if (att.type === 'link') {
          return { name: att.name, type: att.type, content: att.content };
        }
        return { name: att.name, type: att.type };
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Route handlers
  // -------------------------------------------------------------------------

  function handleGetTasks(req, res) {
    try {
      const qs        = new URL(req.url, 'http://x').searchParams;
      const colFilter  = qs.get('status') || qs.get('column') || null;
      const category   = qs.get('category') || null;
      const assigned   = qs.get('assigned') || null;
      const limitRaw   = qs.get('limit');
      const cursor     = qs.get('cursor')   || null;

      const limit = limitRaw != null
        ? Math.min(200, Math.max(1, parseInt(limitRaw, 10) || 50))
        : Infinity;

      const statusIds = store.getStatuses(spaceId).map((s) => s.id);
      if (colFilter && !statusIds.includes(colFilter)) {
        return sendError(res, 400, 'VALIDATION_ERROR',
          `Invalid status '${colFilter}'. Must be one of: ${statusIds.join(', ')}`);
      }
      if (category && !CATEGORIES.includes(category)) {
        return sendError(res, 400, 'VALIDATION_ERROR',
          `Invalid category '${category}'. Must be one of: ${CATEGORIES.join(', ')}`);
      }

      const columns = colFilter ? [colFilter] : statusIds;
      const allWithStatus = store.getAllTasksForSpaceWithStatus(spaceId);
      const flat = [];
      for (const task of allWithStatus) {
        if (!columns.includes(task.statusId)) continue;
        if (category && task.category !== category) continue;
        if (assigned && task.assigned !== assigned) continue;
        flat.push(task);
      }

      const total = flat.length;

      let startIdx = 0;
      if (cursor) {
        try {
          const { col, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
          const idx = flat.findIndex((t) => t.statusId === col && t.id === id);
          startIdx = idx === -1 ? 0 : idx + 1;
        } catch {
          return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid cursor value');
        }
      }

      const page = flat.slice(startIdx, startIdx + limit);

      let nextCursor = null;
      if (startIdx + limit < total) {
        const last = page[page.length - 1];
        nextCursor = Buffer.from(JSON.stringify({ col: last.statusId, id: last.id })).toString('base64url');
      }

      const result = {};
      for (const col of columns) {
        result[col] = [];
      }
      for (const task of page) {
        const { _col, ...rest } = task;
        result[rest.statusId].push(stripAttachmentContent(rest));
      }

      sendJSON(res, 200, { ...result, total, nextCursor });
    } catch (err) {
      console.error('GET tasks error:', err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read task data');
    }
  }

  async function handleCreateTask(req, res) {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 512 KB limit');
      }
      return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    resolveIssueRefs(body);
    const { valid, errors, data } = validateCreatePayload(body);
    if (!valid) {
      return sendError(res, 400, 'VALIDATION_ERROR', errors.join('; '));
    }

    const attachmentResult = validateAttachments(body.attachments);
    if (!attachmentResult.valid) {
      return sendError(res, 400, 'VALIDATION_ERROR', attachmentResult.errors.join('; '));
    }

    const dependsOnResult = validateDependsOnField(body.dependsOn);
    if (!dependsOnResult.valid) {
      return sendError(res, 400, 'VALIDATION_ERROR', dependsOnResult.error);
    }

    const hierarchyError = store.checkHierarchy(spaceId, null, { type: data.type, parentId: data.parentId });
    if (hierarchyError) {
      return sendError(res, 422, 'INVALID_PARENT', hierarchyError);
    }

    const statuses = store.getStatuses(spaceId);
    const statusId = body.statusId ?? statuses.find((s) => s.category === 'todo').id;
    if (!statuses.some((s) => s.id === statusId)) {
      return sendError(res, 400, 'VALIDATION_ERROR',
        `statusId must be one of: ${statuses.map((s) => s.id).join(', ')}`);
    }

    const now  = new Date().toISOString();
    const task = {
      id:    crypto.randomUUID(),
      title: data.title,
      type:  data.type,
      ...(data.priority    !== undefined && { priority:    data.priority }),
      ...(data.labels      !== undefined && { labels:      data.labels }),
      ...(data.parentId    !== undefined && { parentId:    data.parentId }),
      ...(data.dueDate     !== undefined && { dueDate:     data.dueDate }),
      ...(data.estimate    !== undefined && { estimate:    data.estimate }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.assigned    !== undefined && { assigned:    data.assigned }),
      ...(attachmentResult.data.length > 0 && { attachments: attachmentResult.data }),
      ...(dependsOnResult.data && dependsOnResult.data.length > 0
        && { dependsOn: dependsOnResult.data }),
      createdAt: now,
      updatedAt: now,
    };

    // A task being created has an id nothing can reference yet, so it cannot be
    // part of a cycle — only existence needs checking. The INSERT already binds
    // depends_on, so the deps ride along with the row instead of being written
    // by a second statement that would have to be rolled back on failure.
    if (task.dependsOn) {
      const known = new Set(store.getAllTasksForSpace(spaceId).map((t) => t.id));
      const missing = task.dependsOn.find((id) => !known.has(id));
      if (missing) {
        return sendError(res, 422, 'DEPENDENCY_NOT_FOUND', `Dependency task not found: ${missing}`);
      }
    }

    try {
      store.insertTask(task, spaceId, statusId, { actor: readActor(req) });

      sendJSON(res, 201, stripAttachmentContent(task));
    } catch (err) {
      console.error('POST tasks error:', err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to persist task');
    }
  }

  async function handleMoveTask(req, res, taskId) {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 512 KB limit');
      }
      return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    if (!body || typeof body !== 'object') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
    }

    const { to } = body;
    const statuses = store.getStatuses(spaceId);
    const target = statuses.find((s) => s.id === to);
    if (!target) {
      return sendError(res, 400, 'VALIDATION_ERROR',
        `to is required and must be one of: ${statuses.map((s) => s.id).join(', ')}`);
    }

    try {
      const current = store.getTask(spaceId, taskId);
      if (!current) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }
      const sourceColumn = current.statusId;

      if (sourceColumn === to) {
        return sendJSON(res, 200, { task: current, from: sourceColumn, to });
      }

      // Prism moves the card when the agent and the hooks are done, so neither
      // the agent nor anyone else can skip them by moving the card.
      const finishStatusId = store.getSpace(spaceId).finishStatusId;
      if ((target.category !== 'in-progress' || to === finishStatusId) && taskRunner.hasActiveRun(taskId)) {
        return sendError(res, 409, 'TASK_RUN_ACTIVE',
          'An agent is running this task. Stop it before moving the card.');
      }

      // Atomic single-UPDATE move.
      const updatedTask = store.moveTask(spaceId, taskId, to, { actor: readActor(req) });
      if (!updatedTask) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }

      sendJSON(res, 200, { task: updatedTask, from: sourceColumn, to });
    } catch (err) {
      console.error(`PUT tasks/${taskId}/move error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to move task');
    }
  }

  async function handleRankTask(req, res, taskId) {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 512 KB limit');
      }
      return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    if (!body || typeof body !== 'object') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
    }

    const { rank } = body;
    if (rank === undefined || rank === null) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'rank is required');
    }
    if (typeof rank !== 'number' || !isFinite(rank)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'rank must be a finite number');
    }

    const t0 = Date.now();
    try {
      const updatedTask = store.reorderTask(spaceId, taskId, rank);
      if (!updatedTask) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }
      process.stderr.write(JSON.stringify({
        event: 'task.rank_updated', spaceId, taskId, rank, durationMs: Date.now() - t0,
      }) + '\n');
      sendJSON(res, 200, stripAttachmentContent(updatedTask));
    } catch (err) {
      console.error(`PATCH tasks/${taskId}/rank error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update task rank');
    }
  }

  /**
   * Atomically re-rank up to 500 tasks in this space. Body: { updates: [{id, rank}] }.
   * Wraps all writes in a single SQLite transaction — if any id is missing the
   * whole batch is rolled back and a 404 is returned.
   */
  const RANK_BATCH_MAX = 500;
  async function handleRankTasksBatch(req, res) {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 512 KB limit');
      }
      return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    if (!body || typeof body !== 'object' || !Array.isArray(body.updates)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be { updates: [{ id, rank }] }');
    }
    const { updates } = body;
    if (updates.length === 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'updates must be a non-empty array');
    }
    if (updates.length > RANK_BATCH_MAX) {
      return sendError(res, 400, 'VALIDATION_ERROR', `updates must not exceed ${RANK_BATCH_MAX} items`);
    }
    for (let i = 0; i < updates.length; i++) {
      const u = updates[i];
      if (!u || typeof u !== 'object') {
        return sendError(res, 400, 'VALIDATION_ERROR', `updates[${i}] must be an object`);
      }
      if (typeof u.id !== 'string' || u.id.length === 0) {
        return sendError(res, 400, 'VALIDATION_ERROR', `updates[${i}].id must be a non-empty string`);
      }
      if (typeof u.rank !== 'number' || !isFinite(u.rank)) {
        return sendError(res, 400, 'VALIDATION_ERROR', `updates[${i}].rank must be a finite number`);
      }
    }

    const t0 = Date.now();
    try {
      const tasks = store.reorderTasks(spaceId, updates);
      process.stderr.write(JSON.stringify({
        event: 'task.rank_batch_updated', spaceId, count: updates.length, durationMs: Date.now() - t0,
      }) + '\n');
      sendJSON(res, 200, { tasks: tasks.map(stripAttachmentContent) });
    } catch (err) {
      if (err && err.code === 'TASK_NOT_FOUND') {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${err.taskId}' not found in space`);
      }
      console.error(`PATCH tasks/rank batch error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to reorder tasks');
    }
  }

  async function handleUpdateTask(req, res, taskId) {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 512 KB limit');
      }
      return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    if (!body || typeof body !== 'object') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
    }

    resolveIssueRefs(body);
    const UPDATABLE_FIELDS = ['title', 'type', 'description', 'assigned', 'priority', 'labels', 'parentId', 'dueDate', 'estimate', 'dependsOn'];
    const provided         = UPDATABLE_FIELDS.filter((f) => f in body);

    if (provided.length === 0) {
      return sendError(res, 400, 'VALIDATION_ERROR',
        `At least one of the following fields is required: ${UPDATABLE_FIELDS.join(', ')}`);
    }

    const errors = [];

    if ('title' in body) {
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        errors.push('title must be a non-empty string');
      } else {
        const err = validateFieldLength('title', body.title, TITLE_MAX_LEN);
        if (err) errors.push(err);
      }
    }

    if ('type' in body) {
      if (!VALID_TYPES.includes(body.type)) {
        errors.push(`type must be one of: ${VALID_TYPES.join(', ')}`);
      }
    }

    for (const { name, max } of OPTIONAL_STRING_FIELDS) {
      if (!(name in body)) continue;                         // update's existing gate
      const err = validateOptionalStringField(name, body[name], max);
      if (err) errors.push(err);
    }

    errors.push(...validateIssueFields(body));

    let dependsOnUpdateResult;
    if ('dependsOn' in body) {
      dependsOnUpdateResult = validateDependsOnField(body.dependsOn);
      if (!dependsOnUpdateResult.valid) {
        errors.push(dependsOnUpdateResult.error);
      }
    }

    if (errors.length > 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', errors.join('; '));
    }

    try {
      // Nothing is written until every field has been validated: the dependsOn
      // change and the field patch then commit together in one transaction.
      const depIds = ('dependsOn' in body && dependsOnUpdateResult?.valid)
        ? (dependsOnUpdateResult.data ?? [])
        : undefined;

      const existing = store.getTask(spaceId, taskId);
      if (!existing) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }

      if ('type' in body || 'parentId' in body) {
        const hierarchyError = store.checkHierarchy(spaceId, taskId, {
          type:     body.type ?? existing.type,
          parentId: 'parentId' in body ? body.parentId : existing.parentId,
        });
        if (hierarchyError) {
          return sendError(res, 422, 'INVALID_PARENT', hierarchyError);
        }
        if (body.type === 'epic' && taskRunner.hasActiveRun(taskId)) {
          return sendError(res, 409, 'TASK_RUN_ACTIVE', 'An agent is running this task. Stop it before making it an epic.');
        }
      }

      const OTHER_FIELDS = UPDATABLE_FIELDS.filter((f) => f !== 'dependsOn');
      const hasOtherFields = OTHER_FIELDS.some(f => f in body);

      if (!hasOtherFields) {
        if (depIds === undefined) {
          return sendJSON(res, 200, stripAttachmentContent(existing));
        }
        const onlyDeps = store.updateTaskWithDependencies(spaceId, taskId, { depIds, actor: readActor(req) });
        if (onlyDeps.error) return sendDependencyError(res, taskId, onlyDeps);
        return sendJSON(res, 200, stripAttachmentContent(onlyDeps.task));
      }

      const patch = { updatedAt: new Date().toISOString() };

      if ('title' in body) patch.title = body.title.trim();
      if ('type'  in body) patch.type  = body.type;

      if ('description' in body) {
        const trimmed = body.description.trim();
        patch.description = trimmed.length > 0 ? trimmed : undefined;
      }

      if ('assigned' in body) {
        const trimmed = body.assigned.trim();
        patch.assigned = trimmed.length > 0 ? trimmed : undefined;
      }

      if ('priority' in body) patch.priority = body.priority;
      if ('labels' in body) {
        patch.labels = body.labels.length > 0 ? cleanLabels(body.labels) : undefined;
      }
      if ('parentId' in body) patch.parentId = body.parentId ?? undefined;
      if ('dueDate' in body) patch.dueDate = body.dueDate ?? undefined;
      if ('estimate' in body) patch.estimate = body.estimate ?? undefined;

      const written = store.updateTaskWithDependencies(spaceId, taskId, { patch, depIds, actor: readActor(req) });
      if (written.error) return sendDependencyError(res, taskId, written);
      sendJSON(res, 200, stripAttachmentContent(written.task));
    } catch (err) {
      console.error(`PUT tasks/${taskId} error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update task');
    }
  }

  /** Map a store dependency/update error code to its HTTP response. */
  function sendDependencyError(res, taskId, result) {
    if (result.code === 'TASK_NOT_FOUND') {
      return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
    }
    if (result.code === 'CYCLE_DETECTED') {
      return sendError(res, 409, 'CYCLE_DETECTED', result.error);
    }
    if (result.code === 'DEPENDENCY_NOT_FOUND') {
      return sendError(res, 422, 'DEPENDENCY_NOT_FOUND', result.error);
    }
    return sendError(res, 400, 'VALIDATION_ERROR', result.error);
  }

  function handleGetTask(req, res, taskId) {
    try {
      const task = store.getTask(spaceId, taskId);
      if (!task) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }
      const children = store.getChildren(taskId).map((child) => ({
        id: child.id, key: child.key, title: child.title, type: child.type,
        statusId: child.statusId, category: child.category,
      }));
      sendJSON(res, 200, { ...task, ...(children.length > 0 && { children }) });
    } catch (err) {
      console.error(`GET tasks/${taskId} error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to get task');
    }
  }

  function handleGetHistory(res, taskId) {
    try {
      if (!store.getTask(spaceId, taskId)) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }
      sendJSON(res, 200, { history: store.getHistory(taskId) });
    } catch (err) {
      console.error(`GET tasks/${taskId}/history error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read the history');
    }
  }

  function handleClearBoard(req, res) {
    try {
      if (taskRunner.spaceHasActiveRun(spaceId)) {
        return sendError(res, 409, 'SPACE_RUN_ACTIVE',
          'An agent is running a task here. Stop it before clearing the board.');
      }
      // Count first (for the response payload).
      const total = store.getAllTasksForSpace(spaceId).length;
      store.clearSpace(spaceId);
      taskRunner.closeSpaceRuns(spaceId).catch(() => {});
      sendJSON(res, 200, { deleted: total });
    } catch (err) {
      console.error('DELETE tasks error:', err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to clear board');
    }
  }

  function handleDeleteTask(req, res, taskId) {
    try {
      if (taskRunner.hasActiveRun(taskId)) {
        return sendError(res, 409, 'TASK_RUN_ACTIVE',
          'An agent is running this task. Stop it before deleting the card.');
      }
      const deleted = store.deleteTask(spaceId, taskId, { actor: readActor(req) });
      if (!deleted) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }
      taskRunner.closeTaskRuns(spaceId, taskId).catch(() => {});
      sendJSON(res, 200, { deleted: true, id: taskId });
    } catch (err) {
      console.error(`DELETE tasks/${taskId} error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to delete task');
    }
  }

  async function parseAttachmentsBody(req, res) {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      if (err.message === 'PAYLOAD_TOO_LARGE') {
        sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 512 KB limit');
      } else {
        sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
      }
      return null;
    }
    if (!body || typeof body !== 'object') {
      sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
      return null;
    }
    if (!Array.isArray(body.attachments)) {
      sendError(res, 400, 'VALIDATION_ERROR', 'attachments field is required and must be an array');
      return null;
    }
    const result = validateAttachments(body.attachments);
    if (!result.valid) {
      sendError(res, 400, 'VALIDATION_ERROR', result.errors.join('; '));
      return null;
    }
    return result.data;
  }

  async function handleUpdateAttachments(req, res, taskId) {
    const incoming = await parseAttachmentsBody(req, res);
    if (incoming === null) return;

    const t0 = Date.now();

    try {
      const existingTask = store.getTask(spaceId, taskId);
      if (!existingTask) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }

      if (incoming.length > ATTACHMENT_MAX_COUNT) {
        const existingCount = (existingTask.attachments || []).length;
        return sendError(res, 413, 'ATTACHMENT_LIMIT_EXCEEDED',
          `Attachment count (${incoming.length}) exceeds the limit of ${ATTACHMENT_MAX_COUNT}. ` +
          JSON.stringify({ existing: existingCount, incoming: incoming.length, merged: incoming.length, max: ATTACHMENT_MAX_COUNT }));
      }

      const updatedTask = store.updateTask(spaceId, taskId, {
        attachments: incoming.length > 0 ? incoming : undefined,
        updatedAt:   new Date().toISOString(),
      });

      process.stderr.write(JSON.stringify({
        event: 'attachments.replace', spaceId, taskId,
        existing: (existingTask.attachments || []).length, incoming: incoming.length, final: incoming.length, durationMs: Date.now() - t0,
      }) + '\n');

      sendJSON(res, 200, stripAttachmentContent(updatedTask));
    } catch (err) {
      console.error(`PUT tasks/${taskId}/attachments error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update attachments');
    }
  }

  async function handlePatchAttachments(req, res, taskId) {
    const incoming = await parseAttachmentsBody(req, res);
    if (incoming === null) return;

    const t0 = Date.now();

    try {
      const existingTask = store.getTask(spaceId, taskId);
      if (!existingTask) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }

      const existingAttachments = existingTask.attachments || [];
      const existingCount       = existingAttachments.length;

      if (incoming.length === 0) {
        process.stderr.write(JSON.stringify({
          event: 'attachments.merge', spaceId, taskId,
          existing: existingCount, incoming: 0, merged: existingCount, durationMs: Date.now() - t0,
        }) + '\n');
        return sendJSON(res, 200, stripAttachmentContent(existingTask));
      }

      const incomingByName = new Map();
      for (const a of incoming) incomingByName.set(a.name, a);

      const merged = [];
      const seen   = new Set();

      for (const a of existingAttachments) {
        merged.push(incomingByName.has(a.name) ? incomingByName.get(a.name) : a);
        seen.add(a.name);
      }
      for (const [name, a] of incomingByName) {
        if (!seen.has(name)) merged.push(a);
      }

      if (merged.length > ATTACHMENT_MAX_COUNT) {
        return sendError(res, 413, 'ATTACHMENT_LIMIT_EXCEEDED',
          `Merged attachment count (${merged.length}) exceeds the limit of ${ATTACHMENT_MAX_COUNT}. ` +
          JSON.stringify({ existing: existingCount, incoming: incoming.length, merged: merged.length, max: ATTACHMENT_MAX_COUNT }));
      }

      const updatedTask = store.updateTask(spaceId, taskId, {
        attachments: merged.length > 0 ? merged : undefined,
        updatedAt:   new Date().toISOString(),
      });

      process.stderr.write(JSON.stringify({
        event: 'attachments.merge', spaceId, taskId,
        existing: existingCount, incoming: incoming.length, merged: merged.length, durationMs: Date.now() - t0,
      }) + '\n');

      sendJSON(res, 200, stripAttachmentContent(updatedTask));
    } catch (err) {
      console.error(`PATCH tasks/${taskId}/attachments error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to merge attachments');
    }
  }

  function handleGetAttachmentContent(req, res, taskId, index) {
    const idx = parseInt(index, 10);
    if (isNaN(idx) || idx < 0) {
      return sendError(res, 404, 'NOT_FOUND', 'Attachment index must be a non-negative integer');
    }

    try {
      const foundTask = store.getTask(spaceId, taskId);

      if (!foundTask) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }

      if (!foundTask.attachments || idx >= foundTask.attachments.length) {
        return sendError(res, 404, 'NOT_FOUND', `Attachment at index ${idx} not found`);
      }

      const attachment = foundTask.attachments[idx];
      console.log(`[attachment] Serving content for task ${taskId} attachment ${idx}`);

      if (attachment.type === 'text') {
        return sendJSON(res, 200, {
          name:    attachment.name,
          type:    attachment.type,
          content: attachment.content,
        });
      }

      if (attachment.type === 'link') {
        return sendJSON(res, 200, {
          name:    attachment.name,
          type:    attachment.type,
          content: attachment.content,
        });
      }

      if (attachment.content.includes('..')) {
        return sendError(res, 403, 'FORBIDDEN', 'Invalid file path');
      }

      const fs   = require('fs');
      const normalizedPath = path.normalize(attachment.content);

      if (!fs.existsSync(normalizedPath)) {
        console.warn(`[attachment] File not found: ${normalizedPath}`);
        return sendError(res, 422, 'FILE_NOT_FOUND', 'The referenced file does not exist on disk');
      }

      const stat = fs.statSync(normalizedPath);
      if (stat.size > ATTACHMENT_FILE_MAX_BYTES) {
        console.warn(`[attachment] File exceeds size limit: ${normalizedPath}`);
        return sendError(res, 413, 'FILE_TOO_LARGE', 'The referenced file exceeds the 5 MB size limit');
      }

      const fileContent = fs.readFileSync(normalizedPath, 'utf8');
      return sendJSON(res, 200, {
        name:    attachment.name,
        type:    attachment.type,
        content: fileContent,
        source:  normalizedPath,
      });
    } catch (err) {
      console.error(`GET tasks/${taskId}/attachments/${index} error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to retrieve attachment content');
    }
  }

  // -------------------------------------------------------------------------
  // Search handler
  // -------------------------------------------------------------------------

  const MAX_QUERY_LEN = 200;

  // UUID v4 canonical form — FTS5 cannot tokenise hyphenated hex runs.
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function handleSearchTasks(req, res) {
    const qs    = new URL(req.url, 'http://x').searchParams;
    const query = qs.get('q');

    if (!query || query.trim().length === 0) {
      return sendError(res, 400, 'VALIDATION_ERROR',
        'Query parameter q is required and must not be empty');
    }

    const trimmedQ = query.trim();

    if (trimmedQ.length > MAX_QUERY_LEN) {
      return sendError(res, 400, 'VALIDATION_ERROR',
        `Query must not exceed ${MAX_QUERY_LEN} characters`);
    }

    const limitRaw = qs.get('limit');
    const limit    = limitRaw != null
      ? Math.min(100, Math.max(1, parseInt(limitRaw, 10) || 20))
      : 20;

    try {
      // A key, such as WEB-142, finds that issue if it is in this space.
      const byKey = store.getTaskByKey(trimmedQ);
      if (byKey?.spaceId === spaceId) {
        return sendJSON(res, 200, { results: [stripAttachmentContent(byKey.task)], total: 1 });
      }

      // UUID shortcut: FTS5 does not tokenise hyphenated hex runs, so a UUID
      // query would always return 0 results. Do a direct ID lookup instead.
      if (UUID_PATTERN.test(trimmedQ)) {
        const task = store.getTask(spaceId, trimmedQ);
        const results = task ? [stripAttachmentContent(task)] : [];
        return sendJSON(res, 200, { results, total: results.length });
      }

      const results = store.searchTasks(spaceId, trimmedQ, { limit });
      const stripped = results.map(stripAttachmentContent);
      return sendJSON(res, 200, { results: stripped, total: stripped.length });
    } catch (err) {
      console.error('[search] searchTasks error:', err);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to execute search');
    }
  }

  // -------------------------------------------------------------------------
  // Router
  // -------------------------------------------------------------------------

  async function router(req, res, taskPath) {
    const { method } = req;

    // Search must be matched before the generic /tasks route to avoid collision.
    if (method === 'GET' && taskPath === '/tasks/search') {
      return handleSearchTasks(req, res);
    }

    if (method === 'GET' && taskPath === '/tasks') {
      return handleGetTasks(req, res);
    }

    if (method === 'POST' && taskPath === '/tasks') {
      return handleCreateTask(req, res);
    }

    if (method === 'DELETE' && taskPath === '/tasks') {
      return handleClearBoard(req, res);
    }

    const attachmentContentMatch = TASK_ATTACHMENT_CONTENT_ROUTE.exec(taskPath);
    if (method === 'GET' && attachmentContentMatch) {
      return handleGetAttachmentContent(req, res, attachmentContentMatch[1], attachmentContentMatch[2]);
    }

    const attachmentsMatch = TASK_ATTACHMENTS_ROUTE.exec(taskPath);
    if (method === 'PUT' && attachmentsMatch) {
      return handleUpdateAttachments(req, res, attachmentsMatch[1]);
    }
    if (method === 'PATCH' && attachmentsMatch) {
      return handlePatchAttachments(req, res, attachmentsMatch[1]);
    }

    // Batch rank update — must be matched before TASK_SINGLE_ROUTE would eat `/tasks/rank`.
    if (method === 'PATCH' && taskPath === '/tasks/rank') {
      return handleRankTasksBatch(req, res);
    }

    const rankMatch = TASK_RANK_ROUTE.exec(taskPath);
    if (method === 'PATCH' && rankMatch) {
      return handleRankTask(req, res, rankMatch[1]);
    }

    const moveMatch = TASK_MOVE_ROUTE.exec(taskPath);
    if (method === 'PUT' && moveMatch) {
      return handleMoveTask(req, res, moveMatch[1]);
    }

    const historyMatch = TASK_HISTORY_ROUTE.exec(taskPath);
    if (method === 'GET' && historyMatch) {
      return handleGetHistory(res, historyMatch[1]);
    }

    const singleMatch = TASK_SINGLE_ROUTE.exec(taskPath);
    if (method === 'GET' && singleMatch) {
      return handleGetTask(req, res, singleMatch[1]);
    }

    if (method === 'DELETE' && singleMatch) {
      return handleDeleteTask(req, res, singleMatch[1]);
    }

    if (method === 'PUT' && singleMatch) {
      return handleUpdateTask(req, res, singleMatch[1]);
    }

    return null;
  }

  // ensureDataFiles is a no-op — schema is applied when the Store is opened.
  function ensureDataFiles() {}

  return { router, ensureDataFiles };
}

module.exports = {
  createApp,
  validateFieldLength,
  validateOptionalStringField,
};
