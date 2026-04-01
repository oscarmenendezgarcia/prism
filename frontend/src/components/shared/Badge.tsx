/**
 * Task type badge — renders feature, bug, tech-debt, chore, or done variants.
 * ADR-002: replaces .badge .badge-task .badge-research etc.
 * ADR-003 §8.5: Apple palette colors via CSS custom property tokens, rounded-sm border radius.
 * v1.2.0: TaskType enum expanded from ['task','research'] to ['feature','bug','tech-debt','chore'].
 * Badge background rgba values use dark: variants since CSS custom properties
 * cannot express the per-badge rgba color differences between modes.
 */

import React from 'react';
import type { TaskType } from '@/types';

type BadgeType = TaskType | 'done';

interface BadgeProps {
  type: BadgeType;
  className?: string;
}

// Background: light mode uses muted palette; dark mode uses Apple vivid palette.
// Text color: uses CSS custom property tokens that switch with theme automatically.
const badgeClasses: Record<BadgeType, string> = {
  feature:
    'bg-[rgba(108,57,192,0.10)] dark:bg-[rgba(191,90,242,0.14)] text-badge-feature-text',
  bug:
    'bg-[rgba(255,59,48,0.10)] dark:bg-[rgba(255,69,58,0.14)] text-badge-bug-text',
  'tech-debt':
    'bg-[rgba(255,149,0,0.10)] dark:bg-[rgba(255,214,10,0.14)] text-badge-tech-debt-text',
  chore:
    'bg-[rgba(110,110,115,0.10)] dark:bg-[rgba(255,255,255,0.06)] text-badge-chore-text',
  done:
    'bg-[rgba(36,138,61,0.12)] dark:bg-[rgba(48,209,88,0.14)] text-badge-done-text',
};

/** Human-readable label shown inside the badge. */
const badgeLabel: Record<BadgeType, string> = {
  feature:    'feature',
  bug:        'bug',
  'tech-debt': 'tech-debt',
  chore:      'chore',
  done:       'done',
};

export function Badge({ type, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium leading-none uppercase tracking-wide ${badgeClasses[type]} ${className}`}
    >
      {badgeLabel[type]}
    </span>
  );
}
