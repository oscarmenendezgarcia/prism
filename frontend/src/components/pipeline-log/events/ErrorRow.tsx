/**
 * ErrorRow — renders error and rate_limit events.
 * Wireframes §4.5–§4.6: error rows use red border + bg-error/10;
 * rate_limit rows use warning border + bg-warning/10.
 */

import React from 'react';
import type { ErrorEvent, RateLimitEvent } from '@/types';

// ---------------------------------------------------------------------------
// ErrorRow
// ---------------------------------------------------------------------------

export interface ErrorRowProps {
  event: ErrorEvent;
}

export function ErrorRow({ event }: ErrorRowProps) {
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 border-b border-border last:border-0 bg-error/10 border-l-2 border-l-error"
      role="alert"
    >
      <span className="text-sm text-error leading-none mt-0.5 shrink-0" aria-hidden="true">
        ❌
      </span>
      <div className="min-w-0 flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-error">ERROR</span>
          {event.tool && (
            <span className="text-xs text-text-secondary font-mono">{event.tool}</span>
          )}
        </div>
        <p className="text-xs text-text-primary break-words">{event.message}</p>
        {event.preview && (
          <p className="text-xs font-mono text-text-secondary break-all mt-0.5">{event.preview}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RateLimitRow
// ---------------------------------------------------------------------------

export interface RateLimitRowProps {
  event: RateLimitEvent;
}

export function RateLimitRow({ event }: RateLimitRowProps) {
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 border-b border-border last:border-0 bg-warning/10 border-l-2 border-l-warning"
      role="alert"
    >
      <span className="text-sm leading-none mt-0.5 shrink-0" aria-hidden="true" title="Rate Limit">
        ⏱
      </span>
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="text-xs font-semibold text-warning-on">Rate Limit</span>
        <p className="text-xs text-text-primary">{event.status}</p>
      </div>
    </div>
  );
}
