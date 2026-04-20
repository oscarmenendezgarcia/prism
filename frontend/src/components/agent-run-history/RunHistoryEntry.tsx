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

  // Status dot class — wireframe S-08
  const statusDotClass =
    status === 'running'   ? 'bg-primary animate-pulse' :
    status === 'completed' ? 'bg-success' :
    status === 'failed'    ? 'bg-error' :
    status === 'cancelled' ? 'bg-warning' :
    'bg-border';

  return (
    <li
      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-variant transition-colors duration-fast rounded-lg cursor-pointer mx-1 my-0.5"
    >
      {/* Status dot */}
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass}`}
        aria-label={status}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary truncate leading-snug">
          {stageLabel ? `${stageLabel}: ${run.agentDisplayName}` : run.agentDisplayName}
        </p>
        <p className="text-xs text-text-secondary truncate mt-0.5">
          {run.taskTitle}
        </p>
      </div>

      {/* Meta */}
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <span className="text-xs text-text-secondary">{relativeTime(run.startedAt)}</span>
        {run.durationMs != null && (
          <span
            className="text-[11px] text-text-disabled font-mono"
            aria-label={`Duration: ${formatDuration(run.durationMs)}`}
          >
            {formatDuration(run.durationMs)}
          </span>
        )}
      </div>
    </li>
  );
});
