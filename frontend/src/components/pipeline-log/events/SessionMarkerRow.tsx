/**
 * SessionMarkerRow — renders session_start and final_result events.
 * Blueprint §3: event row components.
 * Wireframes §4.1: session start / final result styling.
 */

import React from 'react';
import type { SessionStartEvent, FinalResultEvent } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}

function formatMs(ms: number): string {
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1_000);
  return s > 0 ? `${m} m ${s} s` : `${m} m`;
}

// ---------------------------------------------------------------------------
// SessionStart
// ---------------------------------------------------------------------------

export function SessionStartRow({ event }: { event: SessionStartEvent }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-border last:border-0">
      <span
        className="text-sm text-primary leading-none mt-0.5 shrink-0"
        aria-hidden="true"
        title="Session Start"
      >
        ▶
      </span>
      <div className="min-w-0">
        <span className="text-xs font-semibold text-text-primary">Session Start</span>
        {event.model && (
          <span className="ml-2 text-xs text-text-secondary font-mono">{event.model}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FinalResult
// ---------------------------------------------------------------------------

export function FinalResultRow({ event }: { event: FinalResultEvent }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-border last:border-0">
      <span
        className="text-sm text-success leading-none mt-0.5 shrink-0"
        aria-hidden="true"
        title="Session Complete"
      >
        ✓
      </span>
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="text-xs font-semibold text-text-primary">Session Complete</span>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-secondary">
          <span>Duration: <span className="font-mono text-text-primary">{formatMs(event.durationMs)}</span></span>
          <span>Turns: <span className="font-mono text-text-primary">{event.numTurns}</span></span>
          <span>Cost: <span className="font-mono text-text-primary">{formatCost(event.costUsd)}</span></span>
          {event.stopReason && (
            <span>Stop: <span className="font-mono text-text-primary">{event.stopReason}</span></span>
          )}
        </div>
      </div>
    </div>
  );
}
