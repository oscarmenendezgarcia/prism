/**
 * Polling hook for the Pipeline Log Viewer.
 * ADR-1 (log-viewer) §3.2: polls GET /api/v1/runs/:runId/stages/:N/log every 2 s
 * while the run is active. Fetches immediately on mount and whenever stageIndex changes.
 * Stops polling when isRunActive === false (run is completed/failed).
 *
 * Distinguishes LOG_NOT_AVAILABLE (stage not started — not an error) from
 * real HTTP errors (sets stageErrors in the store).
 */

import { useEffect, useRef } from 'react';
import { getStageLog, LogNotAvailableError } from '@/api/client';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';

const POLL_INTERVAL_MS = 2000;

export interface UsePipelineLogPollingOptions {
  /** The pipeline run ID. Pass null to disable polling entirely. */
  runId: string | null;
  /**
   * Zero-based index used in the API request path:
   *   GET /api/v1/runs/:runId/stages/:stageIndex/log
   * For frontend-driven pipelines where each stage has its own 1-stage backend run,
   * this is always 0 (the single stage in that run).
   */
  stageIndex: number;
  /**
   * Key under which the fetched log is stored in usePipelineLogStore.stageLogs.
   * Defaults to stageIndex when omitted.
   * For frontend-driven pipelines: storeKey = pipeline-level stage index (e.g. 1 for QA)
   * while stageIndex = 0 (the actual stage index within the backend run).
   */
  storeKey?: number;
  /** True while run.status === 'running'. Controls whether an interval is set up. */
  isRunActive: boolean;
}

/**
 * Mounts log polling for a specific pipeline stage.
 *
 * - When runId is null: no-op.
 * - When isRunActive is false: single fetch at mount (static logs for completed run).
 * - When isRunActive is true: immediate fetch + repeat every POLL_INTERVAL_MS.
 * - Cleans up the interval on unmount or when inputs change.
 */
export function usePipelineLogPolling({
  runId,
  stageIndex,
  storeKey,
  isRunActive,
}: UsePipelineLogPollingOptions): void {
  const setStageLog     = usePipelineLogStore((s) => s.setStageLog);
  const setStageLoading = usePipelineLogStore((s) => s.setStageLoading);
  const setStageError   = usePipelineLogStore((s) => s.setStageError);

  // The key used to read/write from the log store. Falls back to stageIndex when
  // not provided (single-stage runs or backend-native multi-stage runs).
  const key = storeKey ?? stageIndex;

  // Keep a stable ref to the latest fetch function so the interval closure
  // doesn't capture stale store actions.
  const fetchRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!runId) return;

    const fetchLog = async () => {
      setStageLoading(key, true);
      try {
        const content = await getStageLog(runId, stageIndex, 500);
        setStageLog(key, content);
        setStageError(key, null);
        console.log(
          `[PipelineLog] poll fetched stageIndex=${stageIndex} storeKey=${key} bytes=${content.length} runId=${runId}`,
        );
      } catch (err) {
        if (err instanceof LogNotAvailableError) {
          // Stage has not started yet — not a real error. Leave log as empty.
          setStageLog(key, '');
          setStageError(key, null);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          setStageError(key, message);
          console.warn(`[PipelineLog] poll error stageIndex=${stageIndex} storeKey=${key}`, message);
        }
      } finally {
        setStageLoading(key, false);
      }
    };

    fetchRef.current = fetchLog;

    // Immediate fetch on mount / stageIndex change.
    fetchLog();

    if (!isRunActive) {
      // Run is not active: single fetch only, no interval.
      return;
    }

    // Run is active: start polling interval.
    const intervalId = setInterval(() => {
      fetchRef.current();
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, stageIndex, key, isRunActive]);
}
