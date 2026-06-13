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

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';
import { usePanelResize } from '@/hooks/usePanelResize';
import { getBackendRun, getStagePrompt, PromptNotAvailableError } from '@/api/client';
import { StageTabBar } from './StageTabBar';
import { MarkdownViewer } from '@/components/shared/MarkdownViewer';
import { StageMetricsPanel } from './StageMetricsPanel';
import { StructuredLogView } from './StructuredLogView';
import { RunSelector } from './RunSelector';
import type { BackendStageStatus, FeedbackGateResult } from '@/types';
import type { RunSelectorEntry } from './RunSelector';

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
  // Multi-run: read the full pipelineStates dict and derive the selected run.
  const pipelineStates        = useAppStore((s) => s.pipelineStates);
  const clearRun              = useAppStore((s) => s.clearRun);
  const activeSpace           = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId) ?? null);
  const selectedStageIndex    = usePipelineLogStore((s) => s.selectedStageIndex);
  const setSelectedStageIndex = usePipelineLogStore((s) => s.setSelectedStageIndex);
  const setLogPanelOpen       = usePipelineLogStore((s) => s.setLogPanelOpen);
  const stageView             = usePipelineLogStore((s) => s.stageView);
  const setStageView          = usePipelineLogStore((s) => s.setStageView);
  const stagePrompts          = usePipelineLogStore((s) => s.stagePrompts);
  const setStagePrompt        = usePipelineLogStore((s) => s.setStagePrompt);
  const stagePromptLoading    = usePipelineLogStore((s) => s.stagePromptLoading);
  const setStagePromptLoading = usePipelineLogStore((s) => s.setStagePromptLoading);
  const logPanelRunId         = usePipelineLogStore((s) => s.logPanelRunId);
  const setLogPanelRunId      = usePipelineLogStore((s) => s.setLogPanelRunId);
  const clearStageLogs        = usePipelineLogStore((s) => s.clearStageLogs);

  const setRunFeedback          = usePipelineLogStore((s) => s.setRunFeedback);
  const feedbackGatesByRunId    = usePipelineLogStore((s) => s.feedbackGatesByRunId);

  const [backendStatuses, setBackendStatuses] = useState<BackendStageStatus[]>([]);

  // Sort runs by startedAt descending (most recent first) for the selector.
  const sortedRuns = useMemo<RunSelectorEntry[]>(() => {
    return Object.entries(pipelineStates)
      .sort(([, a], [, b]) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .map(([key, ps]) => ({ key, pipelineState: ps }));
  }, [pipelineStates]);

  // The run key whose logs are displayed. Explicit selection takes priority;
  // falls back to the most recent run when unset.
  const effectivePanelKey = logPanelRunId ?? sortedRuns[0]?.key ?? null;

  // Fallback: when the selected run is removed, reset to the most recent remaining.
  useEffect(() => {
    if (!logPanelRunId) return;
    if (pipelineStates[logPanelRunId] !== undefined) return;
    // The selected run was deleted — fall back to most recent.
    setLogPanelRunId(sortedRuns[0]?.key ?? null);
  }, [logPanelRunId, pipelineStates, sortedRuns, setLogPanelRunId]);

  // Reset selectedStageIndex to 0 when the user switches to a different run.
  const prevEffectiveKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (effectivePanelKey === prevEffectiveKeyRef.current) return;
    if (prevEffectiveKeyRef.current !== null) {
      // User switched runs: clear cache and reset to stage 0.
      clearStageLogs();
      setSelectedStageIndex(0);
    }
    prevEffectiveKeyRef.current = effectivePanelKey;
  }, [effectivePanelKey, clearStageLogs, setSelectedStageIndex]);

  // Derive the displayed pipeline state from the effective key.
  const pipelineState = effectivePanelKey ? (pipelineStates[effectivePanelKey] ?? null) : null;

  const runId      = pipelineState?.runId ?? null;
  const stageRunIds = pipelineState?.stageRunIds ?? {};
  const stages     = pipelineState?.stages ?? [];
  const isRunActive = pipelineState?.status === 'running';

  // Show the selector only when 2+ runs are tracked.
  const showRunSelector = sortedRuns.length >= 2;

  // Each stage in a frontend-driven pipeline runs as its own 1-stage backend run.
  // stageRunIds[i] holds the runId for pipeline stage i, and the log inside that
  // run is always at stage-0 (the only stage in the run).
  // Fall back to the global runId + selectedStageIndex for backend-native pipelines.
  const effectiveRunId      = stageRunIds[selectedStageIndex] ?? runId;
  const effectiveStageIndex = stageRunIds[selectedStageIndex] !== undefined ? 0 : selectedStageIndex;

  const { width, handleMouseDown, minWidth, maxWidth } = usePanelResize({
    storageKey:   'prism:panel-width:pipeline-log',
    defaultWidth: 480,
    minWidth:     320,
    maxWidth:     900,
  });

  // Fetch backend run status for stageStatuses (icon accuracy).
  // Also caches feedbackGates and feedbackIterations in the pipeline log store
  // so RunsPanel and StageTabBar can read them without extra fetches.
  const fetchRunStatus = useCallback(async () => {
    if (!runId) return;
    try {
      const run = await getBackendRun(runId);
      setBackendStatuses(run.stageStatuses ?? []);
      // LOOP-1: populate feedback gate cache for RunsPanel and StageTabBar.
      if (run.feedbackGates !== undefined || run.feedbackIterations !== undefined) {
        setRunFeedback(
          runId,
          run.feedbackIterations ?? 0,
          (run.feedbackGates ?? {}) as Record<string, FeedbackGateResult>,
        );
      }
    } catch {
      // Non-fatal — fallback statuses are derived from pipelineState.
    }
  }, [runId, setRunFeedback]);

  useEffect(() => {
    fetchRunStatus();
    if (!isRunActive) return;
    const id = setInterval(fetchRunStatus, RUN_STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [fetchRunStatus, isRunActive]);

  const currentView = stageView[selectedStageIndex] ?? 'structured';

  // Fetch prompt for current stage when the "Prompt" view is selected.
  // Caches the result in the store so repeated tab switches don't re-fetch.
  // Uses the same effective runId/stageIndex logic as the log polling to handle
  // frontend-driven pipelines where each stage has its own 1-stage backend run.
  const fetchPromptForStage = useCallback(async (stageIdx: number) => {
    const stageRunId  = stageRunIds[stageIdx] ?? runId;
    const runStageIdx = stageRunIds[stageIdx] !== undefined ? 0 : stageIdx;
    if (!stageRunId) return;
    // Already cached or currently loading — skip.
    if (stagePrompts[stageIdx] !== undefined) return;
    if (stagePromptLoading[stageIdx]) return;

    setStagePromptLoading(stageIdx, true);
    try {
      const text = await getStagePrompt(stageRunId, runStageIdx);
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
  }, [runId, stageRunIds, stagePrompts, stagePromptLoading, setStagePrompt, setStagePromptLoading]);

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

  const selectedStatus = stageStatusesForBar[selectedStageIndex]?.status ?? 'pending';
  const isPending  = selectedStatus === 'pending';
  const isRunning  = selectedStatus === 'running';

  return (
    <aside
      role="complementary"
      aria-label="Pipeline log viewer"
      className="relative flex flex-col bg-surface border-l border-border h-full shrink-0 w-[var(--panel-w)]"
      style={{ '--panel-w': `${width}px` } as React.CSSProperties} // lint-ok: CSS custom-property injection for dynamic panel resize — Tailwind cannot set runtime CSS vars at the element level
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

      {/* Panel header — wireframe S-02 (run selector) / S-07 */}
      <div className="flex items-center gap-2 px-4 py-3 bg-surface-elevated border-b border-border shrink-0">
        <span
          className="material-symbols-outlined text-base text-primary leading-none"
          aria-hidden="true"
        >
          article
        </span>
        <span className="text-sm font-semibold text-text-primary flex-1">Pipeline Logs</span>

        {/* Run selector: only visible when 2+ runs are tracked (S-01 vs S-02) */}
        {showRunSelector && (
          <RunSelector
            runs={sortedRuns}
            selectedRunId={logPanelRunId}
            onSelect={(key) => setLogPanelRunId(key)}
          />
        )}

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
        <button
          onClick={() => {
            setLogPanelOpen(false);
            // Clean up terminal runs from pipelineStates on close so memory
            // doesn't accumulate. Live (running/paused/blocked) runs are left
            // intact — their indicator remains active in the header.
            const TERMINAL = new Set(['completed', 'aborted', 'failed']);
            if (effectivePanelKey && pipelineState && TERMINAL.has(pipelineState.status)) {
              clearRun(effectivePanelKey);
            }
          }}
          aria-label="Close pipeline log panel"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-text-secondary hover:bg-surface-variant hover:text-text-primary transition-all duration-fast"
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
          activeSpace={activeSpace}
          feedbackGates={runId ? feedbackGatesByRunId[runId] : undefined}
        />
      )}

      {/* View mode toggle: Logs (default) | Prompt | Metrics */}
      {runId && (
        <div
          className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0"
          aria-label="Log view mode"
        >
          {([
            { id: 'structured', label: 'Logs' },
            { id: 'prompt',     label: 'Prompt' },
            { id: 'metrics',    label: 'Metrics' },
          ] as const).map(({ id, label }) => (
            <button
              key={id}
              aria-pressed={currentView === id}
              onClick={() => setStageView(selectedStageIndex, id)}
              className={`text-xs px-2.5 py-1 rounded capitalize transition-colors duration-150 ${
                currentView === id
                  ? 'bg-primary text-white'
                  : 'text-text-secondary hover:text-primary hover:bg-surface-variant'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Log / Prompt content area */}
      {runId ? (
        <div
          id={`log-panel-stage-${selectedStageIndex}`}
          role="tabpanel"
          className="flex flex-1 flex-col min-h-0"
        >
          {currentView === 'structured' ? (
            /* Structured view — default (T-003) */
            effectiveRunId ? (
              <StructuredLogView
                runId={effectiveRunId}
                stageIndex={effectiveStageIndex}
                storeKey={selectedStageIndex}
                isRunning={isRunning}
                isPending={isPending}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <span
                  className="material-symbols-outlined text-4xl text-text-disabled leading-none"
                  aria-hidden="true"
                >
                  article
                </span>
                <p className="text-sm text-text-secondary">No run available.</p>
              </div>
            )
          ) : currentView === 'metrics' ? (
            /* Metrics view — T-007 */
            effectiveRunId ? (
              <StageMetricsPanel
                runId={effectiveRunId}
                stageIndex={effectiveStageIndex}
                storeKey={selectedStageIndex}
                isRunning={isRunning}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <span
                  className="material-symbols-outlined text-4xl text-text-disabled leading-none"
                  aria-hidden="true"
                >
                  query_stats
                </span>
                <p className="text-sm text-text-secondary">No run available.</p>
              </div>
            )
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
