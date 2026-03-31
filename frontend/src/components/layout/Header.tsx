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
  const pipelineState  = useAppStore((s) => s.pipelineState);
  const logPanelOpen   = usePipelineLogStore((s) => s.logPanelOpen);
  const setLogPanelOpen = usePipelineLogStore((s) => s.setLogPanelOpen);

  if (!pipelineState) return null;

  return (
    <button
      onClick={() => setLogPanelOpen(!logPanelOpen)}
      aria-label="Toggle pipeline log panel"
      aria-pressed={logPanelOpen}
      className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-150 ease-apple ${
        logPanelOpen
          ? 'bg-primary/[0.15] text-primary'
          : 'text-text-secondary hover:bg-surface-variant hover:text-text-primary'
      }`}
    >
      <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
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
      <div className="flex items-center gap-3">
        <span
          className="material-symbols-outlined text-2xl text-primary leading-none"
          aria-hidden="true"
        >
          view_kanban
        </span>
        <h1 className="text-xl font-medium text-text-primary tracking-tight">Prism</h1>
      </div>

      {/* Centre: unified run indicator (ADR-1 run-indicator) */}
      <div className="flex items-center gap-3 flex-1 justify-center">
        <RunIndicator />
      </div>

      {/* Actions: Panel Toggles | New Task | Utility Strip */}
      <div className="flex items-center">
        {/* Panel Toggles */}
        <div className="flex items-center gap-1">
          <AgentSettingsToggle />
          <RunHistoryToggle />
          <PipelineLogToggle />
          <ConfigToggle />
          <TerminalToggle />
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
