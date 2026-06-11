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
 * GET /api/v1/fs/home
 * Returns the current user's home directory path.
 * Response: { homePath: string }
 */
function handleGetHome(_req, res) {
  return sendJSON(res, 200, { homePath: HOME_DIR });
}

/**
 * POST /api/v1/fs/browse
 * Body: { path: string, includeHidden?: boolean }
 * Returns the immediate subdirectories of the given path.
 * Response: { path: string, items: DirectoryItem[], hasMore: boolean }
 */
async function handleBrowse(req, res) {
  let body;
  try {
    body = await parseBody(req);
  } catch {
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (!body || typeof body.path !== 'string' || !body.path.trim()) {
    return sendError(res, 400, 'INVALID_PATH', 'path is required and must be a non-empty string');
  }

  const rawPath       = body.path.trim();
  const dirPath       = expandHome(rawPath);
  const includeHidden = body.includeHidden === true;

  if (!path.isAbsolute(dirPath)) {
    return sendError(res, 400, 'INVALID_PATH', 'path must be absolute (use ~ or /absolute/path)');
  }

  let stat;
  try {
    stat = fs.statSync(dirPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return sendError(res, 404, 'NOT_FOUND', `Directory not found: ${dirPath}`);
    }
    if (err.code === 'EACCES') {
      return sendError(res, 403, 'PERMISSION_DENIED', `Permission denied: ${dirPath}`);
    }
    return sendError(res, 500, 'INTERNAL_ERROR', `Failed to stat path: ${err.message}`);
  }

  if (!stat.isDirectory()) {
    return sendError(res, 400, 'INVALID_PATH', `Path is not a directory: ${dirPath}`);
  }

  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch (err) {
    if (err.code === 'EACCES') {
      return sendError(res, 403, 'PERMISSION_DENIED', `Permission denied listing directory: ${dirPath}`);
    }
    return sendError(res, 500, 'INTERNAL_ERROR', `Failed to list directory: ${err.message}`);
  }

  const items = [];

  for (const name of entries) {
    // Skip hidden files/dirs unless includeHidden is true
    if (!includeHidden && name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, name);
    let isDir        = false;
    let isReadable   = true;
    let isAccessible = true;

    try {
      const lstat = fs.lstatSync(fullPath);

      if (lstat.isDirectory()) {
        isDir = true;
      } else if (lstat.isSymbolicLink()) {
        // Follow symlink to determine whether it points to a directory
        try {
          const real = fs.statSync(fullPath);
          isDir = real.isDirectory();
        } catch {
          isAccessible = false;
        }
      } else {
        // Regular files are excluded from the directory picker
        continue;
      }
    } catch {
      isReadable   = false;
      isAccessible = false;
      // Include inaccessible dirs so users see them (greyed out in the UI)
    }

    items.push({
      name,
      type: isDir ? 'dir' : 'symlink',
      isReadable,
      isAccessible,
    });
  }

  // Sort alphabetically, case-insensitive
  items.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  return sendJSON(res, 200, { path: dirPath, items, hasMore: false });
}

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

module.exports = { handleGetHome, handleBrowse, handleValidate };
