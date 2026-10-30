/**
 * Prism — the agents an issue can be assigned to. An assignee is either the name of a person
 * or the id of one of these.
 */

'use strict';

const AGENT_IDS = ['claude', 'opencode', 'pi', 'hermes'];

const AGENT_DISPLAY_NAMES = { claude: 'Claude Code', opencode: 'opencode', pi: 'pi', hermes: 'Hermes' };

/** How the old free-text assignee might have named an agent: Claude, its models, its roles. */
const CLAUDE_ALIASES = [
  'claude code', 'sonnet', 'opus', 'haiku',
  'prism agent', 'developer agent', 'senior architect', 'ux api designer', 'code reviewer', 'qa engineer e2e', 'orchestrator',
];

const isAgentId = (value) => AGENT_IDS.includes(value);

/** Names people cannot take: they would read as an agent, in an assignee or a signature. */
function isReservedName(name) {
  const clean = String(name).trim().toLowerCase();
  return isAgentId(clean) || Object.values(AGENT_DISPLAY_NAMES).some((label) => clean === label.toLowerCase()) || clean.includes('started by');
}

/** @returns {string|null} The agent this old assignee meant, if any. */
function agentFromOldName(name) {
  if (typeof name !== 'string') return null;
  const clean = name.trim().toLowerCase().replace(/[-_]+/g, ' ');
  // Someone called Pi is more likely than an agent written with a capital.
  if (name.trim() === 'pi' || (clean !== 'pi' && isAgentId(clean))) return clean;
  return CLAUDE_ALIASES.includes(clean) ? 'claude' : null;
}

/** Whether a space has this agent turned on. They start off. */
const agentIsOn = (space, id) => space?.hooks?.agents?.[id]?.enabled === true;

module.exports = { AGENT_IDS, AGENT_DISPLAY_NAMES, isReservedName, isAgentId, agentFromOldName, agentIsOn };
