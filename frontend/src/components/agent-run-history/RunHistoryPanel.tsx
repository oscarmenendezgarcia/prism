/**
 * Run History side panel — resizable right sidebar showing agent run records.
 * ADR-1 (Agent Run History) §6.1: follows the TerminalPanel / ConfigPanel pattern.
 *
 * Features:
 * - Drag-resize left edge via usePanelResize (storageKey: prism:panel-width:run-history)
 * - Pulsing dot in header when any run is active
 * - Status filter pill bar (All / Running / Completed / Cancelled / Failed)
 * - Scrollable list of RunHistoryEntry rows
 * - Empty state when filter yields no results
 */

import React from 'react';
import { useRunHistoryStore, useFilteredRuns } from '@/stores/useRunHistoryStore';
import { usePanelResize } from '@/hooks/usePanelResize';
import { RunHistoryEntry } from './RunHistoryEntry';
import type { RunStatus } from '@/types';

// ---------------------------------------------------------------------------
// Filter pill bar configuration
// ---------------------------------------------------------------------------

type FilterOption = { label: string; value: RunStatus | 'all' };

const FILTER_OPTIONS: FilterOption[] = [
  { label: 'All',       value: 'all'       },
  { label: 'Running',   value: 'running'   },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'Failed',    value: 'failed'    },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Right-sidebar panel for browsing agent run history.
 * Rendered conditionally from App.tsx when historyPanelOpen is true.
 */
export function RunHistoryPanel() {
  const filter           = useRunHistoryStore((s) => s.filter);
  const setFilter        = useRunHistoryStore((s) => s.setFilter);
  const togglePanel      = useRunHistoryStore((s) => s.toggleHistoryPanel);
  const loading          = useRunHistoryStore((s) => s.loading);
  const runs             = useRunHistoryStore((s) => s.runs);
  const taskIdFilter     = useRunHistoryStore((s) => s.taskIdFilter);
  const clearTaskIdFilter = useRunHistoryStore((s) => s.clearTaskIdFilter);
  const filteredRuns     = useFilteredRuns();

  // Check if any run is currently active (for pulsing header dot).
  const hasActiveRun = runs.some((r) => r.status === 'running');

  const { width, handleMouseDown, minWidth, maxWidth } = usePanelResize({
    storageKey:   'prism:panel-width:run-history',
    defaultWidth: 360,
    minWidth:     280,
    maxWidth:     640,
  });

  return (
    <aside
      role="complementary"
      aria-label="Agent run history"
      className="relative flex flex-col bg-surface border-l border-border h-full shrink-0 w-[var(--panel-w)]"
      style={{ '--panel-w': `${width}px` } as React.CSSProperties}
    >
      {/* Left-edge drag handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize run history panel"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/40 transition-colors duration-150 z-10"
      />

      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">Run History</span>
          {hasActiveRun && (
            <span
              className="relative flex h-2 w-2"
              aria-label="Agent run active"
              title="An agent run is currently active"
            >
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
          )}
        </div>
        <button
          onClick={togglePanel}
          aria-label="Close run history panel"
          className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-surface-variant transition-colors duration-150"
        >
          <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
            close
          </span>
        </button>
      </div>

      {/* Task ID filter chip — shown when opened from a task card indicator */}
      {taskIdFilter && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border shrink-0 bg-[#3b82f6]/5">
          <span className="material-symbols-outlined text-sm text-[#3b82f6] leading-none" aria-hidden="true">
            filter_alt
          </span>
          <span className="text-xs text-[#3b82f6] flex-1 truncate">Filtering by task</span>
          <button
            onClick={clearTaskIdFilter}
            aria-label="Clear task filter"
            className="w-5 h-5 flex items-center justify-center rounded text-[#3b82f6] hover:bg-[#3b82f6]/20 transition-colors duration-150"
          >
            <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">close</span>
          </button>
        </div>
      )}

      {/* Filter pill bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0 overflow-x-auto">
        {FILTER_OPTIONS.map((opt) => {
          const isActive = filter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              aria-pressed={isActive}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors duration-150 whitespace-nowrap ${
                isActive
                  ? 'bg-primary/10 text-primary border-primary/20'
                  : 'bg-surface text-text-secondary border-border hover:bg-surface-variant'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Run list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && filteredRuns.length === 0 ? (
          /* Loading skeleton */
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <span className="material-symbols-outlined text-3xl text-text-disabled animate-pulse" aria-hidden="true">
              history
            </span>
            <p className="text-sm text-text-secondary">Loading run history…</p>
          </div>
        ) : filteredRuns.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <span className="material-symbols-outlined text-4xl text-text-disabled" aria-hidden="true">
              history
            </span>
            <p className="text-sm font-medium text-text-secondary">
              {taskIdFilter ? 'No runs for this task' : filter === 'all' ? 'No runs yet' : `No ${filter} runs`}
            </p>
            <p className="text-xs text-text-disabled leading-relaxed max-w-[200px]">
              {taskIdFilter
                ? 'No agents have been launched on this task yet.'
                : filter === 'all'
                ? 'Agent runs will appear here when you launch an agent from a task card.'
                : `Switch to "All" to see runs with other statuses.`}
            </p>
          </div>
        ) : (
          <ul role="list" aria-label="Agent run history list">
            {filteredRuns.map((run) => (
              <RunHistoryEntry key={run.id} run={run} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
