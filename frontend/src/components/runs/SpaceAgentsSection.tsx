/**
 * Space settings: which agents can work in this space. Saved with the rest of the space by
 * the modal's Save button.
 */

import { useEffect } from 'react';
import { useTaskRunStore } from '@/stores/useTaskRunStore';
import type { ModelCliTool, SpaceAgents } from '@/types';
import { AGENT_IDS, AGENT_NAMES } from '@/utils/agents';
import { HarnessIcon } from './HarnessIcon';

const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku'];

const FIELD = 'w-full px-2 py-1 rounded-lg bg-surface-variant border border-border text-xs text-text-primary placeholder:text-text-tertiary focus:outline-hidden focus:border-primary transition-colors duration-fast';

interface SpaceAgentsSectionProps {
  agents: SpaceAgents;
  onChange: (agents: SpaceAgents) => void;
}

export function SpaceAgentsSection({ agents, onChange }: SpaceAgentsSectionProps) {
  const harnesses = useTaskRunStore((s) => s.harnesses);
  useEffect(() => { void useTaskRunStore.getState().loadHarnesses(); }, []);

  const update = (agent: ModelCliTool, change: { enabled?: boolean; model?: string }) => {
    const current = agents[agent] ?? { enabled: false };
    const model = change.model ?? current.model ?? (agent === 'claude' ? 'sonnet' : undefined);
    onChange({ ...agents, [agent]: { ...current, ...change, ...(model && { model }) } });
  };

  return (
    <fieldset className="flex flex-col gap-2 border-t border-border pt-3" data-testid="agents-section">
      <legend className="text-sm font-medium text-text-primary">Agents in this space</legend>
      <p className="text-xs text-text-secondary leading-snug border-l-2 border-error pl-2">
        An agent runs on this server with full permissions. It can read and run anything the server's user can,
        and text in an issue could try to trick it. Turn agents on only where you trust everyone who can write.
      </p>
      {AGENT_IDS.map((agent) => {
        const setting = agents[agent];
        const missing = harnesses?.find((h) => h.cliTool === agent)?.available === false;
        return (
          <div key={agent} className={`flex items-center gap-2 min-h-8 ${missing ? 'opacity-60' : ''}`} data-testid={`agent-row-${agent}`}>
            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer min-w-0 flex-1">
              <input
                type="checkbox"
                className="accent-primary"
                checked={!!setting?.enabled}
                disabled={missing && !setting?.enabled}
                onChange={(e) => update(agent, { enabled: e.target.checked })}
              />
              <HarnessIcon cliTool={agent} />
              <span className="truncate">{AGENT_NAMES[agent]}</span>
            </label>
            {missing && <span className="text-xs text-text-secondary">Not installed</span>}
            {setting?.enabled && (
              <div className="w-40 flex-shrink-0">
                {agent === 'claude' ? (
                  <select className={FIELD} value={setting.model ?? 'sonnet'} aria-label={`Model of ${AGENT_NAMES[agent]}`} onChange={(e) => update(agent, { model: e.target.value })}>
                    {CLAUDE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input className={FIELD} value={setting.model ?? ''} placeholder="provider/model" aria-label={`Model of ${AGENT_NAMES[agent]}`} onChange={(e) => update(agent, { model: e.target.value })} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
