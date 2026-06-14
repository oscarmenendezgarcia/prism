/**
 * DependsOnSection — "Depends on" field in TaskDetailPanel.
 *
 * Shows the list of dependency tasks with their column status.
 * [+] button opens an inline FTS search to add deps.
 * [×] button removes a dep.
 * Calls PUT /tasks/:id with merged/filtered dependsOn.
 *
 * Section is hidden when column is 'done'.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { apiFetch, updateTask } from '@/api/client';
import type { Column, Task } from '@/types';

// Column pill styles
const COLUMN_PILL_CLASS: Record<Column, string> = {
  'todo':        'bg-info/[0.12] text-info',
  'in-progress': 'bg-warning/[0.12] text-warning',
  'done':        'bg-success/[0.12] text-success',
};

const COLUMN_LABELS: Record<Column, string> = {
  'todo':        'todo',
  'in-progress': 'in progress',
  'done':        'done',
};

interface DepTask {
  id: string;
  title: string;
  column: Column;
}

interface DependsOnSectionProps {
  spaceId: string;
  taskId: string;
  dependsOn: string[];
  disabled?: boolean;
  /** Called after a successful update so the parent can refresh. */
  onUpdated: (newDependsOn: string[]) => void;
}

export function DependsOnSection({
  spaceId,
  taskId,
  dependsOn,
  disabled = false,
  onUpdated,
}: DependsOnSectionProps) {
  const tasks = useAppStore((s) => s.tasks);
  const showToast = useAppStore((s) => s.showToast);

  const [searchOpen,   setSearchOpen]   = useState(false);
  const [query,        setQuery]        = useState('');
  const [results,      setResults]      = useState<Task[]>([]);
  const [searching,    setSearching]    = useState(false);
  const [mutating,     setMutating]     = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  // Build a lookup of task column from the board tasks
  const allTasks: Task[] = [
    ...tasks['todo'],
    ...tasks['in-progress'],
    ...tasks['done'],
  ];

  function getTaskColumn(id: string): Column {
    if (tasks['todo'].some(x => x.id === id)) return 'todo';
    if (tasks['in-progress'].some(x => x.id === id)) return 'in-progress';
    return 'done';
  }

  const depTaskMap = new Map<string, DepTask>();
  for (const t of allTasks) {
    depTaskMap.set(t.id, { id: t.id, title: t.title, column: getTaskColumn(t.id) });
  }

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen) {
      searchRef.current?.focus();
      setQuery('');
      setResults([]);
    }
  }, [searchOpen]);

  // FTS search with debounce
  useEffect(() => {
    if (!searchOpen) return;
    if (!query.trim()) { setResults([]); return; }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch<{ results: Task[]; total: number }>(
          `/spaces/${encodeURIComponent(spaceId)}/tasks/search?q=${encodeURIComponent(query.trim())}&limit=10`,
          { signal }
        );
        if (!signal.aborted) {
          // Exclude self and already-added deps
          setResults(res.results.filter(t => t.id !== taskId && !dependsOn.includes(t.id)));
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('[DependsOnSection] search error:', err);
        }
      } finally {
        if (!signal.aborted) setSearching(false);
      }
    }, 200);

    return () => { clearTimeout(timer); abortRef.current?.abort(); };
  }, [query, searchOpen, spaceId, taskId, dependsOn]);

  const handleAdd = useCallback(async (depId: string) => {
    if (mutating) return;
    setMutating(true);
    const newDeps = [...dependsOn, depId];
    try {
      await updateTask(spaceId, taskId, { dependsOn: newDeps });
      onUpdated(newDeps);
      setSearchOpen(false);
      setQuery('');
    } catch (err) {
      const apiErr = err as { code?: string; message?: string };
      if (apiErr.code === 'CYCLE_DETECTED') {
        showToast('Cannot add: this would create a circular dependency.', 'error');
      } else if (apiErr.code === 'DEPENDENCY_NOT_FOUND') {
        showToast('Task not found in this space.', 'error');
      } else {
        showToast(`Failed to add dependency: ${apiErr.message || 'Unknown error'}`, 'error');
      }
    } finally {
      setMutating(false);
    }
  }, [dependsOn, spaceId, taskId, mutating, onUpdated, showToast]);

  const handleRemove = useCallback(async (depId: string) => {
    if (mutating) return;
    setMutating(true);
    const newDeps = dependsOn.filter(id => id !== depId);
    try {
      await updateTask(spaceId, taskId, { dependsOn: newDeps });
      onUpdated(newDeps);
    } catch (err) {
      const apiErr = err as { code?: string; message?: string };
      showToast(`Failed to remove dependency: ${apiErr.message || 'Unknown error'}`, 'error');
    } finally {
      setMutating(false);
    }
  }, [dependsOn, spaceId, taskId, mutating, onUpdated, showToast]);

  return (
    <div className="flex flex-col gap-2" data-testid="depends-on-section">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-[0.10em]">
          Depends on
        </span>
        {!disabled && !searchOpen && (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Add dependency"
            title="Add dependency"
            className="p-2.5 -m-1 flex items-center justify-center rounded text-text-disabled hover:text-text-secondary hover:bg-surface-variant focus:outline-hidden focus:ring-2 focus:ring-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-[180ms] ease-spring"
          >
            <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">add</span>
          </button>
        )}
      </div>

      {/* Dep list */}
      {dependsOn.length === 0 ? (
        <p className="text-[12px] text-text-disabled italic">No dependencies</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Dependencies">
          {dependsOn.map((depId) => {
            const dep = depTaskMap.get(depId);
            return (
              <li
                key={depId}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface/50 border border-border/30"
                data-testid="dep-item"
              >
                {dep ? (
                  <>
                    <span
                      className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${COLUMN_PILL_CLASS[dep.column]}`}
                      aria-label={`Status: ${COLUMN_LABELS[dep.column]}`}
                    >
                      {COLUMN_LABELS[dep.column]}
                    </span>
                    <span className="flex-1 text-xs text-text-secondary truncate" title={dep.title}>
                      {dep.title}
                    </span>
                  </>
                ) : (
                  <span className="flex-1 text-xs text-text-disabled font-mono truncate">{depId}</span>
                )}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => handleRemove(depId)}
                    disabled={mutating}
                    aria-label={`Remove dependency ${dep?.title ?? depId}`}
                    className="shrink-0 text-text-disabled hover:text-error transition-colors disabled:opacity-40"
                    data-testid="remove-dep-btn"
                  >
                    <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">close</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Search input */}
      {searchOpen && !disabled && (
        <div className="flex flex-col gap-1 mt-1" data-testid="dep-search">
          <div className="relative">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setSearchOpen(false); setQuery(''); } }}
              placeholder="Search tasks to add…"
              className="w-full px-3 py-2 rounded-lg bg-surface/60 border border-border/40 text-sm text-text-primary placeholder:text-text-disabled/50 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60 transition-all duration-[220ms] ease-spring"
              aria-label="Search tasks to add as dependency"
            />
            {searching && (
              <span className="material-symbols-outlined text-[14px] text-text-disabled absolute right-3 top-1/2 -translate-y-1/2 animate-spin" aria-hidden="true">
                progress_activity
              </span>
            )}
          </div>

          {results.length > 0 && (
            <ul className="flex flex-col gap-0.5 max-h-[200px] overflow-y-auto border border-border/30 rounded-lg bg-surface-elevated shadow-md" role="listbox" aria-label="Search results">
              {results.map((t) => {
                const col = getTaskColumn(t.id);
                return (
                  <li key={t.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      onClick={() => handleAdd(t.id)}
                      disabled={mutating}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-variant transition-colors disabled:opacity-50"
                      data-testid="search-result-item"
                    >
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0 ${COLUMN_PILL_CLASS[col]}`}>
                        {COLUMN_LABELS[col]}
                      </span>
                      <span className="text-xs text-text-primary truncate">{t.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!searching && query.trim() && results.length === 0 && (
            <p className="text-xs text-text-disabled px-1">No tasks found</p>
          )}

          <button
            type="button"
            onClick={() => { setSearchOpen(false); setQuery(''); }}
            className="text-[11px] text-text-secondary hover:text-text-primary self-start transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
