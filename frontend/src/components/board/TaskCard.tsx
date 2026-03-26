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

import React, { useRef, useState } from 'react';
import type { Task, Column } from '@/types';
import { Badge } from '@/components/shared/Badge';
import { ContextMenu } from '@/components/shared/ContextMenu';
import type { ContextMenuItem } from '@/components/shared/ContextMenu';
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

const COLUMN_LABELS: Record<Column, string> = {
  'todo': 'Todo',
  'in-progress': 'In Progress',
  'done': 'Done',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskCard({ task, column, isDragging, isDragOver, onDragStart, onDragOver, onDragLeave, onDrop }: TaskCardProps) {
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

  // more_vert context-menu state
  const moreVertRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchorRect, setMenuAnchorRect] = useState<DOMRect | null>(null);

  const hasMetadata =
    !!task.assigned ||
    (task.attachments && task.attachments.length > 0) ||
    !!task.description;

  // -----------------------------------------------------------------------
  // Context menu items (same actions as hover overlay)
  // -----------------------------------------------------------------------
  const contextMenuItems: ContextMenuItem[] = [
    ...(showLeft ? [{
      id: 'move-left',
      label: `Move to ${COLUMN_LABELS[COLUMNS[idx - 1]]}`,
      icon: 'arrow_back',
      disabled: isMutating,
    }] : []),
    ...(showRight ? [{
      id: 'move-right',
      label: `Move to ${COLUMN_LABELS[COLUMNS[idx + 1]]}`,
      icon: 'arrow_forward',
      disabled: isMutating,
    }] : []),
    ...(column === 'todo' ? [{
      id: 'run-agent',
      label: 'Run Agent',
      icon: 'smart_toy',
      disabled: activeRun !== null,
    }] : []),
    {
      id: 'delete',
      label: 'Delete',
      icon: 'delete',
      danger: true,
      disabled: isMutating || activeRun !== null,
    },
  ];

  function handleContextMenuSelect(id: string) {
    if (id === 'move-left') moveTask(task.id, 'left', column);
    else if (id === 'move-right') moveTask(task.id, 'right', column);
    else if (id === 'delete') deleteTask(task.id);
    // 'run-agent' is handled by AgentLauncherMenu inside CardActionMenu — not via ContextMenu
  }

  function handleMoreVertClick(e: React.MouseEvent) {
    e.stopPropagation();
    const rect = moreVertRef.current?.getBoundingClientRect() ?? null;
    setMenuAnchorRect(rect);
    setMenuOpen(true);
  }

  return (
    <article
      role="listitem"
      draggable
      data-id={task.id}
      data-column={column}
      className={[
        'group relative bg-surface rounded-card border shadow-card hover:shadow-card-hover',
        'transition-all duration-200 ease-apple p-3 flex flex-col gap-2',
        isDone ? 'opacity-50 grayscale-[30%]' : '',
        isDragging ? 'opacity-50' : '',
        isDragOver ? 'ring-2 ring-primary' : '',
        isActiveTask ? 'border-[#3b82f6]/40' : 'border-border',
      ].filter(Boolean).join(' ')}
      aria-grabbed={isDragging}
      onDragStart={(e) => onDragStart(e, task.id, column)}
      onDragOver={(e) => onDragOver(e, task.id)}
      onDragLeave={(e) => onDragLeave(e, task.id)}
      onDrop={(e) => onDrop(e, column)}
    >

      {/* ------------------------------------------------------------------ */}
      {/* ZONE A — Identity: Badge + title + optional run dot + more_vert     */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex items-start gap-2">
        <Badge type={task.type} />

        {/* Title — clickable to open the detail panel. ADR-1: line-clamp-2 */}
        <button
          type="button"
          onClick={() => openDetailPanel(task)}
          className="flex-1 min-w-0 text-sm font-medium text-text-primary leading-snug line-clamp-2 text-left cursor-pointer hover:text-primary transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary rounded-sm"
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
            className="flex-shrink-0 flex items-center justify-center w-4 h-4 focus:outline-none focus:ring-2 focus:ring-primary rounded-full"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3b82f6] opacity-75" aria-hidden="true" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#3b82f6]" aria-hidden="true" />
            </span>
          </button>
        )}

        {/* more_vert — always visible; anchors the ContextMenu */}
        <button
          ref={moreVertRef}
          type="button"
          onClick={handleMoreVertClick}
          onDragStart={(e) => e.stopPropagation()}
          aria-label="Task actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-sm text-text-secondary hover:text-primary hover:bg-surface-variant transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
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
              onClick={() => openAttachmentModal(activeSpaceId, task.id, 0, task.attachments![0].name)}
              aria-label={`${task.attachments.length} attachment${task.attachments.length !== 1 ? 's' : ''}`}
              title={`${task.attachments.length} attachment${task.attachments.length !== 1 ? 's' : ''}`}
              data-testid="attachment-pill"
              className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-text-secondary hover:text-primary transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary rounded-sm"
            >
              <span className="material-symbols-outlined text-[14px] leading-none" aria-hidden="true">
                attachment
              </span>
              {task.attachments.length}
            </button>
          )}

          {task.description && (
            <p className="w-full text-[11px] text-text-secondary/70 line-clamp-1" data-testid="desc-preview">
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
      <div
        data-testid="hover-overlay"
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity duration-150 ease-apple bg-surface-elevated border border-border rounded-md shadow-sm"
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

      {/* ------------------------------------------------------------------ */}
      {/* CONTEXT MENU — opened via more_vert button                          */}
      {/* ------------------------------------------------------------------ */}
      <ContextMenu
        open={menuOpen}
        anchorRect={menuAnchorRect}
        items={contextMenuItems}
        onSelect={handleContextMenuSelect}
        onClose={() => setMenuOpen(false)}
      />
    </article>
  );
}
