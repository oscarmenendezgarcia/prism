/**
 * Three-column kanban board.
 * Reads tasks from the Zustand store and renders Column components.
 * ADR-002: replaces renderBoard() + static .board section in legacy app.js.
 */

import React, { useState, useCallback, useRef } from 'react';
import type { Column as ColumnType } from '@/types';
import { useTasks, useAppStore } from '@/stores/useAppStore';
import { Column } from './Column';
import { ColumnTabBar } from './ColumnTabBar';

const COLUMNS: ColumnType[] = ['todo', 'in-progress', 'done'];

export function Board() {
  const tasks = useTasks();
  const moveTask = useAppStore((s) => s.moveTask);
  const openCreateModal = useAppStore((s) => s.openCreateModal);
  // MB-1: active column for mobile single-column view
  const [activeColumn, setActiveColumn] = useState<ColumnType>('todo');
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);

  // Refs mirror the state values so stable useCallback closures can read the
  // latest value without being listed as deps (avoids recreating callbacks on
  // every drag event, which would force all Column/TaskCard children to re-render).
  const draggedTaskIdRef = useRef<string | null>(null);
  const dragSourceColumnRef = useRef<ColumnType | null>(null);
  const dragOverTaskIdRef = useRef<string | null>(null);

  /** Clears all drag state atomically — called on drop and on drag-cancel. */
  const resetDragState = useCallback(() => {
    draggedTaskIdRef.current = null;
    dragSourceColumnRef.current = null;
    dragOverTaskIdRef.current = null;
    setDraggedTaskId(null);
    setDragOverTaskId(null);
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, taskId: string, sourceColumn: ColumnType) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
    draggedTaskIdRef.current = taskId;
    dragSourceColumnRef.current = sourceColumn;
    setDraggedTaskId(taskId);
  }, []);

  // PERF: reads draggedTaskId via ref so dep array is stable ([] instead of
  // [draggedTaskId]). Without this, handleDragOver was recreated each time
  // drag started, cascading re-renders into all Column children.
  const handleDragOver = useCallback((e: React.DragEvent, _targetColumn: ColumnType) => {
    e.preventDefault();
    e.stopPropagation();
    // Guard: only accept events while a drag is active.
    if (!draggedTaskIdRef.current) return;
    // Clear per-card highlight when hovering the column container directly.
    if (dragOverTaskIdRef.current !== null) {
      dragOverTaskIdRef.current = null;
      setDragOverTaskId(null);
    }
  }, []); // stable — no closure deps

  // PERF: same stabilisation pattern as handleDragOver.
  const handleDragOverTask = useCallback((e: React.DragEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedTaskIdRef.current && draggedTaskIdRef.current !== taskId) {
      if (dragOverTaskIdRef.current !== taskId) {
        dragOverTaskIdRef.current = taskId;
        setDragOverTaskId(taskId);
      }
    }
  }, []); // stable — no closure deps

  // PERF: use relatedTarget to detect genuine column-exit vs child-to-child
  // movement. No closure over mutable state → stable dep array.
  const handleDragLeave = useCallback((e: React.DragEvent, _targetColumn: ColumnType) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      dragOverTaskIdRef.current = null;
      setDragOverTaskId(null);
    }
  }, []); // stable — no closure deps

  // PERF: reads dragOverTaskId via ref — was previously [dragOverTaskId] which
  // caused handleDragLeaveTask to be recreated on every card-hover change.
  const handleDragLeaveTask = useCallback((e: React.DragEvent, taskId: string) => {
    e.stopPropagation();
    if (dragOverTaskIdRef.current === taskId) {
      dragOverTaskIdRef.current = null;
      setDragOverTaskId(null);
    }
  }, []); // stable — no closure deps

  // PERF: `tasks` removed from dep array — it was never read inside this
  // handler, causing an unnecessary recreation on every board poll cycle.
  // `dragSourceColumn` moved to ref so this is now stable for the session.
  const handleDrop = useCallback((e: React.DragEvent, targetColumn: ColumnType) => {
    e.preventDefault();
    e.stopPropagation();

    const taskId = e.dataTransfer.getData('text/plain');
    const sourceColumn = dragSourceColumnRef.current;

    if (!taskId || !sourceColumn) {
      resetDragState();
      return;
    }

    if (sourceColumn === targetColumn) {
      resetDragState();
      return;
    }

    const direction = COLUMNS.indexOf(targetColumn) > COLUMNS.indexOf(sourceColumn) ? 'right' : 'left';
    moveTask(taskId, direction, sourceColumn);
    resetDragState();
  }, [moveTask, resetDragState]); // stable — moveTask is a Zustand action (never changes)

  // Safety: if the drag is cancelled (dropped outside any valid target), the
  // browser fires dragend on the source element. Reset state to avoid a ghost
  // "dragging" card being stuck in the UI.
  const handleDragEnd = useCallback(() => {
    resetDragState();
  }, [resetDragState]);

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
        className="flex gap-4 p-6 h-full overflow-x-auto overflow-y-hidden"
      >
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
              onDragOverTask={handleDragOverTask}
              onDragLeave={handleDragLeave}
              onDragLeaveTask={handleDragLeaveTask}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
              draggedTaskId={draggedTaskId}
              dragOverTaskId={dragOverTaskId}
            />
          </div>
        ))}
      </main>

      {/* MB-2: FAB — only visible on mobile (< 640px), fixed bottom-right with safe-area */}
      <button
        type="button"
        onClick={openCreateModal}
        aria-label="Create new task"
        className="sm:hidden fixed bottom-safe-6 right-6 z-40 w-14 h-14 rounded-full bg-primary text-white shadow-lg hover:bg-primary-hover active:scale-95 transition-all duration-200 ease-spring flex items-center justify-center"
      >
        <span className="material-symbols-outlined text-2xl" aria-hidden="true">add</span>
      </button>
    </>
  );
}
