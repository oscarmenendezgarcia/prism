/**
 * PipelineRunGroup — collapsible group row for multi-stage pipeline runs.
 *
 * ADR-1 (pipeline-run-history-bridge) §3.5 C:
 * Renders a group header with aggregate status, task title, space name,
 * stage count badge, total elapsed time, and chevron toggle.
 * Expanded state shows one RunHistoryEntry per stage, each prefixed with
 * a "Stage N:" label via the stageLabel prop.
 *
 * ADR-1 (run-history-pipeline-logs) §7: the header is split into two areas:
 *  - Main area (icon + content) → invokes onOpenLogs(stageIndex=0)
 *  - Chevron button → toggles expand/collapse only (stopPropagation)
 * Each expanded RunHistoryEntry also receives an onClick that opens logs
 * with the corresponding stage pre-selected.
 *
 * Default open state:
 *   - collapsed  → groups with no running stage (completed / failed / etc.)
 *   - expanded   → groups that contain at least one running stage
 */

import React, { memo, useCallback, useState } from 'react';
import type { AgentRunRecord, RunStatus } from '@/types';
import { RunHistoryEntry } from './RunHistoryEntry';

// ---------------------------------------------------------------------------
// Status-driven style maps (mirrors RunHistoryEntry)
// ---------------------------------------------------------------------------

const borderColorClass: Record<string, string> = {
  running:   'border-l-primary',
  completed: 'border-l-success',
  cancelled: 'border-l-warning',
  failed:    'border-l-error',
};

const iconBgClass: Record<string, string> = {
  running:   'bg-primary/10 text-primary',
  completed: 'bg-success/10 text-success',
  cancelled: 'bg-warning/10 text-warning',
  failed:    'bg-error/10   text-error',
};

const iconName: Record<string, string> = {
  running:   'account_tree',
  completed: 'check_circle',
  cancelled: 'cancel',
  failed:    'error',
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Format elapsed milliseconds as m:ss (e.g. "5:23"). */
function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const minutes   = Math.floor(totalSecs / 60);
  const seconds   = totalSecs % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Compute a human-readable relative time string from an ISO timestamp. */
function relativeTime(isoTimestamp: string): string {
  const diffMs = Date.now() - Date.parse(isoTimestamp);
  const secs   = Math.floor(diffMs / 1000);
  if (secs < 60)    return 'just now';
  if (secs < 3600)  return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`;
  return `${Math.floor(secs / 86400)} d ago`;
}

/**
 * Compute total elapsed time for the group:
 * from the earliest startedAt to the latest completedAt.
 * Returns null when any stage is still running (no completedAt).
 */
function computeTotalDuration(stages: AgentRunRecord[]): number | null {
  if (stages.some((s) => s.completedAt === null)) return null;
  const start = Math.min(...stages.map((s) => Date.parse(s.startedAt)));
  const end   = Math.max(...stages.map((s) => Date.parse(s.completedAt!)));
  return end - start;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PipelineRunGroupProps {
  pipelineRunId: string;
  stages: AgentRunRecord[];
  aggregateStatus: RunStatus;
  /**
   * Called when the user clicks the main header area or an individual stage row.
   * stageIndex is provided when clicking on an expanded stage row.
   * ADR-1 (run-history-pipeline-logs) §7.
   */
  onOpenLogs?: (stageIndex?: number) => void;
}

/**
 * Renders a collapsible pipeline group row in the Run History panel.
 * The first stage's task title and space name are used as the group title.
 */
export const PipelineRunGroup = memo(function PipelineRunGroup({
  pipelineRunId: _pipelineRunId,
  stages,
  aggregateStatus,
  onOpenLogs,
}: PipelineRunGroupProps) {
  const hasRunning = stages.some((s) => s.status === 'running');
  const [open, setOpen] = useState(hasRunning);

  const first          = stages[0];
  const totalMs        = computeTotalDuration(stages);
  const completedCount = stages.filter((s) => s.status === 'completed').length;

  // Stage count badge: "3 stages" while running, "2/3 completed" when partially done.
  const stageCountLabel = hasRunning
    ? `${completedCount}/${stages.length} stages`
    : `${stages.length} stages`;

  const handleMainAreaClick = useCallback(() => {
    onOpenLogs?.(0);
  }, [onOpenLogs]);

  const handleMainAreaKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenLogs?.(0);
    }
  }, [onOpenLogs]);

  const handleChevronClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((prev) => !prev);
  }, []);

  const handleChevronKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation();
      e.preventDefault();
      setOpen((prev) => !prev);
    }
  }, []);

  return (
    <li className="border-b border-border">
      {/* Group header row — split into main area (logs) + chevron (toggle) */}
      <div
        className={`relative w-full flex items-start gap-3 px-4 py-3 hover:bg-surface-elevated transition-colors duration-150 border-l-[3px] ${borderColorClass[aggregateStatus] ?? 'border-l-border'}`}
      >
        {/* Main clickable area: opens logs in stage 0 (interactive only when onOpenLogs provided) */}
        <div
          {...(onOpenLogs ? {
            role:        'button' as const,
            tabIndex:    0,
            onClick:     handleMainAreaClick,
            onKeyDown:   handleMainAreaKeyDown,
            'aria-label': `Open logs for ${first.taskTitle}`,
          } : {})}
          className={`flex-1 flex items-start gap-3 min-w-0 text-left ${onOpenLogs ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded' : ''}`}
        >
          {/* Status icon */}
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBgClass[aggregateStatus] ?? ''}`}
            aria-hidden="true"
          >
            <span className="material-symbols-outlined text-base leading-none">
              {iconName[aggregateStatus] ?? 'help'}
            </span>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Task title */}
            <p className="text-sm font-medium text-text-primary leading-snug truncate">
              {first.taskTitle}
            </p>

            {/* Space + relative time + optional total duration */}
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-[11px] text-text-disabled truncate">{first.spaceName}</span>
              <span className="text-[11px] text-text-disabled" aria-hidden="true">·</span>
              <span className="text-[11px] text-text-disabled">{relativeTime(first.startedAt)}</span>

              {totalMs !== null && (
                <>
                  <span className="text-[11px] text-text-disabled" aria-hidden="true">·</span>
                  <span
                    className="text-[11px] text-text-secondary font-mono"
                    aria-label={`Total duration: ${formatDuration(totalMs)}`}
                  >
                    {formatDuration(totalMs)}
                  </span>
                </>
              )}
            </div>

            {/* Stage count badge */}
            <div className="mt-1">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-variant text-text-secondary">
                <span className="material-symbols-outlined text-[10px] leading-none" aria-hidden="true">
                  linear_scale
                </span>
                {stageCountLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Chevron — separate interactive control for expand/collapse only */}
        <button
          type="button"
          onClick={handleChevronClick}
          onKeyDown={handleChevronKeyDown}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} pipeline stages for ${first.taskTitle}`}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded text-text-disabled hover:bg-surface-variant hover:text-text-secondary transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span
            className={`material-symbols-outlined text-base leading-none transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            expand_more
          </span>
        </button>
      </div>

      {/* Expanded stage list */}
      {open && (
        <ul aria-label={`Pipeline stages for ${first.taskTitle}`}>
          {stages.map((stage, idx) => (
            <RunHistoryEntry
              key={stage.id}
              run={stage}
              stageLabel={`Stage ${idx + 1}`}
              onClick={onOpenLogs ? () => onOpenLogs(idx) : undefined}
            />
          ))}
        </ul>
      )}
    </li>
  );
});
