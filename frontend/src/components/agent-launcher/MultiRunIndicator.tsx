/**
 * MultiRunIndicator — collapsed pill + expandable dropdown shown in the Header
 * when 2 or more pipeline runs are active simultaneously.
 *
 * Layout (from wireframes.md §2–3):
 *   Collapsed: "[N runs ▼]" pill in the header
 *   Expanded:  Absolute dropdown panel below the pill listing each RunItemCompact
 *
 * Auto-expand: opens for 3 s when a second run is detected, then auto-collapses
 *              (unless the user clicked to keep it open).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { PipelineState } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import { RunItemCompact } from './RunItemCompact';
import type { Space, AgentInfo, Task } from '@/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MultiRunIndicatorProps {
  pipelineStates: Record<string, PipelineState>;
  activePipelineRunId: string | null;
  activeSpace: Space | null;
  availableAgents: AgentInfo[];
}

// ---------------------------------------------------------------------------
// MultiRunIndicator
// ---------------------------------------------------------------------------

/** Terminal statuses excluded from the "active" run count shown to users. */
const ACTIVE_STATUSES = new Set<PipelineState['status']>(['running', 'paused', 'blocked']);

export function MultiRunIndicator({
  pipelineStates,
  activePipelineRunId,
  activeSpace,
  availableAgents,
}: MultiRunIndicatorProps) {
  const runCount = Object.keys(pipelineStates).length;

  const activeRunCount = Object.values(pipelineStates).filter(
    (ps) => ACTIVE_STATUSES.has(ps.status),
  ).length;

  const abortRun      = useAppStore((s) => s.abortRun);
  const clearRun      = useAppStore((s) => s.clearRun);
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const tasks         = useAppStore((s) => s.tasks);

  const [isExpanded, setIsExpanded]     = useState(false);
  // Track whether user explicitly clicked (overrides auto-close timer).
  const userClickedRef                  = useRef(false);
  const autoCollapseTimerRef            = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef                     = useRef<HTMLDivElement>(null);
  const prevRunCountRef                 = useRef(runCount);

  // Auto-expand for 3 s when a second run is detected.
  useEffect(() => {
    if (prevRunCountRef.current < 2 && runCount >= 2) {
      setIsExpanded(true);
      userClickedRef.current = false;
      if (autoCollapseTimerRef.current) clearTimeout(autoCollapseTimerRef.current);
      autoCollapseTimerRef.current = setTimeout(() => {
        if (!userClickedRef.current) setIsExpanded(false);
        autoCollapseTimerRef.current = null;
      }, 3000);
    }
    prevRunCountRef.current = runCount;
    return () => {
      if (autoCollapseTimerRef.current) {
        clearTimeout(autoCollapseTimerRef.current);
        autoCollapseTimerRef.current = null;
      }
    };
    // Intentionally depends only on runCount — pipelineStates ref changes every poll
    // tick, which would re-fire the timer on every backend update. We only want the
    // auto-expand to trigger on the 1→2 transition, not on run mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runCount]);

  // Close dropdown on click outside.
  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExpanded]);

  // Close on Escape key.
  useEffect(() => {
    if (!isExpanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsExpanded(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  const handlePillClick = () => {
    userClickedRef.current = true;
    // Cancel auto-close timer on explicit click.
    if (autoCollapseTimerRef.current) {
      clearTimeout(autoCollapseTimerRef.current);
      autoCollapseTimerRef.current = null;
    }
    setIsExpanded((prev) => !prev);
  };

  const handleOpenDetail = useCallback((runId: string) => {
    const ps = pipelineStates[runId];
    if (!ps) return;
    const taskId = ps.taskId;
    const task: Task | undefined =
      tasks['todo'].find((t) => t.id === taskId) ??
      tasks['in-progress'].find((t) => t.id === taskId) ??
      tasks['done'].find((t) => t.id === taskId);
    if (task) openDetailPanel(task);
  }, [pipelineStates, tasks, openDetailPanel]);

  // Sort: active run first, then by startedAt descending.
  const sortedEntries = Object.entries(pipelineStates).sort(([aId, a], [bId, b]) => {
    if (aId === activePipelineRunId) return -1;
    if (bId === activePipelineRunId) return 1;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });

  return (
    <div className="relative" ref={dropdownRef} data-testid="multi-run-indicator">
      {/* Collapsed pill */}
      <button
        onClick={handlePillClick}
        aria-expanded={isExpanded}
        aria-haspopup="listbox"
        aria-label={`${activeRunCount} ${activeRunCount === 1 ? 'run' : 'runs'} active, press Enter to ${isExpanded ? 'collapse' : 'expand'}`}
        data-testid="multi-run-pill"
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-variant border border-border text-text-secondary hover:text-text-primary hover:bg-surface-elevated cursor-pointer transition-colors duration-fast select-none"
      >
        {/* Stacked dots icon */}
        <span className="flex flex-col gap-0.5" aria-hidden="true">
          <span className="w-3.5 h-0.5 rounded-full bg-current" />
          <span className="w-3 h-0.5 rounded-full bg-current" />
          <span className="w-2.5 h-0.5 rounded-full bg-current" />
        </span>

        <span className="text-xs font-medium">
          {activeRunCount} {activeRunCount === 1 ? 'run' : 'runs'}
        </span>

        <span
          className={`material-symbols-outlined text-sm leading-none transition-transform duration-fast ${
            isExpanded ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        >
          expand_more
        </span>
      </button>

      {/* Expanded dropdown */}
      {isExpanded && (
        <div
          className="absolute top-[calc(100%+6px)] left-0 z-[110] min-w-[300px] w-[380px] max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto rounded-lg bg-surface border border-border shadow-lg"
          role="listbox"
          aria-label="Active pipeline runs"
          data-testid="multi-run-dropdown"
        >
          <div className="px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
              Active Runs ({activeRunCount})
            </span>
          </div>

          <div className="divide-y divide-border">
            {sortedEntries.map(([runId, ps]) => (
              <RunItemCompact
                key={runId}
                runId={runId}
                pipelineState={ps}
                isActive={runId === activePipelineRunId}
                activeSpace={activeSpace}
                availableAgents={availableAgents}
                onAbort={abortRun}
                onDismiss={clearRun}
                onOpenDetail={handleOpenDetail}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
