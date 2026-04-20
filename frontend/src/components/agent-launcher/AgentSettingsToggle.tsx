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
      aria-label="Agent settings"
      aria-pressed={agentSettingsPanelOpen}
      className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-fast ease-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        agentSettingsPanelOpen
          ? 'bg-primary/15 text-primary'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant'
      }`}
    >
      <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">
        smart_toy
      </span>
    </button>
  );
}
