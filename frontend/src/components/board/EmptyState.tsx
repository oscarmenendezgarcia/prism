import React from 'react';
import type { StatusCategory } from '@/types';

interface EmptyStateProps {
  column: StatusCategory;
}

const COLUMN_EMPTY: Record<StatusCategory, {
  icon: string;
  iconColor: string;
  title: string;
  subtitle: string;
}> = {
  'todo': {
    icon: 'inbox',
    iconColor: 'text-text-disabled',
    title: 'No issues here',
    subtitle: 'New issues start in the first to-do status',
  },
  'in-progress': {
    icon: 'hourglass_empty',
    iconColor: 'text-text-disabled',
    title: 'Nothing here',
    subtitle: 'Issues move here as work goes on',
  },
  'done': {
    icon: 'check_circle',
    iconColor: 'text-text-disabled',
    title: 'Nothing done yet',
    subtitle: 'Finished issues appear here',
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
