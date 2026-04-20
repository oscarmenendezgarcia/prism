/**
 * MB-1: Mobile-only tab bar for switching between kanban columns.
 * Visible only below 640px (sm:hidden on the Board wraps this).
 * Uses scroll-snap and overflow-x-auto for smooth swipe ergonomics.
 */

import React from 'react';
import type { Column } from '@/types';

const TABS: { column: Column; label: string }[] = [
  { column: 'todo',        label: 'Todo' },
  { column: 'in-progress', label: 'In Progress' },
  { column: 'done',        label: 'Done' },
];

interface ColumnTabBarProps {
  activeColumn: Column;
  taskCounts: Record<Column, number>;
  onSelect: (col: Column) => void;
}

export function ColumnTabBar({ activeColumn, taskCounts, onSelect }: ColumnTabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Kanban columns"
      className="flex justify-center overflow-x-auto snap-x snap-mandatory gap-1 px-4 py-2 bg-surface border-b border-border"
    >
      {TABS.map(({ column, label }) => {
        const isActive = column === activeColumn;
        return (
          <button
            key={column}
            role="tab"
            aria-selected={isActive}
            aria-controls={`column-panel-${column}`}
            onClick={() => onSelect(column)}
            className={[
              'flex-shrink-0 snap-start flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ease-apple',
              isActive
                ? 'bg-primary/15 text-primary font-semibold border-b-2 border-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-surface-variant',
            ].join(' ')}
          >
            {label}
            <span className={`text-xs tabular-nums px-1.5 py-0.5 rounded-full ${isActive ? 'bg-primary/20 text-primary' : 'bg-surface-variant text-text-secondary'}`}>
              {taskCounts[column]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
