'use strict';

/**
 * Filesystem handlers for the directory browser feature.
 *
 * Endpoints:
 *   GET  /api/v1/fs/home     — return os.homedir()
 *   POST /api/v1/fs/browse   — list immediate directory children (dirs only)
 *   POST /api/v1/fs/validate — verify a path exists and is a readable directory
 *
 * Security: all paths must resolve to absolute locations; ~ is expanded to HOME.
 * Only directories are returned by browse (this is a directory picker, not a file picker).
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { sendJSON, sendError, parseBody } = require('../utils/http');

const HOME_DIR = os.homedir();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Expand a leading ~ to the OS home directory.
 * @param {string} rawPath
 * @returns {string}
 */
function expandHome(rawPath) {
  if (rawPath === '~' || rawPath.startsWith('~/')) {
    return HOME_DIR + rawPath.slice(1);
  }
  return rawPath;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/fs/validate
 * Body: { path: string }
 * Response 200: { path: string, isValid: true, message: string }
 * Response 404/403/400: error response
 */
async function handleValidate(req, res) {
  let body;
  try {
    body = await parseBody(req);
  } catch {
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (!body || typeof body.path !== 'string' || !body.path.trim()) {
    return sendError(res, 400, 'INVALID_PATH', 'path is required and must be a non-empty string');
  }

  const rawPath = body.path.trim();
  const dirPath = expandHome(rawPath);

  if (!path.isAbsolute(dirPath)) {
    return sendError(res, 400, 'INVALID_PATH', 'path must be absolute (use ~ or /absolute/path)');
  }

  let stat;
  try {
    stat = fs.statSync(dirPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return sendError(res, 404, 'NOT_FOUND', `Path does not exist: ${dirPath}`);
    }
    if (err.code === 'EACCES') {
      return sendError(res, 403, 'PERMISSION_DENIED', `Path is not readable: ${dirPath}`);
    }
    return sendError(res, 500, 'INTERNAL_ERROR', `Failed to validate path: ${err.message}`);
  }

  if (!stat.isDirectory()) {
    return sendError(res, 400, 'INVALID_PATH', `Path is not a directory: ${dirPath}`);
  }

  return sendJSON(res, 200, {
    path:    dirPath,
    isValid: true,
    message: 'Directory exists and is readable',
  });
}

module.exports = { handleValidate };
