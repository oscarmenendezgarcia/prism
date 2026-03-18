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
      const result = {};
      for (const column of COLUMNS) {
        result[column] = readColumn(column).map(stripAttachmentContent);
      }
      sendJSON(res, 200, result);
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
 * @returns {Map<string, { id: string, name: string, scope: string, absPath: string, directory: string }>}
 */
function buildConfigRegistry() {
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

  // ── Project file: ./CLAUDE.md ─────────────────────────────────────────────
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

  return registry;
}

/**
 * GET /api/v1/config/files
 * List all available config files. Registry rebuilt on each call.
 */
function handleConfigListFiles(req, res) {
  try {
    const registry = buildConfigRegistry();
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
 * GET /api/v1/config/files/:fileId
 * Read a config file's full content.
 */
function handleConfigReadFile(req, res, fileId) {
  try {
    const registry = buildConfigRegistry();
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
async function handleConfigSaveFile(req, res, fileId) {
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
  const registry = buildConfigRegistry();
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
// Server factory — exported for use by tests and direct invocation
// ---------------------------------------------------------------------------

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

        const name = body && body.name;
        const result = spaceManager.createSpace(name);

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

        const name   = body && body.name;
        const result = spaceManager.renameSpace(spaceId, name);

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
    // Config file routes: /api/v1/config/files and /api/v1/config/files/:fileId
    // ADR-1 (Config Editor Panel): allowlisted file registry, no user paths.
    // -----------------------------------------------------------------------
    if (CONFIG_FILES_LIST_ROUTE.test(urlPath)) {
      if (method === 'GET') {
        return handleConfigListFiles(req, res);
      }
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method '${method}' is not allowed on this route`);
    }

    const configFileSingleMatch = CONFIG_FILES_SINGLE_ROUTE.exec(urlPath);
    if (configFileSingleMatch) {
      const fileId = configFileSingleMatch[1];
      if (method === 'GET') {
        return handleConfigReadFile(req, res, fileId);
      }
      if (method === 'PUT') {
        return handleConfigSaveFile(req, res, fileId);
      }
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

  // --- Step 5: Create and start the HTTP server. ---

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
