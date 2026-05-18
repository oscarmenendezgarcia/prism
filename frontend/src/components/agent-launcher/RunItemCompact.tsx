/**
 * RunItemCompact — a single row in the MultiRunIndicator expanded dropdown.
 *
 * Renders status dot + agent name + elapsed + stage info + action buttons for
 * one active pipeline run. Used exclusively by MultiRunIndicator.
 *
 * Wireframe ref: wireframes.md §4.1–4.4 (running / paused / completed / failed).
 */

import React, { useEffect, useState } from 'react';
import type { PipelineState } from '@/types';
import { resolveAgentName } from '@/utils/agentName';
import type { Space, AgentInfo } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Status dot
// ---------------------------------------------------------------------------

interface StatusDotProps {
  status: PipelineState['status'];
}

function StatusDot({ status }: StatusDotProps) {
  if (status === 'completed') {
    return (
      <span
        className="flex-shrink-0 w-4 h-4 rounded-full bg-success/[0.15] border border-success/30 flex items-center justify-center"
        aria-hidden="true"
      >
        <span className="material-symbols-outlined text-[10px] leading-none text-success">
          check
        </span>
      </span>
    );
  }

  if (status === 'aborted' || status === 'interrupted') {
    return (
      <span
        className="flex-shrink-0 w-4 h-4 rounded-full bg-error/[0.12] border border-error/30 flex items-center justify-center"
        aria-hidden="true"
      >
        <span className="material-symbols-outlined text-[10px] leading-none text-error">
          close
        </span>
      </span>
    );
  }

  if (status === 'paused' || status === 'blocked') {
    return (
      <span
        className="flex-shrink-0 w-4 h-4 rounded-full bg-warning/[0.12] border border-warning/30 flex items-center justify-center"
        aria-hidden="true"
      >
        <span className="material-symbols-outlined text-[10px] leading-none text-warning">
          pause
        </span>
      </span>
    );
  }

  // running — animated pulse
  return (
    <span className="relative flex h-4 w-4 flex-shrink-0" aria-hidden="true">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-40" />
      <span className="relative inline-flex rounded-full h-4 w-4 bg-primary/90" />
    </span>
  );
}

function statusLabel(status: PipelineState['status']): string {
  switch (status) {
    case 'running':     return 'Running';
    case 'paused':      return 'Paused';
    case 'blocked':     return 'Blocked';
    case 'completed':   return 'Completed';
    case 'aborted':     return 'Aborted';
    case 'interrupted': return 'Interrupted';
    default:            return status;
  }
}

// ---------------------------------------------------------------------------
// RunItemCompact props
// ---------------------------------------------------------------------------

export interface RunItemCompactProps {
  runId: string;
  pipelineState: PipelineState;
  /** True if this run is the activePipelineRunId (displayed first / highlighted). */
  isActive: boolean;
  activeSpace: Space | null;
  availableAgents: AgentInfo[];
  onAbort: (runId: string) => void;
  onDismiss: (runId: string) => void;
  onOpenDetail: (runId: string) => void;
}

// ---------------------------------------------------------------------------
// RunItemCompact component
// ---------------------------------------------------------------------------

export function RunItemCompact({
  runId,
  pipelineState,
  isActive,
  activeSpace,
  availableAgents,
  onAbort,
  onDismiss,
  onOpenDetail,
}: RunItemCompactProps) {
  const { stages, currentStageIndex, status, startedAt, finishedAt } = pipelineState;

  const [elapsedSecs, setElapsedSecs] = useState(() => {
    const startMs  = new Date(startedAt).getTime();
    const isTerminal = status !== 'running' && status !== 'paused' && status !== 'blocked';
    if (isTerminal) {
      const endMs = finishedAt ? new Date(finishedAt).getTime() : Date.now();
      return Math.floor((endMs - startMs) / 1000);
    }
    return Math.floor((Date.now() - startMs) / 1000);
  });

  // Timer — ticks every 1 s while active; frozen for terminal statuses.
  useEffect(() => {
    const startMs    = new Date(startedAt).getTime();
    const isTerminal = status !== 'running' && status !== 'paused' && status !== 'blocked';
    if (isTerminal) {
      const endMs = finishedAt ? new Date(finishedAt).getTime() : Date.now();
      setElapsedSecs(Math.floor((endMs - startMs) / 1000));
      return;
    }
    setElapsedSecs(Math.floor((Date.now() - startMs) / 1000));
    const id = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt, status, finishedAt]);

  // Auto-dismiss terminal runs after 2 s (completed, interrupted, aborted).
  useEffect(() => {
    if (status !== 'completed' && status !== 'interrupted' && status !== 'aborted') return;
    const t = setTimeout(() => onDismiss(runId), 2000);
    return () => clearTimeout(t);
  }, [status, runId, onDismiss]);

  const currentAgentId  = stages[currentStageIndex] ?? stages[0];
  const agentName       = resolveAgentName(currentAgentId, activeSpace, availableAgents);
  const stageLabel      = `Stage ${currentStageIndex + 1}/${stages.length}`;

  // Border-left color by status.
  const borderColor =
    status === 'completed'               ? 'border-l-success'
    : status === 'paused' || status === 'blocked' ? 'border-l-warning'
    : status === 'aborted' || status === 'interrupted' ? 'border-l-error'
    : 'border-l-primary';

  return (
    <div
      className={`flex flex-col gap-1 px-3 py-2 border-l-2 ${borderColor} hover:bg-surface-elevated transition-colors duration-fast ${
        isActive ? 'bg-surface-elevated' : ''
      }`}
      role="listitem"
      aria-label={`Run: ${agentName} — ${statusLabel(status)}, elapsed ${formatElapsed(elapsedSecs)}, ${stageLabel}`}
      data-testid={`run-item-${runId}`}
    >
      {/* Row 1: dot + agent + time + buttons */}
      <div className="flex items-center gap-2 min-w-0">
        <StatusDot status={status} />

        <span className="text-xs font-medium text-text-primary truncate flex-1 min-w-0">
          {agentName}
        </span>

        <span className="text-xs text-text-secondary tabular-nums flex-shrink-0">
          {formatElapsed(elapsedSecs)}
        </span>

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Details / Resolve button */}
          {(status === 'blocked' || status === 'paused') ? (
            <button
              onClick={() => onOpenDetail(runId)}
              aria-label={`Resolve blocked run: ${agentName}`}
              title="Resolve"
              className="text-xs text-primary hover:text-primary/80 transition-colors duration-base flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-primary/[0.08]"
            >
              <span className="material-symbols-outlined text-xs leading-none" aria-hidden="true">
                open_in_new
              </span>
              <span className="hidden sm:inline">Resolve</span>
            </button>
          ) : (
            <button
              onClick={() => onOpenDetail(runId)}
              aria-label={`View details for run: ${agentName}`}
              title="Details"
              className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors duration-base"
            >
              <span className="material-symbols-outlined text-xs leading-none" aria-hidden="true">
                open_in_new
              </span>
            </button>
          )}

          {/* Abort button — only for active runs */}
          {(status === 'running' || status === 'paused' || status === 'blocked') && (
            <button
              onClick={() => onAbort(runId)}
              aria-label={`Abort run: ${agentName}`}
              title="Abort"
              className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-error hover:bg-error/[0.10] transition-colors duration-base"
            >
              <span className="material-symbols-outlined text-xs leading-none" aria-hidden="true">
                stop
              </span>
            </button>
          )}

          {/* Dismiss / X button */}
          <button
            onClick={() => onDismiss(runId)}
            aria-label={`Dismiss run: ${agentName}`}
            title="Dismiss"
            className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors duration-base"
          >
            <span className="material-symbols-outlined text-xs leading-none" aria-hidden="true">
              close
            </span>
          </button>
        </div>
      </div>

      {/* Row 2: stage info */}
      <div className="flex items-center gap-2 text-[11px] text-text-secondary pl-6">
        <span className="truncate">
          {statusLabel(status)} · {stageLabel}
          {(status === 'completed' || status === 'interrupted' || status === 'aborted') && ' · Dismissing…'}
        </span>
      </div>
    </div>
  );
}
