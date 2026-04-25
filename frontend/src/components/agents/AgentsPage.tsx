/**
 * AgentsPage — /agents route: grid view of discovered agent personalities.
 *
 * Features:
 *   - Fetches agents from GET /api/v1/agents
 *   - Fetches personalities from GET /api/v1/agents-personalities
 *   - Discovers MCP servers from GET /api/v1/agents-personalities/mcp-tools
 *   - Renders an AgentPersonalityCard per agent
 *   - Empty state: CTA to launch OnboardingWizard
 *   - Auto-launches OnboardingWizard on first open when personalities are empty
 *     and localStorage flag is not set
 */

import React, { useEffect, useState, useCallback } from 'react';
import { AgentPersonalityCard } from '@/components/agents/AgentPersonalityCard';
import { OnboardingWizard, ONBOARDING_DISMISSED_KEY } from '@/components/agents/OnboardingWizard';
import { useAgentPersonalityStore } from '@/stores/useAgentPersonalityStore';
import { useAppStore } from '@/stores/useAppStore';
import * as api from '@/api/client';
import type { AgentInfo } from '@/types';

export function AgentsPage() {
  const personalities  = useAgentPersonalityStore((s) => s.personalities);
  const loading        = useAgentPersonalityStore((s) => s.loading);
  const mcpServers     = useAgentPersonalityStore((s) => s.mcpServers);
  const fetchAll       = useAgentPersonalityStore((s) => s.fetchAll);
  const fetchMcp       = useAgentPersonalityStore((s) => s.fetchMcp);

  const [agents, setAgents]         = useState<AgentInfo[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError]     = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Load agents list + personalities + MCP servers
  const loadAll = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const [agentList] = await Promise.all([
        api.getAgents(),
        fetchAll(),
        fetchMcp(),
      ]);
      setAgents(agentList);
    } catch (err) {
      setAgentsError((err as Error).message || 'Failed to load agents.');
    } finally {
      setAgentsLoading(false);
    }
  }, [fetchAll, fetchMcp]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Auto-launch onboarding on first open when personalities are empty
  useEffect(() => {
    if (!loading && !agentsLoading && agents.length > 0) {
      const hasPersonalities = Object.keys(personalities).length > 0;
      const dismissed        = localStorage.getItem(ONBOARDING_DISMISSED_KEY);
      if (!hasPersonalities && !dismissed) {
        setWizardOpen(true);
      }
    }
  }, [loading, agentsLoading, agents.length, personalities]);

  // ── Loading skeleton ──
  if (agentsLoading || loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <PageHeader onLaunchWizard={() => setWizardOpen(true)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-48 rounded-xl bg-surface-variant animate-pulse"
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (agentsError) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <PageHeader onLaunchWizard={() => setWizardOpen(true)} />
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <span className="material-symbols-outlined text-4xl text-error" aria-hidden="true">
            error
          </span>
          <p className="text-sm text-error">{agentsError}</p>
          <button
            type="button"
            onClick={loadAll}
            className="px-4 py-2 rounded-md bg-surface-variant text-sm text-text-primary hover:bg-border transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Empty agents (no .md files) ──
  if (agents.length === 0) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <PageHeader onLaunchWizard={() => setWizardOpen(true)} />
        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <span className="material-symbols-outlined text-4xl text-text-disabled" aria-hidden="true">
            smart_toy
          </span>
          <p className="text-sm text-text-secondary">
            No agent files found in <code className="font-mono">~/.claude/agents/</code>.
          </p>
          <p className="text-xs text-text-disabled">
            Create <code className="font-mono">.md</code> agent definition files to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader onLaunchWizard={() => setWizardOpen(true)} />

      {/* Agent grid */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-6"
        role="list"
        aria-label="Agent personalities"
      >
        {agents.map((agent) => (
          <div key={agent.id} role="listitem">
            <AgentPersonalityCard
              agent={agent}
              personality={personalities[agent.id] ?? null}
              mcpServers={mcpServers}
            />
          </div>
        ))}
      </div>

      {/* Onboarding wizard */}
      {wizardOpen && (
        <OnboardingWizard
          agents={agents}
          mcpServers={mcpServers}
          onDismiss={() => {
            setWizardOpen(false);
            fetchAll(); // refresh after wizard completes
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PageHeader({ onLaunchWizard }: { onLaunchWizard: () => void }) {
  const setAgentSettingsPanelOpen = useAppStore((s) => s.setAgentSettingsPanelOpen);
  const agentSettingsPanelOpen    = useAppStore((s) => s.agentSettingsPanelOpen);
  const toggleConfigPanel         = useAppStore((s) => s.toggleConfigPanel);
  const configPanelOpen           = useAppStore((s) => s.configPanelOpen);

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
          <span className="material-symbols-outlined text-xl text-primary" aria-hidden="true">
            smart_toy
          </span>
          Agents
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Manage AI agent personas, tool access, and custom branding
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAgentSettingsPanelOpen(!agentSettingsPanelOpen)}
          aria-label="Agent launcher settings"
          aria-pressed={agentSettingsPanelOpen}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-primary ${
            agentSettingsPanelOpen
              ? 'bg-primary/15 text-primary'
              : 'bg-surface-variant text-text-secondary hover:text-text-primary hover:bg-border'
          }`}
        >
          <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
            tune
          </span>
          Settings
        </button>
        <button
          type="button"
          onClick={toggleConfigPanel}
          aria-label="Toggle configuration editor"
          aria-pressed={configPanelOpen}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-primary ${
            configPanelOpen
              ? 'bg-primary/15 text-primary'
              : 'bg-surface-variant text-text-secondary hover:text-text-primary hover:bg-border'
          }`}
        >
          <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
            settings
          </span>
          Config
        </button>
        <button
          type="button"
          onClick={onLaunchWizard}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Launch onboarding wizard"
        >
          <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">
            auto_fix_high
          </span>
          Setup Wizard
        </button>
      </div>
    </div>
  );
}
