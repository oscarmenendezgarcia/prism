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

import React, { memo } from 'react';
import type { Task, Column } from '@/types';
import { Badge } from '@/components/shared/Badge';
import { arcColor } from '@/utils/arcs';
import { CardActionMenu } from '@/components/board/CardActionMenu';
import { useAppStore, useActiveRun } from '@/stores/useAppStore';
import { useRunHistoryStore } from '@/stores/useRunHistoryStore';
import { useDragStore } from '@/stores/useDragStore';

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
// Column metadata
// ---------------------------------------------------------------------------

const COLUMNS: Column[] = ['todo', 'in-progress', 'done'];

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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// PERF: memo prevents re-renders when the parent Column re-renders (e.g. on
// task list changes). Drag state is now read directly from useDragStore with
// per-card boolean selectors — only this specific card re-renders when its own
// drag state changes, giving O(1) re-renders per drag event.
export const TaskCard = memo(function TaskCard({ task, column, onDragStart, onDragEnd, staggerDelayMs = 0, onDragOverTask }: TaskCardProps) {
  const moveTask          = useAppStore((s) => s.moveTask);
  const deleteTask        = useAppStore((s) => s.deleteTask);
  const openAttachmentModal = useAppStore((s) => s.openAttachmentModal);
  const activeSpaceId     = useAppStore((s) => s.activeSpaceId);
  // Per-task mutation flag — only this card's actions get disabled while its
  // own move/delete is in flight; the rest of the board stays interactive.
  const isMutating        = useAppStore((s) => s.mutatingTaskIds.has(task.id));
  const activeRun         = useActiveRun();
  const openDetailPanel   = useAppStore((s) => s.openDetailPanel);
  const arcGrouping       = useAppStore((s) => s.arcGrouping);
  const openPanelForTask  = useRunHistoryStore((s) => s.openPanelForTask);

  const isDragging = useDragStore((s) => s.draggedTaskId === task.id);
  const isDragOverThis = useDragStore((s) => s.dragOverTaskId === task.id);
  const insertBeforeThis = useDragStore((s) => s.insertBefore);

  const isActiveTask = activeRun?.taskId === task.id;
  const isDone = column === 'done';

  const idx = COLUMNS.indexOf(column);
  const showLeft = idx > 0;
  const showRight = idx < COLUMNS.length - 1;

  const pendingQuestions =
    task.comments?.filter((c) => c.type === 'question' && !c.resolved).length ?? 0;

  const hasMetadata =
    !!task.arc ||
    !!task.assigned ||
    (task.attachments && task.attachments.length > 0) ||
    !!task.description ||
    pendingQuestions > 0;

  // Badge style per type (wireframe S-02, S-03)
  const badgeClass = task.type === 'feature'
    ? 'bg-primary/10 text-primary'
    : task.type === 'bug'
    ? 'bg-error/10 text-error'
    : 'bg-info/10 text-info';


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

  return (
    <article
      role="listitem"
      draggable
      data-id={task.id}
      data-column={column}
      data-testid="task-card"
      className={[
        'group relative bg-surface rounded-xl border border-border p-4 pl-7 cursor-pointer overflow-hidden',
        'animate-fade-in-up shrink-0',
        // Animate only what changes (transform/shadow/ring/border) instead of `all`,
        // and give a subtle tactile press — the card is clickable (opens the panel).
        'transition-[transform,box-shadow,border-color] duration-fast ease-default',
        'hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(124,109,250,0.15)] hover:ring-1 hover:ring-primary/30',
        'active:scale-[0.99] active:duration-100',
        isDone ? 'opacity-50 grayscale-[25%]' : '',
        isDragging ? 'rotate-1 scale-[0.97] shadow-xl ring-1 ring-primary/40 opacity-80' : '',
        isActiveTask ? 'border-primary/30 animate-glow-pulse' : '',
        isDragOverThis && insertBeforeThis  ? 'border-t-2 border-t-primary ring-0' : '',
        isDragOverThis && !insertBeforeThis ? 'border-b-2 border-b-primary ring-0' : '',
      ].filter(Boolean).join(' ')}
      style={staggerDelayMs > 0 ? { animationDelay: `${staggerDelayMs}ms`, animationFillMode: 'both' } : { animationFillMode: 'both' }}
      aria-grabbed={isDragging}
      onClick={() => openDetailPanel(task)}
      onDragStart={(e) => onDragStart?.(e, task.id, column)}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
    >
      {/* Drag handle — visible on hover, left edge */}
      <div
        className="absolute left-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 [@media(pointer:coarse)]:opacity-30 transition-opacity duration-fast text-text-secondary cursor-grab active:cursor-grabbing"
        aria-hidden="true"
      >
        <span className="material-symbols-outlined text-base leading-none select-none">drag_indicator</span>
      </div>

      {/* ── Arc strip (storyline banner) ──
          Full-width tinted band titling the card with its arc, coloured per-arc
          so same-arc cards read as a group at a glance. Hidden while grouping is
          on, since the column's group header already carries the arc. Negative
          margins bleed it to the card edges (article is overflow-hidden so it
          respects the rounded top corners). Rides the card's fade-in entrance. */}
      {task.arc && !arcGrouping && (
        <div
          data-testid="arc-strip"
          className={`-mx-4 -mt-4 mb-3 px-4 py-1.5 text-[11px] font-mono font-semibold uppercase tracking-wider truncate ${arcColor(task.arc)}`}
          title={task.arc}
        >
          {task.arc}
        </div>
      )}

      {/* ── Title ── */}
      <p className="text-sm font-medium text-text-primary leading-snug line-clamp-2">
        {task.title}
      </p>

      {/* ── Meta row: badge + assigned + attachments + questions + action menu ── */}
      <div className="flex items-center gap-2 mt-3 flex-wrap" data-testid="zone-b">
        {/* Badge */}
        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md flex-shrink-0 ${badgeClass}`}>
          <span className="material-symbols-outlined text-[10px] leading-none" aria-hidden="true">
            {task.type === 'feature' ? 'diamond' : task.type === 'bug' ? 'bug_report' : 'science'}
          </span>
          {task.type}
        </span>

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

      </div>

      {/* Action menu — absolute top-right, hover/focus-within only */}
      <div
        data-testid="hover-overlay"
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity duration-fast"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-surface-elevated border border-border rounded-md shadow-sm">
          <CardActionMenu
            taskId={task.id}
            column={column}
            spaceId={activeSpaceId}
            isMutating={isMutating}
            activeRun={activeRun}
            onMoveLeft={showLeft ? () => moveTask(task.id, 'left', column) : undefined}
            onMoveRight={showRight ? () => moveTask(task.id, 'right', column) : undefined}
            onDelete={() => deleteTask(task.id)}
          />
        </div>
      </div>

      {/* ── Description preview ── */}
      {task.description && (
        <p className="mt-2 text-[11px] text-text-disabled line-clamp-2 leading-relaxed" data-testid="desc-preview">
          {task.description}
        </p>
      )}
    </article>
  );
});
