/**
 * App header — brand and action buttons.
 * ADR-002: replaces the .app-header section in legacy index.html.
 * ADR-003 §8.1: glass-heavy background, text-text-primary token, ThemeToggle added.
 */

import React from 'react';
import { Button } from '@/components/shared/Button';
import { TerminalToggle } from '@/components/terminal/TerminalToggle';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { ConfigToggle } from '@/components/config/ConfigToggle';
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

      {/* Actions */}
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <ConfigToggle />
        <TerminalToggle />
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
      </div>
    </header>
  );
}
