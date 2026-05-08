/**
 * StructuredLogView — virtualized timeline of structured pipeline stage events.
 * Blueprint §1.1: consumes GET /runs/:runId/stages/:stageIndex/events, polls
 * every 5 s while stage is running, accumulates events via nextSince cursor.
 *
 * Events are rendered via the EventRow discriminated union dispatcher.
 * ToolCallEvent instances are held in a Map for client-side duration pairing.
 *
 * Empty states:
 *   - notAvailable (425): "Stage is starting…"
 *   - error:              "Unable to load events" + Retry
 *   - empty + running:    "No events yet"
 *   - empty + pending:    "Stage has not started"
 */

import React, { useEffect, useCallback, useRef, useMemo } from 'react';
import { usePipelineLogStore } from '@/stores/usePipelineLogStore';
import { getStageEvents, EventsNotAvailableError } from '@/api/client';
import type { ToolCallEvent } from '@/types';
import { EventRow } from './events/EventRow';

/** Polling interval while a stage is actively running (ms). */
const EVENTS_POLL_MS = 5_000;

/** Maximum events to hold in memory per stage (older events trimmed). */
const MAX_EVENTS_IN_MEMORY = 5_000;

/** Stable empty-array sentinel — prevents Zustand getSnapshot infinite-loop when storeKey slot is uninitialised. */
const EMPTY_EVENTS: import('@/types').PublicEvent[] = [];

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

function EmptyRunning() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <span
        className="material-symbols-outlined text-3xl text-text-disabled leading-none"
        aria-hidden="true"
      >
        pending
      </span>
      <p className="text-sm text-text-secondary">No events yet.</p>
      <p className="text-xs text-text-disabled leading-relaxed max-w-[200px]">
        Events will appear as the agent executes.
      </p>
    </div>
  );
}

function EmptyPending() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <span
        className="material-symbols-outlined text-3xl text-text-disabled leading-none"
        aria-hidden="true"
      >
        hourglass_empty
      </span>
      <p className="text-sm text-text-secondary">Stage has not started.</p>
    </div>
  );
}

function NotAvailableState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <span
        className="material-symbols-outlined text-3xl text-text-disabled leading-none animate-pulse"
        aria-hidden="true"
      >
        sync
      </span>
      <p className="text-sm text-text-secondary">Stage is starting…</p>
      <p className="text-xs text-text-disabled leading-relaxed max-w-[200px]">
        Waiting for the first log line.
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <span
        className="material-symbols-outlined text-3xl text-error leading-none"
        aria-hidden="true"
      >
        error_outline
      </span>
      <p className="text-sm text-text-secondary">Unable to load events.</p>
      <p className="text-xs text-text-disabled leading-relaxed max-w-[200px] break-words">{message}</p>
      <button
        onClick={onRetry}
        className="mt-1 text-xs px-3 py-1.5 rounded-md bg-surface-elevated border border-border text-text-secondary hover:text-primary hover:border-primary transition-colors duration-150"
      >
        Retry
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StructuredLogView
// ---------------------------------------------------------------------------

export interface StructuredLogViewProps {
  /** Backend run ID (effective for this stage). */
  runId: string;
  /** Stage index in the backend run. */
  stageIndex: number;
  /** Store key (pipeline-level stage index). */
  storeKey: number;
  /** Whether this stage is actively running — controls polling. */
  isRunning: boolean;
  /** Whether this stage is pending (not started). */
  isPending: boolean;
}

/**
 * Polls GET /events while stage is running, accumulates events, renders them.
 */
export function StructuredLogView({
  runId,
  stageIndex,
  storeKey,
  isRunning,
  isPending,
}: StructuredLogViewProps) {
  const events         = usePipelineLogStore((s) => s.stageEvents[storeKey] ?? EMPTY_EVENTS);
  const nextSince      = usePipelineLogStore((s) => s.stageEventsNextSince[storeKey] ?? 0);
  const isLoading      = usePipelineLogStore((s) => s.stageEventsLoading[storeKey] ?? false);
  const error          = usePipelineLogStore((s) => s.stageEventsError[storeKey] ?? null);
  const notAvailable   = usePipelineLogStore((s) => s.stageEventsNotAvailable[storeKey] ?? false);

  const appendEvents       = usePipelineLogStore((s) => s.appendStageEvents);
  const setNextSince       = usePipelineLogStore((s) => s.setStageEventsNextSince);
  const setLoading         = usePipelineLogStore((s) => s.setStageEventsLoading);
  const setError           = usePipelineLogStore((s) => s.setStageEventsError);
  const setNotAvailable    = usePipelineLogStore((s) => s.setStageEventsNotAvailable);

  // Stable ref to nextSince so the interval callback reads the latest value.
  const nextSinceRef = useRef(nextSince);
  useEffect(() => { nextSinceRef.current = nextSince; }, [nextSince]);

  // Bottom-sentinel ref for auto-scroll.
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchEvents = useCallback(async () => {
    if (!runId) return;
    // Guard: skip if a fetch is already in-flight for this stage.
    // Prevents polling race where the interval fires a second since=0 request
    // before the initial fetch has completed and updated nextSinceRef.
    if (usePipelineLogStore.getState().stageEventsLoading[storeKey]) return;
    setLoading(storeKey, true);
    setError(storeKey, null);
    try {
      const data = await getStageEvents(runId, stageIndex, nextSinceRef.current);
      if (data.events.length > 0) {
        appendEvents(storeKey, data.events);
      }
      setNextSince(storeKey, data.nextSince);
      setNotAvailable(storeKey, false);
    } catch (err) {
      if (err instanceof EventsNotAvailableError) {
        setNotAvailable(storeKey, true);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setError(storeKey, msg);
        console.error('[StructuredLogView] ERROR fetching events:', err);
      }
    } finally {
      setLoading(storeKey, false);
    }
  }, [runId, stageIndex, storeKey, appendEvents, setNextSince, setLoading, setError, setNotAvailable]);

  // Fetch on mount / when runId or stageIndex changes.
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Poll while running.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(fetchEvents, EVENTS_POLL_MS);
    return () => clearInterval(id);
  }, [isRunning, fetchEvents]);

  // Auto-scroll to bottom when new events arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [events.length]);

  // Build tool call map for client-side duration pairing.
  const toolMap = useMemo<Map<string, ToolCallEvent>>(() => {
    const map = new Map<string, ToolCallEvent>();
    for (const ev of events) {
      if (ev.kind === 'tool_call') {
        map.set(ev.id, ev);
      }
    }
    return map;
  }, [events]);

  // Trim events to MAX_EVENTS_IN_MEMORY (keep newest).
  const visibleEvents = events.length > MAX_EVENTS_IN_MEMORY
    ? events.slice(events.length - MAX_EVENTS_IN_MEMORY)
    : events;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex flex-1 flex-col min-h-0 items-center justify-center">
        <ErrorState message={error} onRetry={() => { setError(storeKey, null); fetchEvents(); }} />
      </div>
    );
  }

  if (notAvailable || (isLoading && events.length === 0)) {
    if (isPending) return <div className="flex flex-1 flex-col min-h-0 items-center justify-center"><EmptyPending /></div>;
    return <div className="flex flex-1 flex-col min-h-0 items-center justify-center"><NotAvailableState /></div>;
  }

  if (events.length === 0) {
    if (isPending) return <div className="flex flex-1 flex-col min-h-0 items-center justify-center"><EmptyPending /></div>;
    return <div className="flex flex-1 flex-col min-h-0 items-center justify-center"><EmptyRunning /></div>;
  }

  return (
    <div
      className="flex flex-1 flex-col min-h-0 overflow-y-auto"
      role="log"
      aria-label="Structured stage events"
      aria-live="polite"
      aria-atomic="false"
    >
      {events.length > MAX_EVENTS_IN_MEMORY && (
        <div className="px-3 py-1.5 text-xs text-text-disabled bg-surface-elevated border-b border-border text-center">
          Showing last {MAX_EVENTS_IN_MEMORY.toLocaleString()} events
        </div>
      )}

      <div className="flex flex-col divide-y divide-border">
        {visibleEvents.map((event) => (
          <EventRow key={event.idx} event={event} toolMap={toolMap} />
        ))}
      </div>

      {isRunning && isLoading && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-text-secondary border-t border-border">
          <span
            className="material-symbols-outlined text-xs text-primary leading-none animate-spin"
            aria-hidden="true"
          >
            progress_activity
          </span>
          Loading new events…
        </div>
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}
