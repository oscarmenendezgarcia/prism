/**
 * Single row in the Run History panel list.
 * ADR-1 (Agent Run History) §6.2: colored left border, icon, agent name, task,
 * space name, relative time, and optional duration badge.
 *
 * Pure component — no internal state, no polling, renders only from props.
 */

import React, { memo } from 'react';
import type { AgentRunRecord } from '@/types';

// ---------------------------------------------------------------------------
// Status-driven style maps
// ---------------------------------------------------------------------------

/** Left border colour per status using Tailwind arbitrary values. */
const borderColorClass: Record<string, string> = {
  running:   'border-l-primary',
  completed: 'border-l-success',
  cancelled: 'border-l-warning',
  failed:    'border-l-error',
};

/** Icon container background per status. */
const iconBgClass: Record<string, string> = {
  running:   'bg-primary/10 text-primary',
  completed: 'bg-success/10 text-success',
  cancelled: 'bg-warning/10 text-warning',
  failed:    'bg-error/10   text-error',
};

/** Material Symbol icon name per status. */
const iconName: Record<string, string> = {
  running:   'smart_toy',
  completed: 'check_circle',
  cancelled: 'cancel',
  failed:    'error',
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Format elapsed milliseconds as m:ss (e.g. "5:23").
 * Returns an empty string when durationMs is null.
 */
function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const minutes   = Math.floor(totalSecs / 60);
  const seconds   = totalSecs % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Compute a human-readable relative time string from an ISO timestamp.
 * Returns strings like "just now", "2 min ago", "1 hr ago".
 */
function relativeTime(isoTimestamp: string): string {
  const diffMs = Date.now() - Date.parse(isoTimestamp);
  const secs   = Math.floor(diffMs / 1000);
  if (secs < 60)                    return 'just now';
  if (secs < 3600)                  return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400)                 return `${Math.floor(secs / 3600)} hr ago`;
  return `${Math.floor(secs / 86400)} d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RunHistoryEntryProps {
  run: AgentRunRecord;
  /**
   * When set, prepends a stage label to the agent display name.
   * Used inside PipelineRunGroup: "Stage 1: Senior Architect".
   */
  stageLabel?: string;
}

/**
 * Renders a single agent run record as a list row.
 * Memoized to prevent re-renders when unrelated runs update.
 */
export const RunHistoryEntry = memo(function RunHistoryEntry({ run, stageLabel }: RunHistoryEntryProps) {
  const status = run.status;

  return (
    <li
      className={`relative flex items-start gap-3 px-4 py-3 border-b border-border hover:bg-surface-elevated transition-colors duration-150 border-l-[3px] ${borderColorClass[status] ?? 'border-l-border'}`}
    >
      {/* Icon container */}
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBgClass[status] ?? ''}`}
        aria-hidden="true"
      >
        <span className="material-symbols-outlined text-base leading-none">
          {iconName[status] ?? 'help'}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Agent name — optionally prefixed with stage label */}
        <p className="text-sm font-medium text-text-primary leading-snug truncate">
          {stageLabel ? `${stageLabel}: ${run.agentDisplayName}` : run.agentDisplayName}
        </p>

        {/* Task title */}
        <p className="text-xs text-text-secondary leading-snug truncate mt-0.5">
          {run.taskTitle}
        </p>

        {/* Space + relative time + optional duration */}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-[11px] text-text-disabled truncate">{run.spaceName}</span>
          <span className="text-[11px] text-text-disabled" aria-hidden="true">·</span>
          <span className="text-[11px] text-text-disabled">{relativeTime(run.startedAt)}</span>

          {run.durationMs != null && (
            <>
              <span className="text-[11px] text-text-disabled" aria-hidden="true">·</span>
              <span
                className="text-[11px] text-text-secondary font-mono"
                aria-label={`Duration: ${formatDuration(run.durationMs)}`}
              >
                {formatDuration(run.durationMs)}
              </span>
            </>
          )}
        </div>
      </div>
    </li>
  );
});
