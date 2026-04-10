'use strict';

/**
 * Config file editor handlers — ADR-1 (Config Editor Panel)
 *
 * Security boundary: no user-supplied paths are ever used in file I/O.
 * All paths are derived from known directories and validated file IDs only.
 *
 * Routes:
 *   GET  /api/v1/config/files[?spaceId=...]          → handleConfigListFiles
 *   GET  /api/v1/config/files/:fileId[?spaceId=...]   → handleConfigReadFile
 *   PUT  /api/v1/config/files/:fileId                 → handleConfigSaveFile
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { sendJSON, sendError, parseBodyWithLimit } = require('../utils/http');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

/** Route patterns (compiled once at module load). */
const CONFIG_FILES_LIST_ROUTE   = /^\/api\/v1\/config\/files$/;
const CONFIG_FILES_SINGLE_ROUTE = /^\/api\/v1\/config\/files\/([^/]+)$/;

// ---------------------------------------------------------------------------
// Registry builder
// ---------------------------------------------------------------------------

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
      .sort();

    for (const filename of mdFiles) {
      const absPath = path.join(globalDir, filename);
      const stem    = filename.slice(0, -3);
      const kebab   = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const id      = `global-${kebab}-md`;
      registry.set(id, { id, name: filename, scope: 'global', absPath, directory: '~/.claude' });
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
      registry.set(id, { id, name: filename, scope: 'agent', absPath, directory: '~/.claude/agents' });
    }
  }

  // ── Project file: ./CLAUDE.md ─────────────────────────────────────────────
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
 */
function resolveWorkingDirFromQuery(req, spaceManager) {
  const urlObj  = new URL(req.url, 'http://x');
  const spaceId = urlObj.searchParams.get('spaceId');
  if (!spaceId) return undefined;
  const result = spaceManager.getSpace(spaceId);
  return result.ok ? result.space.workingDirectory : undefined;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/config/files[?spaceId=...]
 * List all available config files. Registry rebuilt on each call.
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
        continue;
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
  let body;
  try {
    body = await parseBodyWithLimit(req, CONFIG_MAX_BYTES + 256);
  } catch (err) {
    if (err.message === 'PAYLOAD_TOO_LARGE') {
      return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'File content exceeds the 1 MB limit.', { field: 'content' });
    }
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'content' field is required and must be a string.", { field: 'content' });
  }
  if (!('content' in body)) {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'content' field is required and must be a string.", { field: 'content' });
  }
  if (typeof body.content !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', "The 'content' field must be a string, not a number or object.", { field: 'content' });
  }

  const byteLen = Buffer.byteLength(body.content, 'utf8');
  if (byteLen > CONFIG_MAX_BYTES) {
    const receivedMB = (byteLen / (1024 * 1024)).toFixed(1);
    return sendError(res, 413, 'PAYLOAD_TOO_LARGE', `File content exceeds the 1 MB limit (received ${receivedMB} MB).`, { field: 'content' });
  }

  const workingDirectory = resolveWorkingDirFromQuery(req, spaceManager);
  const registry = buildConfigRegistry(workingDirectory);
  const entry    = registry.get(fileId);
  if (!entry) {
    return sendError(res, 404, 'FILE_NOT_FOUND', `Config file '${fileId}' was not found.`);
  }

  const tmpPath = entry.absPath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, body.content, 'utf8');
    fs.renameSync(tmpPath, entry.absPath);
  } catch (err) {
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

module.exports = {
  CONFIG_FILES_LIST_ROUTE,
  CONFIG_FILES_SINGLE_ROUTE,
  buildConfigRegistry,
  handleConfigListFiles,
  handleConfigReadFile,
  handleConfigSaveFile,
};
