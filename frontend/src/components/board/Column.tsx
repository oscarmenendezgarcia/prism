/**
 * Single kanban column — header (title + count) and card list.
 * ADR-002: replaces #col-todo/in-progress/done static HTML sections.
 * ADR-003 §8.3: bg-transparent, rounded-lg, col.* tokens replace hardcoded hex.
 */

import React, { memo } from 'react';
import type { Task, Column as ColumnType } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import { useDragStore } from '@/stores/useDragStore';
import { TaskCard } from './TaskCard';
import { EmptyState } from './EmptyState';

// Wireframe S-01/S-02: Todo = neutral, In-Progress = violet left accent, Done = green left accent
export const COLUMN_META: Record<ColumnType, { label: string; accentClass: string; colIndex: number }> = {
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
  onDragOverTask?: (taskId: string | null, insertBefore: boolean) => void;
  /** Keyboard/button reorder within a column. See Board.handleKeyboardReorder. */
  onKeyboardReorder?: (taskId: string, column: ColumnType, direction: 'up' | 'down') => void;
}

export const Column = memo(function Column({ column, tasks, onDragStart, onDragOver, onDragLeave, onDragEnd, onDrop, onDragOverTask, onKeyboardReorder }: ColumnProps) {
  const { label, accentClass } = COLUMN_META[column];

  // Subscribe to column-level drag-over — re-renders only when this column's
  // active state changes (2 re-renders max per drag move: prev col + next col).
  const isDragOver    = useDragStore((s) => s.dragOverColumn === column && s.draggedTaskId !== null);
  const arcFilter     = useAppStore((s) => s.arcFilter);
  const arcGrouping   = useAppStore((s) => s.arcGrouping);

  // Filter tasks by arc if a filter is active
  const visibleTasks = arcFilter !== null
    ? tasks.filter((t) => t.arc === arcFilter)
    : tasks;

  // Build groups when grouping is on: tasks with an arc, grouped by arc, then ungrouped tasks last
  const groups: { arc: string | null; tasks: Task[] }[] = arcGrouping
    ? (() => {
        const grouped = new Map<string, Task[]>();
        const ungrouped: Task[] = [];
        for (const t of visibleTasks) {
          if (t.arc) {
            if (!grouped.has(t.arc)) grouped.set(t.arc, []);
            grouped.get(t.arc)!.push(t);
          } else {
            ungrouped.push(t);
          }
        }
        const result: { arc: string | null; tasks: Task[] }[] = [];
        for (const [arc, ts] of grouped) result.push({ arc, tasks: ts });
        if (ungrouped.length > 0) result.push({ arc: null, tasks: ungrouped });
        return result;
      })()
    : [{ arc: null, tasks: visibleTasks }];

  // Stagger index is global across groups — precompute each group's start offset
  // once instead of re-reducing all prior groups for every card.
  const groupOffsets: number[] = [];
  groups.reduce((acc, g, i) => { groupOffsets[i] = acc; return acc + g.tasks.length; }, 0);

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
          {visibleTasks.length}
        </span>
      </div>

      {/* Card area */}
      <div
        role="list"
        className="flex-1 p-3 flex flex-col gap-2 overflow-y-auto pb-20 sm:pb-3"
      >
        {visibleTasks.length === 0 ? (
          <EmptyState column={column} />
        ) : (
          groups.map((group, groupIdx) => (
            <React.Fragment key={group.arc ?? '__ungrouped'}>
              {/* Arc group header — only rendered when grouping is on and there's an arc label */}
              {arcGrouping && group.arc && (
                <div
                  className="flex items-center gap-2 mt-2 mb-1 first:mt-0"
                  aria-label={`Arc group: ${group.arc}`}
                >
                  <span className="text-[10px] font-mono font-semibold text-text-tertiary uppercase tracking-widest">
                    {group.arc}
                  </span>
                  <div className="flex-1 h-px bg-border/50" />
                </div>
              )}
              {group.tasks.map((task, cardIndex) => {
                const globalIndex = groupOffsets[groupIdx] + cardIndex;
                const staggerMs = tasks.length > 30
                  ? 0
                  : Math.min(COLUMN_META[column].colIndex * 100 + globalIndex * 35, 500);
                // Boundary flags are local to the visible group when grouping
                // is on, and to the whole visible column otherwise — matching
                // resolveKeyboardNeighbor's arc-group constraint (T-005).
                const isFirstInList = cardIndex === 0;
                const isLastInList  = cardIndex === group.tasks.length - 1;
                return (
                  <TaskCard
                    key={task.id}
                    task={task}
                    column={column}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    staggerDelayMs={staggerMs}
                    onDragOverTask={onDragOverTask}
                    onKeyboardReorder={onKeyboardReorder}
                    isFirstInList={isFirstInList}
                    isLastInList={isLastInList}
                  />
                );
              })}
            </React.Fragment>
          ))
        )}
      </div>
    </section>
  );
});
