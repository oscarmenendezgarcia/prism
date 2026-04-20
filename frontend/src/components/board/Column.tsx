/**
 * Single kanban column — header (title + count) and card list.
 * ADR-002: replaces #col-todo/in-progress/done static HTML sections.
 * ADR-003 §8.3: bg-transparent, rounded-lg, col.* tokens replace hardcoded hex.
 */

import React, { memo } from 'react';
import type { Task, Column as ColumnType } from '@/types';
import { useDragStore } from '@/stores/useDragStore';
import { TaskCard } from './TaskCard';
import { EmptyState } from './EmptyState';

// Wireframe S-01/S-02: Todo = neutral, In-Progress = violet left accent, Done = green left accent
const COLUMN_META: Record<ColumnType, { label: string; accentClass: string; colIndex: number }> = {
  'todo':        { label: 'Todo',        accentClass: '',                     colIndex: 0 },
  'in-progress': { label: 'In Progress', accentClass: 'border-l-2 border-l-primary', colIndex: 1 },
  'done':        { label: 'Done',        accentClass: 'border-l-2 border-l-success', colIndex: 2 },
};

interface ColumnProps {
  column: ColumnType;
  tasks: Task[];
  onDragStart?: (e: React.DragEvent, taskId: string, sourceColumn: ColumnType) => void;
  onDragOver?: (e: React.DragEvent, targetColumn: ColumnType) => void;
  onDragLeave?: (e: React.DragEvent, targetColumn: ColumnType) => void;
  onDragEnd?: () => void;
  onDrop?: (e: React.DragEvent, targetColumn: ColumnType) => void;
}

export const Column = memo(function Column({ column, tasks, onDragStart, onDragOver, onDragLeave, onDragEnd, onDrop }: ColumnProps) {
  const { label, accentClass } = COLUMN_META[column];

  // Subscribe to column-level drag-over — re-renders only when this column's
  // active state changes (2 re-renders max per drag move: prev col + next col).
  const isDragOver = useDragStore((s) => s.dragOverColumn === column && s.draggedTaskId !== null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    onDragOver?.(e, column);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    onDragLeave?.(e, column);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    onDrop?.(e, column);
  };

  return (
    <section
      className={`flex flex-col bg-surface rounded-xl border overflow-hidden min-h-[200px] h-full transition-all duration-fast ${accentClass} ${
        isDragOver
          ? 'border-primary/60 ring-2 ring-primary/20 bg-primary/[0.03]'
          : 'border-border'
      }`}
      aria-label={`${label} column`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-column={column}
    >
      {/* Column header — wireframe S-01/S-02 */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-widest">{label}</h2>
        <span
          className="ml-2 px-2 py-0.5 text-xs font-mono bg-surface-elevated rounded-full text-text-secondary tabular-nums"
          aria-live="polite"
        >
          {tasks.length}
        </span>
      </div>

      {/* Card area */}
      <div
        role="list"
        className="flex-1 p-3 flex flex-col gap-2 overflow-y-auto pb-20 sm:pb-3"
      >
        {tasks.length === 0 ? (
          <EmptyState column={column} />
        ) : (
          tasks.map((task, cardIndex) => {
            const staggerMs = tasks.length > 30
              ? 0
              : Math.min(COLUMN_META[column].colIndex * 100 + cardIndex * 35, 500);
            return (
              <TaskCard
                key={task.id}
                task={task}
                column={column}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                staggerDelayMs={staggerMs}
              />
            );
          })
        )}
      </div>
    </section>
  );
});
