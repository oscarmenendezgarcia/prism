/**
 * App header — brand, search, theme, and New issue.
 */

import { Button } from '@/components/shared/Button';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { UserMenu } from '@/components/layout/UserMenu';
import { useAppStore } from '@/stores/useAppStore';

// The global-search shortcut binds metaKey || ctrlKey (App.tsx), so it fires on both
// platforms. Show the matching modifier label: ⌘K on macOS, Ctrl K elsewhere.
const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
const SEARCH_HINT = IS_MAC ? '⌘K' : 'Ctrl K';
const SEARCH_LABEL = `Search tasks (${SEARCH_HINT})`;

export function Header() {
  const openCreateModal = useAppStore((s) => s.openCreateModal);
  const openGlobalSearch = useAppStore((s) => s.openGlobalSearch);

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

      {/* Centre: search pill — flex-1 fills the free space; justify-center keeps
          the capped pill centred once it hits its max-width on wide screens */}
      <div className="flex flex-1 min-w-0 items-center justify-center gap-3 px-6 lg:px-8">
        {/* Search pill — visible on md+, hidden on mobile (the icon button above is its entry point) */}
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
            Search…
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

      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <ThemeToggle />
        <Button
          variant="primary"
          onClick={openCreateModal}
          aria-label="Add new issue"
        >
          <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
            add
          </span>
          <span className="hidden sm:inline">New issue</span>
        </Button>
        <UserMenu />
      </div>
    </header>
  );
}
