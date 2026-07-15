/**
 * Isolated Zustand store for agent run history.
 * ADR-1 (Agent Run History) §2.2: separated from useAppStore to respect SRP.
 *
 * Does NOT import or depend on useAppStore — use useRunHistoryStore.getState()
 * from the agent launcher lifecycle functions to avoid circular imports.
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createAgentRun, updateAgentRun, getAgentRuns } from '@/api/client';
import type { AgentRunRecord, AgentRunPatchPayload, RunStatus } from '@/types';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface RunHistoryState {
  /** Full run list from last poll, newest-first. */
  runs: AgentRunRecord[];

  /** Active status filter — 'all' means no filter. */
  filter: RunStatus | 'all';

  /** True during the first fetch only. */
  loading: boolean;

  /** Fetch /api/v1/agent-runs and update runs[]. */
  loadRuns: () => Promise<void>;

  /**
   * POST a new run record and prepend it to runs[] optimistically.
   * Called from executeAgentRun() via useRunHistoryStore.getState().
   */
  recordRunStarted: (
    record: Omit<AgentRunRecord, 'status' | 'completedAt' | 'durationMs' | 'reason'>
  ) => Promise<void>;

  /**
   * PATCH an existing run to a terminal status and update it in runs[].
   * Called from cancelAgentRun() and useAgentCompletion via useRunHistoryStore.getState().
   */
  recordRunFinished: (
    runId: string,
    status: 'completed' | 'cancelled' | 'failed',
    durationMs: number
  ) => Promise<void>;

  /** Update the active status filter. */
  setFilter: (filter: RunStatus | 'all') => void;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useRunHistoryStore = create<RunHistoryState>((set, get) => ({
  runs:    [],
  filter:  'all',
  loading: false,

  loadRuns: async () => {
    const { runs: currentRuns } = get();
    // Only show loading spinner on the very first fetch
    if (currentRuns.length === 0) {
      set({ loading: true });
    }
    try {
      const result = await getAgentRuns({ limit: 100 });
      set({ runs: result.runs });
    } catch (err) {
      // Non-fatal: history panel is informational, do not crash the app.
      console.error('[run-history] Failed to load runs:', err);
    } finally {
      set({ loading: false });
    }
  },

  recordRunStarted: async (record) => {
    // Optimistic prepend so the panel shows the run immediately.
    const optimistic: AgentRunRecord = {
      ...record,
      status:      'running',
      completedAt: null,
      durationMs:  null,
    };
    set((state) => ({ runs: [optimistic, ...state.runs] }));

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level:     'info',
      component: 'run-history-store',
      event:     'record_run_started',
      runId:     record.id,
      agentId:   record.agentId,
      taskId:    record.taskId,
    }));

    try {
      await createAgentRun(record);
    } catch (err) {
      // Log but do not revert the optimistic update — history is best-effort.
      console.error('[run-history] Failed to persist run start:', err);
    }
  },

  recordRunFinished: async (runId, status, durationMs) => {
    const completedAt = new Date().toISOString();
    const patch: AgentRunPatchPayload = { status, completedAt, durationMs };

    // Optimistic update in the local list.
    set((state) => ({
      runs: state.runs.map((r) =>
        r.id === runId
          ? { ...r, status, completedAt, durationMs }
          : r
      ),
    }));

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level:     'info',
      component: 'run-history-store',
      event:     'record_run_finished',
      runId,
      status,
      durationMs,
    }));

    try {
      await updateAgentRun(runId, patch);
    } catch (err) {
      console.error('[run-history] Failed to persist run finish:', err);
    }
  },

  setFilter: (filter) => set({ filter }),
}));

// ---------------------------------------------------------------------------
// Selector hooks for common slices
// ---------------------------------------------------------------------------

/** Filtered runs — applies the active status filter. */
export const useFilteredRuns = (): AgentRunRecord[] =>
  useRunHistoryStore(
    useShallow((s) => (s.filter === 'all' ? s.runs : s.runs.filter((r) => r.status === s.filter)))
  );
