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
      className={`h-10 min-w-[72px] px-3 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-all duration-150 ease-apple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        agentSettingsPanelOpen
          ? 'bg-primary/[0.15] text-primary border border-primary/30'
          : 'text-text-secondary bg-white/[0.04] border border-white/[0.08] hover:bg-surface-variant hover:text-text-primary'
      }`}
    >
      <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
        smart_toy
      </span>
      <span className="hidden sm:block text-[10px] font-medium leading-none">Settings</span>
    </button>
  );
}
