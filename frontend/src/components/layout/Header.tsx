/**
 * App header — brand, agent run indicator, pipeline bar, and action buttons.
 * ADR-002: replaces the .app-header section in legacy index.html.
 * ADR-003 §8.1: glass-heavy background, text-text-primary token, ThemeToggle added.
 * ADR-1 (Agent Launcher): AgentRunIndicator, PipelineProgressBar, agent settings gear icon.
 */

import React from 'react';
import { Button } from '@/components/shared/Button';
import { TerminalToggle } from '@/components/terminal/TerminalToggle';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { ConfigToggle } from '@/components/config/ConfigToggle';
import { AgentRunIndicator } from '@/components/agent-launcher/AgentRunIndicator';
import { PipelineProgressBar } from '@/components/agent-launcher/PipelineProgressBar';
import { AgentSettingsToggle } from '@/components/agent-launcher/AgentSettingsToggle';
import { useAppStore } from '@/stores/useAppStore';

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

      {/* Centre: active run indicator + pipeline bar */}
      <div className="flex items-center gap-3 flex-1 justify-center">
        <AgentRunIndicator />
        <PipelineProgressBar />
      </div>

      {/* Actions: Panel Toggles | New Task | Utility Strip */}
      <div className="flex items-center">
        {/* Panel Toggles */}
        <div className="flex items-center gap-1">
          <AgentSettingsToggle />
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
