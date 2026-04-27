/**
 * App header — brand, run indicator, and action buttons.
 * ADR-002: replaces the .app-header section in legacy index.html.
 * ADR-003 §8.1: glass-heavy background, text-text-primary token, ThemeToggle added.
 * ADR-1 (Agent Launcher): RunIndicator (unified, replaces AgentRunIndicator + PipelineProgressBar).
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/shared/Button';
import { TerminalToggle } from '@/components/terminal/TerminalToggle';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { ConfigToggle } from '@/components/config/ConfigToggle';
import { RunIndicator } from '@/components/agent-launcher/RunIndicator';
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

interface HeaderProps {
  agentsPageOpen?: boolean;
  onToggleAgentsPage?: () => void;
}

export function Header({ agentsPageOpen = false, onToggleAgentsPage }: HeaderProps) {
  const openCreateModal = useAppStore((s) => s.openCreateModal);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  return (
    <header className="flex items-center justify-between h-header px-6 bg-surface-elevated glass-heavy border-b border-border sticky top-0 z-[100]">
      {/* Brand */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-7 h-7 flex items-center justify-center rounded-lg bg-primary/10">
          <span className="text-primary text-sm font-bold leading-none select-none">◆</span>
        </div>
        <h1 className="text-lg font-semibold text-text-primary tracking-tight">Prism</h1>
      </div>

      {/* Centre: unified run indicator (ADR-1 run-indicator) — only takes space when active */}
      <div className="flex items-center gap-3 justify-center px-4">
        <RunIndicator />
      </div>

      {/* Actions: Panel Toggles | New Task | Utility Strip */}
      <div className="flex items-center">
        {/* Panel Toggles — hidden on mobile */}
        <div className="hidden sm:flex items-center gap-2">
          {/* Agents page toggle */}
          {onToggleAgentsPage && (
            <button
              onClick={onToggleAgentsPage}
              aria-label="Toggle agents page"
              aria-pressed={agentsPageOpen}
              className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-fast ease-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                agentsPageOpen
                  ? 'bg-primary/15 text-primary'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant'
              }`}
            >
              <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">
                smart_toy
              </span>
            </button>
          )}
          <TerminalToggle />
          <RunHistoryToggle />
          <PipelineLogToggle />
          <ConfigToggle />
        </div>

        <div className="hidden sm:block w-px h-6 bg-border/60 mx-2" aria-hidden="true" />

        {/* New Task — hidden on mobile (FAB in Board handles it) */}
        <div className="hidden sm:block">
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

        <div className="hidden sm:block w-px h-6 bg-border/60 mx-2" aria-hidden="true" />

        {/* Utility Strip — hidden on mobile (lives in hamburger menu) */}
        <div className="hidden sm:block">
          <ThemeToggle />
        </div>

        {/* Hamburger — mobile only */}
        <div className="relative sm:hidden ml-2" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-fast ${
              menuOpen
                ? 'bg-primary/15 text-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant'
            }`}
          >
            <span className="material-symbols-outlined text-[20px] leading-none" aria-hidden="true">
              {menuOpen ? 'close' : 'menu'}
            </span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-surface-elevated border border-border rounded-xl shadow-lg py-2 z-[110]">
              {/* New Task */}
              <button
                type="button"
                onClick={() => { openCreateModal(); setMenuOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-surface-variant transition-colors duration-fast"
              >
                <span className="material-symbols-outlined text-[18px] leading-none text-primary" aria-hidden="true">add_circle</span>
                New Task
              </button>

              <div className="h-px bg-border mx-3 my-1" aria-hidden="true" />

              {/* Panel toggles — rendered as menu rows */}
              <div className="flex flex-col">
                {onToggleAgentsPage && (
                  <button
                    type="button"
                    onClick={() => { onToggleAgentsPage(); setMenuOpen(false); }}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-variant transition-colors duration-fast"
                  >
                    <span className="material-symbols-outlined text-[18px] leading-none text-primary" aria-hidden="true">smart_toy</span>
                    <span className={agentsPageOpen ? 'text-primary font-medium' : 'text-text-primary'}>Agents</span>
                  </button>
                )}
                <MobileMenuRow label="Terminal" icon="terminal" toggle={<TerminalToggle />} />
                <MobileMenuRow label="Run History" icon="history" toggle={<RunHistoryToggle />} />
                <MobileMenuRow label="Pipeline Log" icon="article" toggle={<PipelineLogToggle />} />
                <MobileMenuRow label="Config" icon="settings" toggle={<ConfigToggle />} />
                <MobileMenuRow label="Theme" icon="dark_mode" toggle={<ThemeToggle />} />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MobileMenuRow({ label, icon, toggle }: { label: string; icon: string; toggle: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 hover:bg-surface-variant transition-colors duration-fast">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-[18px] leading-none text-text-secondary" aria-hidden="true">{icon}</span>
        <span className="text-sm text-text-primary">{label}</span>
      </div>
      {toggle}
    </div>
  );
}
