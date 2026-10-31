/**
 * Kanban board with a column per status of the space.
 * Reads tasks from the Zustand store and renders Column components.
 * ADR-002: replaces renderBoard() + static .board section in legacy app.js.
 */

import React, { useRef, useState, useCallback } from 'react';
import type { Column as ColumnType, Status, Task } from '@/types';
import { useTasks, useAppStore } from '@/stores/useAppStore';
import { useDragStore } from '@/stores/useDragStore';
import { useAnnouncer } from '@/stores/useAnnouncer';
import { Column } from './Column';
import { ColumnTabBar } from './ColumnTabBar';
import { BoardEmptyState } from './BoardEmptyState';
import { Announcer } from '@/components/shared/Announcer';
import { own } from '@/utils/issues';
import { noteDragStart, noteDrop, useCardMotion } from '@/hooks/useCardMotion';

/**
 * Resolve the keyboard-reorder neighbor for a card among those loaded.
 * At the first or last visible card of the column there is none.
 */
export function resolveKeyboardNeighbor(
  visible: Task[],
  taskId: string,
  direction: 'up' | 'down',
): {
  ok: true;
  neighborId: string;
  visibleIndex: number;
  visibleCount: number;
} | {
  ok: false;
  visibleIndex: number;
  visibleCount: number;
} {
  const idx = visible.findIndex((t) => t.id === taskId);
  const visibleCount = visible.length;

  if (idx === -1) {
    return { ok: false, visibleIndex: -1, visibleCount };
  }
  const neighborIdx = idx + (direction === 'up' ? -1 : 1);
  if (neighborIdx < 0 || neighborIdx >= visible.length) {
    return { ok: false, visibleIndex: idx, visibleCount };
  }
  return { ok: true, neighborId: visible[neighborIdx].id, visibleIndex: idx, visibleCount };
}

/**
 * The rank for a card dropped among those loaded. Past either end of them there may be cards
 * that are not loaded, and the drop has to land before those: a Done column shows its last
 * cards, so the first one shown is not the first of the column, and rank 0 would send the
 * card out of sight. `bounds` says where those cards are.
 */
export function computeDropRank(
  tasks: Task[],
  draggedId: string,
  overTaskId: string | null,
  insertBefore: boolean,
  bounds: { rankBefore?: number; rankAfter?: number } = {},
): { newRank: number; needsRebalance: boolean; overId?: string | null; insertBefore?: boolean } {
  const withoutDragged = tasks.filter((t) => t.id !== draggedId);
  // A card brought by id may lie past those bounds, and then they say nothing about its side.
  const firstRank = withoutDragged[0]?.rank ?? 0;
  const lastRank = withoutDragged.at(-1)?.rank ?? 0;
  const floor = bounds.rankBefore !== undefined && (withoutDragged.length === 0 || bounds.rankBefore < firstRank) ? bounds.rankBefore : 0;
  const ceiling = bounds.rankAfter !== undefined && (withoutDragged.length === 0 || bounds.rankAfter > lastRank) ? bounds.rankAfter : Infinity;

  let prevRank = floor;
  let nextRank = ceiling;

  if (overTaskId === null) {
    prevRank = withoutDragged.at(-1)?.rank ?? floor;
    nextRank = ceiling;
  } else {
    const overIdx = withoutDragged.findIndex((t) => t.id === overTaskId);
    if (overIdx === -1) {
      prevRank = withoutDragged.at(-1)?.rank ?? floor;
      nextRank = ceiling;
    } else if (insertBefore) {
      prevRank = overIdx > 0 ? (withoutDragged[overIdx - 1]?.rank ?? 0) : floor;
      nextRank = withoutDragged[overIdx]?.rank ?? ceiling;
    } else {
      prevRank = withoutDragged[overIdx]?.rank ?? 0;
      nextRank = overIdx + 1 < withoutDragged.length
        ? (withoutDragged[overIdx + 1]?.rank ?? ceiling)
        : ceiling;
    }
  }

  const newRank = nextRank === Infinity
    ? prevRank + 1000.0
    : (prevRank + nextRank) / 2;

  const gap = nextRank === Infinity ? Infinity : nextRank - prevRank;

  if (gap < 0.001 && gap !== Infinity) {
    // No room. Only where it goes: the server spreads out the column, which it sees all of.
    const over = overTaskId !== null && withoutDragged.some((t) => t.id === overTaskId) ? overTaskId : null;
    return over !== null
      ? { newRank, needsRebalance: true, overId: over, insertBefore }
      : { newRank, needsRebalance: true, overId: withoutDragged.at(-1)?.id ?? null, insertBefore: false };
  }

  return { newRank, needsRebalance: false };
}

const NO_STATUSES: Status[] = [];
const NO_TASKS: Task[] = [];

export function Board() {
  const tasks = useTasks();
  const moveTask = useAppStore((s) => s.moveTask);
  const reorderTask = useAppStore((s) => s.reorderTask);
  const rebalanceColumn = useAppStore((s) => s.rebalanceColumn);
  const openCreateModal = useAppStore((s) => s.openCreateModal);
  const statuses = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId)?.statuses) ?? NO_STATUSES;
  const columnTotals = useAppStore((s) => s.columnTotals);
  // MB-1: active column for mobile single-column view. A removed status falls back to the first.
  const [chosenColumn, setActiveColumn] = useState<ColumnType | null>(null);
  const activeColumn = statuses.some((s) => s.id === chosenColumn) ? chosenColumn! : statuses[0]?.id;
  const mainRef = useRef<HTMLElement>(null);
  const epicFilter = useAppStore((s) => s.epicFilter);
  // What the cards are of, which is not yet what was asked for until they arrive.
  const boardScope = useAppStore((s) => s.boardScope);
  useCardMotion(mainRef, tasks, boardScope);

  // PERF: All drag handlers read/write via useDragStore.getState() — no
  // subscription, so Board never re-renders from drag events. Only the two
  // TaskCards whose per-card boolean selector changes will re-render.

  const handleDragStart = useCallback((e: React.DragEvent, taskId: string, sourceColumn: ColumnType) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
    noteDragStart(e);
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

    noteDrop(taskId, e);
    useDragStore.getState().resetDrag();

    if (dragSourceColumn === targetColumn) {
      // Same column → reorder
      const { tasks: board, columnBounds } = useAppStore.getState();
      const columnTasks = own(board, targetColumn) ?? [];
      const place = computeDropRank(
        columnTasks, taskId, dragOverTaskId, insertBefore, own(columnBounds, targetColumn),
      );

      if (place.needsRebalance) {
        void rebalanceColumn(targetColumn, taskId, place.overId ?? null, place.insertBefore ?? false);
      } else {
        reorderTask(taskId, targetColumn, place.newRank);
      }
      return;
    }

    moveTask(taskId, targetColumn);
  }, [moveTask, reorderTask, rebalanceColumn]); // stable — Zustand actions never change

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

    const columnTasks = own(state.tasks, targetColumn) ?? [];
    const task = columnTasks.find((t) => t.id === taskId);
    if (!task) return;

    const columnLabel = state.spaces.find((s) => s.id === state.activeSpaceId)?.statuses?.find((s) => s.id === targetColumn)?.name ?? targetColumn;
    const title = task.title;
    const announce = useAnnouncer.getState().announce;

    const resolved = resolveKeyboardNeighbor(columnTasks, taskId, direction);

    if (!resolved.ok) {
      const edge = direction === 'up' ? 'top' : 'bottom';
      announce(`Task "${title}" is already at the ${edge} of ${columnLabel}.`);
      return;
    }

    const place = computeDropRank(
      columnTasks, taskId, resolved.neighborId, /* insertBefore */ direction === 'up', own(state.columnBounds, targetColumn),
    );

    if (place.needsRebalance) {
      void rebalanceColumn(targetColumn, taskId, place.overId ?? null, place.insertBefore ?? false);
    } else {
      reorderTask(taskId, targetColumn, place.newRank);
    }

    // New 1-based position in the (unchanged-length) visible list.
    const newVisibleIndex = direction === 'up' ? resolved.visibleIndex - 1 : resolved.visibleIndex + 1;
    const newPosition = newVisibleIndex + 1;
    announce(
      `Task "${title}" moved to position ${newPosition} of ${resolved.visibleCount} in ${columnLabel}.`
    );
  }, [reorderTask, rebalanceColumn]); // stable — Zustand actions never change

  const taskCounts = Object.fromEntries(statuses.map((s) => [s.id, own(columnTotals, s.id) ?? own(tasks, s.id)?.length ?? 0]));

  // F1/ADR-1: show the onboarding guide when the active space has zero tasks.
  // No persistence — visibility is derived purely from store state. An epic with nothing to
  // show says nothing about the space.
  const isBoardEmpty = epicFilter === null
    && Object.values(tasks).every((list) => list.length === 0)
    && Object.values(columnTotals).every((total) => total === 0);

  if (isBoardEmpty) {
    return (
      <main role="main" className="flex h-full overflow-hidden">
        <BoardEmptyState onCreateTask={openCreateModal} />
      </main>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* MB-1: Tab bar — only visible on mobile (< 640px) */}
      <div className="sm:hidden">
        <ColumnTabBar
          statuses={statuses}
          activeColumn={activeColumn}
          taskCounts={taskCounts}
          onSelect={setActiveColumn}
        />
      </div>

      {/* Shared SR-only aria-live region for keyboard reorder announcements. */}
      <Announcer />

      <main
        ref={mainRef}
        role="main"
        className="flex flex-1 min-h-0 overflow-x-auto overflow-y-hidden"
      >
        <div className="flex gap-4 w-full sm:w-auto sm:p-6 mx-auto sm:min-w-fit h-full">
        {statuses.map(({ id: col }) => (
          <div
            key={col}
            id={`column-panel-${col}`}
            role="tabpanel"
            aria-labelledby={col}
            // MB-1: on mobile only show the active column; on sm+ all are shown
            className={`flex-1 w-full sm:w-72 sm:min-w-64 sm:max-w-96 h-full ${col !== activeColumn ? 'hidden sm:flex' : 'flex'} flex-col`}
          >
            <Column
              column={col}
              status={statuses.find((s) => s.id === col)}
              statuses={statuses}
              tasks={own(tasks, col) ?? NO_TASKS}
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

    </div>
  );
}
