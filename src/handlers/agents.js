'use strict';

/**
 * Agent launcher handlers — ADR-1 (Agent Launcher)
 *
 * Security boundary: agentId must match /^[a-z0-9]+(-[a-z0-9]+)*$/ and is
 * only resolved against ~/.claude/agents/. No user-supplied paths used.
 *
 * Routes:
 *   GET /api/v1/agents[?workingDirectory=<abs-path>]  → handleListAgents
 *   GET /api/v1/agents/:agentId                       → handleGetAgent
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { sendJSON, sendError } = require('../utils/http');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENTS_DIR_DEFAULT = path.join(os.homedir(), '.claude', 'agents');

/** Expand a leading `~` to the user's home directory (Node.js does not do this automatically). */
function expandTilde(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return os.homedir() + p.slice(1);
  return p;
}

// Evaluated lazily so PIPELINE_AGENTS_DIR set after module load (e.g. in tests) is picked up.
// Tilde is expanded so that PIPELINE_AGENTS_DIR=~/.claude/agents works correctly.
function getAgentsDir() {
  return expandTilde(process.env.PIPELINE_AGENTS_DIR) || AGENTS_DIR_DEFAULT;
}

const AGENT_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Route patterns (compiled once at module load). */
const AGENTS_LIST_ROUTE   = /^\/api\/v1\/agents$/;
const AGENTS_SINGLE_ROUTE = /^\/api\/v1\/agents\/([^/]+)$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/agents[?workingDirectory=<abs-path>]
 * List agents from all search directories, merged in priority order (later overrides earlier):
 *   1. ~/.claude/agents/                    (always)
 *   2. PIPELINE_AGENTS_DIR (if set, tilde-expanded, and different from #1)
 *   3. <workingDirectory>/.claude/agents/   (if ?workingDirectory provided)
 */
function handleListAgents(req, res) {
  const qs = new URL(req.url, 'http://x').searchParams;
  const workingDirectory = qs.get('workingDirectory') || null;

  function scanDir(dir, source) {
    if (!fs.existsSync(dir)) return [];
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      console.error(`[agents] ERROR reading agents dir (${source}):`, err.message);
      return [];
    }
    const results = [];
    for (const filename of entries.filter((f) => f.toLowerCase().endsWith('.md')).sort()) {
      const absPath = path.join(dir, filename);
      let stat;
      try { stat = fs.statSync(absPath); } catch { continue; }
      const stem = filename.slice(0, -3);
      const id   = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      results.push({ id, name: filename, displayName: toDisplayName(stem), path: absPath, sizeBytes: stat.size, source });
    }
    return results;
  }

  // 1. Always scan the global dir.
  const globalAgents = scanDir(AGENTS_DIR_DEFAULT, 'global');

  // 2. Scan PIPELINE_AGENTS_DIR if set and different from global (after tilde expansion).
  let envAgents = [];
  const envRaw = process.env.PIPELINE_AGENTS_DIR;
  if (envRaw) {
    const envDir = expandTilde(envRaw);
    if (envDir !== AGENTS_DIR_DEFAULT) {
      envAgents = scanDir(envDir, 'env');
    }
  }

  // 3. Scan workspace dir if workingDirectory is provided.
  let workspaceAgents = [];
  if (workingDirectory && path.isAbsolute(workingDirectory)) {
    workspaceAgents = scanDir(path.join(workingDirectory, '.claude', 'agents'), 'workspace');
  }

  // Merge in priority order: global → env → workspace (later overrides earlier).
  const merged = new Map();
  for (const a of globalAgents)   merged.set(a.id, a);
  for (const a of envAgents)      merged.set(a.id, a);
  for (const a of workspaceAgents) merged.set(a.id, a);

  const agents = [...merged.values()];
  console.log(`[agents] Listed ${agents.length} agents (global: ${globalAgents.length}, env: ${envAgents.length}, workspace: ${workspaceAgents.length})`);
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
  const agentsDir = getAgentsDir();
  const absPath   = path.join(agentsDir, filename);

  const resolved = path.resolve(absPath);
  if (!resolved.startsWith(agentsDir + path.sep)) {
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
    sendJSON(res, 200, {
      id:          agentId,
      name:        filename,
      displayName: toDisplayName(agentId),
      path:        resolved,
      sizeBytes:   stat.size,
      content,
    });
  } catch (err) {
    console.error(`[agents] ERROR reading agent ${agentId}:`, err.message);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read agent file');
  }
}

module.exports = {
  getAgentsDir,
  AGENT_ID_RE,
  AGENTS_LIST_ROUTE,
  AGENTS_SINGLE_ROUTE,
  toDisplayName,
  handleListAgents,
  handleGetAgent,
};
