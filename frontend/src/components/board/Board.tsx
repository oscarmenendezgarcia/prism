/**
 * Three-column kanban board.
 * Reads tasks from the Zustand store and renders Column components.
 * ADR-002: replaces renderBoard() + static .board section in legacy app.js.
 */

import React, { useState, useCallback } from 'react';
import type { Column as ColumnType, Task } from '@/types';
import { useTasks, useAppStore } from '@/stores/useAppStore';
import { useDragStore } from '@/stores/useDragStore';
import { useAnnouncer } from '@/stores/useAnnouncer';
import { Column } from './Column';
import { ArcBar } from './ArcBar';
import { ColumnTabBar } from './ColumnTabBar';
import { BoardEmptyState } from './BoardEmptyState';
import { Announcer } from '@/components/shared/Announcer';
import { COLUMNS } from '@/constants/columns';

const COLUMN_LABEL: Record<ColumnType, string> = {
  todo: 'Todo',
  'in-progress': 'In Progress',
  done: 'Done',
};

/**
 * Given the sorted column, produce the visible list respecting the arc
 * filter (matches Column.tsx). Rank math still runs against the full column.
 */
function getVisibleColumnTasks(
  columnTasks: Task[],
  arcFilter: string | null,
): Task[] {
  if (arcFilter === null) return columnTasks;
  return columnTasks.filter((t) => t.arc === arcFilter);
}

/**
 * Resolve the keyboard-reorder neighbor for a card, honouring arc filter
 * and arc grouping (T-005). Returns either the neighbor id or a boundary
 * reason:
 *   - `column` — first/last in the visible column (or card missing)
 *   - `group`  — first/last within the arc group when grouping is on;
 *                moving further would cross into another arc, which would
 *                implicitly reassign `task.arc` (out of scope).
 */
export function resolveKeyboardNeighbor(
  columnTasks: Task[],
  taskId: string,
  arcFilter: string | null,
  arcGrouping: boolean,
  direction: 'up' | 'down',
): {
  ok: true;
  neighborId: string;
  visibleIndex: number;
  visibleCount: number;
} | {
  ok: false;
  reason: 'column' | 'group';
  arcLabel: string | null;
  visibleIndex: number;
  visibleCount: number;
} {
  const visible = getVisibleColumnTasks(columnTasks, arcFilter);
  const idx = visible.findIndex((t) => t.id === taskId);
  const visibleCount = visible.length;

  if (idx === -1) {
    return { ok: false, reason: 'column', arcLabel: null, visibleIndex: -1, visibleCount };
  }
  const step = direction === 'up' ? -1 : 1;
  const neighborIdx = idx + step;
  if (neighborIdx < 0 || neighborIdx >= visible.length) {
    return { ok: false, reason: 'column', arcLabel: null, visibleIndex: idx, visibleCount };
  }
  const current  = visible[idx];
  const neighbor = visible[neighborIdx];

  if (arcGrouping) {
    const currentArc  = current.arc ?? null;
    const neighborArc = neighbor.arc ?? null;
    if (currentArc !== neighborArc) {
      return { ok: false, reason: 'group', arcLabel: currentArc, visibleIndex: idx, visibleCount };
    }
  }

  return { ok: true, neighborId: neighbor.id, visibleIndex: idx, visibleCount };
}

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
  const reorderTasks = useAppStore((s) => s.reorderTasks);
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
        // BUG-fix: batch the rebalance into a single atomic request. Previously
        // this fired N independent PATCHes; a mid-batch failure (network blip,
        // server restart) left the column with a mix of old and new ranks that
        // persisted after reload. `reorderTasks` sends one request wrapped in a
        // SQLite transaction and rolls back the whole column on failure.
        reorderTasks(
          targetColumn,
          rebalancedTasks.map((t) => ({ id: t.id, rank: t.rank ?? 0 })),
        );
      } else {
        reorderTask(taskId, targetColumn, newRank);
      }
      return;
    }

    const direction = COLUMNS.indexOf(targetColumn) > COLUMNS.indexOf(dragSourceColumn) ? 'right' : 'left';
    moveTask(taskId, direction, dragSourceColumn);
  }, [moveTask, reorderTask, reorderTasks]); // stable — Zustand actions never change

  // Safety: if the drag is cancelled (dropped outside any valid target), the
  // browser fires dragend on the source element. Reset to avoid a ghost card.
  const handleDragEnd = useCallback(() => {
    useDragStore.getState().resetDrag();
  }, []); // stable — no closure deps

  // ── Keyboard reorder ─────────────────────────────────────────────────────
  // Alt+Arrow on a focused card or CardActionMenu up/down button (shared by
  // the keyboard-card-reorder and touch-reorder features — see the
  // consolidation note in Column.tsx). Reuses computeDropRank + reorderTask
  // (no new persistence surface). Announces the outcome via the shared
  // aria-live announcer (WCAG 4.1.3). Guarded so a press during an in-flight
  // cross-column move is a silent no-op — matching the button `disabled`
  // state (see wireframes.md — no SR noise for a transient, retryable state).
  const handleKeyboardReorder = useCallback((
    taskId: string,
    targetColumn: ColumnType,
    direction: 'up' | 'down',
  ) => {
    const state = useAppStore.getState();
    if (state.isMutating) return;

    const columnTasks = state.tasks[targetColumn] ?? [];
    const task = columnTasks.find((t) => t.id === taskId);
    if (!task) return;

    const columnLabel = COLUMN_LABEL[targetColumn];
    const title = task.title;
    const announce = useAnnouncer.getState().announce;

    const resolved = resolveKeyboardNeighbor(
      columnTasks, taskId, state.arcFilter, state.arcGrouping, direction,
    );

    if (!resolved.ok) {
      const edge = direction === 'up' ? 'top' : 'bottom';
      if (resolved.reason === 'group' && resolved.arcLabel) {
        announce(
          `Task "${title}" is already at the ${edge} of the "${resolved.arcLabel}" group in ${columnLabel}.`
        );
      } else {
        announce(`Task "${title}" is already at the ${edge} of ${columnLabel}.`);
      }
      return;
    }

    const { newRank, needsRebalance, rebalancedTasks } = computeDropRank(
      columnTasks, taskId, resolved.neighborId, /* insertBefore */ direction === 'up',
    );

    if (needsRebalance && rebalancedTasks) {
      for (const t of rebalancedTasks) {
        reorderTask(t.id, targetColumn, t.rank ?? 0);
      }
    } else {
      reorderTask(taskId, targetColumn, newRank);
    }

    // New 1-based position in the (unchanged-length) visible list.
    const newVisibleIndex = direction === 'up' ? resolved.visibleIndex - 1 : resolved.visibleIndex + 1;
    const newPosition = newVisibleIndex + 1;
    announce(
      `Task "${title}" moved to position ${newPosition} of ${resolved.visibleCount} in ${columnLabel}.`
    );
  }, [reorderTask]); // reorderTask is a stable Zustand action

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

      {/* Shared SR-only aria-live region for keyboard reorder announcements. */}
      <Announcer />

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
              onKeyboardReorder={handleKeyboardReorder}
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
