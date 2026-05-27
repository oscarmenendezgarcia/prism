/**
 * RunsToggle — single header button replacing RunHistoryToggle + PipelineLogToggle.
 * T-005 (runs-panel-unification): toggles runsPanelOpen in usePipelineLogStore.
 *
 * Shows:
 *   - "account_tree" icon (pipeline runs)
 *   - unseen log count badge (red dot) when unseenCount > 0 and panel is closed
 *   - pulsing blue dot when any agent run is currently active
 */

import React from 'react';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';
import { useRunHistoryStore } from '@/stores/useRunHistoryStore';

export function RunsToggle() {
  const runsPanelOpen    = usePipelineLogStore((s) => s.runsPanelOpen);
  const setRunsPanelOpen = usePipelineLogStore((s) => s.setRunsPanelOpen);
  const unseenCount      = usePipelineLogStore((s) => s.unseenCount);
  const runs             = useRunHistoryStore((s) => s.runs);

  const hasActiveRun = runs.some((r) => r.status === 'running');
  const showDot      = unseenCount > 0 && !runsPanelOpen;

  return (
    <button
      onClick={() => setRunsPanelOpen(!runsPanelOpen)}
      aria-label="Toggle runs panel"
      aria-pressed={runsPanelOpen}
      className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-fast ease-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        runsPanelOpen
          ? 'bg-primary/15 text-primary'
          : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant'
      }`}
    >
      {/* Unseen log updates dot */}
      {showDot && (
        <span
          className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-error"
          aria-hidden="true"
          data-testid="runs-unseen-dot"
        />
      )}

      {/* Active run pulsing dot */}
      {hasActiveRun && !showDot && (
        <span
          className="absolute top-1.5 right-1.5"
          aria-label="Active run"
          title="A pipeline run is currently active"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
          </span>
        </span>
      )}

      <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">
        account_tree
      </span>
    </button>
  );
}
