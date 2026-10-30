/**
 * Prism — the agents an issue can be assigned to. An assignee is either the name of a person
 * or the id of one of these.
 */

'use strict';

const AGENT_IDS = ['claude', 'opencode', 'pi', 'hermes'];

/** How the old free-text assignee might have named an agent. */
const CLAUDE_ALIASES = ['claude code', 'sonnet', 'opus', 'haiku'];

const isAgentId = (value) => AGENT_IDS.includes(value);

/** @returns {string|null} The agent this old assignee meant, if any. */
function agentFromOldName(name) {
  const clean = String(name).trim().toLowerCase().replace(/[-_]+/g, ' ');
  if (isAgentId(clean)) return clean;
  if (CLAUDE_ALIASES.includes(clean) || clean.endsWith(' agent')) return 'claude';
  return null;
}

/** Whether a space has this agent turned on. They start off. */
const agentIsOn = (space, id) => space?.hooks?.agents?.[id]?.enabled === true;

module.exports = { AGENT_IDS, isAgentId, agentFromOldName, agentIsOn };
