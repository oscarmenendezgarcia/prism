/**
 * Isolated Zustand store for the Pipeline Log Viewer panel.
 * ADR-1 (log-viewer) §3.4: separated from useAppStore for cohesion.
 * Follows the same pattern as useRunHistoryStore.
 *
 * Manages: panel open/close, selected stage, per-stage log cache,
 * per-stage loading flags, and per-stage error strings.
 */

import { create } from 'zustand';
import type { StageMetrics, PublicEvent } from '@/types';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface PipelineLogState {
  /** Whether the Pipeline Log panel is open. */
  logPanelOpen: boolean;
  setLogPanelOpen: (open: boolean) => void;

  /**
   * Count of log lines appended since the panel was last opened.
   * Drives the notification dot on the Logs toggle.
   * Resets to 0 when the panel is opened.
   */
  unseenCount: number;
  incrementUnseenCount: () => void;

  /** Stage index (0-based) currently shown in the panel. */
  selectedStageIndex: number;
  setSelectedStageIndex: (index: number) => void;

  /**
   * Per-stage log content cache.
   * Key: zero-based stage index. Value: raw log text (may be empty string).
   */
  stageLogs: Record<number, string>;
  setStageLog: (stageIndex: number, content: string) => void;

  /** Per-stage loading flag — true while a fetch is in-flight for that stage. */
  stageLoading: Record<number, boolean>;
  setStageLoading: (stageIndex: number, loading: boolean) => void;

  /**
   * Per-stage error message.
   * null  → no error (initial or LOG_NOT_AVAILABLE — "not started yet" is not an error).
   * string → human-readable error message from a real fetch failure.
   */
  stageErrors: Record<number, string | null>;
  setStageError: (stageIndex: number, error: string | null) => void;

  /**
   * Reset stage caches and open the panel for the given run.
   * Called when starting a new pipeline run so stale logs from a previous run
   * are not shown while the new run loads.
   */
  clearStageLogs: () => void;

  // ── T-008: Prompt/Log toggle ───────────────────────────────────────────────

  /** Which view is active in the log panel per stage: 'structured' (default), 'log', 'prompt', or 'metrics'. */
  stageView: Record<number, 'structured' | 'log' | 'prompt' | 'metrics'>;
  setStageView: (stageIndex: number, view: 'structured' | 'log' | 'prompt' | 'metrics') => void;

  /**
   * Per-stage prompt content cache. Keyed by stageIndex.
   * null  → not yet fetched or error.
   * string → fetched prompt text.
   */
  stagePrompts: Record<number, string | null>;
  setStagePrompt: (stageIndex: number, prompt: string | null) => void;

  /** Per-stage prompt loading flag. */
  stagePromptLoading: Record<number, boolean>;
  setStagePromptLoading: (stageIndex: number, loading: boolean) => void;

  // ── T-007: Stage Metrics view ──────────────────────────────────────────────

  /**
   * Per-stage metrics cache. Keyed by stageIndex.
   * null  → not yet fetched or not available (425 Too Early).
   * StageMetrics → fetched and parsed.
   */
  stageMetrics: Record<number, StageMetrics | null>;
  setStageMetrics: (stageIndex: number, metrics: StageMetrics | null) => void;

  /** Per-stage metrics loading flag. */
  stageMetricsLoading: Record<number, boolean>;
  setStageMetricsLoading: (stageIndex: number, loading: boolean) => void;

  /**
   * Per-stage metrics error. null = no error.
   * Set to a human-readable message on fetch failures that are not MetricsNotAvailableError.
   */
  stageMetricsError: Record<number, string | null>;
  setStageMetricsError: (stageIndex: number, error: string | null) => void;

  // ── Structured events view ─────────────────────────────────────────────────

  /**
   * Per-stage accumulated events list. Grows across polls using ?since= cursor.
   * Key: stageIndex. Value: PublicEvent[] in chronological order.
   */
  stageEvents: Record<number, PublicEvent[]>;
  appendStageEvents: (stageIndex: number, events: PublicEvent[]) => void;
  clearStageEvents: (stageIndex: number) => void;

  /**
   * Per-stage cursor for incremental polling (?since= param).
   * Updated to `nextSince` from each /events response.
   */
  stageEventsNextSince: Record<number, number>;
  setStageEventsNextSince: (stageIndex: number, nextSince: number) => void;

  /** Per-stage events loading flag (true while a fetch is in-flight). */
  stageEventsLoading: Record<number, boolean>;
  setStageEventsLoading: (stageIndex: number, loading: boolean) => void;

  /**
   * Per-stage events error. null = no error.
   * Set to a human-readable message on fetch failures (not EventsNotAvailableError).
   */
  stageEventsError: Record<number, string | null>;
  setStageEventsError: (stageIndex: number, error: string | null) => void;

  /** Per-stage "events not available yet" flag (server returned 425). */
  stageEventsNotAvailable: Record<number, boolean>;
  setStageEventsNotAvailable: (stageIndex: number, notAvailable: boolean) => void;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const usePipelineLogStore = create<PipelineLogState>((set) => ({
  logPanelOpen:            false,
  unseenCount:             0,
  selectedStageIndex:      0,
  stageLogs:               {},
  stageLoading:            {},
  stageErrors:             {},
  stageView:               {},
  stagePrompts:            {},
  stagePromptLoading:      {},
  stageMetrics:            {},
  stageMetricsLoading:     {},
  stageMetricsError:       {},
  stageEvents:             {},
  stageEventsNextSince:    {},
  stageEventsLoading:      {},
  stageEventsError:        {},
  stageEventsNotAvailable: {},

  setLogPanelOpen: (open) => set({ logPanelOpen: open, ...(open ? { unseenCount: 0 } : {}) }),

  incrementUnseenCount: () =>
    set((state) => ({ unseenCount: state.unseenCount + 1 })),

  setSelectedStageIndex: (index) => set({ selectedStageIndex: index }),

  setStageLog: (stageIndex, content) =>
    set((state) => ({
      stageLogs: { ...state.stageLogs, [stageIndex]: content },
    })),

  setStageLoading: (stageIndex, loading) =>
    set((state) => ({
      stageLoading: { ...state.stageLoading, [stageIndex]: loading },
    })),

  setStageError: (stageIndex, error) =>
    set((state) => ({
      stageErrors: { ...state.stageErrors, [stageIndex]: error },
    })),

  clearStageLogs: () =>
    set({
      stageLogs:               {},
      stageLoading:            {},
      stageErrors:             {},
      stageView:               {},
      stagePrompts:            {},
      stagePromptLoading:      {},
      stageMetrics:            {},
      stageMetricsLoading:     {},
      stageMetricsError:       {},
      stageEvents:             {},
      stageEventsNextSince:    {},
      stageEventsLoading:      {},
      stageEventsError:        {},
      stageEventsNotAvailable: {},
    }),

  setStageView: (stageIndex, view) =>
    set((state) => ({
      stageView: { ...state.stageView, [stageIndex]: view },
    })),

  setStagePrompt: (stageIndex, prompt) =>
    set((state) => ({
      stagePrompts: { ...state.stagePrompts, [stageIndex]: prompt },
    })),

  setStagePromptLoading: (stageIndex, loading) =>
    set((state) => ({
      stagePromptLoading: { ...state.stagePromptLoading, [stageIndex]: loading },
    })),

  setStageMetrics: (stageIndex, metrics) =>
    set((state) => ({
      stageMetrics: { ...state.stageMetrics, [stageIndex]: metrics },
    })),

  setStageMetricsLoading: (stageIndex, loading) =>
    set((state) => ({
      stageMetricsLoading: { ...state.stageMetricsLoading, [stageIndex]: loading },
    })),

  setStageMetricsError: (stageIndex, error) =>
    set((state) => ({
      stageMetricsError: { ...state.stageMetricsError, [stageIndex]: error },
    })),

  appendStageEvents: (stageIndex, events) =>
    set((state) => {
      const existing = state.stageEvents[stageIndex] ?? [];
      // Deduplicate by idx (Map preserves insertion order).
      // Safety net against polling races where two requests both use since=0:
      // the second append for already-known idx values is a no-op.
      const merged = new Map<number, PublicEvent>(existing.map((e) => [e.idx, e]));
      for (const e of events) merged.set(e.idx, e);
      return {
        stageEvents: {
          ...state.stageEvents,
          [stageIndex]: Array.from(merged.values()),
        },
      };
    }),

  clearStageEvents: (stageIndex) =>
    set((state) => ({
      stageEvents:             { ...state.stageEvents,             [stageIndex]: [] },
      stageEventsNextSince:    { ...state.stageEventsNextSince,    [stageIndex]: 0 },
      stageEventsError:        { ...state.stageEventsError,        [stageIndex]: null },
      stageEventsNotAvailable: { ...state.stageEventsNotAvailable, [stageIndex]: false },
    })),

  setStageEventsNextSince: (stageIndex, nextSince) =>
    set((state) => ({
      stageEventsNextSince: { ...state.stageEventsNextSince, [stageIndex]: nextSince },
    })),

  setStageEventsLoading: (stageIndex, loading) =>
    set((state) => ({
      stageEventsLoading: { ...state.stageEventsLoading, [stageIndex]: loading },
    })),

  setStageEventsError: (stageIndex, error) =>
    set((state) => ({
      stageEventsError: { ...state.stageEventsError, [stageIndex]: error },
    })),

  setStageEventsNotAvailable: (stageIndex, notAvailable) =>
    set((state) => ({
      stageEventsNotAvailable: { ...state.stageEventsNotAvailable, [stageIndex]: notAvailable },
    })),
}));
