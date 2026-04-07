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
import { CardActionMenu } from '@/components/board/CardActionMenu';
import { useAppStore, useActiveRun } from '@/stores/useAppStore';
import { useRunHistoryStore } from '@/stores/useRunHistoryStore';

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
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: (e: React.DragEvent, taskId: string, sourceColumn: Column) => void;
  onDragOver?: (e: React.DragEvent, taskId: string) => void;
  onDragLeave?: (e: React.DragEvent, taskId: string) => void;
  /** Called when drag ends (drop or cancel). Lets Board reset drag state. */
  onDragEnd?: () => void;
  onDrop?: (e: React.DragEvent, targetColumn: Column) => void;
  /** A-1: stagger delay in ms for the entrance animation. EXCEPTION: only inline style allowed. */
  staggerDelayMs?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// PERF: memo prevents re-renders when sibling cards' drag state changes.
// Since all callbacks are now stable (useCallback with [] deps in Board), and
// isDragging/isDragOver only change for the specific card involved, React.memo
// cuts per-drag-event renders from O(n_all_cards) to O(1).
export const TaskCard = memo(function TaskCard({ task, column, isDragging = false, isDragOver = false, onDragStart, onDragOver, onDragLeave, onDragEnd, onDrop, staggerDelayMs = 0 }: TaskCardProps) {
  const moveTask          = useAppStore((s) => s.moveTask);
  const deleteTask        = useAppStore((s) => s.deleteTask);
  const openAttachmentModal = useAppStore((s) => s.openAttachmentModal);
  const activeSpaceId     = useAppStore((s) => s.activeSpaceId);
  const isMutating        = useAppStore((s) => s.isMutating);
  const activeRun         = useActiveRun();
  const openDetailPanel   = useAppStore((s) => s.openDetailPanel);
  const openPanelForTask  = useRunHistoryStore((s) => s.openPanelForTask);

  const isActiveTask = activeRun?.taskId === task.id;
  const isDone = column === 'done';

  const idx = COLUMNS.indexOf(column);
  const showLeft = idx > 0;
  const showRight = idx < COLUMNS.length - 1;

  const hasMetadata =
    !!task.assigned ||
    (task.attachments && task.attachments.length > 0) ||
    !!task.description;

  return (
    <article
      role="listitem"
      draggable
      data-id={task.id}
      data-column={column}
      data-testid="task-card"
      className={[
        'group relative bg-surface rounded-card border shadow-card hover:shadow-card-hover',
        // A-1: entrance fade-in-up; A-2: hover lifts card via translateY
        'animate-fade-in-up hover:-translate-y-0.5',
        'transition-all duration-200 ease-apple p-3 flex flex-col gap-2',
        // shrink-0: prevent flex-shrink in overflow-y-auto column from collapsing card height
        // MB-3: minimum 44px touch target + press scale feedback on coarse pointer
        'shrink-0 min-h-[44px] [@media(pointer:coarse)]:active:scale-[0.98]',
        isDone ? 'opacity-50 grayscale-[30%]' : '',
        isDragging ? 'opacity-50' : '',
        isDragOver ? 'ring-2 ring-primary' : '',
        isActiveTask ? 'border-[#3b82f6]/40' : 'border-border',
      ].filter(Boolean).join(' ')}
      // A-1: EXCEPTION — dynamic stagger delay requires inline style
      style={staggerDelayMs > 0 ? { animationDelay: `${staggerDelayMs}ms`, animationFillMode: 'both' } : { animationFillMode: 'both' }}
      aria-grabbed={isDragging}
      onDragStart={(e) => onDragStart?.(e, task.id, column)}
      onDragOver={(e) => onDragOver?.(e, task.id)}
      onDragLeave={(e) => onDragLeave?.(e, task.id)}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDrop?.(e, column)}
    >

      {/* ------------------------------------------------------------------ */}
      {/* ZONE A — Identity: Badge + title + optional run dot + more_vert     */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-baseline gap-2">
        <Badge type={task.type} />

        {/* Title — clickable to open the detail panel. ADR-1: line-clamp-2 */}
        <button
          type="button"
          onClick={() => openDetailPanel(task)}
          className="flex-1 min-w-0 text-sm font-medium text-text-primary leading-snug line-clamp-2 text-left cursor-pointer hover:text-primary transition-colors duration-150 focus:outline-hidden focus:ring-2 focus:ring-primary rounded-sm"
        >
          {task.title}
        </button>

        {/* Active run indicator — 6px pulsing dot. Only visible when this task is running. */}
        {isActiveTask && (
          <button
            type="button"
            onClick={() => openPanelForTask(task.id)}
            aria-label="Agent running — view run history"
            title="Agent running — click to view run history"
            className="flex-shrink-0 flex items-center justify-center w-4 h-4 focus:outline-hidden focus:ring-2 focus:ring-primary rounded-full"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3b82f6] opacity-75" aria-hidden="true" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#3b82f6]" aria-hidden="true" />
            </span>
          </button>
        )}

        {/* more_vert button — always visible, opens the card action context menu */}
        <button
          type="button"
          aria-label="Task actions"
          aria-haspopup="menu"
          className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-sm text-text-secondary opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:text-text-primary hover:bg-surface-variant transition-all duration-150 focus:outline-hidden focus:ring-2 focus:ring-primary focus:opacity-100"
        >
          <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">
            more_vert
          </span>
        </button>

      </div>

      {/* ------------------------------------------------------------------ */}
      {/* ZONE B — Metadata: assigned avatar + attachment count + description */}
      {/* Only rendered when at least one piece of metadata is present.       */}
      {/* ------------------------------------------------------------------ */}
      {hasMetadata && (
        <div className="flex items-center gap-2 min-h-0 flex-wrap" data-testid="zone-b">
          {task.assigned && (
            <>
              <div
                className={`w-5 h-5 rounded-full bg-gradient-to-br ${getGradient(task.assigned)} flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0`}
                aria-hidden="true"
                data-testid="avatar"
              >
                {getInitials(task.assigned)}
              </div>
              <span className="text-[11px] text-text-secondary truncate" data-testid="assigned-name">
                {task.assigned}
              </span>
            </>
          )}

          {task.attachments && task.attachments.length > 0 && (
            <button
              type="button"
              onClick={() => openAttachmentModal(activeSpaceId, task.id, 0, task.attachments![0].name, task.attachments!)}
              aria-label={`${task.attachments.length} attachment${task.attachments.length !== 1 ? 's' : ''}`}
              title={`${task.attachments.length} attachment${task.attachments.length !== 1 ? 's' : ''}`}
              data-testid="attachment-pill"
              className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-text-secondary hover:text-primary transition-colors duration-150 focus:outline-hidden focus:ring-2 focus:ring-primary rounded-sm"
            >
              <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">
                attachment
              </span>
              {task.attachments.length}
            </button>
          )}

          {task.description && (
            <p className="w-full text-[11px] text-text-secondary/70 line-clamp-3" data-testid="desc-preview">
              {task.description}
            </p>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* HOVER OVERLAY — CardActionMenu                                      */}
      {/* Hidden at rest; revealed on group-hover (CSS only, no JS handlers). */}
      {/* Always visible on coarse-pointer (touch) devices.                   */}
      {/* ADR-1: absolute top-2 right-2 z-10, pure CSS group-hover approach.  */}
      {/* ------------------------------------------------------------------ */}
      {/* A-2: overlay reveals with scale-in animation on group-hover */}
      <div
        data-testid="hover-overlay"
        className="absolute top-2 right-2 z-10 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-hover:animate-hover-overlay-in [@media(pointer:coarse)]:opacity-100 [@media(pointer:coarse)]:pointer-events-auto transition-opacity duration-150 ease-apple bg-surface-elevated border border-border rounded-md shadow-sm"
        aria-hidden="true"
      >
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

    </article>
  );
});
