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
    iconColor: 'text-text-disabled/40',
    iconBg: 'bg-white/[0.03]',
    title: 'No tasks yet',
    subtitle: 'Add a task to get started',
  },
  'in-progress': {
    icon: 'hourglass_empty',
    iconColor: 'text-primary/30',
    iconBg: 'bg-primary/[0.05]',
    title: 'Nothing in progress',
    subtitle: 'Move tasks here when you start working',
  },
  'done': {
    icon: 'check_circle',
    iconColor: 'text-col-done/30',
    iconBg: 'bg-col-done/[0.05]',
    title: 'No completed tasks',
    subtitle: 'Completed tasks will appear here',
  },
};

export function EmptyState({ column }: EmptyStateProps) {
  const { icon, iconColor, iconBg, title, subtitle } = COLUMN_EMPTY[column];

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center select-none">
      <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full ${iconBg} animate-empty-pulse`}>
        <span className={`material-symbols-outlined text-3xl ${iconColor}`} aria-hidden="true">
          {icon}
        </span>
      </div>
      <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
      <p className="mt-1 text-xs text-text-secondary">{subtitle}</p>
    </div>
  );
}
