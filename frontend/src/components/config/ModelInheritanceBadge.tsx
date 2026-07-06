/**
 * ModelInheritanceBadge — shows the source of a model override.
 *
 * Sources and their token swatches (dark theme):
 *   default  → text-text-secondary     bg-surface-variant          (agent's own frontmatter)
 *   global   → text-primary            bg-primary-container        (from global settings)
 *   space    → text-info               bg-info-container           (from active space)
 *   task     → text-warning            bg-warning-container        (from task — set by TaskDetailPanel)
 *
 * Color is never the sole signal — the text label is always present.
 *
 * `muted` renders the "inherited, not set at this scope" treatment: same source
 * icon/color, dashed border, reduced opacity — distinct from both a "set here"
 * badge (solid) and a plain "default" badge (no source to speak of).
 */

import React from 'react';
import type { ModelSource } from '@/utils/modelRouting';

interface ModelInheritanceBadgeProps {
  source: ModelSource;
  /**
   * Optional text override. Defaults to the source name.
   */
  label?: string;
  /**
   * Renders the dashed, reduced-opacity "inherited from <source>, not set here"
   * treatment instead of the solid "set here" badge.
   */
  muted?: boolean;
}

/**
 * Exported so sibling elements (e.g. the model pill next to this badge in
 * AgentRoutingCard) can share the exact same source→colour mapping — otherwise
 * a badge and the pill right next to it can silently drift into different
 * colours for the same source (e.g. a space-scope badge in info/blue next to
 * a pill hardcoded to primary/violet).
 */
export const SOURCE_CLASSES: Record<ModelSource, string> = {
  default: 'text-text-secondary bg-surface-variant border-border/50',
  global:  'text-primary bg-primary-container border-primary/30',
  space:   'text-info bg-info-container border-info/30',
  task:    'text-warning bg-warning-container border-warning/30',
};

export const SOURCE_MUTED_CLASSES: Record<ModelSource, string> = {
  default: 'text-text-secondary bg-transparent border-border border-dashed',
  global:  'text-primary/70 bg-transparent border-primary/30 border-dashed',
  space:   'text-info/70 bg-transparent border-info/30 border-dashed',
  task:    'text-warning/70 bg-transparent border-warning/30 border-dashed',
};

export function ModelInheritanceBadge({ source, label, muted = false }: ModelInheritanceBadgeProps) {
  const text = label ?? source;
  return (
    <span
      aria-label={`model source: ${text}`}
      className={[
        'inline-flex items-center px-1.5 py-0.5 rounded-md border',
        'text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap',
        'transition-colors duration-fast',
        muted ? SOURCE_MUTED_CLASSES[source] : SOURCE_CLASSES[source],
      ].join(' ')}
    >
      <span>{text}</span>
    </span>
  );
}
