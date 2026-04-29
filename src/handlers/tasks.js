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

const { COLUMNS }                          = require('../constants');
const { sendJSON, sendError, parseBody }   = require('../utils/http');

// ---------------------------------------------------------------------------
// Validation constraints
// ---------------------------------------------------------------------------

const VALID_TYPES          = ['feature', 'bug', 'tech-debt', 'chore'];
const TITLE_MAX_LEN        = 200;
const DESCRIPTION_MAX_LEN  = 1000;
const ASSIGNED_MAX_LEN     = 50;
const PIPELINE_MAX_STAGES  = 20;
const PIPELINE_STAGE_MAX_LEN = 50;
const PIPELINE_STAGE_ID_RE = /^[a-z0-9-]+$/;

const ATTACHMENT_MAX_COUNT         = 20;
const ATTACHMENT_NAME_MAX_LEN      = 100;
const ATTACHMENT_TEXT_MAX_BYTES    = 100 * 1024;
const ATTACHMENT_FILE_MAX_BYTES    = 5 * 1024 * 1024;
const VALID_ATTACHMENT_TYPES       = ['text', 'file'];

// ---------------------------------------------------------------------------
// Route patterns
// ---------------------------------------------------------------------------

const TASK_MOVE_ROUTE               = /^\/tasks\/([^/]+)\/move$/;
const TASK_ATTACHMENTS_ROUTE        = /^\/tasks\/([^/]+)\/attachments$/;
const TASK_ATTACHMENT_CONTENT_ROUTE = /^\/tasks\/([^/]+)\/attachments\/(\d+)$/;
const TASK_SINGLE_ROUTE             = /^\/tasks\/([^/]+)$/;

// ---------------------------------------------------------------------------
// Pipeline field validation (exported for autoTask.js)
// ---------------------------------------------------------------------------

/**
 * Validate the `pipeline` field from an incoming request body.
 *
 * @param {unknown} value
 * @returns {{ valid: boolean, data: string[] | undefined, error?: string }}
 */
function validatePipelineField(value) {
  if (value === undefined) {
    return { valid: true, data: undefined };
  }

  if (!Array.isArray(value)) {
    return { valid: false, error: 'pipeline must be an array of agent ID strings' };
  }

  if (value.length === 0) {
    return { valid: true, data: undefined };
  }

  if (value.length > PIPELINE_MAX_STAGES) {
    return { valid: false, error: `pipeline must not exceed ${PIPELINE_MAX_STAGES} stages` };
  }

  for (let i = 0; i < value.length; i++) {
    const element = value[i];
    if (typeof element !== 'string' || element.trim().length === 0) {
      return { valid: false, error: `pipeline[${i}] must be a non-empty string` };
    }
    if (element.trim().length > PIPELINE_STAGE_MAX_LEN) {
      return { valid: false, error: `pipeline[${i}] must not exceed ${PIPELINE_STAGE_MAX_LEN} characters` };
    }
    if (!PIPELINE_STAGE_ID_RE.test(element.trim())) {
      return { valid: false, error: `pipeline[${i}] must contain only lowercase letters, digits, and hyphens` };
    }
  }

  return { valid: true, data: value.map((s) => s.trim()) };
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

  function validateCreatePayload(body) {
    const errors = [];

    if (!body || typeof body !== 'object') {
      return { valid: false, errors: ['Request body must be a JSON object'], data: null };
    }

    const { title, type, description, assigned } = body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      errors.push('title is required and must be a non-empty string');
    } else if (title.trim().length > TITLE_MAX_LEN) {
      errors.push(`title must not exceed ${TITLE_MAX_LEN} characters`);
    }

    if (!type || !VALID_TYPES.includes(type)) {
      errors.push(`type is required and must be one of: ${VALID_TYPES.join(', ')}`);
    }

    if (description !== undefined && typeof description !== 'string') {
      errors.push('description must be a string when provided');
    } else if (typeof description === 'string' && description.trim().length > DESCRIPTION_MAX_LEN) {
      errors.push(`description must not exceed ${DESCRIPTION_MAX_LEN} characters`);
    }

    if (assigned !== undefined && typeof assigned !== 'string') {
      errors.push('assigned must be a string when provided');
    } else if (typeof assigned === 'string' && assigned.trim().length > ASSIGNED_MAX_LEN) {
      errors.push(`assigned must not exceed ${ASSIGNED_MAX_LEN} characters`);
    }

    const pipelineResult = validatePipelineField(body.pipeline);
    if (!pipelineResult.valid) {
      errors.push(pipelineResult.error);
    }

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
        pipeline:    pipelineResult.data,
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
      attachments: task.attachments.map(({ name, type }) => ({ name, type })),
    };
  }

  // -------------------------------------------------------------------------
  // Route handlers
  // -------------------------------------------------------------------------

  function handleGetTasks(req, res) {
    try {
      const qs        = new URL(req.url, 'http://x').searchParams;
      const colFilter  = qs.get('column')   || null;
      const assigned   = qs.get('assigned') || null;
      const limitRaw   = qs.get('limit');
      const cursor     = qs.get('cursor')   || null;

      const limit = limitRaw != null
        ? Math.min(200, Math.max(1, parseInt(limitRaw, 10) || 50))
        : Infinity;

      if (colFilter && !COLUMNS.includes(colFilter)) {
        return sendError(res, 400, 'VALIDATION_ERROR',
          `Invalid column '${colFilter}'. Must be one of: ${COLUMNS.join(', ')}`);
      }

      const columns = colFilter ? [colFilter] : COLUMNS;
      const flat = [];
      for (const col of columns) {
        for (const task of store.getTasksByColumn(spaceId, col)) {
          if (!assigned || task.assigned === assigned) {
            flat.push({ ...task, _col: col });
          }
        }
      }

      const total = flat.length;

      let startIdx = 0;
      if (cursor) {
        try {
          const { col, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
          const idx = flat.findIndex((t) => t._col === col && t.id === id);
          startIdx = idx === -1 ? 0 : idx + 1;
        } catch {
          return sendError(res, 400, 'VALIDATION_ERROR', 'Invalid cursor value');
        }
      }

      const page = flat.slice(startIdx, startIdx + limit);

      let nextCursor = null;
      if (startIdx + limit < total) {
        const last = page[page.length - 1];
        nextCursor = Buffer.from(JSON.stringify({ col: last._col, id: last.id })).toString('base64url');
      }

      const result = {};
      for (const col of columns) {
        result[col] = [];
      }
      for (const task of page) {
        const { _col, ...rest } = task;
        result[_col].push(stripAttachmentContent(rest));
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

    const { valid, errors, data } = validateCreatePayload(body);
    if (!valid) {
      return sendError(res, 400, 'VALIDATION_ERROR', errors.join('; '));
    }

    const attachmentResult = validateAttachments(body.attachments);
    if (!attachmentResult.valid) {
      return sendError(res, 400, 'VALIDATION_ERROR', attachmentResult.errors.join('; '));
    }

    const now  = new Date().toISOString();
    const task = {
      id:    crypto.randomUUID(),
      title: data.title,
      type:  data.type,
      ...(data.description !== undefined && { description: data.description }),
      ...(data.assigned    !== undefined && { assigned:    data.assigned }),
      ...(data.pipeline    !== undefined && { pipeline:    data.pipeline }),
      ...(attachmentResult.data.length > 0 && { attachments: attachmentResult.data }),
      createdAt: now,
      updatedAt: now,
    };

    try {
      store.insertTask(task, spaceId, 'todo');
      if (task.pipeline) {
        process.stderr.write(JSON.stringify({
          event: 'task.pipeline_field_set', spaceId,
          taskId: task.id, stages: task.pipeline, source: 'api',
        }) + '\n');
      }
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
    if (!to || !COLUMNS.includes(to)) {
      return sendError(res, 400, 'VALIDATION_ERROR',
        `to is required and must be one of: ${COLUMNS.join(', ')}`);
    }

    try {
      // Find current column first (needed for same-column short-circuit).
      let sourceColumn = null;
      for (const col of COLUMNS) {
        const tasks = store.getTasksByColumn(spaceId, col);
        if (tasks.find((t) => t.id === taskId)) {
          sourceColumn = col;
          break;
        }
      }

      if (!sourceColumn) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }

      if (sourceColumn === to) {
        const task = store.getTask(spaceId, taskId);
        return sendJSON(res, 200, { task, from: sourceColumn, to });
      }

      // Atomic single-UPDATE move.
      const updatedTask = store.moveTask(spaceId, taskId, to);
      if (!updatedTask) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }

      sendJSON(res, 200, { task: updatedTask, from: sourceColumn, to });
    } catch (err) {
      console.error(`PUT tasks/${taskId}/move error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to move task');
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

    const UPDATABLE_FIELDS = ['title', 'type', 'description', 'assigned', 'pipeline'];
    const provided         = UPDATABLE_FIELDS.filter((f) => f in body);

    if (provided.length === 0) {
      return sendError(res, 400, 'VALIDATION_ERROR',
        `At least one of the following fields is required: ${UPDATABLE_FIELDS.join(', ')}`);
    }

    const errors = [];

    if ('title' in body) {
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        errors.push('title must be a non-empty string');
      } else if (body.title.trim().length > TITLE_MAX_LEN) {
        errors.push(`title must not exceed ${TITLE_MAX_LEN} characters`);
      }
    }

    if ('type' in body) {
      if (!VALID_TYPES.includes(body.type)) {
        errors.push(`type must be one of: ${VALID_TYPES.join(', ')}`);
      }
    }

    if ('description' in body) {
      if (typeof body.description !== 'string') {
        errors.push('description must be a string when provided');
      } else if (body.description.trim().length > DESCRIPTION_MAX_LEN) {
        errors.push(`description must not exceed ${DESCRIPTION_MAX_LEN} characters`);
      }
    }

    if ('assigned' in body) {
      if (typeof body.assigned !== 'string') {
        errors.push('assigned must be a string when provided');
      } else if (body.assigned.trim().length > ASSIGNED_MAX_LEN) {
        errors.push(`assigned must not exceed ${ASSIGNED_MAX_LEN} characters`);
      }
    }

    let pipelineUpdateResult;
    if ('pipeline' in body) {
      pipelineUpdateResult = validatePipelineField(body.pipeline);
      if (!pipelineUpdateResult.valid) {
        errors.push(pipelineUpdateResult.error);
      }
    }

    if (errors.length > 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', errors.join('; '));
    }

    try {
      const existing = store.getTask(spaceId, taskId);
      if (!existing) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
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

      if ('pipeline' in body && pipelineUpdateResult) {
        patch.pipeline = pipelineUpdateResult.data; // undefined = clear
        if (pipelineUpdateResult.data !== undefined) {
          process.stderr.write(JSON.stringify({
            event: 'task.pipeline_field_set', taskId,
            stages: pipelineUpdateResult.data, source: 'api',
          }) + '\n');
        }
      }

      const updatedTask = store.updateTask(spaceId, taskId, patch);
      sendJSON(res, 200, stripAttachmentContent(updatedTask));
    } catch (err) {
      console.error(`PUT tasks/${taskId} error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update task');
    }
  }

  function handleClearBoard(req, res) {
    try {
      // Count first (for the response payload).
      const total = store.getAllTasksForSpace(spaceId).length;
      store.clearSpace(spaceId);
      sendJSON(res, 200, { deleted: total });
    } catch (err) {
      console.error('DELETE tasks error:', err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to clear board');
    }
  }

  function handleDeleteTask(req, res, taskId) {
    try {
      const deleted = store.deleteTask(spaceId, taskId);
      if (!deleted) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }
      sendJSON(res, 200, { deleted: true, id: taskId });
    } catch (err) {
      console.error(`DELETE tasks/${taskId} error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to delete task');
    }
  }

  async function handleUpdateAttachments(req, res, taskId) {
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

    if (!Array.isArray(body.attachments)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'attachments field is required and must be an array');
    }

    const attachmentResult = validateAttachments(body.attachments);
    if (!attachmentResult.valid) {
      return sendError(res, 400, 'VALIDATION_ERROR', attachmentResult.errors.join('; '));
    }

    try {
      const existing = store.getTask(spaceId, taskId);
      if (!existing) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }

      const patch = {
        attachments: attachmentResult.data.length > 0 ? attachmentResult.data : undefined,
        updatedAt:   new Date().toISOString(),
      };

      const updatedTask = store.updateTask(spaceId, taskId, patch);

      console.log(`[attachment] Updated ${attachmentResult.data.length} attachments for task ${taskId}`);
      sendJSON(res, 200, stripAttachmentContent(updatedTask));
    } catch (err) {
      console.error(`PUT tasks/${taskId}/attachments error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update attachments');
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

  function handleSearchTasks(req, res) {
    const qs    = new URL(req.url, 'http://x').searchParams;
    const query = qs.get('q');

    if (!query || query.trim().length === 0) {
      return sendError(res, 400, 'VALIDATION_ERROR',
        'Query parameter q is required and must not be empty');
    }

    const limitRaw = qs.get('limit');
    const limit    = limitRaw != null
      ? Math.min(100, Math.max(1, parseInt(limitRaw, 10) || 20))
      : 20;

    try {
      const results = store.searchTasks(spaceId, query, { limit });
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

    const moveMatch = TASK_MOVE_ROUTE.exec(taskPath);
    if (method === 'PUT' && moveMatch) {
      return handleMoveTask(req, res, moveMatch[1]);
    }

    const singleMatch = TASK_SINGLE_ROUTE.exec(taskPath);
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

module.exports = { createApp, validatePipelineField };
