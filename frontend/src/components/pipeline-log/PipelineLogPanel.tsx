/**
 * PipelineLogPanel — right-side panel showing per-stage logs for an active or completed run.
 * ADR-1 (log-viewer) §3.4: follows TerminalPanel / RunHistoryPanel / ConfigPanel pattern.
 *
 * - Resizable via usePanelResize (storageKey: prism:panel-width:pipeline-log).
 * - Reads runId from pipelineState in useAppStore.
 * - Mounts usePipelineLogPolling to fetch logs every 2 s while run is active.
 * - Fetches run status (stageStatuses) from the backend to drive StageTabBar icons.
 *
 * T-008: Prompt/Log toggle below the stage tab bar. Selecting "Prompt" fetches
 *        GET /api/v1/runs/:runId/stages/:stageIndex/prompt and renders it in
 *        MarkdownViewer. Prompts are cached per stageIndex in usePipelineLogStore.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';
import { usePipelineLogPolling } from '@/hooks/usePipelineLogPolling';
import { usePanelResize } from '@/hooks/usePanelResize';
import { getBackendRun, getStagePrompt, PromptNotAvailableError } from '@/api/client';
import { StageTabBar } from './StageTabBar';
import { LogViewer } from './LogViewer';
import { MarkdownViewer } from '@/components/shared/MarkdownViewer';
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
  const pipelineState         = useAppStore((s) => s.pipelineState);
  const selectedStageIndex    = usePipelineLogStore((s) => s.selectedStageIndex);
  const setSelectedStageIndex = usePipelineLogStore((s) => s.setSelectedStageIndex);
  const setLogPanelOpen       = usePipelineLogStore((s) => s.setLogPanelOpen);
  const stageLogs             = usePipelineLogStore((s) => s.stageLogs);
  const stageLoading          = usePipelineLogStore((s) => s.stageLoading);
  const stageErrors           = usePipelineLogStore((s) => s.stageErrors);
  const stageView             = usePipelineLogStore((s) => s.stageView);
  const setStageView          = usePipelineLogStore((s) => s.setStageView);
  const stagePrompts          = usePipelineLogStore((s) => s.stagePrompts);
  const setStagePrompt        = usePipelineLogStore((s) => s.setStagePrompt);
  const stagePromptLoading    = usePipelineLogStore((s) => s.stagePromptLoading);
  const setStagePromptLoading = usePipelineLogStore((s) => s.setStagePromptLoading);

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

  const currentView = stageView[selectedStageIndex] ?? 'log';

  // Fetch prompt for current stage when the "Prompt" view is selected.
  // Caches the result in the store so repeated tab switches don't re-fetch.
  const fetchPromptForStage = useCallback(async (stageIdx: number) => {
    if (!runId) return;
    // Already cached or currently loading — skip.
    if (stagePrompts[stageIdx] !== undefined) return;
    if (stagePromptLoading[stageIdx]) return;

    setStagePromptLoading(stageIdx, true);
    try {
      const text = await getStagePrompt(runId, stageIdx);
      setStagePrompt(stageIdx, text);
    } catch (err) {
      if (err instanceof PromptNotAvailableError) {
        // Stage hasn't started yet — store null to indicate "not available".
        setStagePrompt(stageIdx, null);
      } else {
        console.error('[PipelineLogPanel] ERROR fetching stage prompt:', err);
        setStagePrompt(stageIdx, null);
      }
    } finally {
      setStagePromptLoading(stageIdx, false);
    }
  }, [runId, stagePrompts, stagePromptLoading, setStagePrompt, setStagePromptLoading]);

  useEffect(() => {
    if (currentView === 'prompt') {
      fetchPromptForStage(selectedStageIndex);
    }
  }, [currentView, selectedStageIndex, fetchPromptForStage]);

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
      className="relative flex flex-col bg-surface border-l border-border h-full shrink-0 w-[var(--panel-w)]"
      style={{ '--panel-w': `${width}px` } as React.CSSProperties}
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

      {/* T-008: Prompt / Log toggle — only shown when a run is active */}
      {runId && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0">
          <button
            onClick={() => setStageView(selectedStageIndex, 'log')}
            aria-pressed={currentView === 'log'}
            className={`text-xs px-2.5 py-1 rounded transition-colors duration-150 ${
              currentView === 'log'
                ? 'bg-primary text-white'
                : 'text-text-secondary hover:text-primary hover:bg-surface-variant'
            }`}
          >
            Log
          </button>
          <button
            onClick={() => setStageView(selectedStageIndex, 'prompt')}
            aria-pressed={currentView === 'prompt'}
            className={`text-xs px-2.5 py-1 rounded transition-colors duration-150 ${
              currentView === 'prompt'
                ? 'bg-primary text-white'
                : 'text-text-secondary hover:text-primary hover:bg-surface-variant'
            }`}
          >
            Prompt
          </button>
        </div>
      )}

      {/* Log / Prompt content area */}
      {runId ? (
        <div
          id={`log-panel-stage-${selectedStageIndex}`}
          role="tabpanel"
          className="flex flex-1 flex-col min-h-0"
        >
          {currentView === 'log' ? (
            <LogViewer
              content={currentLog}
              isPending={isPending}
              isRunning={isRunning}
              isLoading={currentLoading}
              error={currentError}
            />
          ) : (
            /* Prompt view */
            <div className="flex flex-1 flex-col min-h-0 overflow-y-auto p-3">
              {stagePromptLoading[selectedStageIndex] ? (
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  <span className="material-symbols-outlined text-sm animate-spin leading-none" aria-hidden="true">
                    progress_activity
                  </span>
                  Loading prompt…
                </div>
              ) : stagePrompts[selectedStageIndex] != null ? (
                <MarkdownViewer content={stagePrompts[selectedStageIndex] as string} />
              ) : (
                /* Prompt not yet available (stage hasn't started) */
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <span
                    className="material-symbols-outlined text-3xl text-text-disabled leading-none"
                    aria-hidden="true"
                  >
                    description
                  </span>
                  <p className="text-sm text-text-secondary">Prompt not available yet.</p>
                  <p className="text-xs text-text-disabled leading-relaxed max-w-[180px]">
                    The prompt file is written when the stage starts.
                  </p>
                </div>
              )}
            </div>
          )}
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
          <p className="text-sm text-text-secondary">No pipeline runs yet.</p>
          <p className="text-xs text-text-disabled leading-relaxed max-w-[200px]">
            Start a pipeline run to see stage logs here.
          </p>
        </div>
      )}
    </aside>
  );
}
