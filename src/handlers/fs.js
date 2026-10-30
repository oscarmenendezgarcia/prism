'use strict';

/**
 * Checks the working directory typed in the space form.
 *
 * Endpoint:
 *   POST /api/v1/fs/validate — verify a path is a readable directory, and whether it is
 *                              a git repository
 *
 * All paths must resolve to absolute locations; ~ is expanded to HOME.
 */

const fs   = require('fs');
const { execFileSync } = require('child_process');
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

  let isGitRepo = false;
  try {
    execFileSync('git', ['-C', dirPath, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore', timeout: 5000 });
    isGitRepo = true;
  } catch { /* not a repository, or git is not installed */ }

  return sendJSON(res, 200, {
    path:    dirPath,
    isValid: true,
    isGitRepo,
    message: 'Directory exists and is readable',
  });
}

module.exports = { handleValidate };
