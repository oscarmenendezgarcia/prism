/**
 * The agents an issue can be assigned to. An assignee is either the name of a person or the
 * id of one of these.
 */

import type { ModelCliTool, Space } from '@/types';

export const AGENT_IDS: ModelCliTool[] = ['claude', 'opencode', 'pi', 'hermes'];

export const AGENT_NAMES: Record<ModelCliTool, string> = {
  claude:   'Claude Code',
  opencode: 'opencode',
  pi:       'pi',
  hermes:   'Hermes',
};

export function agentOf(assigned: string | undefined): ModelCliTool | null {
  return AGENT_IDS.includes(assigned as ModelCliTool) ? assigned as ModelCliTool : null;
}

/** How an assignee reads: agents by their name, people as they are. */
export function assigneeLabel(assigned: string): string {
  const agent = agentOf(assigned);
  return agent ? AGENT_NAMES[agent] : assigned;
}

export function agentIsOn(space: Space | undefined, agent: ModelCliTool): boolean {
  return space?.hooks?.agents?.[agent]?.enabled === true;
}
