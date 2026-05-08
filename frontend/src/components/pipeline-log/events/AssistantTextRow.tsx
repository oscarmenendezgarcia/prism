/**
 * AssistantTextRow — renders assistant_text events.
 * Wireframes §4.4: collapsed by default (3 lines), expandable on click.
 */

import React, { useState } from 'react';
import type { AssistantTextEvent } from '@/types';

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

export interface AssistantTextRowProps {
  event: AssistantTextEvent;
}

export function AssistantTextRow({ event }: AssistantTextRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isTruncated = event.bytes > 1_000;

  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-border last:border-0">
      <span className="text-sm leading-none mt-0.5 shrink-0" aria-hidden="true" title="Assistant Text">
        💬
      </span>
      <div className="min-w-0 flex flex-col gap-0.5 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-text-primary">Assistant</span>
          <span className="text-xs text-text-secondary">{formatBytes(event.bytes)}</span>
        </div>

        <div
          className={`text-xs text-text-primary whitespace-pre-wrap break-words leading-relaxed transition-all duration-150 ${
            expanded ? '' : 'line-clamp-3'
          }`}
          aria-label="Assistant message text"
        >
          {event.preview}
        </div>

        {(isTruncated || (!expanded && event.preview.length > 0)) && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-primary hover:underline self-start mt-0.5 transition-colors duration-150"
            aria-expanded={expanded}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}
