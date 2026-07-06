/**
 * EffortSegmented — read-only label reflecting an agent's effort level.
 *
 * Phase 1: read-only, no editing affordance (a Tooltip explains editing is
 * coming in Phase 2). Mirrors SkillsReadOnly's plain-label treatment rather
 * than a full interactive segmented control, since nothing here is clickable.
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
    return <span className="block h-[13px] w-16 rounded bg-surface-variant animate-pulse" aria-hidden="true" />;
  }

  if (!active) {
    return <span className="text-[12px] text-text-secondary italic">not set</span>;
  }

  return (
    <Tooltip label="Editing coming in Phase 2" description="Effort level is read-only in this release">
      <span className="text-[12px] font-semibold font-mono text-text-primary" title="Editing coming in Phase 2">
        {active}
      </span>
    </Tooltip>
  );
}
