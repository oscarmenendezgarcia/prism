/**
 * Prism — Agent Resolver
 *
 * ADR-1 (mcp-start-pipeline) §agentResolver:
 * Reads ~/.claude/agents/<agentId>.md, extracts frontmatter `model:` with
 * a regex, and builds the argv array for spawning `claude`.
 *
 * This module is pure (no side-effects beyond filesystem reads) and
 * stateless — safe to call from any context including test environments.
 *
 * Spawn modes (controlled by PIPELINE_AGENT_MODE env var):
 *   subagent (default): ['--agent', agentId, '--print', '--output-format', 'stream-json', '--allowedTools', '...']
 *   headless:           ['-p', systemPrompt, '--model', model, '--output-format', 'stream-json', '--enable-auto-mode']
 *
 * Note: --dangerously-skip-permissions is injected at spawn time by pipelineManager,
 * not here — this keeps resolveAgent pure and testable.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

/** Expand a leading `~` to the user's home directory. */
function expandTilde(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return os.homedir() + p.slice(1);
  return p;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown when the requested agent file does not exist.
 */
class AgentNotFoundError extends Error {
  /**
   * @param {string} agentId
   * @param {string} agentsDir
   */
  constructor(agentId, agentsDir) {
    super(`Agent '${agentId}' not found. Expected file: ${path.join(agentsDir, `${agentId}.md`)}`);
    this.name    = 'AgentNotFoundError';
    this.code    = 'AGENT_NOT_FOUND';
    this.agentId = agentId;
  }
}

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

/**
 * Extract `model:` from YAML-style frontmatter delimited by `---` lines.
 * Returns the extracted model string, or `defaultModel` if not found.
 *
 * @param {string} content       - Full file content.
 * @param {string} [defaultModel] - Fallback when no model: line is found.
 * @returns {{ model: string, body: string }}
 */
function parseFrontmatter(content, defaultModel = 'sonnet') {
  const lines  = content.split('\n');
  let inFront  = false;
  let frontEnd = -1;
  let model    = defaultModel;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    if (i === 0 && line === '---') {
      inFront = true;
      continue;
    }

    if (inFront) {
      if (line === '---') {
        frontEnd = i;
        break;
      }
      const match = line.match(/^model:\s*(\S+)/);
      if (match) {
        model = match[1];
      }
    }
  }

  const body = frontEnd !== -1
    ? lines.slice(frontEnd + 1).join('\n').trimStart()
    : content;

  return { model, body };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve an agent specification from its definition file.
 *
 * Search order (project scope takes precedence over global):
 *   1. `<workingDirectory>/.claude/agents/<agentId>.md`  (when workingDirectory given)
 *   2. `<agentsDir>/<agentId>.md`                        (explicit override, or default)
 *
 * Default `agentsDir` is `~/.claude/agents/`.
 *
 * Parses the frontmatter for `model:` and constructs the spawn argument list
 * based on PIPELINE_AGENT_MODE.
 *
 * @param {string}  agentId            - Kebab-case agent identifier (e.g. 'senior-architect').
 * @param {string}  [agentsDir]        - Override global agents directory. Defaults to ~/.claude/agents/.
 * @param {string}  [workingDirectory] - Project working directory; enables project-scoped lookup
 *                                       under `<workingDirectory>/.claude/agents/` with higher precedence.
 * @returns {{ agentId: string, model: string, systemPrompt: string, spawnArgs: string[] }}
 * @throws {AgentNotFoundError} When the agent file does not exist in any search location.
 */
function resolveAgent(agentId, agentsDir, workingDirectory) {
  const globalDir = expandTilde(agentsDir) || path.join(os.homedir(), '.claude', 'agents');

  // Search order: project-scoped first, then global. Duplicate dirs are skipped
  // so an explicit `agentsDir` equal to the project dir is not searched twice.
  const searchDirs = [];
  if (workingDirectory && typeof workingDirectory === 'string') {
    searchDirs.push(path.join(workingDirectory, '.claude', 'agents'));
  }
  if (!searchDirs.includes(globalDir)) {
    searchDirs.push(globalDir);
  }

  let filePath = null;
  for (const dir of searchDirs) {
    const candidate = path.join(dir, `${agentId}.md`);
    if (fs.existsSync(candidate)) {
      filePath = candidate;
      break;
    }
  }

  if (!filePath) {
    // Report every searched location so callers can diagnose project vs. global misses.
    throw new AgentNotFoundError(agentId, searchDirs.join(' or '));
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const { model, body: systemPrompt } = parseFrontmatter(content);

  const agentMode = process.env.PIPELINE_AGENT_MODE || 'subagent';

  let spawnArgs;
  if (agentMode === 'headless') {
    // Stable fallback: pass system prompt and model explicitly via -p flag.
    spawnArgs = ['-p', systemPrompt, '--model', model, '--output-format', 'stream-json', '--enable-auto-mode'];
  } else {
    // Default subagent mode: invoke the named agent definition.
    // No --allowedTools: --permission-mode bypassPermissions (injected by pipelineManager)
    // already covers all tool approvals — a restrictive allowlist on top would cause
    // unlisted tools to prompt interactively, hanging the stage with stdin closed.
    spawnArgs = [
      '--agent', agentId,
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
    ];
  }

  return { agentId, model, systemPrompt, spawnArgs };
}

module.exports = { resolveAgent, AgentNotFoundError, parseFrontmatter };
