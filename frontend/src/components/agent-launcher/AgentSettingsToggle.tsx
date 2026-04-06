/**
 * Agent Settings toggle button in the header.
 * ADR-1 (Settings Bar): extracted from inline <button> in Header.tsx.
 * Follows the ConfigToggle / TerminalToggle component pattern.
 */

import React from 'react';
import { useAppStore } from '@/stores/useAppStore';

export function AgentSettingsToggle() {
  const agentSettingsPanelOpen    = useAppStore((s) => s.agentSettingsPanelOpen);
  const setAgentSettingsPanelOpen = useAppStore((s) => s.setAgentSettingsPanelOpen);

  return (
    <button
      onClick={() => setAgentSettingsPanelOpen(!agentSettingsPanelOpen)}
      aria-label={agentSettingsPanelOpen ? 'Close agent settings' : 'Open agent settings'}
      aria-pressed={agentSettingsPanelOpen}
      title="Agent settings"
      className={`h-10 min-w-[72px] px-3 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-all duration-150 ease-apple ${
        agentSettingsPanelOpen
          ? 'bg-primary/[0.15] text-primary'
          : 'text-text-secondary hover:bg-surface-variant hover:text-text-primary'
      }`}
    >
      <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
        smart_toy
      </span>
    </button>
  );
}
