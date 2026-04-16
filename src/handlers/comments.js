'use strict';

/**
 * Task Comments handler.
 *
 * Endpoints:
 *   POST  /api/v1/spaces/:spaceId/tasks/:taskId/comments
 *   PATCH /api/v1/spaces/:spaceId/tasks/:taskId/comments/:commentId
 *
 * Comments are stored as `comments: Comment[]` embedded in the task object
 * inside the column JSON files. Persistence follows the same write-tmp-rename
 * pattern used by tasks.js (ADR-002).
 *
 * Schema of a Comment:
 *   { id, author, text, type: 'note'|'question'|'answer',
 *     parentId?: string, resolved: boolean, createdAt: ISO8601, updatedAt?: ISO8601 }
 */

const fs   = require('fs');
const path = require('path');

const { COLUMNS }                        = require('../constants');
const { sendJSON, sendError, parseBody } = require('../utils/http');

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

const VALID_COMMENT_TYPES   = ['note', 'question', 'answer'];
const AUTHOR_MAX_LEN        = 100;
const TEXT_MAX_LEN          = 5000;
const COMMENT_MAX_COUNT     = 200;

// ---------------------------------------------------------------------------
// Persistence helpers — mirror of the pattern in tasks.js
// ---------------------------------------------------------------------------

function columnFiles(spaceDataDir) {
  return {
    todo:          path.join(spaceDataDir, 'todo.json'),
    'in-progress': path.join(spaceDataDir, 'in-progress.json'),
    done:          path.join(spaceDataDir, 'done.json'),
  };
}

function readColumn(spaceDataDir, column) {
  const filePath = columnFiles(spaceDataDir)[column];
  const raw      = fs.readFileSync(filePath, 'utf8');
  const parsed   = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function writeColumn(spaceDataDir, column, tasks) {
  const filePath = columnFiles(spaceDataDir)[column];
  const tmpPath  = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(tasks, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Find a task by ID across all columns.
 * Returns { task, column, tasks } or null when not found.
 */
function findTask(spaceDataDir, taskId) {
  for (const column of COLUMNS) {
    const tasks = readColumn(spaceDataDir, column);
    const index = tasks.findIndex((t) => t.id === taskId);
    if (index !== -1) {
      return { task: tasks[index], column, tasks, index };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST /…/tasks/:taskId/comments
// ---------------------------------------------------------------------------

async function handleCreateComment(req, res, spaceDataDir, taskId) {
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

  const errors = [];
  const { author, text, type, parentId } = body;

  if (!author || typeof author !== 'string' || author.trim().length === 0) {
    errors.push('author is required and must be a non-empty string');
  } else if (author.trim().length > AUTHOR_MAX_LEN) {
    errors.push(`author must not exceed ${AUTHOR_MAX_LEN} characters`);
  }

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    errors.push('text is required and must be a non-empty string');
  } else if (text.trim().length > TEXT_MAX_LEN) {
    errors.push(`text must not exceed ${TEXT_MAX_LEN} characters`);
  }

  if (!type || !VALID_COMMENT_TYPES.includes(type)) {
    errors.push(`type is required and must be one of: ${VALID_COMMENT_TYPES.join(', ')}`);
  }

  if (parentId !== undefined) {
    if (typeof parentId !== 'string' || parentId.trim().length === 0) {
      errors.push('parentId must be a non-empty string when provided');
    }
  }

  if (errors.length > 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', errors.join('; '));
  }

  try {
    const found = findTask(spaceDataDir, taskId);
    if (!found) {
      return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
    }

    const { task, column, tasks, index } = found;
    const comments = Array.isArray(task.comments) ? task.comments : [];

    // Limit check
    if (comments.length >= COMMENT_MAX_COUNT) {
      return sendError(
        res, 400, 'COMMENT_LIMIT_EXCEEDED',
        `Task has reached the maximum of ${COMMENT_MAX_COUNT} comments`
      );
    }

    // parentId existence check
    if (parentId !== undefined) {
      const parentExists = comments.some((c) => c.id === parentId.trim());
      if (!parentExists) {
        return sendError(res, 400, 'PARENT_COMMENT_NOT_FOUND',
          `Parent comment with id '${parentId}' not found in this task`);
      }
    }

    const now     = new Date().toISOString();
    const comment = {
      id:       crypto.randomUUID(),
      author:   author.trim(),
      text:     text.trim(),
      type,
      ...(parentId !== undefined && { parentId: parentId.trim() }),
      resolved: false,
      createdAt: now,
    };

    const updatedTask = {
      ...task,
      comments:  [...comments, comment],
      updatedAt: now,
    };

    tasks[index] = updatedTask;
    writeColumn(spaceDataDir, column, tasks);

    return sendJSON(res, 201, comment);
  } catch (err) {
    console.error(`POST comments for task ${taskId} error:`, err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create comment');
  }
}

// ---------------------------------------------------------------------------
// PATCH /…/tasks/:taskId/comments/:commentId
// ---------------------------------------------------------------------------

async function handleUpdateComment(req, res, spaceDataDir, taskId, commentId) {
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

  const PATCHABLE = ['text', 'type', 'resolved'];
  const provided  = PATCHABLE.filter((f) => f in body);

  if (provided.length === 0) {
    return sendError(
      res, 400, 'VALIDATION_ERROR',
      `At least one of the following fields is required: ${PATCHABLE.join(', ')}`
    );
  }

  const errors = [];

  if ('text' in body) {
    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      errors.push('text must be a non-empty string when provided');
    } else if (body.text.trim().length > TEXT_MAX_LEN) {
      errors.push(`text must not exceed ${TEXT_MAX_LEN} characters`);
    }
  }

  if ('type' in body) {
    if (!VALID_COMMENT_TYPES.includes(body.type)) {
      errors.push(`type must be one of: ${VALID_COMMENT_TYPES.join(', ')}`);
    }
  }

  if ('resolved' in body) {
    if (typeof body.resolved !== 'boolean') {
      errors.push('resolved must be a boolean when provided');
    }
  }

  if (errors.length > 0) {
    return sendError(res, 400, 'VALIDATION_ERROR', errors.join('; '));
  }

  try {
    const found = findTask(spaceDataDir, taskId);
    if (!found) {
      return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
    }

    const { task, column, tasks, index } = found;
    const comments = Array.isArray(task.comments) ? task.comments : [];

    const commentIndex = comments.findIndex((c) => c.id === commentId);
    if (commentIndex === -1) {
      return sendError(res, 404, 'COMMENT_NOT_FOUND',
        `Comment with id '${commentId}' not found in task '${taskId}'`);
    }

    const now            = new Date().toISOString();
    const existingComment = comments[commentIndex];
    const updatedComment = {
      ...existingComment,
      ...('text'     in body && { text:     body.text.trim() }),
      ...('type'     in body && { type:     body.type }),
      ...('resolved' in body && { resolved: body.resolved }),
      updatedAt: now,
    };

    const updatedComments = [...comments];
    updatedComments[commentIndex] = updatedComment;

    const updatedTask = {
      ...task,
      comments:  updatedComments,
      updatedAt: now,
    };

    tasks[index] = updatedTask;
    writeColumn(spaceDataDir, column, tasks);

    return sendJSON(res, 200, updatedComment);
  } catch (err) {
    console.error(`PATCH comment ${commentId} for task ${taskId} error:`, err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update comment');
  }
}

module.exports = { handleCreateComment, handleUpdateComment };
