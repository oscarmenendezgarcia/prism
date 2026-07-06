/**
 * EffortSegmented — read-only segmented control reflecting an agent's effort level.
 *
 * Phase 1: always disabled. The active segment highlights the frontmatter value.
 * A Tooltip informs the user that editing is coming in Phase 2.
 *
 * Accessibility: aria-disabled on each button, title attribute for tooltip text.
 */

import React from 'react';
import { Tooltip } from '@/components/shared/Tooltip';

const EFFORTS = ['low', 'medium', 'high'] as const;
type Effort = typeof EFFORTS[number];

interface EffortSegmentedProps {
  value?: string;    // frontmatter effort value (may be undefined → no highlight)
  loading?: boolean; // true while metadata is still being fetched
}

export function EffortSegmented({ value, loading = false }: EffortSegmentedProps) {
  const active = EFFORTS.includes(value as Effort) ? (value as Effort) : undefined;

  if (loading) {
    return (
      <div className="inline-flex gap-0.5 bg-surface border border-border rounded-sm p-[3px]" aria-hidden="true">
        {EFFORTS.map((effort) => (
          <span key={effort} className="px-3 py-1">
            <span className="block h-[13px] w-8 rounded bg-surface-variant animate-pulse" />
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Tooltip label="Editing coming in Phase 2" description="Effort level is read-only in this release">
        <div
          role="group"
          aria-label="Effort level (read-only)"
          className="inline-flex gap-0.5 bg-surface border border-border rounded-sm p-[3px] cursor-not-allowed"
        >
          {EFFORTS.map((effort) => {
            const isActive = effort === active;
            return (
              <button
                key={effort}
                type="button"
                disabled
                aria-disabled="true"
                aria-pressed={isActive}
                title="Editing coming in Phase 2"
                className={[
                  'px-3 py-1 text-[12px] font-semibold rounded-md border-0',
                  'cursor-not-allowed select-none transition-colors duration-fast',
                  isActive
                    ? 'bg-primary-container text-primary opacity-60'
                    : 'bg-transparent text-text-secondary opacity-50',
                ].join(' ')}
              >
                {effort}
              </button>
            );
          })}
        </div>
      </Tooltip>
      {/* Loaded, but the agent's frontmatter has no effort — distinguish from the loading skeleton above */}
      {!active && (
        <span className="text-[11px] text-text-tertiary italic">not set</span>
      )}
    </div>
  );
}
