/**
 * Three-column kanban board.
 * Reads tasks from the Zustand store and renders Column components.
 * ADR-002: replaces renderBoard() + static .board section in legacy app.js.
 */

import React, { useState, useCallback } from 'react';
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
  const [dragSourceColumn, setDragSourceColumn] = useState<ColumnType | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ColumnType | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, taskId: string, sourceColumn: ColumnType) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
    setDraggedTaskId(taskId);
    setDragSourceColumn(sourceColumn);
    setDragOverColumn(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetColumn: ColumnType) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedTaskId) {
      setDragOverColumn(targetColumn);
      setDragOverTaskId(null);
    }
  }, [draggedTaskId]);

  const handleDragOverTask = useCallback((e: React.DragEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedTaskId && draggedTaskId !== taskId) {
      setDragOverTaskId(taskId);
    }
  }, [draggedTaskId]);

  const handleDragLeave = useCallback((e: React.DragEvent, targetColumn: ColumnType) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragOverColumn === targetColumn) {
      setDragOverColumn(null);
      setDragOverTaskId(null);
    }
  }, [dragOverColumn]);

  const handleDragLeaveTask = useCallback((e: React.DragEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragOverTaskId === taskId) {
      setDragOverTaskId(null);
    }
  }, [dragOverTaskId]);

  const handleDrop = useCallback((e: React.DragEvent, targetColumn: ColumnType) => {
    e.preventDefault();
    e.stopPropagation();
    
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId || !dragSourceColumn) {
      setDraggedTaskId(null);
      setDragSourceColumn(null);
      setDragOverColumn(null);
      setDragOverTaskId(null);
      return;
    }

    if (dragSourceColumn === targetColumn) {
      setDraggedTaskId(null);
      setDragSourceColumn(null);
      setDragOverColumn(null);
      setDragOverTaskId(null);
      return;
    }

    const direction = COLUMNS.indexOf(targetColumn) > COLUMNS.indexOf(dragSourceColumn) ? 'right' : 'left';
    moveTask(taskId, direction, dragSourceColumn);
    
    setDraggedTaskId(null);
    setDragSourceColumn(null);
    setDragOverColumn(null);
    setDragOverTaskId(null);
  }, [tasks, dragSourceColumn, moveTask]);

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
        aria-label="New task"
        className="sm:hidden fixed bottom-safe-6 right-6 z-40 w-14 h-14 rounded-full bg-primary text-white shadow-lg hover:bg-primary-hover active:scale-95 transition-all duration-200 ease-spring flex items-center justify-center"
      >
        <span className="material-symbols-outlined text-2xl" aria-hidden="true">add</span>
      </button>
    </>
  );
}
