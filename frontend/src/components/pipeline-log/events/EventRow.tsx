/**
 * EventRow — discriminated union dispatcher for all PublicEvent kinds.
 * Blueprint §1.1: "one row component per event kind."
 *
 * Props:
 *   event     — the PublicEvent to render
 *   toolMap   — Map<toolCallId, ToolCallEvent> for client-side duration pairing
 */

import React from 'react';
import type { PublicEvent, ToolCallEvent } from '@/types';
import { SessionStartRow, FinalResultRow } from './SessionMarkerRow';
import { ToolCallRow, ToolResultRow } from './ToolCallRow';
import { AssistantTextRow } from './AssistantTextRow';
import { ErrorRow, RateLimitRow } from './ErrorRow';

export interface EventRowProps {
  event: PublicEvent;
  /** Map from tool_call id → ToolCallEvent, used to compute duration on result rows. */
  toolMap: Map<string, ToolCallEvent>;
}

export function EventRow({ event, toolMap }: EventRowProps) {
  switch (event.kind) {
    case 'session_start':
      return <SessionStartRow event={event} />;

    case 'final_result':
      return <FinalResultRow event={event} />;

    case 'tool_call':
      return <ToolCallRow event={event} />;

    case 'tool_result': {
      const call = toolMap.get(event.id);
      // Compute durationMs client-side from the paired tool_call's t field.
      const durationMs = call != null && event.t >= call.t
        ? (event.t - call.t) * 1_000  // t is line index, treat as relative ms
        : event.durationMs;
      return (
        <ToolResultRow
          event={{ ...event, durationMs }}
          toolName={call?.name}
        />
      );
    }

    case 'assistant_text':
      return <AssistantTextRow event={event} />;

    case 'error':
      return <ErrorRow event={event} />;

    case 'rate_limit':
      return <RateLimitRow event={event} />;

    default:
      // Exhaustiveness guard — should not reach here at runtime.
      return null;
  }
}
