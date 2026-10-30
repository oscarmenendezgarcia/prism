/**
 * Task type badge — renders feature, bug, tech-debt, chore, or done variants.
 * ADR-002: replaces .badge .badge-task .badge-research etc.
 * Redesign (Trend A): violet-accent palette, rounded-full pills.
 * v1.3.0: Updated to Trend-A dark design system tokens.
 */

import React from 'react';
import type { TaskType } from '@/types';

type BadgeType = TaskType | 'done';

interface BadgeProps {
  type: BadgeType;
  /** Shown instead of the type's own name, as written. */
  label?: string;
  className?: string;
}

/**
 * Badge backgrounds use semi-transparent rgba values tuned for both themes.
 * Text colors are CSS custom property tokens (switch automatically with theme).
 *
 * Light mode:  faint tinted backgrounds (10-12% opacity)
 * Dark mode:   slightly more saturated tints (12-15% opacity)
 * Expressed as dark: variants since CSS vars cannot cover per-badge rgba differences.
 */
const badgeClasses: Record<BadgeType, string> = {
  feature:
    'bg-[rgba(108,96,224,0.10)] dark:bg-[rgba(124,109,250,0.14)] text-badge-feature-text',
  bug:
    'bg-[rgba(217,48,37,0.10)] dark:bg-[rgba(255,90,95,0.13)] text-badge-bug-text',
  'tech-debt':
    'bg-[rgba(242,153,0,0.10)] dark:bg-[rgba(255,180,84,0.13)] text-badge-tech-debt-text',
  chore:
    'bg-[rgba(26,26,46,0.07)] dark:bg-[rgba(255,255,255,0.07)] text-badge-chore-text',
  epic:
    'bg-primary text-white',
  done:
    'bg-[rgba(30,142,62,0.10)] dark:bg-[rgba(59,214,113,0.13)] text-badge-done-text',
};

/** Human-readable label shown inside the badge. */
const badgeLabel: Record<BadgeType, string> = {
  feature:     'feature',
  bug:         'bug',
  'tech-debt': 'tech-debt',
  chore:       'chore',
  epic:        'epic',
  done:        'done',
};

export function Badge({ type, label, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium leading-none ${label ? '' : 'uppercase tracking-wide'} ${badgeClasses[type]} ${className}`}
    >
      {label ?? badgeLabel[type]}
    </span>
  );
}
