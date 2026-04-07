/**
 * StageTabBar — horizontal tab row for selecting which pipeline stage to view.
 * ADR-1 (log-viewer) §3.4: one tab per stage with status icon.
 *
 * Status icons (Material Symbols):
 *  completed → check
 *  running   → progress_activity (spinning)
 *  failed    → close
 *  timeout   → close
 *  pending   → hourglass_empty
 */

import React from 'react';

/** Shape matching one entry in GET /api/v1/runs/:runId stageStatuses[]. */
export interface StageStatus {
  index: number;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'interrupted';
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
}

export interface StageTabBarProps {
  /** Ordered list of agent IDs for each stage (e.g. ["senior-architect", ...]). */
  stages: string[];
  /** Status objects parallel to stages[]. May be shorter than stages[] if not all stages started. */
  stageStatuses: StageStatus[];
  /** Zero-based index of the currently selected tab. */
  selectedIndex: number;
  /** Called when the user clicks a tab. */
  onSelect: (index: number) => void;
}

/** Map agent ID stems to short display labels. Falls back to first word of the ID. */
function getShortLabel(agentId: string): string {
  const labelMap: Record<string, string> = {
    'senior-architect': 'Architect',
    'ux-api-designer':  'UX',
    'developer-agent':  'Dev',
    'qa-engineer-e2e':  'QA',
    orchestrator:       'Orch',
  };
  return labelMap[agentId] ?? agentId.split('-')[0] ?? agentId;
}

interface StatusIconProps {
  status: StageStatus['status'];
}

function StatusIcon({ status }: StatusIconProps) {
  if (status === 'completed') {
    return (
      <span
        className="material-symbols-outlined text-sm leading-none text-success"
        aria-hidden="true"
      >
        check
      </span>
    );
  }

  if (status === 'running') {
    return (
      <span
        className="material-symbols-outlined text-sm leading-none text-primary animate-spin"
        aria-hidden="true"
      >
        progress_activity
      </span>
    );
  }

  if (status === 'interrupted') {
    return (
      <span
        className="material-symbols-outlined text-sm leading-none text-warning"
        aria-hidden="true"
      >
        pause_circle
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span
        className="material-symbols-outlined text-sm leading-none text-error"
        aria-hidden="true"
      >
        close
      </span>
    );
  }

  if (status === 'timeout') {
    return (
      <span
        className="material-symbols-outlined text-sm leading-none text-warning"
        aria-hidden="true"
      >
        timer_off
      </span>
    );
  }

  // pending (default)
  return (
    <span
      className="material-symbols-outlined text-sm leading-none text-text-disabled"
      aria-hidden="true"
    >
      hourglass_empty
    </span>
  );
}

/**
 * Horizontal tab bar listing all stages of a pipeline run.
 * Pure display component — all state lives in usePipelineLogStore.
 */
export function StageTabBar({
  stages,
  stageStatuses,
  selectedIndex,
  onSelect,
}: StageTabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Pipeline stages"
      className="flex items-stretch border-b border-border bg-surface shrink-0 overflow-x-auto"
    >
      {stages.map((agentId, index) => {
        const statusObj  = stageStatuses[index];
        const status     = statusObj?.status ?? 'pending';
        const isActive   = index === selectedIndex;
        const label      = getShortLabel(agentId);

        return (
          <button
            key={index}
            role="tab"
            aria-selected={isActive}
            aria-controls={`log-panel-stage-${index}`}
            onClick={() => onSelect(index)}
            title={agentId}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors duration-150 border-b-2 ${
              isActive
                ? 'bg-primary/10 text-primary border-primary'
                : 'text-text-secondary border-transparent hover:bg-surface-variant hover:text-text-primary'
            }`}
          >
            <StatusIcon status={status} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
