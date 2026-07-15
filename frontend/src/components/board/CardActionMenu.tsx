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
  onDelete: () => void;
  /**
   * Vertical (in-column) reorder — the pointer alternative to Alt+Arrow.
   * Satisfies WCAG 2.5.7 (a non-drag alternative to the drag gesture).
   * Undefined when at a list/group boundary → button rendered `disabled`.
   */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /**
   * Whether the card has a same-group neighbor above/below. Controls the
   * disabled state independently of `onMoveUp/Down` so a wiring bug is
   * observable, not silently hidden.
   */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
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
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
}: CardActionMenuProps) {
  const showLeft = column !== 'todo';
  const showRight = column !== 'done';
  const showRunAgent = column === 'todo';
  const deleteDisabled = isMutating || activeRun !== null;
  // Vertical reorder buttons rendered when the parent wired the callback OR
  // it's a boundary (disabled). Absent only if the whole feature is off.
  const showVertical = onMoveUp !== undefined || onMoveDown !== undefined || canMoveUp || canMoveDown;

  return (
    <div
      role="toolbar"
      aria-label="Card actions"
      className="flex items-center gap-0.5 px-1 py-0.5"
    >
      {showVertical && (
        <>
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isMutating || !canMoveUp}
            aria-label="Move up"
            title="Move up (Alt+↑)"
            data-testid="move-up-button"
            className="w-7 h-7 flex items-center justify-center rounded-sm text-text-secondary hover:text-primary hover:bg-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
          >
            <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
              arrow_upward
            </span>
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isMutating || !canMoveDown}
            aria-label="Move down"
            title="Move down (Alt+↓)"
            data-testid="move-down-button"
            className="w-7 h-7 flex items-center justify-center rounded-sm text-text-secondary hover:text-primary hover:bg-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
          >
            <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
              arrow_downward
            </span>
          </button>
          {/* Thin divider — separates the new vertical pair from the shipped
              horizontal move pair. Wireframes.md button-order decision. */}
          <div aria-hidden="true" className="w-px h-4 bg-border mx-0.5" />
        </>
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
