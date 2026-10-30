'use strict';

/**
 * Task Comments handler (SQLite-backed).
 *
 * Endpoints:
 *   POST  /api/v1/spaces/:spaceId/tasks/:taskId/comments
 *   PATCH /api/v1/spaces/:spaceId/tasks/:taskId/comments/:commentId
 *
 * Comments live in their own table. Persistence delegates to the Store (no direct file I/O).
 *
 * Schema of a Comment:
 *   { id, author, text, type: 'note'|'question'|'answer',
 *     parentId?: string,
 *     resolved: boolean,
 *     createdAt: ISO8601, updatedAt?: ISO8601 }
 */

const path = require('path');

const { sendJSON, sendError, parseBody } = require('../utils/http');
// Required at module level (not lazily) so that the same initialized instance
// (with _store set by pipelineManager.init) is used across all handler calls.
// Lazy require inside handlers risks getting an uninitialized module instance
// when the test suite clears pipelineManager from the Node module cache.
const taskRunner = require('../services/taskRunner');

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------

const VALID_COMMENT_TYPES   = ['note', 'question', 'answer'];
const AUTHOR_MAX_LEN        = 100;
const TEXT_MAX_LEN          = 5000;
const COMMENT_MAX_COUNT     = 200;

// ---------------------------------------------------------------------------
// POST /…/tasks/:taskId/comments
// ---------------------------------------------------------------------------

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {import('../services/store').Store} store
 * @param {string} spaceId
 * @param {string} taskId
 * @param {string} dataDir - Root data directory (for pipelineManager notifications).
 */
async function handleCreateComment(req, res, store, spaceId, taskId) {
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
    const task = store.getTask(spaceId, taskId);
    if (!task) {
      return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
    }

    const comments = Array.isArray(task.comments) ? task.comments : [];

    if (comments.length >= COMMENT_MAX_COUNT) {
      return sendError(res, 400, 'COMMENT_LIMIT_EXCEEDED',
        `Task has reached the maximum of ${COMMENT_MAX_COUNT} comments`);
    }

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
      ...(parentId    !== undefined && { parentId:    parentId.trim() }),
      resolved:   false,
      createdAt:  now,
    };

    store.addComment(spaceId, taskId, comment);

    return sendJSON(res, 201, comment);
  } catch (err) {
    console.error(`POST comments for task ${taskId} error:`, err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to create comment');
  }
}

// ---------------------------------------------------------------------------
// PATCH /…/tasks/:taskId/comments/:commentId
// ---------------------------------------------------------------------------

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 * @param {import('../services/store').Store} store
 * @param {string} spaceId
 * @param {string} taskId
 * @param {string} commentId
 * @param {string} dataDir - Root data directory (for pipelineManager notifications).
 */
async function handleUpdateComment(req, res, store, spaceId, taskId, commentId) {
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
    return sendError(res, 400, 'VALIDATION_ERROR',
      `At least one of the following fields is required: ${['text', 'type', 'resolved'].join(', ')}`);
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
    const task = store.getTask(spaceId, taskId);
    if (!task) {
      return sendError(res, 404, 'TASK_NOT_FOUND', `Task with id '${taskId}' not found`);
    }

    const comments = Array.isArray(task.comments) ? task.comments : [];

    const commentIndex = comments.findIndex((c) => c.id === commentId);
    if (commentIndex === -1) {
      return sendError(res, 404, 'COMMENT_NOT_FOUND',
        `Comment with id '${commentId}' not found in task '${taskId}'`);
    }

    const now             = new Date().toISOString();
    const existingComment = comments[commentIndex];
    const updatedComment  = {
      ...existingComment,
      ...('text'       in body && { text:       body.text.trim() }),
      ...('type'       in body && { type:       body.type }),
      ...('resolved'   in body && { resolved:   body.resolved }),
      updatedAt: now,
    };

    store.updateComment(spaceId, taskId, updatedComment);

    if (body.resolved === true && existingComment.type === 'question') {
      taskRunner.questionAnswered(taskId);
    }

    return sendJSON(res, 200, updatedComment);
  } catch (err) {
    console.error(`PATCH comment ${commentId} for task ${taskId} error:`, err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Failed to update comment');
  }
}

module.exports = { handleCreateComment, handleUpdateComment };
