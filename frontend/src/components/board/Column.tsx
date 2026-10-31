/**
 * Single kanban column — header (title + count) and card list.
 * ADR-002: replaces #col-todo/in-progress/done static HTML sections.
 * ADR-003 §8.3: bg-transparent, rounded-lg, col.* tokens replace hardcoded hex.
 */

import React, { memo, useState } from 'react';
import type { Task, Column as ColumnType, Status } from '@/types';
import { Button } from '@/components/shared/Button';
import { MAX_COLUMN_LIMIT, useAppStore } from '@/stores/useAppStore';
import { useDragStore } from '@/stores/useDragStore';
import { TaskCard } from './TaskCard';
import { EmptyState } from './EmptyState';
import { statusDotClass } from '@/utils/issues';

interface ColumnProps {
  column: ColumnType;
  status?: Status;
  /** All the statuses of the space, in order. */
  statuses?: Status[];
  tasks: Task[];
  onDragStart?: (e: React.DragEvent, taskId: string, sourceColumn: ColumnType) => void;
  onDragOver?: (e: React.DragEvent, targetColumn: ColumnType) => void;
  onDragLeave?: (e: React.DragEvent, targetColumn: ColumnType) => void;
  onDragEnd?: () => void;
  onDrop?: (e: React.DragEvent, targetColumn: ColumnType) => void;
  onDragOverTask?: (taskId: string | null, insertBefore: boolean) => void;
  /**
   * Keyboard/button reorder within a column (Alt+Arrow shortcut, and the
   * CardActionMenu move-up/move-down buttons — shared by the keyboard and
   * touch-reorder features; see ADR-1 keyboard-card-reorder + ADR-1 touch-reorder).
   */
  onKeyboardReorder?: (taskId: string, column: ColumnType, direction: 'up' | 'down') => void;
}

export const Column = memo(function Column({ column, status, statuses = [], tasks, onDragStart, onDragOver, onDragLeave, onDragEnd, onDrop, onDragOverTask, onKeyboardReorder }: ColumnProps) {
  const label = status?.name ?? column;

  // Subscribe to column-level drag-over — re-renders only when this column's
  // active state changes (2 re-renders max per drag move: prev col + next col).
  const isDragOver    = useDragStore((s) => s.dragOverColumn === column && s.draggedTaskId !== null);
  // What the column really has: not all of it is loaded, and the server applies the epic filter.
  const total         = useAppStore((s) => s.columnTotals[column]) ?? tasks.length;
  const limit         = useAppStore((s) => s.columnLimits[column]) ?? 0;
  const showMoreCards = useAppStore((s) => s.showMoreCards);
  const [loadingMore, setLoadingMore] = useState(false);

  const handleShowMore = async () => {
    setLoadingMore(true);
    try {
      await showMoreCards(column);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    onDragOver?.(e, column);
    // BUG-003 fix: TaskCard.handleDragOver calls stopPropagation, so this
    // column-level handler only fires when the cursor is in empty column space
    // (below the last card, or briefly in the gap between cards). Clear
    // dragOverTaskId so the drop indicator does not stay pinned to the last
    // card the cursor passed over; a subsequent card-level dragover will
    // re-set it. Prevents mispositioned drops in the empty area below all cards.
    onDragOverTask?.(null, true);
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
      className={`flex flex-col sm:bg-surface sm:rounded-xl border-0 sm:border overflow-hidden min-h-[200px] h-full transition-ui duration-fast ${
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
      <div className="hidden sm:flex px-4 py-3 border-b border-border items-center justify-between flex-shrink-0">
        <h2 className="flex items-center gap-2 text-xs font-semibold text-text-secondary uppercase tracking-widest">
          {status && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(status, statuses)}`} aria-hidden="true" />}
          {label}
        </h2>
        <span
          className="ml-2 px-2 py-0.5 text-xs font-mono bg-surface-elevated rounded-full text-text-secondary tabular-nums"
          aria-live="polite"
        >
          {total}
        </span>
      </div>

      {/* Card area */}
      <div
        role="list"
        className="flex-1 p-3 flex flex-col gap-2 overflow-y-auto"
      >
        {tasks.length === 0 ? (
          <EmptyState column={status?.category ?? 'todo'} />
        ) : (
          tasks.map((task, cardIndex) => (
            <TaskCard
              key={task.id}
              task={task}
              column={column}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOverTask={onDragOverTask}
              onKeyboardReorder={onKeyboardReorder}
              isFirstInList={cardIndex === 0}
              isLastInList={cardIndex === tasks.length - 1}
            />
          ))
        )}
        {tasks.length < total && limit < MAX_COLUMN_LIMIT && (
          <div role="listitem" className="shrink-0 flex justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loadingMore}
              onClick={() => { void handleShowMore(); }}
              data-testid="show-more-cards"
            >
              Show more
            </Button>
          </div>
        )}
      </div>
    </section>
  );
});
