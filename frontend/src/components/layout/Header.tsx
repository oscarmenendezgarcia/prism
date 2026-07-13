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
import { FolioToggle } from '@/components/folio/FolioToggle';
import { useAppStore } from '@/stores/useAppStore';

// The global-search shortcut binds metaKey || ctrlKey (App.tsx), so it fires on both
// platforms. Show the matching modifier label: ⌘K on macOS, Ctrl K elsewhere.
const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
const SEARCH_HINT = IS_MAC ? '⌘K' : 'Ctrl K';
const SEARCH_LABEL = `Buscar tareas (${SEARCH_HINT})`;

export function Header() {
  const openCreateModal = useAppStore((s) => s.openCreateModal);
  const openGlobalSearch = useAppStore((s) => s.openGlobalSearch);
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

      {/* Divider — separates the brand from the mobile search utility so the icon doesn't read as part of the logo.
          Matches the actions-strip dividers (h-6, mx-2) for a consistent rhythm. */}
      <div className="md:hidden w-px h-6 bg-border/60 mx-2 flex-shrink-0" aria-hidden="true" />

      {/* Search — compact icon button on the left, only on mobile (md+ shows the full pill in the centre) */}
      <button
        type="button"
        onClick={openGlobalSearch}
        aria-label={SEARCH_LABEL}
        className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg flex-shrink-0
          text-text-secondary hover:text-text-primary hover:bg-surface-variant
          active:scale-95 motion-reduce:active:scale-100
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
          transition-[color,background-color,transform] duration-fast ease-default"
      >
        <span className="material-symbols-outlined text-[20px] leading-none" aria-hidden="true">search</span>
      </button>

      {/* Centre: search pill + run indicator — flex-1 fills the free space; justify-center keeps
          the capped pill centred once it hits its max-width on wide screens */}
      <div className="flex flex-1 min-w-0 items-center justify-center gap-3 px-6 lg:px-8">
        {/* Search pill — visible on md+, hidden on mobile (hamburger menu has the entry point) */}
        <button
          type="button"
          onClick={openGlobalSearch}
          aria-label={SEARCH_LABEL}
          className="hidden md:flex flex-1 min-w-0 max-w-2xl items-center gap-2 px-3 h-9
            bg-surface border border-border rounded-lg
            hover:border-primary/40 hover:bg-surface-elevated
            active:scale-[0.99] motion-reduce:active:scale-100
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
            transition-[background-color,border-color,transform] duration-fast ease-default cursor-pointer group"
        >
          <span
            className="material-symbols-outlined text-[20px] leading-none text-text-secondary group-hover:text-text-primary shrink-0
              transition-colors duration-fast ease-default"
            aria-hidden="true"
          >
            search
          </span>
          <span className="flex-1 text-[13px] text-text-disabled group-hover:text-text-secondary text-left select-none
            transition-colors duration-fast ease-default">
            Buscar…
          </span>
          <kbd
            className="inline-flex items-center px-1.5 py-0.5
              text-[10px] font-mono text-text-disabled
              border border-border rounded
              bg-surface-variant shrink-0"
            aria-hidden="true"
          >
            {SEARCH_HINT}
          </kbd>
        </button>

        <RunIndicator />
      </div>

      {/* Actions: Panel Toggles | New Task | Utility Strip */}
      <div className="flex items-center flex-shrink-0">
        {/* Panel Toggles — collapse into the hamburger below lg so New Task always fits */}
        <div className="hidden lg:flex items-center gap-2">
          <Tooltip label="Folio" description="Browse and edit the space knowledge base">
            <FolioToggle />
          </Tooltip>
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

        <div className="hidden lg:block w-px h-6 bg-border/60 mx-2" aria-hidden="true" />

        {/* New Task — always visible; utility icons collapse around it */}
        <div className="block">
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

        <div className="hidden lg:block w-px h-6 bg-border/60 mx-2" aria-hidden="true" />

        {/* Theme — collapses into the hamburger below lg */}
        <div className="hidden lg:block">
          <ThemeToggle />
        </div>

        {/* Hamburger — shows below lg (holds the collapsed utility icons) */}
        <div className="relative lg:hidden ml-2" ref={menuRef}>
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
              {/* Panel toggles — rendered as menu rows */}
              <div className="flex flex-col">
                <MobileMenuRow label="Folio" icon="menu_book" toggle={<FolioToggle />} />
                <MobileMenuRow label="Terminal" icon="terminal" toggle={<TerminalToggle />} />
                <MobileMenuRow label="Agent Settings" icon="tune" toggle={<AgentSettingsToggle />} />
                <MobileMenuRow label="Runs" icon="account_tree" toggle={<RunsToggle />} />
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
