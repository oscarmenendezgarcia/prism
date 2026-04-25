'use strict';

/**
 * agentsPersonalities handler — /api/v1/agents-personalities/*
 *
 * Routes:
 *   GET    /api/v1/agents-personalities                  → handleListPersonalities
 *   GET    /api/v1/agents-personalities/mcp-tools        → handleDiscoverMcp   (MUST be before /:agentId)
 *   POST   /api/v1/agents-personalities/generate         → handleGeneratePersonality (MUST be before /:agentId)
 *   GET    /api/v1/agents-personalities/:agentId         → handleGetPersonality
 *   PUT    /api/v1/agents-personalities/:agentId         → handleUpsertPersonality
 *   DELETE /api/v1/agents-personalities/:agentId         → handleDeletePersonality
 *
 * Validation follows the { valid, errors, data } tuple convention.
 * All file-level I/O is delegated to personalityStore; LLM to personalityGenerator.
 */

const { sendJSON, sendError, parseBody } = require('../utils/http');
const { listAll, get, upsert, remove }   = require('../services/personalityStore');
const { discoverMcpTools }               = require('../services/mcpDiscovery');
const { generatePersonality, CURATED_PALETTE, isInPalette } = require('../services/personalityGenerator');
const { getAgentsDir, AGENT_ID_RE }      = require('./agents');
const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Route patterns — exported so the router can register them
// ---------------------------------------------------------------------------

/** /api/v1/agents-personalities  (list) */
const AP_LIST_ROUTE        = /^\/api\/v1\/agents-personalities$/;
/** /api/v1/agents-personalities/mcp-tools  (MUST be before /:agentId) */
const AP_MCP_ROUTE         = /^\/api\/v1\/agents-personalities\/mcp-tools$/;
/** /api/v1/agents-personalities/generate  (MUST be before /:agentId) */
const AP_GENERATE_ROUTE    = /^\/api\/v1\/agents-personalities\/generate$/;
/** /api/v1/agents-personalities/:agentId */
const AP_SINGLE_ROUTE      = /^\/api\/v1\/agents-personalities\/([^/]+)$/;

// ---------------------------------------------------------------------------
// Concurrency guard — one in-flight generate per agentId
// ---------------------------------------------------------------------------

/** @type {Set<string>} */
const generatingIds = new Set();

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const MCP_TOOL_RE = /^mcp__[a-z0-9_-]+__\*$/;

/**
 * Validate an agent personality input body.
 * @param {object} body
 * @returns {{ valid: boolean, errors: string[], data: object | null }}
 */
function validatePersonalityInput(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object.'], data: null };
  }

  // displayName (required)
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (!displayName) errors.push('displayName is required and must be a non-empty string.');
  else if (displayName.length > 60) errors.push('displayName exceeds 60 characters.');
  else if (/[\r\n]/.test(displayName)) errors.push('displayName must not contain newlines.');

  // color (required)
  const color = typeof body.color === 'string' ? body.color.toUpperCase() : '';
  if (!color) errors.push('color is required.');
  else if (!/^#[0-9A-F]{6}$/.test(color)) errors.push('color must be a valid 6-digit hex color (e.g. #7C3AED).');
  else if (!isInPalette(color)) {
    errors.push(`color must be one of the 16 curated swatches: ${CURATED_PALETTE.join(', ')}.`);
  }

  // persona (optional, max 600 chars)
  const persona = typeof body.persona === 'string' ? body.persona : '';
  if (persona.length > 600) errors.push('persona exceeds 600 characters.');

  // mcpTools (required, array)
  const rawTools = body.mcpTools;
  if (!Array.isArray(rawTools)) {
    errors.push('mcpTools must be an array of strings.');
  } else {
    for (const t of rawTools) {
      if (typeof t !== 'string' || !MCP_TOOL_RE.test(t)) {
        errors.push(`Invalid mcpTools entry: "${t}". Must match pattern mcp__<name>__*`);
      }
    }
  }

  // avatar (optional, soft limit)
  const avatar = typeof body.avatar === 'string' ? body.avatar : '';

  if (errors.length > 0) return { valid: false, errors, data: null };

  return {
    valid: true,
    errors: [],
    data: {
      displayName,
      color,
      persona,
      mcpTools: Array.isArray(rawTools) ? rawTools.filter((t) => MCP_TOOL_RE.test(t)) : [],
      avatar,
    },
  };
}

/**
 * Verify that agentId corresponds to an existing .md file under AGENTS_DIR.
 * @param {string} agentId
 * @returns {boolean}
 */
function agentFileExists(agentId) {
  const agentsDir = getAgentsDir();
  const filePath  = path.join(agentsDir, `${agentId}.md`);
  const resolved  = path.resolve(filePath);
  if (!resolved.startsWith(agentsDir + path.sep)) return false;
  return fs.existsSync(resolved);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/agents-personalities
 * Returns all personality records as an array.
 */
function handleListPersonalities(req, res) {
  try {
    const personalities = listAll();
    sendJSON(res, 200, personalities);
  } catch (err) {
    console.error('[agentsPersonalities] listAll error:', err.message);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to read personalities.');
  }
}

/**
 * GET /api/v1/agents-personalities/:agentId
 */
function handleGetPersonality(req, res, agentId) {
  if (!AGENT_ID_RE.test(agentId)) {
    return sendError(res, 400, 'INVALID_AGENT_ID',
      `Agent ID "${agentId}" does not match kebab-case pattern.`,
      { suggestion: 'Use lowercase with hyphens. Example: senior-architect' });
  }
  const personality = get(agentId);
  if (!personality) {
    return sendError(res, 404, 'NOT_FOUND',
      `No personality found for agent ${agentId}.`,
      { suggestion: 'Visit /agents to create one via the UI or API POST /generate.' });
  }
  sendJSON(res, 200, personality);
}

/**
 * PUT /api/v1/agents-personalities/:agentId
 */
async function handleUpsertPersonality(req, res, agentId) {
  if (!AGENT_ID_RE.test(agentId)) {
    return sendError(res, 400, 'INVALID_AGENT_ID',
      `Agent ID "${agentId}" does not match kebab-case pattern.`,
      { suggestion: 'Use lowercase with hyphens. Example: senior-architect' });
  }

  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    const code = err.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON';
    return sendError(res, err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400, code,
      err.message === 'PAYLOAD_TOO_LARGE' ? 'Request body exceeds 512 KB limit.' : 'Request body must be valid JSON.');
  }

  const { valid, errors, data } = validatePersonalityInput(body);
  if (!valid) {
    return sendError(res, 400, 'VALIDATION_ERROR', errors[0], { errors });
  }

  // Verify agent file exists (security: no arbitrary IDs allowed)
  if (!agentFileExists(agentId)) {
    return sendError(res, 400, 'INVALID_AGENT_ID',
      `No agent file found for "${agentId}" in ${getAgentsDir()}.`,
      { suggestion: `Ensure ${agentId}.md exists under ~/.claude/agents/` });
  }

  try {
    const source    = body.source === 'generated' ? 'generated' : 'manual';
    const generatedAt = source === 'generated' ? (body.generatedAt || new Date().toISOString()) : undefined;

    const saved = await upsert({
      agentId,
      ...data,
      source,
      ...(generatedAt ? { generatedAt } : {}),
    });

    console.info(JSON.stringify({
      ts: new Date().toISOString(),
      evt: 'personality.save',
      agentId,
      source,
    }));

    sendJSON(res, 200, saved);
  } catch (err) {
    console.error('[agentsPersonalities] upsert error:', err.message);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to save personality.');
  }
}

/**
 * DELETE /api/v1/agents-personalities/:agentId
 */
async function handleDeletePersonality(req, res, agentId) {
  if (!AGENT_ID_RE.test(agentId)) {
    return sendError(res, 400, 'INVALID_AGENT_ID',
      `Agent ID "${agentId}" does not match kebab-case pattern.`);
  }
  try {
    const deleted = await remove(agentId);
    if (!deleted) {
      return sendError(res, 404, 'NOT_FOUND',
        `No personality found for agent ${agentId}.`);
    }
    res.writeHead(204);
    res.end();
  } catch (err) {
    console.error('[agentsPersonalities] remove error:', err.message);
    sendError(res, 500, 'INTERNAL_ERROR', 'Failed to delete personality.');
  }
}

/**
 * POST /api/v1/agents-personalities/generate
 * Generates a personality proposal via the LLM. Does NOT persist.
 */
async function handleGeneratePersonality(req, res, dataDir) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    const code = err.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON';
    return sendError(res, err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400, code,
      err.message === 'PAYLOAD_TOO_LARGE' ? 'Request body exceeds 512 KB limit.' : 'Request body must be valid JSON.');
  }

  if (!body || typeof body !== 'object') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
  }

  const agentId = body.agentId;
  const hint    = typeof body.hint === 'string' ? body.hint.slice(0, 200) : undefined;

  if (!agentId || typeof agentId !== 'string') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'agentId is required.',
      { field: 'agentId', suggestion: "Provide a kebab-case agent ID, e.g. 'senior-architect'" });
  }

  if (!AGENT_ID_RE.test(agentId)) {
    return sendError(res, 400, 'INVALID_AGENT_ID',
      `Agent '${agentId}' does not match kebab-case pattern.`,
      { suggestion: 'Use lowercase with hyphens, no underscores or special chars. Example: senior-architect' });
  }

  // Concurrent-generate guard
  if (generatingIds.has(agentId)) {
    return sendError(res, 409, 'GENERATE_BUSY',
      `A personality is already being generated for ${agentId}.`,
      { suggestion: 'Wait for the current request to finish, then try again.' });
  }
  generatingIds.add(agentId);

  // Discover available tools for context
  let availableTools = [];
  try {
    const discovered = discoverMcpTools();
    availableTools = discovered.servers.map((s) => s.toolPrefix);
  } catch { /* discovery failure is non-fatal */ }

  try {
    const result = await generatePersonality({ agentId, hint, availableTools, dataDir });
    if (!result.valid) {
      return sendError(res, 502, 'GENERATE_CLI_ERROR',
        `Personality generation failed: ${result.errors[0]}`,
        { suggestion: 'Ensure your Claude CLI is installed (claude --version) and your API key is valid. Try again in a moment.' });
    }
    sendJSON(res, 200, result.data);
  } catch (err) {
    console.error('[agentsPersonalities] generate error:', err.message);
    sendError(res, 502, 'GENERATE_CLI_ERROR',
      `Claude CLI failed to generate personality: ${err.message}`,
      { suggestion: 'Ensure your Claude CLI is installed (claude --version) and your API key is valid. Try again in a moment.' });
  } finally {
    generatingIds.delete(agentId);
  }
}

/**
 * GET /api/v1/agents-personalities/mcp-tools[?workingDirectory=...]
 */
function handleDiscoverMcp(req, res) {
  const qs = new URL(req.url, 'http://x').searchParams;
  const wd = qs.get('workingDirectory') || null;
  try {
    const result = discoverMcpTools(wd);
    sendJSON(res, 200, result);
  } catch (err) {
    console.error('[agentsPersonalities] mcp-tools error:', err.message);
    sendError(res, 500, 'INTERNAL_ERROR', 'MCP discovery failed.');
  }
}

module.exports = {
  AP_LIST_ROUTE,
  AP_MCP_ROUTE,
  AP_GENERATE_ROUTE,
  AP_SINGLE_ROUTE,
  handleListPersonalities,
  handleGetPersonality,
  handleUpsertPersonality,
  handleDeletePersonality,
  handleGeneratePersonality,
  handleDiscoverMcp,
  // exported for tests
  validatePersonalityInput,
  agentFileExists,
  generatingIds,
};
