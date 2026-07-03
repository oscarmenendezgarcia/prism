/**
 * ModelInheritanceBadge — shows the source of a model override.
 *
 * Sources and their token swatches (dark theme):
 *   default  → text-text-secondary     bg-surface-variant          (no override)
 *   global   → text-primary            bg-primary/10               (from global settings)
 *   space    → text-info               bg-info-container           (from active space)
 *   task     → text-warning            bg-warning-container        (from task — set by TaskDetailPanel)
 *
 * Color is never the sole signal — the text label is always present.
 */

import React from 'react';
import type { ModelSource } from '@/utils/modelRouting';

interface ModelInheritanceBadgeProps {
  source: ModelSource;
  /**
   * Optional text override. Defaults to the source name. Used to render an
   * "inherited" pill (muted `default` styling) when a value is not set at the
   * scope currently being edited — distinct from a value set here.
   */
  label?: string;
}

const SOURCE_CLASSES: Record<ModelSource, string> = {
  default: 'text-text-secondary bg-surface-variant border-border/50',
  global:  'text-primary bg-primary-container border-primary/30',
  space:   'text-info bg-info-container border-info/30',
  task:    'text-warning bg-warning-container border-warning/30',
};

export function ModelInheritanceBadge({ source, label }: ModelInheritanceBadgeProps) {
  const text = label ?? source;
  return (
    <span
      aria-label={`model source: ${text}`}
      className={[
        'inline-flex items-center px-1.5 py-0.5 rounded-md border',
        'text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap',
        'transition-colors duration-fast',
        SOURCE_CLASSES[source],
      ].join(' ')}
    >
      {text}
    </span>
  );
}
