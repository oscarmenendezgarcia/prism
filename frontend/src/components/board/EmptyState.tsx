import React from 'react';
import type { Column } from '@/types';

interface EmptyStateProps {
  column: Column;
}

const COLUMN_EMPTY: Record<Column, {
  icon: string;
  iconColor: string;
  title: string;
  subtitle: string;
}> = {
  'todo': {
    icon: 'inbox',
    iconColor: 'text-text-disabled',
    title: 'No tasks yet',
    subtitle: 'Create a task to get started',
  },
  'in-progress': {
    icon: 'hourglass_empty',
    iconColor: 'text-text-disabled',
    title: 'Nothing in progress',
    subtitle: 'Move tasks here when you start working',
  },
  'done': {
    icon: 'check_circle',
    iconColor: 'text-text-disabled',
    title: 'No completed tasks',
    subtitle: 'Completed tasks will appear here',
  },
};

export function EmptyState({ column }: EmptyStateProps) {
  const { icon, iconColor, title, subtitle } = COLUMN_EMPTY[column];

  return (
    <div className="flex flex-col items-center justify-center flex-1 py-12 px-4 text-center select-none">
      <span
        className={`material-symbols-outlined text-5xl mb-4 ${iconColor}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="text-sm font-medium text-text-secondary mb-1">{title}</p>
      <p className="text-xs text-text-disabled">{subtitle}</p>
    </div>
  );
}
