/**
 * Single kanban column — header (title + count) and card list.
 * ADR-002: replaces #col-todo/in-progress/done static HTML sections.
 * ADR-003 §8.3: bg-transparent, rounded-lg, col.* tokens replace hardcoded hex.
 */

import React from 'react';
import type { Task, Column as ColumnType } from '@/types';
import { TaskCard } from './TaskCard';
import { EmptyState } from './EmptyState';

// ADR-003: accent classes now use semantic col.* tokens backed by CSS custom properties.
const COLUMN_META: Record<ColumnType, { label: string; accentClass: string; colIndex: number }> = {
  'todo':        { label: 'Todo',        accentClass: 'border-col-todo',        colIndex: 0 },
  'in-progress': { label: 'In Progress', accentClass: 'border-col-in-progress', colIndex: 1 },
  'done':        { label: 'Done',        accentClass: 'border-col-done',        colIndex: 2 },
};

interface ColumnProps {
  column: ColumnType;
  tasks: Task[];
  onDragStart: (e: React.DragEvent, taskId: string, sourceColumn: ColumnType) => void;
  onDragOver: (e: React.DragEvent, targetColumn: ColumnType) => void;
  onDragOverTask: (e: React.DragEvent, taskId: string) => void;
  onDragLeave: (e: React.DragEvent, targetColumn: ColumnType) => void;
  onDragLeaveTask: (e: React.DragEvent, taskId: string) => void;
  onDrop: (e: React.DragEvent, targetColumn: ColumnType) => void;
  draggedTaskId: string | null;
  dragOverTaskId: string | null;
}

export function Column({ column, tasks, onDragStart, onDragOver, onDragOverTask, onDragLeave, onDragLeaveTask, onDrop, draggedTaskId, dragOverTaskId }: ColumnProps) {
  const { label, accentClass } = COLUMN_META[column];

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    onDragOver(e, column);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    onDragLeave(e, column);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    onDrop(e, column);
  };

  return (
    <section
      className="flex flex-col bg-transparent rounded-lg h-full transition-colors duration-200"
      aria-label={`${label} column`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-column={column}
      data-drag-over={draggedTaskId !== null}
    >
      {/* S-1: sticky so the header stays visible when column content scrolls */}
      <div className={`sticky top-0 z-10 flex items-center justify-between px-3 py-2.5 border-b-2 bg-background ${accentClass}`}>
        <h2 className="text-sm font-semibold text-text-primary tracking-tight">{label}</h2>
        {/* S-2: tabular-nums keeps the count width stable as it changes */}
        <span className="text-xs font-medium text-text-secondary bg-surface-variant px-2 py-0.5 rounded-full tabular-nums">
          {tasks.length}
        </span>
      </div>

      <div
        role="list"
        className="flex flex-col gap-3 p-3 overflow-y-auto flex-1"
      >
        {tasks.length === 0 ? (
          <EmptyState column={column} />
        ) : (
          tasks.map((task, cardIndex) => {
            // A-1: stagger delay — skip if total cards > 30 (too many, animate all at once).
            // Cap at 500ms. Column offset: colIndex × 100ms, card offset: cardIndex × 35ms.
            const staggerMs = tasks.length > 30
              ? 0
              : Math.min(COLUMN_META[column].colIndex * 100 + cardIndex * 35, 500);
            return (
              <TaskCard
                key={task.id}
                task={task}
                column={column}
                isDragging={task.id === draggedTaskId}
                isDragOver={task.id === dragOverTaskId}
                onDragStart={onDragStart}
                onDragOver={onDragOverTask}
                onDragLeave={onDragLeaveTask}
                onDrop={onDrop}
                staggerDelayMs={staggerMs}
              />
            );
          })
        )}
      </div>
    </section>
  );
}
