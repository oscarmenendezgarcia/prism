'use strict';

/**
 * Task router factory.
 *
 * ADR-002: Direct disk persistence via JSON files in ./data/.
 *
 * createApp() returns an isolated router bound to a specific data directory.
 * All file I/O is scoped to `dataDir`; no module-level mutable state is used.
 */

const fs   = require('fs');
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
// Agent IDs must be safe identifier strings — no path separators or traversal
// segments. Allows lowercase letters, digits, and hyphens only.
const PIPELINE_STAGE_ID_RE = /^[a-z0-9-]+$/;

const ATTACHMENT_MAX_COUNT         = 20;
const ATTACHMENT_NAME_MAX_LEN      = 100;
const ATTACHMENT_TEXT_MAX_BYTES    = 100 * 1024;   // 100 KB
const ATTACHMENT_FILE_MAX_BYTES    = 5 * 1024 * 1024; // 5 MB
const VALID_ATTACHMENT_TYPES       = ['text', 'file'];

// ---------------------------------------------------------------------------
// Route patterns (compiled once — reused for every request)
// ---------------------------------------------------------------------------

const TASK_MOVE_ROUTE               = /^\/tasks\/([^/]+)\/move$/;
const TASK_ATTACHMENTS_ROUTE        = /^\/tasks\/([^/]+)\/attachments$/;
const TASK_ATTACHMENT_CONTENT_ROUTE = /^\/tasks\/([^/]+)\/attachments\/(\d+)$/;
const TASK_SINGLE_ROUTE             = /^\/tasks\/([^/]+)$/;

// ---------------------------------------------------------------------------
// Pipeline field validation (T-001)
//
// Shared by handleCreateTask, handleUpdateTask, and handleAutoTaskGenerate.
// Kept at module scope (not inside createApp) so autoTask.js can require it.
//
// Returns:
//   { valid: true,  data: string[] }  — non-empty trimmed pipeline
//   { valid: true,  data: undefined } — absent or empty ("clear" semantics)
//   { valid: false, error: string }   — invalid type / length
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
    return { valid: true, data: undefined }; // empty = clear the field
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
    // BUG-002: Reject path-like characters to prevent path traversal.
    // Agent IDs must be lowercase alphanumeric with hyphens only.
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
 * Create a router and supporting helpers bound to the given data directory.
 *
 * @param {string} dataDir - Absolute path to the directory holding column JSON files.
 * @returns {{ router: Function, ensureDataFiles: Function }}
 */
function createApp(dataDir) {
  const COLUMN_FILES = {
    todo:          path.join(dataDir, 'todo.json'),
    'in-progress': path.join(dataDir, 'in-progress.json'),
    done:          path.join(dataDir, 'done.json'),
  };

  // -------------------------------------------------------------------------
  // Disk persistence helpers (ADR-002: no in-memory cache)
  // -------------------------------------------------------------------------

  function readColumn(column) {
    const filePath = COLUMN_FILES[column];
    const raw    = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn(`[readColumn] ${filePath} contained non-Array data; treating as [].`);
      return [];
    }
    return parsed;
  }

  function writeColumn(column, tasks) {
    const filePath = COLUMN_FILES[column];
    const tmpPath  = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(tasks, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  }

  function ensureDataFiles() {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    for (const filePath of Object.values(COLUMN_FILES)) {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '[]', 'utf8');
        console.log(`Created missing data file: ${filePath}`);
      }
    }
  }

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

    // T-002: validate optional pipeline field
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
        pipeline:    pipelineResult.data, // undefined when absent or empty
      },
    };
  }

  // -------------------------------------------------------------------------
  // Attachment content strip helper
  // Strips attachment content from API responses — content served separately
  // via GET /tasks/:id/attachments/:index
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
      const qs       = new URL(req.url, 'http://x').searchParams;
      const colFilter = qs.get('column')   || null;
      const assigned  = qs.get('assigned') || null;
      const limitRaw  = qs.get('limit');
      const cursor    = qs.get('cursor')   || null;

      // No limit param → return all tasks (frontend use case).
      // Explicit limit → cap at 200 (MCP/agent use case).
      const limit = limitRaw != null ? Math.min(200, Math.max(1, parseInt(limitRaw, 10) || 50)) : Infinity;

      if (colFilter && !COLUMNS.includes(colFilter)) {
        return sendError(res, 400, 'VALIDATION_ERROR', `Invalid column '${colFilter}'. Must be one of: ${COLUMNS.join(', ')}`);
      }

      // Build flat sequence: todo → in-progress → done
      const columns = colFilter ? [colFilter] : COLUMNS;
      const flat = [];
      for (const col of columns) {
        for (const task of readColumn(col)) {
          if (!assigned || task.assigned === assigned) {
            flat.push({ ...task, _col: col });
          }
        }
      }

      const total = flat.length;

      // Decode cursor: base64url of JSON { col, id }
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

      // Build next cursor if there are more items beyond this page
      let nextCursor = null;
      if (startIdx + limit < total) {
        const last = page[page.length - 1];
        nextCursor = Buffer.from(JSON.stringify({ col: last._col, id: last.id })).toString('base64url');
      }

      // Re-group into columns, strip internal _col field and attachment content
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
      // T-002: store pipeline only when non-empty (undefined = omit key)
      ...(data.pipeline    !== undefined && { pipeline:    data.pipeline }),
      ...(attachmentResult.data.length > 0 && { attachments: attachmentResult.data }),
      createdAt: now,
      updatedAt: now,
    };

    try {
      const tasks = readColumn('todo');
      tasks.push(task);
      writeColumn('todo', tasks);
      if (task.pipeline) {
        process.stderr.write(JSON.stringify({
          event: 'task.pipeline_field_set', spaceId: 'unknown',
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
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        `to is required and must be one of: ${COLUMNS.join(', ')}`
      );
    }

    try {
      let foundTask           = null;
      let sourceColumn        = null;
      let sourceTasksSnapshot = null;

      for (const column of COLUMNS) {
        const tasks = readColumn(column);
        const index = tasks.findIndex((t) => t.id === taskId);
        if (index !== -1) {
          foundTask           = tasks[index];
          sourceColumn        = column;
          sourceTasksSnapshot = tasks;
          break;
        }
      }

      if (!foundTask) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }

      if (sourceColumn === to) {
        return sendJSON(res, 200, { task: foundTask, from: sourceColumn, to });
      }

      const updatedSource = sourceTasksSnapshot.filter((t) => t.id !== taskId);
      writeColumn(sourceColumn, updatedSource);

      const updatedTask  = { ...foundTask, updatedAt: new Date().toISOString() };
      const targetTasks  = readColumn(to);
      targetTasks.push(updatedTask);
      writeColumn(to, targetTasks);

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

    // T-003: 'pipeline' added to updatable fields
    const UPDATABLE_FIELDS = ['title', 'type', 'description', 'assigned', 'pipeline'];
    const provided         = UPDATABLE_FIELDS.filter((f) => f in body);

    if (provided.length === 0) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        `At least one of the following fields is required: ${UPDATABLE_FIELDS.join(', ')}`
      );
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

    // T-003: validate pipeline when provided
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
      let foundTask   = null;
      let foundColumn = null;
      let columnTasks = null;

      for (const column of COLUMNS) {
        const tasks = readColumn(column);
        const index = tasks.findIndex((t) => t.id === taskId);
        if (index !== -1) {
          foundTask   = tasks[index];
          foundColumn = column;
          columnTasks = tasks;
          break;
        }
      }

      if (!foundTask) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }

      const updatedTask = { ...foundTask, updatedAt: new Date().toISOString() };

      if ('title' in body) updatedTask.title = body.title.trim();
      if ('type' in body) updatedTask.type = body.type;
      if ('description' in body) {
        const trimmed = body.description.trim();
        if (trimmed.length > 0) {
          updatedTask.description = trimmed;
        } else {
          delete updatedTask.description;
        }
      }
      if ('assigned' in body) {
        const trimmed = body.assigned.trim();
        if (trimmed.length > 0) {
          updatedTask.assigned = trimmed;
        } else {
          delete updatedTask.assigned;
        }
      }

      // T-003: apply pipeline update
      // data: string[] → set; data: undefined (empty array input) → delete key
      if ('pipeline' in body && pipelineUpdateResult) {
        if (pipelineUpdateResult.data !== undefined) {
          updatedTask.pipeline = pipelineUpdateResult.data;
          process.stderr.write(JSON.stringify({
            event: 'task.pipeline_field_set', taskId,
            stages: pipelineUpdateResult.data, source: 'api',
          }) + '\n');
        } else {
          delete updatedTask.pipeline;
        }
      }

      const taskIndex = columnTasks.findIndex((t) => t.id === taskId);
      columnTasks[taskIndex] = updatedTask;
      writeColumn(foundColumn, columnTasks);

      sendJSON(res, 200, stripAttachmentContent(updatedTask));
    } catch (err) {
      console.error(`PUT tasks/${taskId} error:`, err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update task');
    }
  }

  function handleClearBoard(req, res) {
    try {
      let totalCount = 0;
      for (const column of COLUMNS) {
        totalCount += readColumn(column).length;
      }
      for (const column of COLUMNS) {
        writeColumn(column, []);
      }
      sendJSON(res, 200, { deleted: totalCount });
    } catch (err) {
      console.error('DELETE tasks error:', err);
      sendError(res, 500, 'INTERNAL_ERROR', 'Failed to clear board');
    }
  }

  function handleDeleteTask(req, res, taskId) {
    try {
      let deleted = false;

      for (const column of COLUMNS) {
        const tasks = readColumn(column);
        const index = tasks.findIndex((t) => t.id === taskId);
        if (index !== -1) {
          tasks.splice(index, 1);
          writeColumn(column, tasks);
          deleted = true;
          break;
        }
      }

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
      let foundTask   = null;
      let foundColumn = null;
      let columnTasks = null;

      for (const column of COLUMNS) {
        const tasks = readColumn(column);
        const index = tasks.findIndex((t) => t.id === taskId);
        if (index !== -1) {
          foundTask   = tasks[index];
          foundColumn = column;
          columnTasks = tasks;
          break;
        }
      }

      if (!foundTask) {
        return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
      }

      const updatedTask = { ...foundTask, updatedAt: new Date().toISOString() };

      if (attachmentResult.data.length > 0) {
        updatedTask.attachments = attachmentResult.data;
      } else {
        delete updatedTask.attachments;
      }

      const taskIndex = columnTasks.findIndex((t) => t.id === taskId);
      columnTasks[taskIndex] = updatedTask;
      writeColumn(foundColumn, columnTasks);

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
      let foundTask = null;

      for (const column of COLUMNS) {
        const tasks = readColumn(column);
        const task  = tasks.find((t) => t.id === taskId);
        if (task) {
          foundTask = task;
          break;
        }
      }

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
  // Router
  //
  // NOTE: urlPath (taskPath) is already stripped of the space prefix.
  // It always starts with /tasks or /tasks/...
  // -------------------------------------------------------------------------

  async function router(req, res, taskPath) {
    const { method } = req;

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

    return null; // signal: route not matched — let outer router handle
  }

  return { router, ensureDataFiles };
}

module.exports = { createApp, validatePipelineField };
