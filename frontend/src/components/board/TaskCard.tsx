/**
 * Kanban task card.
 * Renders title, type badge, optional description, assigned, timestamps,
 * attachment buttons, move arrows, and delete button.
 * ADR-002: replaces buildCard() in legacy app.js.
 * ADR-003 §8.4: transition-all ease-apple, p-4, gap-2.5, done state opacity-50 grayscale-[30%].
 */

import React from 'react';
import type { Task, Column } from '@/types';
import { Badge } from '@/components/shared/Badge';
import { formatTimestamp } from '@/utils/formatTimestamp';
import { useAppStore, useActiveRun } from '@/stores/useAppStore';
import { AgentLauncherMenu } from '@/components/agent-launcher/AgentLauncherMenu';
import { useRunHistoryStore } from '@/stores/useRunHistoryStore';

const AVATAR_GRADIENTS = [
  'from-indigo-500 to-purple-600',
  'from-emerald-500 to-teal-600',
  'from-orange-400 to-pink-500',
  'from-yellow-400 to-orange-500',
  'from-sky-400 to-blue-600',
  'from-rose-500 to-pink-600',
  'from-violet-500 to-indigo-600',
  'from-green-400 to-emerald-600',
];

function getInitials(name: string): string {
  const parts = name.trim().split(/[\s\-_]+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

const COLUMNS: Column[] = ['todo', 'in-progress', 'done'];

const COLUMN_LABELS: Record<Column, string> = {
  'todo': 'Todo',
  'in-progress': 'In Progress',
  'done': 'Done',
};

interface TaskCardProps {
  task: Task;
  column: Column;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent, taskId: string, sourceColumn: Column) => void;
  onDragOver: (e: React.DragEvent, taskId: string) => void;
  onDragLeave: (e: React.DragEvent, taskId: string) => void;
  onDrop: (e: React.DragEvent, targetColumn: Column) => void;
}

export function TaskCard({ task, column, isDragging, isDragOver, onDragStart, onDragOver, onDragLeave, onDrop }: TaskCardProps) {
  const moveTask = useAppStore((s) => s.moveTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const openAttachmentModal = useAppStore((s) => s.openAttachmentModal);
  const activeSpaceId = useAppStore((s) => s.activeSpaceId);
  const isMutating     = useAppStore((s) => s.isMutating);
  const activeRun      = useActiveRun();
  const openPanelForTask = useRunHistoryStore((s) => s.openPanelForTask);

  const isActiveTask = activeRun?.taskId === task.id;

  const idx = COLUMNS.indexOf(column);
  const showLeft = idx > 0;
  const showRight = idx < COLUMNS.length - 1;

  const wasUpdated =
    task.updatedAt &&
    task.createdAt &&
    new Date(task.updatedAt).getTime() !== new Date(task.createdAt).getTime();

  const isDone = column === 'done';

  return (
    <article
      role="listitem"
      draggable
      data-id={task.id}
      data-column={column}
      className={`relative bg-surface rounded-card border shadow-card hover:shadow-card-hover transition-all duration-200 ease-apple p-4 flex flex-col gap-2.5 ${
        isDone ? 'opacity-50 grayscale-[30%]' : ''
      }${isDragging ? ' opacity-50' : ''}${isDragOver ? ' ring-2 ring-primary' : ''} ${
        isActiveTask ? 'border-[#3b82f6]/40' : 'border-border'
      }`}
      aria-grabbed={isDragging}
      onDragStart={(e) => onDragStart(e, task.id, column)}
      onDragOver={(e) => onDragOver(e, task.id)}
      onDragLeave={(e) => onDragLeave(e, task.id)}
      onDrop={(e) => onDrop(e, column)}
    >
      {/* Active agent run indicator — pulsing dot, click opens run history filtered by this task */}
      {isActiveTask && (
        <button
          onClick={() => openPanelForTask(task.id)}
          aria-label="Agent running — view run history for this task"
          title="Agent running — click to view run history"
          className="absolute top-2 right-2 flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-[#3b82f6]/10 hover:bg-[#3b82f6]/20 transition-colors duration-150 pointer-events-auto z-10"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3b82f6] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#3b82f6]" />
          </span>
          <span className="text-[10px] font-semibold text-[#3b82f6]">Running</span>
        </button>
      )}

      {/* Top: title + badge */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-text-primary leading-snug flex-1">
          {task.title}
        </span>
        <Badge type={task.type} />
      </div>

      {/* Description */}
      {task.description && (
        <p className="text-xs text-text-secondary leading-snug">{task.description}</p>
      )}

      {/* Assigned */}
      {task.assigned && (
        <div className="flex items-center gap-2 mt-0.5">
          <div
            className={`w-5 h-5 rounded-full bg-gradient-to-br ${getGradient(task.assigned)} flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0`}
            aria-hidden="true"
          >
            {getInitials(task.assigned)}
          </div>
          <span className="text-[11px] text-text-secondary truncate">{task.assigned}</span>
        </div>
      )}

      {/* Timestamps */}
      {task.createdAt && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-text-disabled">
            Created: {formatTimestamp(task.createdAt)}
          </span>
          {wasUpdated && (
            <span className="text-[11px] text-text-disabled">
              Updated: {formatTimestamp(task.updatedAt)}
            </span>
          )}
        </div>
      )}

      {/* Attachments */}
      {task.attachments && task.attachments.length > 0 && (
        <div className="pt-2 border-t border-border/60">
          <span className="text-[11px] text-text-disabled mb-1 block">
            Attachments ({task.attachments.length})
          </span>
          <div className="flex flex-wrap gap-1">
            {task.attachments.map((att, i) => (
              <button
                key={i}
                onClick={() => openAttachmentModal(activeSpaceId, task.id, i, att.name)}
                title={att.name}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-primary hover:bg-primary/[0.08] rounded-xs transition-colors duration-150"
              >
                <span
                  className="material-symbols-outlined text-sm leading-none"
                  aria-hidden="true"
                >
                  {att.type === 'file' ? 'folder' : 'attachment'}
                </span>
                <span className="max-w-[120px] truncate">{att.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Card footer: move actions + run agent + delete */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-1">
          {showLeft && (
            <button
              onClick={() => moveTask(task.id, 'left', column)}
              disabled={isMutating}
              aria-label={`Move to ${COLUMN_LABELS[COLUMNS[idx - 1]]}`}
              title={`Move to ${COLUMN_LABELS[COLUMNS[idx - 1]]}`}
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 text-base"
            >
              &#8592;
            </button>
          )}
          {showRight && (
            <button
              onClick={() => moveTask(task.id, 'right', column)}
              disabled={isMutating}
              aria-label={`Move to ${COLUMN_LABELS[COLUMNS[idx + 1]]}`}
              title={`Move to ${COLUMN_LABELS[COLUMNS[idx + 1]]}`}
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-variant hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 text-base"
            >
              &#8594;
            </button>
          )}

          {/* Run Agent button — only on todo cards (agents should not re-run done tasks) */}
          {column === 'todo' && (
            <AgentLauncherMenu
              taskId={task.id}
              spaceId={activeSpaceId}
            />
          )}
        </div>
        <button
          onClick={() => deleteTask(task.id)}
          disabled={isMutating || activeRun !== null}
          aria-label="Delete task"
          title="Delete task"
          className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-error/[0.10] hover:text-error disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 text-sm"
        >
          &#10005;
        </button>
      </div>
    </article>
  );
}
