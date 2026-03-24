/**
 * PipelineLogPanel — right-side panel showing per-stage logs for an active or completed run.
 * ADR-1 (log-viewer) §3.4: follows TerminalPanel / RunHistoryPanel / ConfigPanel pattern.
 *
 * - Resizable via usePanelResize (storageKey: prism:panel-width:pipeline-log).
 * - Reads runId from pipelineState in useAppStore.
 * - Mounts usePipelineLogPolling to fetch logs every 2 s while run is active.
 * - Fetches run status (stageStatuses) from the backend to drive StageTabBar icons.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';
import { usePipelineLogPolling } from '@/hooks/usePipelineLogPolling';
import { usePanelResize } from '@/hooks/usePanelResize';
import { getBackendRun } from '@/api/client';
import { StageTabBar } from './StageTabBar';
import { LogViewer } from './LogViewer';
import type { BackendStageStatus } from '@/types';

/** How often (ms) to refresh the run status (for stageStatuses icons). */
const RUN_STATUS_POLL_MS = 3000;

/**
 * Derive the stage-level status string from pipelineState + optional backend stageStatuses.
 * Falls back to 'pending' for any stage not yet represented.
 */
function deriveStageStatus(
  index: number,
  backendStatuses: BackendStageStatus[],
  currentStageIndex: number,
  pipelineStatus: string,
): BackendStageStatus['status'] {
  const found = backendStatuses.find((s) => s.index === index);
  if (found) return found.status;

  // Derive from pipeline frontend state as fallback.
  if (index < currentStageIndex) return 'completed';
  if (index === currentStageIndex && pipelineStatus === 'running') return 'running';
  return 'pending';
}

/**
 * Container component for the pipeline log side panel.
 * Rendered conditionally from App.tsx when logPanelOpen is true and pipelineState is set.
 */
export function PipelineLogPanel() {
  const pipelineState       = useAppStore((s) => s.pipelineState);
  const selectedStageIndex  = usePipelineLogStore((s) => s.selectedStageIndex);
  const setSelectedStageIndex = usePipelineLogStore((s) => s.setSelectedStageIndex);
  const setLogPanelOpen     = usePipelineLogStore((s) => s.setLogPanelOpen);
  const stageLogs           = usePipelineLogStore((s) => s.stageLogs);
  const stageLoading        = usePipelineLogStore((s) => s.stageLoading);
  const stageErrors         = usePipelineLogStore((s) => s.stageErrors);

  const [backendStatuses, setBackendStatuses] = useState<BackendStageStatus[]>([]);

  const runId   = pipelineState?.runId ?? null;
  const stages  = pipelineState?.stages ?? [];
  const isRunActive = pipelineState?.status === 'running';

  const { width, handleMouseDown, minWidth, maxWidth } = usePanelResize({
    storageKey:   'prism:panel-width:pipeline-log',
    defaultWidth: 480,
    minWidth:     320,
    maxWidth:     900,
  });

  // Fetch backend run status for stageStatuses (icon accuracy).
  const fetchRunStatus = useCallback(async () => {
    if (!runId) return;
    try {
      const run = await getBackendRun(runId);
      setBackendStatuses(run.stageStatuses ?? []);
    } catch {
      // Non-fatal — fallback statuses are derived from pipelineState.
    }
  }, [runId]);

  useEffect(() => {
    fetchRunStatus();
    if (!isRunActive) return;
    const id = setInterval(fetchRunStatus, RUN_STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [fetchRunStatus, isRunActive]);

  // Mount polling for the currently selected stage.
  usePipelineLogPolling({
    runId,
    stageIndex: selectedStageIndex,
    isRunActive,
  });

  // Build stageStatuses array for StageTabBar.
  const stageStatusesForBar: BackendStageStatus[] = stages.map((_, index) => ({
    index,
    agentId:    stages[index],
    status:     deriveStageStatus(
      index,
      backendStatuses,
      pipelineState?.currentStageIndex ?? 0,
      pipelineState?.status ?? 'running',
    ),
    startedAt:  null,
    finishedAt: null,
    exitCode:   null,
    // Merge richer data from backend if available.
    ...backendStatuses.find((s) => s.index === index),
  }));

  const currentLog     = stageLogs[selectedStageIndex] ?? '';
  const currentLoading = stageLoading[selectedStageIndex] ?? false;
  const currentError   = stageErrors[selectedStageIndex] ?? null;

  const selectedStatus = stageStatusesForBar[selectedStageIndex]?.status ?? 'pending';
  const isPending  = selectedStatus === 'pending';
  const isRunning  = selectedStatus === 'running';

  return (
    <aside
      role="complementary"
      aria-label="Pipeline log viewer"
      className="relative flex flex-col bg-surface border-l border-border h-full shrink-0"
      style={{ '--panel-w': `${width}px`, width: `${width}px` } as React.CSSProperties}
    >
      {/* Left-edge drag handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize pipeline log panel"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/40 transition-colors duration-150 z-10"
      />

      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span
            className="material-symbols-outlined text-base text-text-secondary leading-none"
            aria-hidden="true"
          >
            article
          </span>
          <span className="text-sm font-medium text-text-primary">Pipeline Logs</span>
          {isRunActive && (
            <span
              className="relative flex h-2 w-2"
              aria-label="Run active"
              title="Pipeline run is active — logs are updating"
            >
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
          )}
        </div>
        <button
          onClick={() => setLogPanelOpen(false)}
          aria-label="Close pipeline log panel"
          className="w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-surface-variant transition-colors duration-150"
        >
          <span className="material-symbols-outlined text-lg leading-none" aria-hidden="true">
            close
          </span>
        </button>
      </div>

      {/* Stage tab bar — hidden when no stages are known yet */}
      {stages.length > 0 && (
        <StageTabBar
          stages={stages}
          stageStatuses={stageStatusesForBar}
          selectedIndex={selectedStageIndex}
          onSelect={setSelectedStageIndex}
        />
      )}

      {/* Log content area */}
      {runId ? (
        <div
          id={`log-panel-stage-${selectedStageIndex}`}
          role="tabpanel"
          className="flex flex-1 flex-col min-h-0"
        >
          <LogViewer
            content={currentLog}
            isPending={isPending}
            isRunning={isRunning}
            isLoading={currentLoading}
            error={currentError}
          />
        </div>
      ) : (
        /* No runId available — panel opened but no run is tracked */
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <span
            className="material-symbols-outlined text-4xl text-text-disabled leading-none"
            aria-hidden="true"
          >
            article
          </span>
          <p className="text-sm text-text-secondary">No active pipeline run.</p>
          <p className="text-xs text-text-disabled leading-relaxed max-w-[200px]">
            Start a pipeline run to see stage logs here.
          </p>
        </div>
      )}
    </aside>
  );
}
