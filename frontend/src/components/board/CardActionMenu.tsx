/**
 * CardActionMenu — hover overlay toolbar for TaskCard.
 *
 * Renders move-left, move-right, run agent, and delete buttons in a compact
 * horizontal strip. Composed into TaskCard as the absolutely-positioned hover
 * overlay. Also used to populate the more_vert ContextMenu item list.
 *
 * ADR-1 (redesign-cards) §3.2: extracted action toolbar, independently testable.
 */

import React from 'react';
import type { Column, AgentRun } from '@/types';
import { AgentLauncherMenu } from '@/components/agent-launcher/AgentLauncherMenu';

/** Map each column to the human-readable label for the column to its left. */
const LEFT_LABEL: Partial<Record<Column, string>> = {
  'in-progress': 'Todo',
  'done': 'In Progress',
};

/** Map each column to the human-readable label for the column to its right. */
const RIGHT_LABEL: Partial<Record<Column, string>> = {
  'todo': 'In Progress',
  'in-progress': 'Done',
};

export interface CardActionMenuProps {
  taskId: string;
  column: Column;
  spaceId: string;
  isMutating: boolean;
  activeRun: AgentRun | null;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  /**
   * ADR-1 (touch-reorder): in-column move UP by one rank position.
   * Omit to hide the button entirely.
   */
  onMoveUp?: () => void;
  /**
   * ADR-1 (touch-reorder): in-column move DOWN by one rank position.
   * Omit to hide the button entirely.
   */
  onMoveDown?: () => void;
  /** True when this card is already the first in its column — disables move-up. */
  canMoveUp?: boolean;
  /** True when this card is already the last in its column — disables move-down. */
  canMoveDown?: boolean;
  onDelete: () => void;
}

/**
 * Inline action toolbar for a Kanban card.
 *
 * Renders a row of icon buttons: move-left (when applicable), move-right
 * (when applicable), run-agent (todo only), and delete (always).
 * Each button is 28×28 px per the design spec.
 */
export function CardActionMenu({
  taskId,
  column,
  spaceId,
  isMutating,
  activeRun,
  onMoveLeft,
  onMoveRight,
  onMoveUp,
  onMoveDown,
  canMoveUp = true,
  canMoveDown = true,
  onDelete,
}: CardActionMenuProps) {
  const showLeft = column !== 'todo';
  const showRight = column !== 'done';
  const showRunAgent = column === 'todo';
  const deleteDisabled = isMutating || activeRun !== null;
  // ADR-1 (touch-reorder): render up/down only when parent wires the handlers.
  const showUp = typeof onMoveUp === 'function';
  const showDown = typeof onMoveDown === 'function';
  const showReorderGroup = showUp || showDown;
  const showColumnMoveGroup = showLeft || showRight;

  return (
    <div
      role="toolbar"
      aria-label="Card actions"
      className="flex items-center gap-0.5 px-1 py-0.5"
    >
      {showUp && (
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isMutating || !canMoveUp}
          aria-label="Move up"
          title="Move up"
          className="w-7 h-7 flex items-center justify-center rounded-sm text-text-secondary hover:text-primary hover:bg-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
        >
          <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
            arrow_upward
          </span>
        </button>
      )}

      {showDown && (
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isMutating || !canMoveDown}
          aria-label="Move down"
          title="Move down"
          className="w-7 h-7 flex items-center justify-center rounded-sm text-text-secondary hover:text-primary hover:bg-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
        >
          <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
            arrow_downward
          </span>
        </button>
      )}

      {/* Thin divider between vertical reorder (↑↓) and horizontal column-move (←→) */}
      {showReorderGroup && showColumnMoveGroup && (
        <div
          aria-hidden="true"
          className="w-px h-4 mx-0.5 bg-border/70"
        />
      )}

      {showLeft && (
        <button
          type="button"
          onClick={onMoveLeft}
          disabled={isMutating}
          aria-label={`Move to ${LEFT_LABEL[column]}`}
          title={`Move to ${LEFT_LABEL[column]}`}
          className="w-7 h-7 flex items-center justify-center rounded-sm text-text-secondary hover:text-primary hover:bg-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
        >
          <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
            arrow_back
          </span>
        </button>
      )}

      {showRight && (
        <button
          type="button"
          onClick={onMoveRight}
          disabled={isMutating}
          aria-label={`Move to ${RIGHT_LABEL[column]}`}
          title={`Move to ${RIGHT_LABEL[column]}`}
          className="w-7 h-7 flex items-center justify-center rounded-sm text-text-secondary hover:text-primary hover:bg-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
        >
          <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
            arrow_forward
          </span>
        </button>
      )}

      {showRunAgent && (
        <AgentLauncherMenu taskId={taskId} spaceId={spaceId} />
      )}

      <button
        type="button"
        onClick={onDelete}
        disabled={deleteDisabled}
        aria-label="Delete task"
        title="Delete task"
        className="w-7 h-7 flex items-center justify-center rounded-sm text-text-secondary hover:text-error hover:bg-error/[0.08] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
      >
        <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
          delete
        </span>
      </button>
    </div>
  );
}
