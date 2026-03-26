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
}: CardActionMenuProps) {
  const showLeft = column !== 'todo';
  const showRight = column !== 'done';
  const showRunAgent = column === 'todo';
  const deleteDisabled = isMutating || activeRun !== null;

  return (
    <div
      role="toolbar"
      aria-label="Card actions"
      className="flex items-center gap-0.5 px-1 py-0.5"
    >
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
