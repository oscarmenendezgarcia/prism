/**
 * Small status pill for an agent run.
 * ADR-1 (Agent Run History) §6.3: four variants using Tailwind design tokens.
 *
 * Running shows a pulsing dot to signal active progress.
 * All other statuses show a static colored pill.
 */

import React from 'react';
import type { RunStatus } from '@/types';

interface RunStatusBadgeProps {
  status: RunStatus;
}

/** Tailwind classes for each status variant. */
const variantClasses: Record<RunStatus, string> = {
  running:   'text-primary   bg-primary/10   border-primary/20',
  completed: 'text-success   bg-success/10   border-success/20',
  cancelled: 'text-warning   bg-warning/10   border-warning/20',
  failed:    'text-error     bg-error/10     border-error/20',
};

/** Human-readable labels. */
const statusLabels: Record<RunStatus, string> = {
  running:   'Running',
  completed: 'Completed',
  cancelled: 'Cancelled',
  failed:    'Failed',
};

/**
 * Colored status pill with an optional pulsing dot for running runs.
 *
 * @param status - The run lifecycle status.
 */
export function RunStatusBadge({ status }: RunStatusBadgeProps) {
  return (
    <span
      role="status"
      aria-label={`Run status: ${statusLabels[status]}`}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${variantClasses[status]}`}
    >
      {status === 'running' ? (
        <span
          className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
          aria-hidden="true"
        />
      ) : (
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            status === 'completed' ? 'bg-success' :
            status === 'cancelled' ? 'bg-warning' :
            'bg-error'
          }`}
          aria-hidden="true"
        />
      )}
      {statusLabels[status]}
    </span>
  );
}
