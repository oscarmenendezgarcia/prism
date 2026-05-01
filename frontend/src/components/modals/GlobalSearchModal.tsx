/**
 * GlobalSearchModal — cross-space task search (⌘K / Ctrl+K).
 *
 * Layout: text input at top (auto-focused), results list below with:
 *   - task title, truncated description preview
 *   - spaceName badge + column badge
 *
 * States: empty, loading, error, results, no-results.
 * Arrow Up/Down moves selection; Enter activates; Escape closes (shared Modal).
 *
 * ADR-1 (global-search): uses shared <Modal> for portal, backdrop, Escape, focus trap.
 */

import React, { useEffect, useRef, useCallback, useId } from 'react';
import { Modal } from '@/components/shared/Modal';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { useAppStore } from '@/stores/useAppStore';
import type { SearchResult } from '@/types';

// ---------------------------------------------------------------------------
// Column display helpers
// ---------------------------------------------------------------------------

const COLUMN_LABELS: Record<string, string> = {
  'todo':        'Todo',
  'in-progress': 'In Progress',
  'done':        'Done',
};

const COLUMN_COLORS: Record<string, string> = {
  'todo':        'text-text-secondary bg-surface-variant',
  'in-progress': 'text-primary bg-primary/10',
  'done':        'text-success bg-success/10',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ResultItemProps {
  result:   SearchResult;
  selected: boolean;
  onSelect: () => void;
  id:       string;
}

function ResultItem({ result, selected, onSelect, id, index = 0 }: ResultItemProps & { index?: number }) {
  const { task, spaceName, column } = result;
  const colLabel = COLUMN_LABELS[column] ?? column;
  const colColor = COLUMN_COLORS[column] ?? 'text-text-secondary bg-surface-variant';
  const staggerClass = `stagger-delay-${Math.min(index, 7)}`;

  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={`flex flex-col gap-1 px-4 py-3 cursor-pointer transition-all duration-150 border-b border-border/50 last:border-b-0 animate-stagger-in ${staggerClass} ${
        selected ? 'bg-primary/10' : 'hover:bg-surface-variant'
      }`}
    >
      {/* Title row */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-text-primary truncate flex-1">
          {task.title}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface-elevated border border-border text-text-secondary font-medium">
            {spaceName}
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${colColor}`}>
            {colLabel}
          </span>
        </div>
      </div>
      {/* Description preview */}
      {task.description && (
        <p className="text-xs text-text-secondary line-clamp-1">
          {task.description}
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// GlobalSearchModal
// ---------------------------------------------------------------------------

interface GlobalSearchModalProps {
  open:    boolean;
  onClose: () => void;
}

export function GlobalSearchModal({ open, onClose }: GlobalSearchModalProps) {
  const { query, setQuery, results, status, error } = useGlobalSearch();
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  const setActiveSpace    = useAppStore((s) => s.setActiveSpace);
  const openDetailPanel   = useAppStore((s) => s.openDetailPanel);
  const loadBoard         = useAppStore((s) => s.loadBoard);

  const inputRef    = useRef<HTMLInputElement>(null);
  const listRef     = useRef<HTMLUListElement>(null);
  const titleId     = useId();

  // Auto-focus input and reset state when modal opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Slight delay to let the Modal animation settle before focusing.
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open, setQuery]);

  // Reset selection when results change.
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Scroll selected item into view.
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('[aria-selected="true"]');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const activateResult = useCallback(
    async (result: SearchResult) => {
      onClose();
      // Switch to the result's space if needed, then load board + open detail.
      setActiveSpace(result.spaceId);
      await loadBoard();
      openDetailPanel(result.task);
    },
    [onClose, setActiveSpace, loadBoard, openDetailPanel]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && results.length > 0) {
        e.preventDefault();
        activateResult(results[selectedIndex]);
      }
    },
    [results, selectedIndex, activateResult]
  );

  const listboxId = `${titleId}-listbox`;

  // Render
  const showResults  = results.length > 0;
  const showNoMatch  = status === 'idle' && query.trim().length > 0 && results.length === 0;
  const showLoading  = status === 'loading';
  const showError    = status === 'error';

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelId={titleId}
      className="max-w-[560px]"
      enterAnimation="animate-search-in"
      exitAnimation="animate-search-out"
    >
      {/* Search input — no ModalHeader so the input IS the header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <span
          className="material-symbols-outlined text-text-secondary text-[20px] leading-none shrink-0"
          aria-hidden="true"
        >
          search
        </span>
        <input
          ref={inputRef}
          id={titleId}
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Search tasks across all spaces"
          aria-controls={listboxId}
          aria-activedescendant={
            showResults ? `${listboxId}-item-${selectedIndex}` : undefined
          }
          aria-autocomplete="list"
          role="combobox"
          aria-expanded={showResults}
          className="flex-1 bg-transparent text-text-primary placeholder:text-text-disabled text-sm focus:outline-none"
        />
        {showLoading && (
          <span
            className="inline-block w-4 h-4 rounded-full border-2 border-text-disabled border-t-primary animate-spin shrink-0"
            aria-label="Loading results…"
            role="status"
          />
        )}
        <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-text-disabled border border-border rounded shrink-0">
          ESC
        </kbd>
      </div>

      {/* Results list */}
      <ul
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label="Search results"
        className="overflow-y-auto max-h-[360px]"
      >
        {showResults && results.map((result, i) => (
          <ResultItem
            key={result.task.id}
            id={`${listboxId}-item-${i}`}
            result={result}
            index={i}
            selected={i === selectedIndex}
            onSelect={() => activateResult(result)}
          />
        ))}

        {showNoMatch && (
          <li className="px-4 py-8 text-center text-sm text-text-secondary" aria-live="polite">
            No matches for{' '}
            <span className="font-medium text-text-primary">"{query.trim()}"</span>
          </li>
        )}

        {showError && (
          <li className="px-4 py-8 text-center text-sm text-error" aria-live="assertive">
            {error?.message ?? 'Search failed. Please try again.'}
          </li>
        )}

        {!query.trim() && (
          <li className="px-4 py-6 text-center text-xs text-text-disabled">
            Type to search across all spaces
          </li>
        )}
      </ul>

      {/* Footer hint */}
      {showResults && (
        <div className="flex items-center gap-3 px-4 py-2 border-t border-border text-[11px] text-text-disabled">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      )}
    </Modal>
  );
}
