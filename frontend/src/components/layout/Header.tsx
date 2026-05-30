/**
 * App header — brand, run indicator, and action buttons.
 * ADR-002: replaces the .app-header section in legacy index.html.
 * ADR-003 §8.1: glass-heavy background, text-text-primary token, ThemeToggle added.
 * ADR-1 (Agent Launcher): RunIndicator (unified, replaces AgentRunIndicator + PipelineProgressBar).
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/shared/Button';
import { Tooltip } from '@/components/shared/Tooltip';
import { TerminalToggle } from '@/components/terminal/TerminalToggle';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { ConfigToggle } from '@/components/config/ConfigToggle';
import { RunIndicator } from '@/components/agent-launcher/RunIndicator';
import { AgentSettingsToggle } from '@/components/agent-launcher/AgentSettingsToggle';
import { RunsToggle } from '@/components/runs-panel/RunsToggle';
import { useAppStore } from '@/stores/useAppStore';

export function Header() {
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
          <Tooltip label="Terminal" description="Run shell commands on the server">
            <TerminalToggle />
          </Tooltip>
          <Tooltip label="Agent Settings" description="Configure agents and pipeline stages">
            <AgentSettingsToggle />
          </Tooltip>
          <Tooltip label="Runs" description="Browse run history and pipeline logs">
            <RunsToggle />
          </Tooltip>
          <Tooltip label="Config" description="Edit configuration files">
            <ConfigToggle />
          </Tooltip>
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
        <div className="hidden sm:flex items-center gap-1">
          <Tooltip label="Support on Ko-fi" description="Buy me a coffee ☕">
            <a
              href="https://ko-fi.com/oscarmdzgarcia"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Support on Ko-fi"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-text-secondary hover:text-[#FF5E5B] hover:bg-[#FF5E5B]/10 transition-all duration-fast"
            >
              <span className="material-symbols-outlined text-[20px] leading-none" aria-hidden="true">coffee</span>
            </a>
          </Tooltip>
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
                <MobileMenuRow label="Terminal" icon="terminal" toggle={<TerminalToggle />} />
                <MobileMenuRow label="Agent Settings" icon="tune" toggle={<AgentSettingsToggle />} />
                <MobileMenuRow label="Runs" icon="account_tree" toggle={<RunsToggle />} />
                <MobileMenuRow label="Config" icon="settings" toggle={<ConfigToggle />} />
                <MobileMenuRow label="Theme" icon="dark_mode" toggle={<ThemeToggle />} />
              </div>

              <div className="h-px bg-border mx-3 my-1" aria-hidden="true" />

              <a
                href="https://ko-fi.com/oscarmdzgarcia"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-surface-variant transition-colors duration-fast"
                onClick={() => setMenuOpen(false)}
              >
                <span className="material-symbols-outlined text-[18px] leading-none text-[#FF5E5B]" aria-hidden="true">coffee</span>
                Support on Ko-fi
              </a>
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
