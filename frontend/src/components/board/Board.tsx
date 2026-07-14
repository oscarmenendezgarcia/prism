/**
 * Three-column kanban board.
 * Reads tasks from the Zustand store and renders Column components.
 * ADR-002: replaces renderBoard() + static .board section in legacy app.js.
 */

import React, { useState, useCallback } from 'react';
import type { Column as ColumnType } from '@/types';
import { useTasks, useAppStore } from '@/stores/useAppStore';
import { useDragStore } from '@/stores/useDragStore';
import { Column } from './Column';
import { ArcBar } from './ArcBar';
import { ColumnTabBar } from './ColumnTabBar';
import { BoardEmptyState } from './BoardEmptyState';

const COLUMNS: ColumnType[] = ['todo', 'in-progress', 'done'];

function computeDropRank(
  tasks: import('@/types').Task[],
  draggedId: string,
  overTaskId: string | null,
  insertBefore: boolean,
): { newRank: number; needsRebalance: boolean; rebalancedTasks?: import('@/types').Task[] } {
  const withoutDragged = tasks.filter((t) => t.id !== draggedId);

  let prevRank = 0;
  let nextRank = Infinity;

  if (overTaskId === null) {
    prevRank = withoutDragged.at(-1)?.rank ?? 0;
    nextRank = Infinity;
  } else {
    const overIdx = withoutDragged.findIndex((t) => t.id === overTaskId);
    if (overIdx === -1) {
      prevRank = withoutDragged.at(-1)?.rank ?? 0;
      nextRank = Infinity;
    } else if (insertBefore) {
      prevRank = overIdx > 0 ? (withoutDragged[overIdx - 1]?.rank ?? 0) : 0;
      nextRank = withoutDragged[overIdx]?.rank ?? Infinity;
    } else {
      prevRank = withoutDragged[overIdx]?.rank ?? 0;
      nextRank = overIdx + 1 < withoutDragged.length
        ? (withoutDragged[overIdx + 1]?.rank ?? Infinity)
        : Infinity;
    }
  }

  const newRank = nextRank === Infinity
    ? prevRank + 1000.0
    : (prevRank + nextRank) / 2;

  const gap = nextRank === Infinity ? Infinity : nextRank - prevRank;

  if (gap < 0.001 && gap !== Infinity) {
    const reinserted = [...withoutDragged];
    let insertAt = overTaskId === null
      ? reinserted.length
      : insertBefore
        ? reinserted.findIndex((t) => t.id === overTaskId)
        : reinserted.findIndex((t) => t.id === overTaskId) + 1;
    if (insertAt < 0) insertAt = reinserted.length;
    const dragged = tasks.find((t) => t.id === draggedId);
    if (dragged) reinserted.splice(insertAt, 0, dragged);
    const rebalancedTasks = reinserted.map((t, i) => ({ ...t, rank: (i + 1) * 1000.0 }));
    const draggedNewRank = rebalancedTasks.find((t) => t.id === draggedId)?.rank ?? newRank;
    return { newRank: draggedNewRank, needsRebalance: true, rebalancedTasks };
  }

  return { newRank, needsRebalance: false };
}

export function Board() {
  const tasks = useTasks();
  const moveTask = useAppStore((s) => s.moveTask);
  const reorderTask = useAppStore((s) => s.reorderTask);
  const openCreateModal = useAppStore((s) => s.openCreateModal);
  // MB-1: active column for mobile single-column view
  const [activeColumn, setActiveColumn] = useState<ColumnType>('todo');

  // PERF: All drag handlers read/write via useDragStore.getState() — no
  // subscription, so Board never re-renders from drag events. Only the two
  // TaskCards whose per-card boolean selector changes will re-render.

  const handleDragStart = useCallback((e: React.DragEvent, taskId: string, sourceColumn: ColumnType) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
    useDragStore.getState().startDrag(taskId, sourceColumn);
  }, []); // stable — getState() never changes


  const handleDragOverTask = useCallback((taskId: string | null, insertBefore: boolean) => {
    useDragStore.getState().setDragOverTask(taskId, insertBefore);
  }, []); // stable — getState() never changes

  const handleDragOver = useCallback((e: React.DragEvent, targetColumn: ColumnType) => {
    e.preventDefault();
    e.stopPropagation();
    if (!useDragStore.getState().draggedTaskId) return;
    if (useDragStore.getState().dragOverColumn !== targetColumn) {
      useDragStore.getState().setDragOver(targetColumn);
    }
  }, []); // stable — no closure deps

  // Use relatedTarget to detect genuine column-exit vs child-to-child movement.
  const handleDragLeave = useCallback((e: React.DragEvent, _targetColumn: ColumnType) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      useDragStore.getState().setDragOver(null);
    }
  }, []); // stable — no closure deps

  const handleDrop = useCallback((e: React.DragEvent, targetColumn: ColumnType) => {
    e.preventDefault();
    e.stopPropagation();

    const taskId = e.dataTransfer.getData('text/plain');
    const { dragSourceColumn, dragOverTaskId, insertBefore } = useDragStore.getState();

    if (!taskId || !dragSourceColumn) {
      useDragStore.getState().resetDrag();
      return;
    }

    useDragStore.getState().resetDrag();

    if (dragSourceColumn === targetColumn) {
      // Same column → reorder
      const columnTasks = useAppStore.getState().tasks[targetColumn] ?? [];
      const { newRank, needsRebalance, rebalancedTasks } = computeDropRank(
        columnTasks, taskId, dragOverTaskId, insertBefore
      );

      if (needsRebalance && rebalancedTasks) {
        for (const t of rebalancedTasks) {
          reorderTask(t.id, targetColumn, t.rank ?? 0);
        }
      } else {
        reorderTask(taskId, targetColumn, newRank);
      }
      return;
    }

    const direction = COLUMNS.indexOf(targetColumn) > COLUMNS.indexOf(dragSourceColumn) ? 'right' : 'left';
    moveTask(taskId, direction, dragSourceColumn);
  }, [moveTask, reorderTask]); // stable — Zustand actions never change

  // Safety: if the drag is cancelled (dropped outside any valid target), the
  // browser fires dragend on the source element. Reset to avoid a ghost card.
  const handleDragEnd = useCallback(() => {
    useDragStore.getState().resetDrag();
  }, []); // stable — no closure deps

  const taskCounts = {
    todo: (tasks.todo || []).length,
    'in-progress': (tasks['in-progress'] || []).length,
    done: (tasks.done || []).length,
  };

  // F1/ADR-1: show the onboarding guide when the active space has zero tasks.
  // No persistence — visibility is derived purely from store state.
  const isBoardEmpty =
    (tasks.todo?.length ?? 0) === 0 &&
    (tasks['in-progress']?.length ?? 0) === 0 &&
    (tasks.done?.length ?? 0) === 0;

  if (isBoardEmpty) {
    return (
      <main role="main" className="flex h-full overflow-hidden">
        <BoardEmptyState onCreateTask={openCreateModal} />
      </main>
    );
  }

  return (
    <>
      {/* MB-1: Tab bar — only visible on mobile (< 640px) */}
      <div className="sm:hidden">
        <ColumnTabBar
          activeColumn={activeColumn}
          taskCounts={taskCounts}
          onSelect={setActiveColumn}
        />
      </div>

      {/* Arc filter / grouping bar */}
      <ArcBar />

      <main
        role="main"
        className="flex h-full overflow-x-auto overflow-y-hidden"
      >
        <div className="flex gap-4 p-6 mx-auto min-w-fit h-full">
        {COLUMNS.map((col) => (
          <div
            key={col}
            id={`column-panel-${col}`}
            role="tabpanel"
            aria-labelledby={col}
            // MB-1: on mobile only show the active column; on sm+ all are shown
            className={`flex-1 min-w-64 max-w-96 h-full ${col !== activeColumn ? 'hidden sm:flex' : 'flex'} flex-col`}
          >
            <Column
              column={col}
              tasks={tasks[col] || []}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
              onDragOverTask={handleDragOverTask}
            />
          </div>
        ))}
        </div>
      </main>

      {/* MB-2: FAB — only visible on mobile (< 640px), fixed bottom-left with safe-area */}
      <button
        type="button"
        onClick={openCreateModal}
        aria-label="Create new task"
        className="sm:hidden fixed bottom-safe-6 left-6 z-40 w-14 h-14 rounded-full bg-primary text-white shadow-lg hover:bg-primary-hover active:scale-95 transition-all duration-200 ease-spring flex items-center justify-center"
      >
        <span className="material-symbols-outlined text-2xl" aria-hidden="true">add</span>
      </button>
    </>
  );
}
