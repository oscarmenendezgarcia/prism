/**
 * App header — brand, run indicator, and action buttons.
 * ADR-002: replaces the .app-header section in legacy index.html.
 * ADR-003 §8.1: glass-heavy background, text-text-primary token, ThemeToggle added.
 * ADR-1 (Agent Launcher): RunIndicator (unified, replaces AgentRunIndicator + PipelineProgressBar).
 */

import React from 'react';
import { Button } from '@/components/shared/Button';
import { TerminalToggle } from '@/components/terminal/TerminalToggle';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { ConfigToggle } from '@/components/config/ConfigToggle';
import { RunIndicator } from '@/components/agent-launcher/RunIndicator';
import { AgentSettingsToggle } from '@/components/agent-launcher/AgentSettingsToggle';
import { RunHistoryToggle } from '@/components/agent-run-history/RunHistoryToggle';
import { useAppStore } from '@/stores/useAppStore';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';

/**
 * Toggle button for the Pipeline Log panel.
 * ADR-1 (log-viewer) §3.4: visible only when pipelineState !== null.
 * Follows the same structure as RunHistoryToggle and TerminalToggle.
 */
function PipelineLogToggle() {
  const pipelineState   = useAppStore((s) => s.pipelineState);
  const logPanelOpen    = usePipelineLogStore((s) => s.logPanelOpen);
  const setLogPanelOpen = usePipelineLogStore((s) => s.setLogPanelOpen);
  const unseenCount     = usePipelineLogStore((s) => s.unseenCount);

  const inactive = !pipelineState;
  const showDot  = unseenCount > 0 && !logPanelOpen && !inactive;

  return (
    <button
      onClick={() => !inactive && setLogPanelOpen(!logPanelOpen)}
      aria-label="Toggle pipeline log panel"
      aria-pressed={logPanelOpen}
      aria-disabled={inactive}
      tabIndex={inactive ? -1 : 0}
      className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-fast ease-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        inactive
          ? 'opacity-40 pointer-events-none text-text-secondary'
          : logPanelOpen
            ? 'bg-primary/15 text-primary'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant'
      }`}
    >
      {showDot && (
        <span
          className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-error"
          aria-hidden="true"
          data-testid="logs-unseen-dot"
        />
      )}
      <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">
        article
      </span>
    </button>
  );
}

export function Header() {
  const openCreateModal = useAppStore((s) => s.openCreateModal);

  return (
    <header className="flex items-center justify-between h-header px-6 bg-surface-elevated glass-heavy border-b border-border sticky top-0 z-[100]">
      {/* Brand */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-7 h-7 flex items-center justify-center rounded-lg bg-primary/10">
          <span className="text-primary text-sm font-bold leading-none select-none">◆</span>
        </div>
        <h1 className="text-sm font-semibold text-text-primary tracking-tight">Prism</h1>
      </div>

      {/* Centre: unified run indicator (ADR-1 run-indicator) */}
      <div className="flex items-center gap-3 flex-1 justify-center">
        <RunIndicator />
      </div>

      {/* Actions: Panel Toggles | New Task | Utility Strip */}
      <div className="flex items-center">
        {/* Panel Toggles */}
        <div className="flex items-center gap-2">
          <TerminalToggle />
          <AgentSettingsToggle />
          <RunHistoryToggle />
          <PipelineLogToggle />
          <ConfigToggle />
        </div>

        <div className="w-px h-6 bg-border/60 mx-2" aria-hidden="true" />

        <Button
          variant="primary"
          onClick={openCreateModal}
          aria-label="Add new task"
        >
          <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
            add
          </span>
          New Task
        </Button>

        <div className="w-px h-6 bg-border/60 mx-2" aria-hidden="true" />

        {/* Utility Strip */}
        <ThemeToggle />
      </div>
    </header>
  );
}
