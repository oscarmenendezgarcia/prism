/**
 * RunLogViewer — extracted log-viewer body for an individual run.
 * T-002 (runs-panel-unification): extracted from PipelineLogPanel so it can be
 * rendered inline inside RunsPanel for any run (active or historical).
 *
 * Renders:
 *   - Stage tab bar (StageTabBar)
 *   - View mode toggle: Logs / Prompt / Metrics
 *   - Content area: StructuredLogView | MarkdownViewer | StageMetricsPanel
 *
 * Props:
 *   - runId: the backend run ID to display (may be null if run isn't hydrated yet)
 *   - pipelineState: the PipelineState entry for the run (provides stages, stageRunIds)
 *   - isRunActive: controls polling vs. single-fetch mode
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';
import { getBackendRun, getStagePrompt, PromptNotAvailableError } from '@/api/client';
import { StageTabBar } from './StageTabBar';
import { MarkdownViewer } from '@/components/shared/MarkdownViewer';
import { StageMetricsPanel } from './StageMetricsPanel';
import { StructuredLogView } from './StructuredLogView';
import type { BackendStageStatus, PipelineState } from '@/types';

/** How often (ms) to refresh the run status for stageStatuses icons. */
const RUN_STATUS_POLL_MS = 3000;

/**
 * Derive stage-level status from pipelineState + optional backend stageStatuses.
 * Falls back to 'pending' for stages not yet represented.
 */
function deriveStageStatus(
  index: number,
  backendStatuses: BackendStageStatus[],
  currentStageIndex: number,
  pipelineStatus: string,
): BackendStageStatus['status'] {
  const found = backendStatuses.find((s) => s.index === index);
  if (found) return found.status;
  if (index < currentStageIndex) return 'completed';
  if (index === currentStageIndex && pipelineStatus === 'running') return 'running';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RunLogViewerProps {
  /**
   * The backend run ID whose logs to display.
   * For frontend-driven pipelines: the global runId (stageRunIds maps per-stage).
   * For backend-native pipelines: the pipeline run ID.
   * null → shows "No run available" empty state.
   */
  runId: string | null;

  /**
   * Full PipelineState for this run — provides stages[], stageRunIds, status,
   * currentStageIndex for tab bar rendering and polling decisions.
   */
  pipelineState: PipelineState | null;

  /**
   * When true: log polling runs every 2 s (active run).
   * When false: single fetch at mount (historical run).
   */
  isRunActive: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RunLogViewer({ runId, pipelineState, isRunActive }: RunLogViewerProps) {
  const activeSpace           = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId) ?? null);
  const selectedStageIndex    = usePipelineLogStore((s) => s.selectedStageIndex);
  const setSelectedStageIndex = usePipelineLogStore((s) => s.setSelectedStageIndex);
  const stageView             = usePipelineLogStore((s) => s.stageView);
  const setStageView          = usePipelineLogStore((s) => s.setStageView);
  const stagePrompts          = usePipelineLogStore((s) => s.stagePrompts);
  const setStagePrompt        = usePipelineLogStore((s) => s.setStagePrompt);
  const stagePromptLoading    = usePipelineLogStore((s) => s.stagePromptLoading);
  const setStagePromptLoading = usePipelineLogStore((s) => s.setStagePromptLoading);

  const stages      = pipelineState?.stages ?? [];
  const stageRunIds = pipelineState?.stageRunIds ?? {};

  // Each stage in a frontend-driven pipeline runs as its own 1-stage backend run.
  // stageRunIds[i] holds the runId for pipeline stage i; the log is always at stage-0.
  // Fall back to the global runId + selectedStageIndex for backend-native pipelines.
  const effectiveRunId      = stageRunIds[selectedStageIndex] ?? runId;
  const effectiveStageIndex = stageRunIds[selectedStageIndex] !== undefined ? 0 : selectedStageIndex;

  const [backendStatuses, setBackendStatuses] = useState<BackendStageStatus[]>([]);

  // Fetch backend run status for accurate stage status icons.
  const fetchRunStatus = useCallback(async () => {
    if (!runId) return;
    try {
      const run = await getBackendRun(runId);
      setBackendStatuses(run.stageStatuses ?? []);
    } catch {
      // Non-fatal — fallback statuses derived from pipelineState.
    }
  }, [runId]);

  useEffect(() => {
    fetchRunStatus();
    if (!isRunActive) return;
    const id = setInterval(fetchRunStatus, RUN_STATUS_POLL_MS);
    return () => clearInterval(id);
  }, [fetchRunStatus, isRunActive]);

  const currentView = stageView[selectedStageIndex] ?? 'structured';

  // Fetch prompt when "Prompt" view is selected; cache by stageIndex.
  const fetchPromptForStage = useCallback(async (stageIdx: number) => {
    const stageRunId  = stageRunIds[stageIdx] ?? runId;
    const runStageIdx = stageRunIds[stageIdx] !== undefined ? 0 : stageIdx;
    if (!stageRunId) return;
    if (stagePrompts[stageIdx] !== undefined) return; // already cached
    if (stagePromptLoading[stageIdx]) return;

    setStagePromptLoading(stageIdx, true);
    try {
      const text = await getStagePrompt(stageRunId, runStageIdx);
      setStagePrompt(stageIdx, text);
    } catch (err) {
      if (err instanceof PromptNotAvailableError) {
        setStagePrompt(stageIdx, null);
      } else {
        console.error('[RunLogViewer] ERROR fetching stage prompt:', err);
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
  const isPending = selectedStatus === 'pending';
  const isRunning = selectedStatus === 'running';

  // ── No runId → empty state ──────────────────────────────────────────────────

  if (!runId) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
        <span
          className="material-symbols-outlined text-4xl text-text-disabled leading-none"
          aria-hidden="true"
        >
          article
        </span>
        <p className="text-sm text-text-secondary">No pipeline run available.</p>
      </div>
    );
  }

  // ── Main viewer ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-0">
      {/* Stage tab bar */}
      {stages.length > 0 && (
        <StageTabBar
          stages={stages}
          stageStatuses={stageStatusesForBar}
          selectedIndex={selectedStageIndex}
          onSelect={setSelectedStageIndex}
          activeSpace={activeSpace}
        />
      )}

      {/* View mode toggle: Logs | Prompt | Metrics */}
      <div
        className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0"
        aria-label="Log view mode"
      >
        {([
          { id: 'structured', label: 'Logs'    },
          { id: 'prompt',     label: 'Prompt'  },
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

      {/* Content: max-height log viewer with internal scroll */}
      <div
        className="max-h-[360px] overflow-y-auto flex flex-col"
        id={`run-log-viewer-stage-${selectedStageIndex}`}
        role="tabpanel"
      >
        {currentView === 'structured' ? (
          effectiveRunId ? (
            <StructuredLogView
              runId={effectiveRunId}
              stageIndex={effectiveStageIndex}
              storeKey={selectedStageIndex}
              isRunning={isRunning}
              isPending={isPending}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
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
          effectiveRunId ? (
            <StageMetricsPanel
              runId={effectiveRunId}
              stageIndex={effectiveStageIndex}
              storeKey={selectedStageIndex}
              isRunning={isRunning}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
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
          <div className="flex flex-col p-3">
            {stagePromptLoading[selectedStageIndex] ? (
              <div className="flex items-center gap-2 text-xs text-text-secondary py-4">
                <span
                  className="material-symbols-outlined text-sm animate-spin leading-none"
                  aria-hidden="true"
                >
                  progress_activity
                </span>
                Loading prompt…
              </div>
            ) : stagePrompts[selectedStageIndex] != null ? (
              <MarkdownViewer content={stagePrompts[selectedStageIndex] as string} />
            ) : (
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
    </div>
  );
}
