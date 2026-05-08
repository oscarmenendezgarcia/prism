/**
 * ToolCallRow — renders tool_call and tool_result events.
 * Blueprint §3: tool call rows are paired by id client-side.
 * Wireframes §4.2–§4.3: tool call and result styling.
 */

import React, { useState } from 'react';
import type { ToolCallEvent, ToolResultEvent } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

function formatDurationMs(ms: number | undefined): string {
  if (ms == null) return '';
  if (ms < 1_000) return `${ms} ms`;
  return `${(ms / 1_000).toFixed(2)} s`;
}

// ---------------------------------------------------------------------------
// ToolCallRow
// ---------------------------------------------------------------------------

export interface ToolCallRowProps {
  event: ToolCallEvent;
}

export function ToolCallRow({ event }: ToolCallRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-border last:border-0">
      <span className="text-sm leading-none mt-0.5 shrink-0" aria-hidden="true" title="Tool Call">
        🔧
      </span>
      <div className="min-w-0 flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-primary">{event.name}</span>
          <span className="text-xs text-text-secondary">tool call</span>
        </div>

        {event.inputPreview && (
          <div>
            <pre
              className={`text-xs font-mono text-text-secondary bg-surface-elevated rounded px-2 py-1 whitespace-pre-wrap break-all ${expanded ? '' : 'line-clamp-2'}`}
              aria-label={`Tool ${event.name} input`}
            >
              {event.inputPreview}
            </pre>
            {event.inputPreview.length >= 190 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-xs text-primary hover:underline mt-0.5 transition-colors duration-150"
                aria-expanded={expanded}
              >
                {expanded ? 'Show less' : 'Show full input'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolResultRow
// ---------------------------------------------------------------------------

export interface ToolResultRowProps {
  event: ToolResultEvent;
  /** Paired tool name (from the matching tool_call event). */
  toolName?: string;
}

export function ToolResultRow({ event, toolName }: ToolResultRowProps) {
  const hasError  = event.isError;
  const duration  = formatDurationMs(event.durationMs);
  const bytesFmt  = formatBytes(event.bytes);

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 border-b border-border last:border-0 ${
        hasError ? 'bg-error/10 border-l-2 border-l-error' : ''
      }`}
    >
      <span
        className={`text-sm leading-none mt-0.5 shrink-0 ${hasError ? 'text-error' : 'text-success'}`}
        aria-hidden="true"
        title={hasError ? 'Tool Error' : 'Tool Result'}
      >
        {hasError ? '✗' : '↩'}
      </span>
      <div className="min-w-0 flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className={`text-xs font-semibold ${hasError ? 'text-error' : 'text-text-primary'}`}>
            Result{toolName ? ` from ${toolName}` : ''}
          </span>
          <span className={`text-xs font-medium ${hasError ? 'text-error' : 'text-success'}`}>
            {hasError ? 'ERROR' : 'OK'}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-secondary">
          {duration && <span>Duration: <span className="font-mono">{duration}</span></span>}
          <span>Size: <span className="font-mono">{bytesFmt}</span></span>
        </div>
      </div>
    </div>
  );
}
