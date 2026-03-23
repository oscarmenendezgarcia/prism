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
 *   subagent (default): ['--agent', agentId, '--print', '--no-auto-approve']
 *   headless:           ['-p', systemPrompt, '--model', model, '--no-auto-approve']
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

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
 * Reads `<agentsDir>/<agentId>.md`, parses the frontmatter for `model:`,
 * and constructs the spawn argument list based on PIPELINE_AGENT_MODE.
 *
 * @param {string}  agentId    - Kebab-case agent identifier (e.g. 'senior-architect').
 * @param {string}  [agentsDir] - Override agents directory. Defaults to ~/.claude/agents/.
 * @returns {{ agentId: string, model: string, systemPrompt: string, spawnArgs: string[] }}
 * @throws {AgentNotFoundError} When the agent file does not exist.
 */
function resolveAgent(agentId, agentsDir) {
  const dir      = agentsDir || path.join(os.homedir(), '.claude', 'agents');
  const filePath = path.join(dir, `${agentId}.md`);

  if (!fs.existsSync(filePath)) {
    throw new AgentNotFoundError(agentId, dir);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const { model, body: systemPrompt } = parseFrontmatter(content);

  const agentMode = process.env.PIPELINE_AGENT_MODE || 'subagent';

  let spawnArgs;
  if (agentMode === 'headless') {
    // Stable fallback: pass system prompt and model explicitly via -p flag.
    spawnArgs = ['-p', systemPrompt, '--model', model, '--no-auto-approve'];
  } else {
    // Default subagent mode: invoke the named agent definition.
    spawnArgs = ['--agent', agentId, '--print', '--no-auto-approve'];
  }

  return { agentId, model, systemPrompt, spawnArgs };
}

module.exports = { resolveAgent, AgentNotFoundError, parseFrontmatter };
