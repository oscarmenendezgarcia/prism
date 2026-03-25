/**
 * Prism - HTTP Server
 *
 * ADR-001: Native Node.js http module, no frameworks.
 * ADR-002: Direct disk persistence via JSON files in ./data/.
 * ADR-1 (Spaces): Directory-per-space model, eager migration at startup,
 *   nested REST routes with legacy backward-compatibility shim.
 *
 * Usage: node server.js
 * Port: 3000 (or PORT env var)
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { migrate }             = require('./src/migrator');
const { createSpaceManager }  = require('./src/spaceManager');
const pipelineManager         = require('./src/pipelineManager');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PORT     = parseInt(process.env.PORT || '3000', 10);
const DEFAULT_DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

/** Canonical column identifiers */
const COLUMNS = ['todo', 'in-progress', 'done'];

/** MIME types for static file serving */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

// Vite build output — the only static root. The legacy public/ directory was
// removed after the React migration; all frontend assets now live here.
const PUBLIC_DIR = path.join(__dirname, 'dist');

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_TYPES          = ['research', 'task'];
const TITLE_MAX_LEN        = 200;
const DESCRIPTION_MAX_LEN  = 1000;
const ASSIGNED_MAX_LEN     = 50;

/** Attachment constraints */
const ATTACHMENT_MAX_COUNT         = 20;
const ATTACHMENT_NAME_MAX_LEN      = 100;
const ATTACHMENT_TEXT_MAX_BYTES    = 100 * 1024;   // 100 KB
const ATTACHMENT_FILE_MAX_BYTES    = 5 * 1024 * 1024; // 5 MB
const VALID_ATTACHMENT_TYPES       = ['text', 'file'];

// ---------------------------------------------------------------------------
// App factory — creates an isolated router bound to a specific data directory
// ---------------------------------------------------------------------------

/**
 * Create a router and supporting helpers bound to the given data directory.
 * All file I/O is scoped to `dataDir`; no module-level mutable state is used.
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
  // Validation helpers
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
      },
    };
  }

  // -------------------------------------------------------------------------
  // Response helpers
  // -------------------------------------------------------------------------

  function sendJSON(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type':   'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  function sendError(res, status, code, message) {
    sendJSON(res, status, { error: { code, message } });
  }

  // -------------------------------------------------------------------------
  // Request body parser
  // -------------------------------------------------------------------------

  function parseBody(req) {
    return new Promise((resolve, reject) => {
      const MAX_BYTES = 512 * 1024;
      const chunks    = [];
      let totalBytes  = 0;

      req.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BYTES) {
          reject(new Error('PAYLOAD_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw.length > 0 ? JSON.parse(raw) : null);
        } catch {
          reject(new Error('INVALID_JSON'));
        }
      });

      req.on('error', reject);
    });
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
  // API route handlers
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

      // Validate column filter
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
      ...(attachmentResult.data.length > 0 && { attachments: attachmentResult.data }),
      createdAt: now,
      updatedAt: now,
    };

    try {
      const tasks = readColumn('todo');
      tasks.push(task);
      writeColumn('todo', tasks);
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

    const UPDATABLE_FIELDS = ['title', 'type', 'description', 'assigned'];
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

    if (errors.length > 0) {
      return sendError(res, 400, 'VALIDATION_ERROR', errors.join('; '));
    }

    try {
      let foundTask  = null;
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
  // Router — matches task-level routes for a specific data directory
  //
  // NOTE: urlPath passed in here is already stripped of the space prefix.
  // It always starts with /tasks or /tasks/...
  // -------------------------------------------------------------------------

  const TASK_MOVE_ROUTE             = /^\/tasks\/([^/]+)\/move$/;
  const TASK_ATTACHMENTS_ROUTE      = /^\/tasks\/([^/]+)\/attachments$/;
  const TASK_ATTACHMENT_CONTENT_ROUTE = /^\/tasks\/([^/]+)\/attachments\/(\d+)$/;
  const TASK_SINGLE_ROUTE           = /^\/tasks\/([^/]+)$/;

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

// ---------------------------------------------------------------------------
// Static file handler (module-level — shared across all requests)
// ---------------------------------------------------------------------------

function handleStatic(req, res) {
  const urlPath     = req.url.split('?')[0];
  const relativePath = urlPath === '/' ? 'index.html' : urlPath.slice(1);

  const resolved = path.resolve(PUBLIC_DIR, relativePath);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
    const payload = JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
    return res.end(payload);
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    // SPA fallback: serve index.html for client-side routes (e.g. /cards).
    // Only fall back if the path has no file extension (i.e. it looks like a route, not an asset).
    const ext = path.extname(urlPath);
    if (!ext) {
      const indexPath = path.resolve(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': content.length });
        return res.end(content);
      }
    }
    const payload = JSON.stringify({ error: { code: 'NOT_FOUND', message: `File '${urlPath}' not found` } });
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
    return res.end(payload);
  }

  const ext         = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(resolved);
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': content.length });
    res.end(content);
  } catch (err) {
    console.error(`Static file error for ${resolved}:`, err);
    const payload = JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Failed to read file' } });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
  }
}

// ---------------------------------------------------------------------------
// Shared JSON helpers (used by space route handlers)
// ---------------------------------------------------------------------------

function sendJSON(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':   'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res, status, code, message, extra = {}) {
  sendJSON(res, status, { error: { code, message, ...extra } });
}

// ---------------------------------------------------------------------------
// Request body parser (module-level reuse by space handlers)
// ---------------------------------------------------------------------------

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const MAX_BYTES = 512 * 1024;
    const chunks    = [];
    let totalBytes  = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BYTES) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw.length > 0 ? JSON.parse(raw) : null);
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Config file registry — ADR-1 (Config Editor Panel)
//
// Security boundary: no user-supplied paths are ever used in file I/O.
// All paths are derived from known directories and validated file IDs only.
// ---------------------------------------------------------------------------

const CONFIG_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Build the file ID registry by scanning ~/.claude/*.md (global) and
 * checking ./CLAUDE.md (project). Rebuilt on every list request so newly
 * created files are picked up without a server restart.
 *
 * File ID pattern: {scope}-{filename-without-extension-kebab}-md
 * Example: "CLAUDE.md" in global scope → "global-claude-md"
 *
 * @param {string} [workingDirectory] - Optional project dir. If set, also loads
 *   <workingDirectory>/CLAUDE.md and <workingDirectory>/.claude/agents/*.md.
 * @returns {Map<string, { id: string, name: string, scope: string, absPath: string, directory: string }>}
 */
function buildConfigRegistry(workingDirectory) {
  const registry = new Map();

  // ── Global files: ~/.claude/*.md ─────────────────────────────────────────
  const globalDir = path.join(os.homedir(), '.claude');
  if (fs.existsSync(globalDir)) {
    let entries;
    try {
      entries = fs.readdirSync(globalDir);
    } catch {
      entries = [];
    }
    const mdFiles = entries
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .sort(); // alphabetical

    for (const filename of mdFiles) {
      const absPath = path.join(globalDir, filename);
      const stem    = filename.slice(0, -3); // strip ".md"
      const kebab   = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const id      = `global-${kebab}-md`;
      registry.set(id, {
        id,
        name:      filename,
        scope:     'global',
        absPath,
        directory: '~/.claude',
      });
    }
  }

  // ── Agent files: ~/.claude/agents/*.md ───────────────────────────────────
  const agentsDir = path.join(os.homedir(), '.claude', 'agents');
  if (fs.existsSync(agentsDir)) {
    let agentEntries;
    try {
      agentEntries = fs.readdirSync(agentsDir);
    } catch {
      agentEntries = [];
    }
    const agentMdFiles = agentEntries
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .sort();

    for (const filename of agentMdFiles) {
      const absPath = path.join(agentsDir, filename);
      const stem    = filename.slice(0, -3);
      const kebab   = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const id      = `agent-${kebab}-md`;
      registry.set(id, {
        id,
        name:      filename,
        scope:     'agent',
        absPath,
        directory: '~/.claude/agents',
      });
    }
  }

  // ── Project file: ./CLAUDE.md ─────────────────────────────────────────────
  // Only include Prism's own CLAUDE.md when no space workingDirectory is active,
  // to avoid showing an unrelated project file in other spaces' config panels.
  if (!workingDirectory) {
    const projectClaudeMd = path.join(process.cwd(), 'CLAUDE.md');
    if (fs.existsSync(projectClaudeMd)) {
      registry.set('project-claude-md', {
        id:        'project-claude-md',
        name:      'CLAUDE.md',
        scope:     'project',
        absPath:   projectClaudeMd,
        directory: './',
      });
    }
  }

  // ── Space project files: <workingDirectory>/CLAUDE.md + /.claude/agents/ ──
  if (workingDirectory) {
    const spaceClaudeMd = path.join(workingDirectory, 'CLAUDE.md');
    if (fs.existsSync(spaceClaudeMd)) {
      registry.set('space-claude-md', {
        id:        'space-claude-md',
        name:      'CLAUDE.md',
        scope:     'space-project',
        absPath:   spaceClaudeMd,
        directory: workingDirectory,
      });
    }

    const spaceAgentsDir = path.join(workingDirectory, '.claude', 'agents');
    if (fs.existsSync(spaceAgentsDir)) {
      let spaceAgentEntries;
      try {
        spaceAgentEntries = fs.readdirSync(spaceAgentsDir);
      } catch {
        spaceAgentEntries = [];
      }
      const spaceAgentMdFiles = spaceAgentEntries
        .filter((f) => f.toLowerCase().endsWith('.md'))
        .sort();

      for (const filename of spaceAgentMdFiles) {
        const absPath = path.join(spaceAgentsDir, filename);
        const stem    = filename.slice(0, -3);
        const kebab   = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const id      = `space-agent-${kebab}-md`;
        registry.set(id, {
          id,
          name:      filename,
          scope:     'space-agent',
          absPath,
          directory: path.join(workingDirectory, '.claude', 'agents'),
        });
      }
    }
  }

  return registry;
}

/**
 * Resolve workingDirectory for config registry from an optional spaceId query param.
 * @param {http.IncomingMessage} req
 * @param {object} spaceManager
 * @returns {string|undefined}
 */
function resolveWorkingDirFromQuery(req, spaceManager) {
  const urlObj = new URL(req.url, 'http://x');
  const spaceId = urlObj.searchParams.get('spaceId');
  if (!spaceId) return undefined;
  const result = spaceManager.getSpace(spaceId);
  return result.ok ? result.space.workingDirectory : undefined;
}

/**
 * GET /api/v1/config/files[?spaceId=...]
 * List all available config files. Registry rebuilt on each call.
 * If spaceId is provided, also includes files from the space's workingDirectory.
 */
function handleConfigListFiles(req, res, spaceManager) {
  try {
    const workingDirectory = resolveWorkingDirFromQuery(req, spaceManager);
    const registry = buildConfigRegistry(workingDirectory);
    const files    = [];

    for (const entry of registry.values()) {
      let stat;
      try {
        stat = fs.statSync(entry.absPath);
      } catch {
        continue; // file disappeared between readdir and stat — skip it
      }
      files.push({
        id:         entry.id,
        name:       entry.name,
        scope:      entry.scope,
        directory:  entry.directory,
        sizeBytes:  stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    }

    console.log(`[config] Listed ${files.length} config files`);
    sendJSON(res, 200, files);
  } catch (err) {
    console.error('[config] ERROR listing files:', err.message);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to list config files');
  }
}

/**
 * GET /api/v1/config/files/:fileId[?spaceId=...]
 * Read a config file's full content.
 */
function handleConfigReadFile(req, res, fileId, spaceManager) {
  try {
    const workingDirectory = resolveWorkingDirFromQuery(req, spaceManager);
    const registry = buildConfigRegistry(workingDirectory);
    const entry    = registry.get(fileId);

    if (!entry) {
      return sendError(res, 404, 'FILE_NOT_FOUND', `Config file '${fileId}' was not found.`);
    }

    let stat;
    try {
      stat = fs.statSync(entry.absPath);
    } catch {
      return sendError(res, 404, 'FILE_NOT_FOUND', `Config file '${fileId}' was not found on disk.`);
    }

    const content = fs.readFileSync(entry.absPath, 'utf8');
    console.log(`[config] Read file ${fileId} (${stat.size} bytes)`);

    sendJSON(res, 200, {
      id:         entry.id,
      name:       entry.name,
      scope:      entry.scope,
      content,
      sizeBytes:  stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  } catch (err) {
    console.error(`[config] ERROR reading file ${fileId}:`, err.message);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read config file');
  }
}

/**
 * PUT /api/v1/config/files/:fileId
 * Atomically overwrite a config file using .tmp + renameSync.
 */
async function handleConfigSaveFile(req, res, fileId, spaceManager) {
  // Parse body — use a larger limit for config files (up to 1 MB content + JSON overhead).
  let body;
  try {
    body = await parseBodyWithLimit(req, CONFIG_MAX_BYTES + 256);
  } catch (err) {
    if (err.message === 'PAYLOAD_TOO_LARGE') {
      return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'File content exceeds the 1 MB limit.', { field: 'content' });
    }
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  // Validate content field.
  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'content' field is required and must be a string.", { field: 'content' });
  }
  if (!('content' in body)) {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'content' field is required and must be a string.", { field: 'content' });
  }
  if (typeof body.content !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'content' field must be a string, not a number or object.", { field: 'content' });
  }

  // Check size after type validation.
  const byteLen = Buffer.byteLength(body.content, 'utf8');
  if (byteLen > CONFIG_MAX_BYTES) {
    const receivedMB = (byteLen / (1024 * 1024)).toFixed(1);
    return sendError(res, 413, 'PAYLOAD_TOO_LARGE', `File content exceeds the 1 MB limit (received ${receivedMB} MB).`, { field: 'content' });
  }

  // Validate file ID against registry (security boundary — no path traversal possible).
  const workingDirectory = resolveWorkingDirFromQuery(req, spaceManager);
  const registry = buildConfigRegistry(workingDirectory);
  const entry    = registry.get(fileId);
  if (!entry) {
    return sendError(res, 404, 'FILE_NOT_FOUND', `Config file '${fileId}' was not found.`);
  }

  // Atomic write: write to .tmp then rename.
  const tmpPath = entry.absPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, body.content, 'utf8');
    fs.renameSync(tmpPath, entry.absPath);
  } catch (err) {
    // Clean up tmp file on failure if it exists.
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    console.error(`[config] ERROR saving file ${fileId}:`, err.message);
    return sendError(res, 500, 'WRITE_FAILED', `Could not save ${entry.name}. The file system may be read-only or permissions may be insufficient.`);
  }

  const stat = fs.statSync(entry.absPath);
  console.log(`[config] Saved file ${fileId} (${stat.size} bytes)`);

  sendJSON(res, 200, {
    id:         entry.id,
    name:       entry.name,
    scope:      entry.scope,
    sizeBytes:  stat.size,
    modifiedAt: stat.mtime.toISOString(),
  });
}

/**
 * Body parser with a configurable byte limit.
 * Used by config save endpoint which accepts up to ~1 MB.
 */
function parseBodyWithLimit(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks   = [];
    let totalBytes = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw.length > 0 ? JSON.parse(raw) : null);
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', reject);
  });
}

/** Route patterns for config endpoints (compiled once at module level). */
const CONFIG_FILES_LIST_ROUTE   = /^\/api\/v1\/config\/files$/;
const CONFIG_FILES_SINGLE_ROUTE = /^\/api\/v1\/config\/files\/([^/]+)$/;

// ---------------------------------------------------------------------------
// Agent launcher — ADR-1: Agent Launcher
//
// Security boundary: agentId must match /^[a-z0-9]+(-[a-z0-9]+)*$/ and is
// only resolved against ~/.claude/agents/. No user-supplied paths used.
// ---------------------------------------------------------------------------

const AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents');
const AGENT_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Convert a kebab-case stem to Title Case display name.
 * "senior-architect" → "Senior Architect"
 */
function toDisplayName(stem) {
  return stem
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * GET /api/v1/agents
 * List all .md files in ~/.claude/agents/, returning agent metadata.
 * Returns [] if the directory does not exist.
 */
function handleListAgents(req, res) {
  if (!fs.existsSync(AGENTS_DIR)) {
    return sendJSON(res, 200, []);
  }

  let entries;
  try {
    entries = fs.readdirSync(AGENTS_DIR);
  } catch (err) {
    console.error('[agents] ERROR reading agents dir:', err.message);
    return sendError(res, 500, 'AGENT_DIRECTORY_READ_ERROR', 'Could not read the agents directory.', {
      suggestion: 'Check that ~/.claude/agents/ is accessible and has read permissions.',
    });
  }

  const agents = [];
  const mdFiles = entries.filter((f) => f.toLowerCase().endsWith('.md')).sort();

  for (const filename of mdFiles) {
    const absPath = path.join(AGENTS_DIR, filename);
    let stat;
    try {
      stat = fs.statSync(absPath);
    } catch {
      continue; // file disappeared between readdir and stat — skip
    }
    const stem = filename.slice(0, -3);
    const id   = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    agents.push({
      id,
      name:        filename,
      displayName: toDisplayName(stem),
      path:        absPath,
      sizeBytes:   stat.size,
    });
  }

  console.log(`[agents] Listed ${agents.length} agents`);
  sendJSON(res, 200, agents);
}

/**
 * GET /api/v1/agents/:agentId
 * Read the full content of a specific agent .md file.
 * Path traversal is prevented by resolving only within AGENTS_DIR.
 */
function handleGetAgent(req, res, agentId) {
  if (!AGENT_ID_RE.test(agentId)) {
    return sendError(res, 400, 'INVALID_AGENT_ID', 'The agent ID provided is not valid.', {
      suggestion: "Agent IDs must be lowercase kebab-case (e.g. 'senior-architect').",
      field: 'agentId',
    });
  }

  const filename = `${agentId}.md`;
  const absPath  = path.join(AGENTS_DIR, filename);

  // Guard: resolved path must be strictly inside AGENTS_DIR
  const resolved = path.resolve(absPath);
  if (!resolved.startsWith(AGENTS_DIR + path.sep)) {
    return sendError(res, 403, 'FORBIDDEN_PATH', 'Access to this agent file is not allowed.', {
      suggestion: 'Only agent files inside ~/.claude/agents/ can be read.',
    });
  }

  if (!fs.existsSync(resolved)) {
    return sendError(res, 404, 'AGENT_NOT_FOUND', `No agent named '${agentId}' was found.`, {
      suggestion: `Check that '${filename}' exists in ~/.claude/agents/.`,
    });
  }

  try {
    const content = fs.readFileSync(resolved, 'utf8');
    const stat    = fs.statSync(resolved);
    const stem    = agentId;
    sendJSON(res, 200, {
      id:          agentId,
      name:        filename,
      displayName: toDisplayName(stem),
      path:        resolved,
      sizeBytes:   stat.size,
      content,
    });
  } catch (err) {
    console.error(`[agents] ERROR reading agent ${agentId}:`, err.message);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read agent file');
  }
}

// ---------------------------------------------------------------------------
// Settings — ADR-1 §3.4: data/settings.json with atomic write + deep merge
// ---------------------------------------------------------------------------

// NOTE: SETTINGS_FILE is NOT a module-level constant — it is computed
// dynamically from dataDir inside readSettings/writeSettings/handleGetSettings/
// handlePutSettings so that test isolation via startServer({ dataDir }) works.
// See BUG-001: previously this was path.join(DEFAULT_DATA_DIR, 'settings.json'),
// which bypassed the dataDir option passed to startServer().

const DEFAULT_SETTINGS = {
  cli: {
    tool:            'claude',
    binary:          'claude',
    flags:           ['-p'],
    promptFlag:      '-p',
    fileInputMethod: 'cat-subshell',
  },
  pipeline: {
    autoAdvance:          true,
    confirmBetweenStages: true,
    stages: ['senior-architect', 'ux-api-designer', 'developer-agent', 'qa-engineer-e2e'],
  },
  prompts: {
    includeKanbanBlock: true,
    includeGitBlock:    true,
    workingDirectory:   '',
  },
};

const VALID_CLI_TOOLS    = ['claude', 'opencode', 'custom'];
const VALID_FILE_METHODS = ['cat-subshell', 'stdin-redirect', 'flag-file'];

/**
 * Deep-merge two plain objects (one level deep for known setting groups).
 * Immutable — returns a new object.
 */
function deepMergeSettings(base, partial) {
  const result = { ...base };
  for (const key of Object.keys(partial)) {
    if (
      partial[key] !== null &&
      typeof partial[key] === 'object' &&
      !Array.isArray(partial[key]) &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = { ...base[key], ...partial[key] };
    } else {
      result[key] = partial[key];
    }
  }
  return result;
}

/**
 * Read settings from disk (or return defaults if file absent/corrupt).
 * Never throws — falls back to defaults on any error.
 *
 * @param {string} dataDir - Root data directory for this server instance.
 */
function readSettings(dataDir) {
  const settingsFile = path.join(dataDir, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw    = fs.readFileSync(settingsFile, 'utf8');
    const parsed = JSON.parse(raw);
    return deepMergeSettings(DEFAULT_SETTINGS, parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Atomically write settings using .tmp + rename pattern.
 * Ensures data dir exists first.
 *
 * @param {string} dataDir - Root data directory for this server instance.
 * @param {object} settings - Full settings object to persist.
 */
function writeSettings(dataDir, settings) {
  const settingsFile = path.join(dataDir, 'settings.json');
  const dir          = path.dirname(settingsFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = settingsFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(tmp, settingsFile);
}

/**
 * GET /api/v1/settings
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {string}               dataDir - Scoped data directory for this server instance.
 */
function handleGetSettings(req, res, dataDir) {
  try {
    const settings = readSettings(dataDir);
    sendJSON(res, 200, settings);
  } catch (err) {
    console.error('[settings] ERROR reading settings:', err.message);
    sendError(res, 500, 'SETTINGS_READ_ERROR', 'Could not read the settings file.', {
      suggestion: 'Check that data/settings.json is readable and contains valid JSON.',
    });
  }
}

/**
 * PUT /api/v1/settings
 * Deep-merge partial body into current settings and persist atomically.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {string}               dataDir - Scoped data directory for this server instance.
 */
async function handlePutSettings(req, res, dataDir) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'The request body is empty or not valid JSON.', {
      suggestion: 'Send a partial settings object. Example: { "cli": { "tool": "opencode" } }',
    });
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'The request body is empty or not valid JSON.', {
      suggestion: 'Send a partial settings object. Example: { "cli": { "tool": "opencode" } }',
    });
  }

  // Validate cli.tool if provided
  if (body.cli && body.cli.tool !== undefined && !VALID_CLI_TOOLS.includes(body.cli.tool)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `The value '${body.cli.tool}' is not a valid CLI tool.`, {
      suggestion: "Use one of: 'claude', 'opencode', 'custom'.",
      field: 'cli.tool',
    });
  }

  // Validate cli.fileInputMethod if provided
  if (body.cli && body.cli.fileInputMethod !== undefined && !VALID_FILE_METHODS.includes(body.cli.fileInputMethod)) {
    return sendError(res, 400, 'VALIDATION_ERROR', `The value '${body.cli.fileInputMethod}' is not a valid prompt delivery method.`, {
      suggestion: "Use one of: 'cat-subshell', 'stdin-redirect', 'flag-file'.",
      field: 'cli.fileInputMethod',
    });
  }

  try {
    const current  = readSettings(dataDir);
    const merged   = deepMergeSettings(current, body);
    writeSettings(dataDir, merged);
    console.log('[settings] Settings updated');
    sendJSON(res, 200, merged);
  } catch (err) {
    console.error('[settings] ERROR writing settings:', err.message);
    sendError(res, 500, 'SETTINGS_WRITE_ERROR', 'Could not save the settings file.', {
      suggestion: 'Check that the data/ directory is writable.',
    });
  }
}

// ---------------------------------------------------------------------------
// Prompt generation — ADR-1 §3.1: temp files in data/.prompts/
// ---------------------------------------------------------------------------

// PROMPTS_DIR is NOT a module-level constant — it is computed from dataDir
// inside handlers (see BUG-001: module-level constants ignored test isolation).
const PROMPT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Build the CLI command string based on current settings and prompt file path.
 */
function buildCliCommand(settings, promptPath) {
  const { tool, binary, fileInputMethod } = settings.cli;
  const bin = binary || tool;

  let promptRef;
  if (fileInputMethod === 'stdin-redirect') {
    promptRef = `< "${promptPath}"`;
  } else if (fileInputMethod === 'flag-file') {
    promptRef = `--file "${promptPath}"`;
  } else {
    // cat-subshell (default)
    promptRef = `"$(cat ${promptPath})"`;
  }

  if (tool === 'opencode') {
    return `${bin} run ${promptRef}`;
  }

  // claude (default) — interactive mode so tool calls and thinking are visible in the TUI.
  // Omitting -p intentionally: -p (non-interactive) hides intermediate steps and exits immediately.
  // --enable-auto-mode grants full tool access; per-agent permissions to be added later.
  return `${bin} ${promptRef} --enable-auto-mode`;
}

/**
 * Build the full prompt text from task data, agent content, and instruction blocks.
 * Assembles: TASK CONTEXT, AGENT INSTRUCTIONS, KANBAN INSTRUCTIONS, GIT INSTRUCTIONS, PROJECT CONTEXT.
 */
function buildPromptText(options) {
  const { task, taskColumn, space, agentContent, settings, customInstructions, workingDirectory } = options;

  const lines = [];

  // ── TASK CONTEXT ──────────────────────────────────────────────────────────
  lines.push('## TASK CONTEXT');
  lines.push(`Title: ${task.title}`);
  if (task.type)        lines.push(`Type: ${task.type}`);
  lines.push(`Column: ${taskColumn}`);
  lines.push(`Space: ${space.name}`);
  lines.push(`Space ID: ${space.id}`);
  if (task.assigned)    lines.push(`Assigned: ${task.assigned}`);
  if (task.description) lines.push(`\nDescription:\n${task.description}`);
  if (task.attachments && task.attachments.length > 0) {
    lines.push(`\nAttachments (${task.attachments.length}):`);
    for (const att of task.attachments) {
      lines.push(`  - ${att.name} (${att.type})`);
    }
  }

  // ── AGENT INSTRUCTIONS ────────────────────────────────────────────────────
  lines.push('\n## AGENT INSTRUCTIONS');
  lines.push(agentContent);

  // ── KANBAN INSTRUCTIONS ───────────────────────────────────────────────────
  if (settings.prompts.includeKanbanBlock) {
    lines.push('\n## KANBAN INSTRUCTIONS');
    lines.push(`Prism Kanban server is running at http://localhost:3000`);
    lines.push(`Space ID: ${space.id}`);
    lines.push(`Task ID: ${task.id}  ← this task already exists. Do NOT create a new kanban task.`);
    lines.push(`Move THIS task through the board: todo → in-progress (immediately) → done (when finished).`);
    lines.push('Use the MCP tools (mcp__prism__kanban_*) to manage tasks:');
    lines.push('  - kanban_list_tasks: list tasks in a column');
    lines.push('  - kanban_move_task: move a task between columns (todo → in-progress → done)');
    lines.push('  - kanban_update_task: update task fields or attach artifacts');
    lines.push('  - kanban_create_task: create new tasks (only if genuinely needed for a sub-task)');
  }

  // ── GIT INSTRUCTIONS ──────────────────────────────────────────────────────
  if (settings.prompts.includeGitBlock) {
    lines.push('\n## GIT INSTRUCTIONS');
    lines.push('- Work on the current feature branch (do not create new branches unless specified)');
    lines.push('- Commit format: [dev] T-XXX: <task title>');
    lines.push('- Stage only task-relevant files (never git add -A or git add .)');
    lines.push('- Never commit to main directly');
  }

  // ── PROJECT CONTEXT ───────────────────────────────────────────────────────
  // Priority: request param > space.workingDirectory > global settings > omit
  const cwd = workingDirectory || space.workingDirectory || settings.prompts.workingDirectory || '';
  lines.push('\n## PROJECT CONTEXT');
  if (cwd) lines.push(`Working directory: ${cwd}`);
  lines.push(`Feature: ${space.name}`);

  // ── CUSTOM INSTRUCTIONS ───────────────────────────────────────────────────
  if (customInstructions && customInstructions.trim().length > 0) {
    lines.push('\n## ADDITIONAL INSTRUCTIONS');
    lines.push(customInstructions.trim());
  }

  return lines.join('\n');
}

/**
 * Find a task by ID across all columns for a given space.
 * Returns { task, column } or null if not found.
 */
function findTaskInSpace(spaceId, taskId, dataDir) {
  const spaceDir = path.join(dataDir, 'spaces', spaceId);
  for (const column of ['todo', 'in-progress', 'done']) {
    const filePath = path.join(spaceDir, `${column}.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const tasks = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const task  = Array.isArray(tasks) ? tasks.find((t) => t.id === taskId) : null;
      if (task) return { task, column };
    } catch { /* skip corrupt files */ }
  }
  return null;
}

/**
 * POST /api/v1/agent/prompt
 * Assemble full prompt, write to data/.prompts/, return path + CLI command.
 */
async function handleGeneratePrompt(req, res, dataDir, spaceManager) {
  let body;
  try {
    body = await parseBody(req);
  } catch {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
  }

  // Validate required fields
  for (const field of ['agentId', 'taskId', 'spaceId']) {
    if (!body[field] || typeof body[field] !== 'string') {
      return sendError(res, 400, 'VALIDATION_ERROR', `The '${field}' field is required.`, {
        suggestion: field === 'agentId'
          ? "Provide the kebab-case agent ID (e.g. 'senior-architect')."
          : `Provide a valid ${field}.`,
        field,
      });
    }
  }

  const { agentId, taskId, spaceId, customInstructions, workingDirectory } = body;

  // Validate agentId format
  if (!AGENT_ID_RE.test(agentId)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'The agent ID provided is not valid.', {
      suggestion: "Agent IDs must be lowercase kebab-case (e.g. 'senior-architect').",
      field: 'agentId',
    });
  }

  // Validate space exists
  const spaceResult = spaceManager.getSpace(spaceId);
  if (!spaceResult.ok) {
    return sendError(res, 404, 'TASK_NOT_FOUND', `Space '${spaceId}' not found.`);
  }

  // Read agent file
  const agentFilename = `${agentId}.md`;
  const agentPath     = path.join(AGENTS_DIR, agentFilename);
  if (!fs.existsSync(agentPath)) {
    return sendError(res, 404, 'AGENT_NOT_FOUND', `No agent named '${agentId}' was found.`, {
      suggestion: `Check that '${agentFilename}' exists in ~/.claude/agents/.`,
    });
  }
  const agentContent = fs.readFileSync(agentPath, 'utf8');

  // Find task
  const taskResult = findTaskInSpace(spaceId, taskId, dataDir);
  if (!taskResult) {
    return sendError(res, 404, 'TASK_NOT_FOUND', `Task '${taskId}' was not found in space '${spaceId}'.`, {
      suggestion: 'Confirm the taskId and spaceId are correct. The task may have been moved or deleted.',
    });
  }

  // Read settings — scoped to the server's dataDir, not DEFAULT_DATA_DIR.
  const settings   = readSettings(dataDir);
  const promptsDir = path.join(dataDir, '.prompts');

  // Build prompt text
  const promptText = buildPromptText({
    task:             taskResult.task,
    taskColumn:       taskResult.column,
    space:            spaceResult.space,
    agentContent,
    settings,
    customInstructions,
    workingDirectory: workingDirectory || settings.prompts.workingDirectory,
  });

  // Ensure prompts directory exists
  if (!fs.existsSync(promptsDir)) {
    fs.mkdirSync(promptsDir, { recursive: true });
  }

  // Write prompt file atomically
  const timestamp  = Date.now();
  const taskPrefix = taskId.slice(0, 8);
  const filename   = `prompt-${timestamp}-${taskPrefix}.md`;
  const promptPath = path.join(promptsDir, filename);
  const tmpPath    = promptPath + '.tmp';

  try {
    fs.writeFileSync(tmpPath, promptText, 'utf8');
    fs.renameSync(tmpPath, promptPath);
  } catch (err) {
    console.error('[prompt] ERROR writing prompt file:', err.message);
    return sendError(res, 500, 'PROMPT_WRITE_ERROR', 'Could not write the prompt file to disk.', {
      suggestion: 'Check that data/.prompts/ is writable and the disk has available space.',
    });
  }

  const cliCommand     = buildCliCommand(settings, promptPath);
  const promptPreview  = promptText.slice(0, 500);
  const estimatedTokens = Math.ceil(promptText.length / 4);

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    component: 'agent-launcher',
    event: 'agent_prompt_generated',
    agentId,
    taskId,
    spaceId,
    promptPath,
    estimatedTokens,
  }));

  sendJSON(res, 201, { promptPath, promptPreview, cliCommand, estimatedTokens });
}

// ---------------------------------------------------------------------------
// Prompt file cleanup — T-007
// ---------------------------------------------------------------------------

/**
 * Delete prompt files in data/.prompts/ that are older than TTL_MS.
 * Best-effort: individual file errors are logged but do not abort cleanup.
 *
 * @param {string} dataDir - Root data directory for this server instance.
 */
function cleanupOldPromptFiles(dataDir) {
  const promptsDir = path.join(dataDir, '.prompts');
  if (!fs.existsSync(promptsDir)) return;

  let entries;
  try {
    entries = fs.readdirSync(promptsDir);
  } catch (err) {
    console.warn('[cleanup] Could not read prompts dir:', err.message);
    return;
  }

  const cutoff = Date.now() - PROMPT_TTL_MS;
  let removed  = 0;

  for (const filename of entries) {
    if (!filename.endsWith('.md')) continue;
    const filePath = path.join(promptsDir, filename);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        removed++;
      }
    } catch (err) {
      console.warn(`[cleanup] Could not process ${filename}:`, err.message);
    }
  }

  if (removed > 0) {
    console.log(`[cleanup] Removed ${removed} old prompt file(s)`);
  }
}

/** Route patterns for agent launcher endpoints. */
const AGENTS_LIST_ROUTE   = /^\/api\/v1\/agents$/;
const AGENTS_SINGLE_ROUTE = /^\/api\/v1\/agents\/([^/]+)$/;
const AGENT_PROMPT_ROUTE  = /^\/api\/v1\/agent\/prompt$/;
const SETTINGS_ROUTE      = /^\/api\/v1\/settings$/;

// ---------------------------------------------------------------------------
// Agent run history — ADR-1 (Agent Run History)
//
// Persistence: data/agent-runs.jsonl — one JSON object per line.
// Max 500 entries enforced at POST time (prune oldest on overflow).
// Atomic rewrites use .tmp + renameSync.
// ---------------------------------------------------------------------------

/** Route patterns for agent run history endpoints. */
const AGENT_RUNS_LIST_ROUTE   = /^\/api\/v1\/agent-runs$/;
const AGENT_RUNS_SINGLE_ROUTE = /^\/api\/v1\/agent-runs\/([^/]+)$/;

const AGENT_RUNS_MAX_ENTRIES   = 500;
const STALE_THRESHOLD_MS       = 4 * 60 * 60 * 1000; // 4 hours
const VALID_TERMINAL_STATUSES  = ['completed', 'cancelled', 'failed'];
const VALID_RUN_STATUSES       = ['running', 'completed', 'cancelled', 'failed'];

/**
 * Read all run records from the JSONL file. Returns [] if file does not exist.
 *
 * @param {string} dataDir - Root data directory for this server instance.
 * @returns {object[]}
 */
function readAgentRuns(dataDir) {
  const filePath = path.join(dataDir, 'agent-runs.jsonl');
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw   = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    return lines.map((l) => JSON.parse(l));
  } catch (err) {
    console.error('[agent-runs] ERROR reading agent-runs.jsonl:', err.message);
    return [];
  }
}

/**
 * Overwrite the JSONL file atomically using .tmp + renameSync.
 *
 * @param {string} dataDir - Root data directory for this server instance.
 * @param {object[]} records - Full list of records to persist.
 */
function writeAgentRuns(dataDir, records) {
  const filePath = path.join(dataDir, 'agent-runs.jsonl');
  const tmpPath  = filePath + '.tmp';
  const content  = records.map((r) => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * POST /api/v1/agent-runs
 * Append a new run record (status=running) to data/agent-runs.jsonl.
 * Prunes to 500 entries if the file would exceed the limit.
 * Returns 201 { id } on success.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {string}               dataDir
 */
async function handleCreateAgentRun(req, res, dataDir) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }

  // Validate required fields
  const requiredFields = ['id', 'taskId', 'taskTitle', 'agentId', 'agentDisplayName',
                          'spaceId', 'spaceName', 'cliCommand', 'promptPath', 'startedAt'];

  for (const field of requiredFields) {
    if (!body[field] || typeof body[field] !== 'string') {
      return sendError(res, 400, 'VALIDATION_ERROR',
        `The '${field}' field is required and must be a non-empty string.`,
        { field });
    }
  }

  // Validate startedAt is a valid ISO timestamp
  if (isNaN(Date.parse(body.startedAt))) {
    return sendError(res, 400, 'VALIDATION_ERROR',
      'The start time must be a valid ISO 8601 timestamp.',
      { field: 'startedAt' });
  }

  const record = {
    id:               body.id,
    taskId:           body.taskId,
    taskTitle:        body.taskTitle,
    agentId:          body.agentId,
    agentDisplayName: body.agentDisplayName,
    spaceId:          body.spaceId,
    spaceName:        body.spaceName,
    status:           'running',
    startedAt:        body.startedAt,
    completedAt:      null,
    durationMs:       null,
    cliCommand:       body.cliCommand,
    promptPath:       body.promptPath,
  };

  try {
    const filePath = path.join(dataDir, 'agent-runs.jsonl');

    // Ensure data dir exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Append new record
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');

    // Prune to max 500 entries if needed
    const allLines = fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0);

    if (allLines.length > AGENT_RUNS_MAX_ENTRIES) {
      const pruned = allLines.slice(allLines.length - AGENT_RUNS_MAX_ENTRIES);
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, pruned.join('\n') + '\n', 'utf8');
      fs.renameSync(tmpPath, filePath);
    }

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level:     'info',
      component: 'agent-runs',
      event:     'run_created',
      runId:     record.id,
      status:    record.status,
    }));

    sendJSON(res, 201, { id: record.id });
  } catch (err) {
    console.error('[agent-runs] ERROR creating run:', err.message);
    sendError(res, 500, 'STORAGE_ERROR',
      'Could not save the run record. The run may not appear in history.',
      { suggestion: 'Check that the data/ directory is writable.' });
  }
}

/**
 * PATCH /api/v1/agent-runs/:runId
 * Update the status of an existing run record.
 * Rewrites the JSONL file atomically.
 * Returns 200 { id, status } on success, 404 if runId not found.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {string}               dataDir
 * @param {string}               runId
 */
async function handleUpdateAgentRun(req, res, dataDir, runId) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }

  // Validate status
  if (!body.status || !VALID_TERMINAL_STATUSES.includes(body.status)) {
    return sendError(res, 400, 'VALIDATION_ERROR',
      "The status value is not valid for an update. Use one of: completed, cancelled, failed.",
      { field: 'status' });
  }

  // Validate completedAt
  if (!body.completedAt || typeof body.completedAt !== 'string' || isNaN(Date.parse(body.completedAt))) {
    return sendError(res, 400, 'VALIDATION_ERROR',
      'A completion timestamp is required.',
      { field: 'completedAt' });
  }

  // Validate durationMs
  if (body.durationMs === undefined || body.durationMs === null || typeof body.durationMs !== 'number') {
    return sendError(res, 400, 'VALIDATION_ERROR',
      'The run duration in milliseconds is required.',
      { field: 'durationMs' });
  }

  try {
    const records = readAgentRuns(dataDir);
    const idx     = records.findIndex((r) => r.id === runId);

    if (idx === -1) {
      return sendError(res, 404, 'RUN_NOT_FOUND',
        'No agent run was found with the given ID.',
        { suggestion: 'Check that the run ID is correct.' });
    }

    records[idx] = {
      ...records[idx],
      status:      body.status,
      completedAt: body.completedAt,
      durationMs:  body.durationMs,
    };

    writeAgentRuns(dataDir, records);

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level:     'info',
      component: 'agent-runs',
      event:     'run_updated',
      runId,
      status:    body.status,
    }));

    sendJSON(res, 200, { id: runId, status: body.status });
  } catch (err) {
    console.error(`[agent-runs] ERROR updating run ${runId}:`, err.message);
    sendError(res, 500, 'STORAGE_ERROR',
      'Could not update the run record. The status may not have changed in history.',
      { suggestion: 'Check that the data/ directory is writable.' });
  }
}

/**
 * GET /api/v1/agent-runs
 * Return run history newest-first with optional status filter and limit.
 * Applies stale-run healing at read time (running > 4h → failed, not persisted).
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {string}               dataDir
 */
function handleListAgentRuns(req, res, dataDir) {
  // Parse query parameters
  const urlObj    = new URL(req.url, 'http://localhost');
  const statusFilter = urlObj.searchParams.get('status') || null;
  const limitParam   = urlObj.searchParams.get('limit');

  // Validate status filter
  if (statusFilter !== null && !VALID_RUN_STATUSES.includes(statusFilter)) {
    return sendError(res, 400, 'VALIDATION_ERROR',
      'The status filter value is not valid.',
      { suggestion: 'Use one of: running, completed, cancelled, failed.', field: 'status' });
  }

  // Validate and cap limit
  let limit = 100;
  if (limitParam !== null) {
    limit = parseInt(limitParam, 10);
    if (isNaN(limit) || limit < 1 || limit > AGENT_RUNS_MAX_ENTRIES) {
      return sendError(res, 400, 'VALIDATION_ERROR',
        'The limit must be between 1 and 500.',
        { suggestion: 'Use a number between 1 and 500. The default is 100.', field: 'limit' });
    }
  }

  try {
    const records = readAgentRuns(dataDir);
    const now     = Date.now();

    // Apply stale healing (read-time only — does NOT mutate the file)
    const healed = records.map((r) => {
      if (r.status === 'running' && (now - Date.parse(r.startedAt)) > STALE_THRESHOLD_MS) {
        return { ...r, status: 'failed', reason: 'stale' };
      }
      return r;
    });

    // Reverse to get newest-first (JSONL is append-only, so oldest are first)
    const newestFirst = [...healed].reverse();

    // Apply status filter
    const filtered = statusFilter
      ? newestFirst.filter((r) => r.status === statusFilter)
      : newestFirst;

    const total = filtered.length;
    const runs  = filtered.slice(0, limit);

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level:     'info',
      component: 'agent-runs',
      event:     'runs_listed',
      total,
      limit,
      statusFilter,
    }));

    sendJSON(res, 200, { runs, total });
  } catch (err) {
    console.error('[agent-runs] ERROR listing runs:', err.message);
    sendError(res, 500, 'STORAGE_ERROR', 'Could not load run history.',
      { suggestion: 'Check that data/agent-runs.jsonl exists and is readable.' });
  }
}

// ---------------------------------------------------------------------------
// Server factory — exported for use by tests and direct invocation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pipeline routes — ADR-1 (mcp-start-pipeline)
// POST   /api/v1/runs
// GET    /api/v1/runs/:runId
// GET    /api/v1/runs/:runId/stages/:stageIndex/log
// DELETE /api/v1/runs/:runId
// ---------------------------------------------------------------------------

/** Route patterns for pipeline run endpoints (compiled once at module level). */
const PIPELINE_RUNS_LIST_ROUTE   = /^\/api\/v1\/runs$/;
const PIPELINE_RUNS_SINGLE_ROUTE = /^\/api\/v1\/runs\/([^/]+)$/;
const PIPELINE_RUNS_LOG_ROUTE    = /^\/api\/v1\/runs\/([^/]+)\/stages\/(\d+)\/log$/;

/**
 * POST /api/v1/runs
 * Create and kick off a new pipeline run.
 * Body: { spaceId, taskId, stages? }
 * When stages is omitted, falls back to the space's default pipeline, then the global default.
 * Returns 201 with the initial run object.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {string}               dataDir
 * @param {object}               spaceManager
 */
async function handleCreateRun(req, res, dataDir, spaceManager) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }

  const { spaceId, taskId, stages } = body;

  if (!spaceId || typeof spaceId !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'spaceId' field is required.");
  }
  if (!taskId || typeof taskId !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'taskId' field is required.");
  }
  if (stages !== undefined && !Array.isArray(stages)) {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'stages' field must be an array when provided.");
  }

  // Resolve stages: explicit body > space.pipeline > pipelineManager default
  let resolvedStages = stages;
  if (!resolvedStages || resolvedStages.length === 0) {
    const spaceResult = spaceManager.getSpace(spaceId);
    if (spaceResult.ok && Array.isArray(spaceResult.space.pipeline) && spaceResult.space.pipeline.length > 0) {
      resolvedStages = spaceResult.space.pipeline;
    }
  }

  try {
    const run = await pipelineManager.createRun({ spaceId, taskId, stages: resolvedStages, dataDir });
    return sendJSON(res, 201, run);
  } catch (err) {
    if (err.code === 'TASK_NOT_FOUND')         return sendError(res, 404, err.code, err.message);
    if (err.code === 'TASK_NOT_IN_TODO')        return sendError(res, 422, err.code, err.message);
    if (err.code === 'MAX_CONCURRENT_REACHED')  return sendError(res, 409, err.code, err.message);
    if (err.code === 'AGENT_NOT_FOUND')         return sendError(res, 422, err.code, err.message);
    console.error('[pipeline] ERROR creating run:', err);
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
}

/**
 * GET /api/v1/runs/:runId
 * Return the full run state.
 * Returns 200 with run object, or 404 RUN_NOT_FOUND.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {string}               runId
 * @param {string}               dataDir
 */
async function handleGetRun(req, res, runId, dataDir) {
  const run = await pipelineManager.getRun(runId, dataDir);
  if (!run) {
    return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
  }
  return sendJSON(res, 200, run);
}

/**
 * GET /api/v1/runs/:runId/stages/:stageIndex/log?tail=200
 * Return the log file content for a specific stage.
 * Returns 200 text/plain, or 404 for missing run/stage/log.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {string}               runId
 * @param {number}               stageIndex
 * @param {string}               dataDir
 */
async function handleGetStageLog(req, res, runId, stageIndex, dataDir) {
  const run = await pipelineManager.getRun(runId, dataDir);
  if (!run) {
    return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
  }

  if (stageIndex < 0 || stageIndex >= run.stages.length) {
    return sendError(res, 404, 'STAGE_NOT_FOUND', `Stage ${stageIndex} does not exist in run '${runId}'.`);
  }

  const logPath = pipelineManager.stageLogPath(dataDir, runId, stageIndex);
  if (!fs.existsSync(logPath)) {
    return sendError(res, 404, 'LOG_NOT_AVAILABLE', `Log for stage ${stageIndex} of run '${runId}' is not yet available.`);
  }

  try {
    const urlObj   = new URL(req.url, 'http://x');
    const tailParam = urlObj.searchParams.get('tail');
    const tailN    = tailParam ? parseInt(tailParam, 10) : 0;

    const content = fs.readFileSync(logPath, 'utf8');
    let output    = content;

    if (tailN > 0) {
      const lines = content.split('\n');
      output = lines.slice(Math.max(0, lines.length - tailN)).join('\n');
    }

    const buf = Buffer.from(output, 'utf8');
    res.writeHead(200, {
      'Content-Type':   'text/plain; charset=utf-8',
      'Content-Length': buf.length,
    });
    res.end(buf);
  } catch (err) {
    console.error(`[pipeline] ERROR reading log for run ${runId} stage ${stageIndex}:`, err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read stage log file');
  }
}

/**
 * DELETE /api/v1/runs/:runId
 * Cancel and remove a run. Sends SIGTERM to any active stage process.
 * Returns 200 { deleted: true }.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {string}               runId
 * @param {string}               dataDir
 */
async function handleDeleteRun(req, res, runId, dataDir) {
  const run = await pipelineManager.getRun(runId, dataDir);
  if (!run) {
    return sendError(res, 404, 'RUN_NOT_FOUND', `Run '${runId}' not found.`);
  }

  try {
    await pipelineManager.deleteRun(runId, dataDir);
    return sendJSON(res, 200, { deleted: true, runId });
  } catch (err) {
    console.error(`[pipeline] ERROR deleting run ${runId}:`, err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', err.message);
  }
}

/**
 * Route patterns for space management.
 * Defined at module level for performance — compiled once.
 */
const SPACES_LIST_ROUTE   = /^\/api\/v1\/spaces$/;
const SPACES_SINGLE_ROUTE = /^\/api\/v1\/spaces\/([^/]+)$/;
// Matches /api/v1/spaces/:spaceId/tasks and everything under it.
const SPACES_TASKS_ROUTE  = /^\/api\/v1\/spaces\/([^/]+)(\/tasks.*)$/;
// Legacy: /api/v1/tasks and everything under it.
const LEGACY_TASKS_ROUTE  = /^\/api\/v1(\/tasks.*)$/;

/**
 * Create and start an HTTP server.
 *
 * @param {object} [options]
 * @param {number} [options.port]    - Port to listen on. Pass 0 for OS-assigned port.
 * @param {string} [options.dataDir] - Absolute path to data directory.
 * @param {boolean} [options.silent] - Suppress startup log.
 * @returns {http.Server}
 */
function startServer(options = {}) {
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;
  const port    = options.port !== undefined ? options.port : DEFAULT_PORT;

  // --- Step 1: Run migrator before anything else. ---
  try {
    migrate(dataDir);
  } catch (err) {
    console.error('[startup] Migration failed — server cannot start:', err);
    process.exit(1);
  }

  // --- Step 2: Create SpaceManager and ensure all space directories exist. ---
  const spaceManager = createSpaceManager(dataDir);
  spaceManager.ensureAllSpaces();

  // --- Step 2b: Initialize pipeline manager (startup recovery). ---
  // Marks any run with status='running' as 'interrupted' from a previous crash.
  pipelineManager.init(dataDir);

  // --- Step 3: Build a Map-based cache of createApp instances by spaceId. ---
  /** @type {Map<string, ReturnType<createApp>>} */
  const appCache = new Map();

  function getApp(spaceId) {
    if (!appCache.has(spaceId)) {
      const spaceDataDir = path.join(dataDir, 'spaces', spaceId);
      const app          = createApp(spaceDataDir);
      app.ensureDataFiles();
      appCache.set(spaceId, app);
    }
    return appCache.get(spaceId);
  }

  function evictApp(spaceId) {
    appCache.delete(spaceId);
  }

  // --- Step 4: Build the main request handler. ---

  async function mainRouter(req, res) {
    const { method } = req;
    const urlPath    = req.url.split('?')[0];

    // -----------------------------------------------------------------------
    // Space-scoped task routes: /api/v1/spaces/:spaceId/tasks/*
    // -----------------------------------------------------------------------
    const spaceTasksMatch = SPACES_TASKS_ROUTE.exec(urlPath);
    if (spaceTasksMatch) {
      const spaceId  = spaceTasksMatch[1];
      const taskPath = spaceTasksMatch[2]; // e.g. /tasks, /tasks/:id/move

      // Validate that the space exists.
      const spaceResult = spaceManager.getSpace(spaceId);
      if (!spaceResult.ok) {
        console.warn(`[router] SPACE_NOT_FOUND: ${spaceId}`);
        return sendError(res, 404, 'SPACE_NOT_FOUND', spaceResult.message);
      }

      const app = getApp(spaceId);
      const handled = await app.router(req, res, taskPath);
      if (handled !== null) return;

      return sendError(res, 404, 'NOT_FOUND', `Route '${method} ${urlPath}' not found`);
    }

    // -----------------------------------------------------------------------
    // Space management routes: /api/v1/spaces and /api/v1/spaces/:spaceId
    // -----------------------------------------------------------------------
    if (SPACES_LIST_ROUTE.test(urlPath)) {
      if (method === 'GET') {
        return sendJSON(res, 200, spaceManager.listSpaces());
      }

      if (method === 'POST') {
        let body;
        try {
          body = await parseBody(req);
        } catch (err) {
          return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
        }

        const name             = body && body.name;
        const workingDirectory = body && body.workingDirectory;
        const pipeline         = body && body.pipeline;
        const result = spaceManager.createSpace(name, workingDirectory, pipeline);

        if (!result.ok) {
          const status = result.code === 'DUPLICATE_NAME' ? 409 : 400;
          return sendError(res, status, result.code, result.message);
        }

        // Warm cache for the newly created space.
        getApp(result.space.id);
        return sendJSON(res, 201, result.space);
      }

      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const singleSpaceMatch = SPACES_SINGLE_ROUTE.exec(urlPath);
    if (singleSpaceMatch) {
      const spaceId = singleSpaceMatch[1];

      if (method === 'GET') {
        const result = spaceManager.getSpace(spaceId);
        if (!result.ok) {
          return sendError(res, 404, 'SPACE_NOT_FOUND', result.message);
        }
        return sendJSON(res, 200, result.space);
      }

      if (method === 'PUT') {
        let body;
        try {
          body = await parseBody(req);
        } catch {
          return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
        }

        const name             = body && body.name;
        const workingDirectory = body && body.workingDirectory;
        const pipeline         = body && body.pipeline;
        const result = spaceManager.renameSpace(spaceId, name, workingDirectory, pipeline);

        if (!result.ok) {
          const status = result.code === 'SPACE_NOT_FOUND' ? 404
                       : result.code === 'DUPLICATE_NAME'  ? 409
                       : 400;
          return sendError(res, status, result.code, result.message);
        }

        return sendJSON(res, 200, result.space);
      }

      if (method === 'DELETE') {
        const result = spaceManager.deleteSpace(spaceId);

        if (!result.ok) {
          const status = result.code === 'SPACE_NOT_FOUND' ? 404
                       : result.code === 'LAST_SPACE'       ? 400
                       : 400;
          // Invalidate cache on any attempt to keep it tidy.
          evictApp(spaceId);
          return sendError(res, status, result.code, result.message);
        }

        evictApp(spaceId);
        return sendJSON(res, 200, { deleted: true, id: result.id });
      }

      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -----------------------------------------------------------------------
    // Agent launcher routes — ADR-1 (Agent Launcher)
    // /api/v1/agents, /api/v1/agents/:agentId, /api/v1/agent/prompt,
    // /api/v1/settings
    // -----------------------------------------------------------------------
    if (AGENTS_LIST_ROUTE.test(urlPath)) {
      if (method === 'GET') return handleListAgents(req, res);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const agentSingleMatch = AGENTS_SINGLE_ROUTE.exec(urlPath);
    if (agentSingleMatch) {
      if (method === 'GET') return handleGetAgent(req, res, agentSingleMatch[1]);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    if (AGENT_PROMPT_ROUTE.test(urlPath)) {
      if (method === 'POST') return handleGeneratePrompt(req, res, dataDir, spaceManager);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    if (SETTINGS_ROUTE.test(urlPath)) {
      if (method === 'GET') return handleGetSettings(req, res, dataDir);
      if (method === 'PUT') return handlePutSettings(req, res, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -----------------------------------------------------------------------
    // Config file routes: /api/v1/config/files and /api/v1/config/files/:fileId
    // ADR-1 (Config Editor Panel): allowlisted file registry, no user paths.
    // -----------------------------------------------------------------------
    if (CONFIG_FILES_LIST_ROUTE.test(urlPath)) {
      if (method === 'GET') {
        return handleConfigListFiles(req, res, spaceManager);
      }
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const configFileSingleMatch = CONFIG_FILES_SINGLE_ROUTE.exec(urlPath);
    if (configFileSingleMatch) {
      const fileId = configFileSingleMatch[1];
      if (method === 'GET') {
        return handleConfigReadFile(req, res, fileId, spaceManager);
      }
      if (method === 'PUT') {
        return handleConfigSaveFile(req, res, fileId, spaceManager);
      }
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -----------------------------------------------------------------------
    // Agent run history routes — ADR-1 (Agent Run History)
    // /api/v1/agent-runs and /api/v1/agent-runs/:runId
    // List route MUST be tested before single-run route to avoid regex match.
    // -----------------------------------------------------------------------
    if (AGENT_RUNS_LIST_ROUTE.test(urlPath)) {
      if (method === 'GET')  return handleListAgentRuns(req, res, dataDir);
      if (method === 'POST') return handleCreateAgentRun(req, res, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const agentRunSingleMatch = AGENT_RUNS_SINGLE_ROUTE.exec(urlPath);
    if (agentRunSingleMatch) {
      const runId = agentRunSingleMatch[1];
      if (method === 'PATCH') return handleUpdateAgentRun(req, res, dataDir, runId);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -----------------------------------------------------------------------
    // Pipeline run routes — ADR-1 (mcp-start-pipeline)
    // Exact /api/v1/runs route MUST be tested before the parameterized regex.
    // Log route MUST be tested before the single-run route to avoid shadowing.
    // -----------------------------------------------------------------------

    const pipelineLogMatch = PIPELINE_RUNS_LOG_ROUTE.exec(urlPath);
    if (pipelineLogMatch) {
      const runId      = pipelineLogMatch[1];
      const stageIndex = parseInt(pipelineLogMatch[2], 10);
      if (method === 'GET') return handleGetStageLog(req, res, runId, stageIndex, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    if (PIPELINE_RUNS_LIST_ROUTE.test(urlPath)) {
      if (method === 'POST') return handleCreateRun(req, res, dataDir, spaceManager);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const pipelineSingleMatch = PIPELINE_RUNS_SINGLE_ROUTE.exec(urlPath);
    if (pipelineSingleMatch) {
      const runId = pipelineSingleMatch[1];
      if (method === 'GET')    return handleGetRun(req, res, runId, dataDir);
      if (method === 'DELETE') return handleDeleteRun(req, res, runId, dataDir);
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    // -----------------------------------------------------------------------
    // Legacy backward-compatibility shim: /api/v1/tasks/* → default space
    // ADR-1 §D2: internally rewrite to spaceId='default', no branching in
    // task-level business logic.
    // -----------------------------------------------------------------------
    const legacyMatch = LEGACY_TASKS_ROUTE.exec(urlPath);
    if (legacyMatch) {
      const taskPath = legacyMatch[1]; // e.g. /tasks, /tasks/:id
      console.log(`[router] route.legacy=true — rewriting '${urlPath}' → default space`);

      const app     = getApp('default');
      const handled = await app.router(req, res, taskPath);
      if (handled !== null) return;

      return sendError(res, 404, 'NOT_FOUND', `Route '${method} ${urlPath}' not found`);
    }

    // -----------------------------------------------------------------------
    // Static file serving
    // -----------------------------------------------------------------------
    if (method === 'GET') {
      return handleStatic(req, res);
    }

    sendError(res, 404, 'NOT_FOUND', `Route '${method} ${urlPath}' not found`);
  }

  // --- Step 5: Run startup cleanup for old prompt files (T-007). ---
  cleanupOldPromptFiles(dataDir);
  // Periodic cleanup every 6 hours
  setInterval(() => cleanupOldPromptFiles(dataDir), 6 * 60 * 60 * 1000).unref();

  // --- Step 6: Create and start the HTTP server. ---

  const server = http.createServer((req, res) => {
    mainRouter(req, res).catch((err) => {
      console.error('Unhandled error in router:', err);
      const payload = JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
      res.end(payload);
    });
  });

  server.listen(port, () => {
    if (!options.silent) {
      console.log(`Prism running at http://localhost:${server.address().port}`);
    }
  });

  return server;
}

module.exports = { startServer };

// ---------------------------------------------------------------------------
// Direct invocation bootstrap
// ---------------------------------------------------------------------------

if (require.main === module) {
  const { setupTerminalWebSocket } = require('./terminal');
  const server = startServer();
  setupTerminalWebSocket(server);
}
