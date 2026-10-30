/**
 * Kanban task card — redesigned with three-zone progressive disclosure layout.
 *
 * Zone A (always visible): Badge + title + optional active-run dot + more_vert button.
 * Zone B (always visible, conditional content): assigned avatar + attachment count + description preview.
 * Hover overlay: CardActionMenu (move ← →, run agent, delete) — revealed via CSS group-hover.
 *
 * ADR-1 (redesign-cards): replaces monolithic flat-list layout with progressive disclosure.
 * ADR-002: replaces buildCard() in legacy app.js.
 * ADR-003 §8.4: transition-all ease-apple, done state opacity-50 grayscale-[30%].
 */

import React, { memo, useMemo } from 'react';
import type { Task, Column } from '@/types';
import { CardActionMenu } from '@/components/board/CardActionMenu';
import { useAppStore } from '@/stores/useAppStore';
import { useTaskRunStore } from '@/stores/useTaskRunStore';
import { useDragStore } from '@/stores/useDragStore';
import { Badge } from '@/components/shared/Badge';
import { boardIndex, epicOf, formatDueDate, isOverdue, parentIssueOf, priorityOf, progressOf, typeOf } from '@/utils/issues';
import { plainText } from '@/utils/plainText';
import { TaskRunFooter } from '@/components/runs/TaskRunFooter';

// ---------------------------------------------------------------------------
// Avatar helpers — deterministic gradient + initials from an assigned name
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TaskCardProps {
  task: Task;
  column: Column;
  onDragStart?: (e: React.DragEvent, taskId: string, sourceColumn: Column) => void;
  onDragEnd?: () => void;
  onDragOverTask?: (taskId: string | null, insertBefore: boolean) => void;
  /** A-1: stagger delay in ms for the entrance animation. EXCEPTION: only inline style allowed. */
  staggerDelayMs?: number;
  /**
   * Keyboard/button reorder within the column (Alt+Arrow shortcut, and the
   * CardActionMenu move-up/move-down buttons — shared by the keyboard and
   * touch-reorder features). See ADR-1 keyboard-card-reorder + ADR-1 touch-reorder.
   */
  onKeyboardReorder?: (taskId: string, column: Column, direction: 'up' | 'down') => void;
  /** True when this card is the first in its visible group — disables move-up. */
  isFirstInList?: boolean;
  /** True when this card is the last in its visible group — disables move-down. */
  isLastInList?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// PERF: memo prevents re-renders when the parent Column re-renders (e.g. on
// task list changes). Drag state is now read directly from useDragStore with
// per-card boolean selectors — only this specific card re-renders when its own
// drag state changes, giving O(1) re-renders per drag event.
export const TaskCard = memo(function TaskCard({ task, column, onDragStart, onDragEnd, staggerDelayMs = 0, onDragOverTask, onKeyboardReorder, isFirstInList = false, isLastInList = false }: TaskCardProps) {
  const moveTask          = useAppStore((s) => s.moveTask);
  const deleteTask        = useAppStore((s) => s.deleteTask);
  const openAttachmentModal = useAppStore((s) => s.openAttachmentModal);
  const activeSpaceId     = useAppStore((s) => s.activeSpaceId);
  // Per-task mutation flag — only this card's actions get disabled while its
  // own move/delete is in flight; the rest of the board stays interactive.
  const isMutating        = useAppStore((s) => s.mutatingTaskIds.has(task.id));
  const isActiveTask      = useTaskRunStore((s) => {
    const status = s.views[task.id]?.status;
    return status === 'working' || status === 'checking';
  });
  const openDetailPanel   = useAppStore((s) => s.openDetailPanel);
  const statuses          = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId)?.statuses);
  // Only what this card shows, so that polling does not re-render every card.
  const epicTitle         = useAppStore((s) => epicOf(task, boardIndex(s.tasks))?.title);
  const parentKey         = useAppStore((s) => parentIssueOf(task, boardIndex(s.tasks))?.key);
  const doneChildren      = useAppStore((s) => progressOf(task.id, boardIndex(s.tasks)).done);
  const totalChildren     = useAppStore((s) => progressOf(task.id, boardIndex(s.tasks)).total);

  const isDragging = useDragStore((s) => s.draggedTaskId === task.id);
  const isDragOverThis = useDragStore((s) => s.dragOverTaskId === task.id);
  const insertBeforeThis = useDragStore((s) => s.insertBefore);

  // A card that did not change must still turn red when the day does.
  useAppStore((s) => s.today);

  const isDone = task.category === 'done';
  const isEpic = task.type === 'epic';

  const idx = statuses?.findIndex((s) => s.id === column) ?? -1;
  const leftStatus = idx > 0 ? statuses![idx - 1] : undefined;
  const rightStatus = idx >= 0 && idx < statuses!.length - 1 ? statuses![idx + 1] : undefined;

  const pendingQuestions =
    task.comments?.filter((c) => c.type === 'question' && !c.resolved).length ?? 0;

  const priority = priorityOf(task.priority);
  const type = typeOf(task.type);
  const overdue = isOverdue(task);
  const description = useMemo(() => plainText(task.description ?? ''), [task.description]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const { draggedTaskId } = useDragStore.getState();
    if (!draggedTaskId || draggedTaskId === task.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const insertBefore = relY < rect.height / 2;
    onDragOverTask?.(task.id, insertBefore);
  };

  // Alt+ArrowUp/Down keyboard reorder (ADR-1 keyboard-card-reorder).
  // Only intercepts that exact combo — Tab, Enter, Space, Escape, plain
  // arrows all pass through unchanged so we never trap the keyboard.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) {
      openDetailPanel(task);
      return;
    }
    if (!onKeyboardReorder) return;
    if (!e.altKey) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (isMutating) {
      // Silent no-op — matches disabled button behaviour; do not spam SR.
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onKeyboardReorder(task.id, column, e.key === 'ArrowUp' ? 'up' : 'down');
  };

  const canMoveUp   = !!onKeyboardReorder && !isFirstInList;
  const canMoveDown = !!onKeyboardReorder && !isLastInList;
  const handleMoveUp   = canMoveUp   ? () => onKeyboardReorder!(task.id, column, 'up')   : undefined;
  const handleMoveDown = canMoveDown ? () => onKeyboardReorder!(task.id, column, 'down') : undefined;

  return (
    <article
      role="listitem"
      draggable
      tabIndex={0}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      data-id={task.id}
      data-column={column}
      data-testid="task-card"
      className={[
        'group relative bg-surface rounded-xl border border-border p-3 pl-4 cursor-pointer overflow-hidden',
        'animate-fade-in-up shrink-0',
        // Animate only what changes (transform/shadow/ring/border) instead of `all`,
        // and give a subtle tactile press — the card is clickable (opens the panel).
        'transition-[transform,box-shadow,border-color] duration-fast ease-default',
        'hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(124,109,250,0.15)] hover:ring-1 hover:ring-primary/30',
        'active:scale-[0.99] active:duration-100',
        // 2.4.7 Focus Visible — card had no focus indicator before; :focus-visible
        // so mouse clicks don't show a ring, only real keyboard focus does.
        'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        isDone ? 'opacity-60 grayscale-[25%]' : '',
        isDragging ? 'rotate-1 scale-[0.97] shadow-xl ring-1 ring-primary/40 opacity-80' : '',
        isActiveTask ? 'border-primary/30 animate-glow-pulse' : '',
        isDragOverThis && insertBeforeThis  ? 'border-t-2 border-t-primary ring-0' : '',
        isDragOverThis && !insertBeforeThis ? 'border-b-2 border-b-primary ring-0' : '',
      ].filter(Boolean).join(' ')}
      style={staggerDelayMs > 0 ? { animationDelay: `${staggerDelayMs}ms`, animationFillMode: 'both' } : { animationFillMode: 'both' }}
      aria-grabbed={isDragging}
      onClick={() => openDetailPanel(task)}
      onKeyDown={handleKeyDown}
      onDragStart={(e) => onDragStart?.(e, task.id, column)}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
    >
      <div className="relative">
        {/* Drag handle — visible on hover only, centered in the pl-4 gutter
            and on the body's own height.
            ADR-1 (touch-reorder): coarse-pointer affordance removed — the
            HTML5 drag it hints at does not fire on touch, so showing a grab
            handle there is misleading. Touch/keyboard users get the ↑ / ↓
            step controls in CardActionMenu instead. */}
        <div
          className="absolute -left-4 w-4 top-1/2 -translate-y-1/2 flex justify-center opacity-0 group-hover:opacity-40 transition-opacity duration-fast text-text-secondary cursor-grab active:cursor-grabbing"
          aria-hidden="true"
          data-testid="drag-handle"
        >
          <span className="material-symbols-outlined text-sm leading-none select-none">drag_indicator</span>
        </div>

        {/* ── Priority, key and type ── */}
        <div className="flex items-center gap-1.5">
          <span
            className={`material-symbols-outlined text-base leading-none flex-shrink-0 ${priority.className}`}
            title={`${priority.label} priority`}
            role="img"
            aria-label={`${priority.label} priority`}
            data-testid="priority-icon"
          >
            {priority.icon}
          </span>
          <span className="font-mono text-[11px] font-semibold text-text-secondary" data-testid="issue-key">{task.key}</span>
          {task.dueDate && (
            <span
              className={`ml-1 text-xs ${overdue ? 'text-error font-semibold' : 'text-text-secondary'}`}
              title={overdue ? 'Overdue' : 'Due date'}
              data-testid="due-date"
            >
              {formatDueDate(task.dueDate)}
            </span>
          )}
          <span className="ml-auto flex-shrink-0" data-testid="type-badge">
            <Badge type={task.type} label={type.label} />
          </span>
        </div>

        {/* ── Title ── */}
        <p className="mt-1 text-sm font-semibold text-text-primary leading-snug line-clamp-2">
          {task.title}
        </p>

        {/* ── Description ── */}
        {description && (
          <p className="mt-1 text-xs text-text-secondary leading-relaxed line-clamp-2 break-words" data-testid="desc-preview">
            {description}
          </p>
        )}

        {/* ── Epic, parent, labels ── */}
        {(epicTitle || parentKey || (task.labels?.length ?? 0) > 0) && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap" data-testid="issue-tags">
            {epicTitle && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary truncate max-w-full" data-testid="epic-tag">{epicTitle}</span>
            )}
            {parentKey && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-surface-variant text-text-secondary" data-testid="parent-tag">↳ {parentKey}</span>
            )}
            {task.labels?.map((label) => (
              <span key={label} className="text-[11px] px-2 py-0.5 rounded-full bg-surface-variant text-text-secondary truncate max-w-full">{label}</span>
            ))}
          </div>
        )}

        {/* ── Epic progress ── */}
        {isEpic && totalChildren > 0 && (
          <div className="mt-2.5" data-testid="epic-progress">
            <div className="h-1 rounded-full bg-surface-variant overflow-hidden">
              <progress
                className="block w-full h-1 appearance-none [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
                max={totalChildren}
                value={doneChildren}
                aria-label="Issues done"
              />
            </div>
            <p className="mt-1 text-xs text-text-secondary">{Math.round((doneChildren / totalChildren) * 100)}% · {doneChildren} of {totalChildren} done</p>
          </div>
        )}

        {/* ── Meta row: assigned + sub-tasks + attachments + questions ── */}
        <div className="flex items-center gap-2 mt-2 flex-wrap min-h-5" data-testid="zone-b">
          {/* Assigned / Unassigned */}
          {task.assigned ? (
            <>
              <div
                className={`w-4 h-4 rounded-full bg-gradient-to-br ${getGradient(task.assigned)} flex items-center justify-center text-[7px] font-bold text-white flex-shrink-0`}
                aria-hidden="true"
                data-testid="avatar"
              >
                {getInitials(task.assigned)}
              </div>
              <span className="text-xs text-text-secondary truncate" data-testid="assigned-name">
                {task.assigned}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-text-disabled" data-testid="unassigned-label">
              Unassigned
            </span>
          )}

          {/* Attachments */}
          {task.attachments && task.attachments.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openAttachmentModal(activeSpaceId, task.id, 0, task.attachments![0].name, task.attachments!); }}
              aria-label={`${task.attachments.length} attachment${task.attachments.length !== 1 ? 's' : ''}`}
              title={`${task.attachments.length} attachment${task.attachments.length !== 1 ? 's' : ''}`}
              data-testid="attachment-pill"
              className="inline-flex items-center gap-0.5 text-xs text-text-secondary hover:text-primary transition-colors duration-fast focus:outline-hidden focus:ring-2 focus:ring-primary rounded-sm"
            >
              <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">attachment</span>
              {task.attachments.length}
            </button>
          )}

          {/* Pending questions */}
          {pendingQuestions > 0 && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-warning/[0.15] text-warning leading-none"
              data-testid="pending-questions-badge"
              aria-label={`${pendingQuestions} pending question${pendingQuestions !== 1 ? 's' : ''}`}
            >
              <span className="material-symbols-outlined text-[10px] leading-none" aria-hidden="true">help</span>
              {pendingQuestions}
            </span>
          )}

          {/* Sub-tasks */}
          {!isEpic && totalChildren > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs text-text-secondary" data-testid="subtask-count" title="Sub-tasks done">
              <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">checklist</span>
              {doneChildren}/{totalChildren}
            </span>
          )}

          {/* Blocked badge — QOL-3 dependsOn */}
          {task.isBlocked && !isDone && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-error/[0.12] text-error leading-none"
              data-testid="blocked-badge"
              aria-label={`Blocked by ${task.blockedByCount} task${task.blockedByCount !== 1 ? 's' : ''}`}
            >
              <span className="material-symbols-outlined text-[10px] leading-none" aria-hidden="true">lock</span>
              blocked by {task.blockedByCount}
            </span>
          )}

        </div>

        {/* With touch there is no hover: the actions and the agent share a row at the end of the card. */}
        <div className="[@media(pointer:coarse)]:flex [@media(pointer:coarse)]:flex-wrap [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:justify-end [@media(pointer:coarse)]:gap-2 [@media(pointer:coarse)]:mt-2">
        {/* Action menu — absolute top-right, hover/focus-within only */}
        <div
          data-testid="hover-overlay"
          className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 [@media(pointer:coarse)]:static transition-opacity duration-fast"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-surface-elevated border border-border rounded-md shadow-sm">
            <CardActionMenu
              leftLabel={leftStatus?.name}
              rightLabel={rightStatus?.name}
              isMutating={isMutating}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              onMoveLeft={leftStatus ? () => moveTask(task.id, leftStatus.id) : undefined}
              onMoveRight={rightStatus ? () => moveTask(task.id, rightStatus.id) : undefined}
              onDelete={() => deleteTask(task.id)}
            />
          </div>
        </div>

        {!isEpic && <TaskRunFooter task={task} column={task.category ?? 'todo'} spaceId={activeSpaceId} />}
        </div>
      </div>
    </article>
  );
});
