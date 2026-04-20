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
import { ColumnTabBar } from './ColumnTabBar';

const COLUMNS: ColumnType[] = ['todo', 'in-progress', 'done'];

export function Board() {
  const tasks = useTasks();
  const moveTask = useAppStore((s) => s.moveTask);
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
    const { dragSourceColumn } = useDragStore.getState();

    if (!taskId || !dragSourceColumn) {
      useDragStore.getState().resetDrag();
      return;
    }

    if (dragSourceColumn === targetColumn) {
      useDragStore.getState().resetDrag();
      return;
    }

    const direction = COLUMNS.indexOf(targetColumn) > COLUMNS.indexOf(dragSourceColumn) ? 'right' : 'left';
    moveTask(taskId, direction, dragSourceColumn);
    useDragStore.getState().resetDrag();
  }, [moveTask]); // stable — moveTask is a Zustand action (never changes)

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
