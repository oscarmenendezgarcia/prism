import React from 'react';
import type { Column } from '@/types';

interface EmptyStateProps {
  column: Column;
}

const COLUMN_EMPTY: Record<Column, {
  icon: string;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
}> = {
  'todo': {
    icon: 'inbox',
    iconColor: 'text-text-disabled',
    iconBg: 'bg-surface-elevated',
    title: 'No tasks yet',
    subtitle: 'Create a task to get started',
  },
  'in-progress': {
    icon: 'hourglass_empty',
    iconColor: 'text-primary/50',
    iconBg: 'bg-primary-container',
    title: 'Nothing in progress',
    subtitle: 'Move tasks here when you start working',
  },
  'done': {
    icon: 'check_circle',
    iconColor: 'text-success/50',
    iconBg: 'bg-success/[0.08]',
    title: 'No completed tasks',
    subtitle: 'Completed tasks will appear here',
  },
};

export function EmptyState({ column }: EmptyStateProps) {
  const { icon, iconColor, iconBg, title, subtitle } = COLUMN_EMPTY[column];

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center select-none">
      <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-border ${iconBg} animate-empty-pulse`}>
        <span className={`material-symbols-outlined text-2xl ${iconColor}`} aria-hidden="true">
          {icon}
        </span>
      </div>
      <h4 className="text-sm font-semibold text-text-secondary">{title}</h4>
      <p className="mt-1 text-xs text-text-disabled">{subtitle}</p>
    </div>
  );
}
