/**
 * CardActionMenu — hover overlay toolbar for TaskCard.
 *
 * Renders move-left, move-right, and delete buttons in a compact
 * horizontal strip. Composed into TaskCard as the absolutely-positioned hover
 * overlay. Also used to populate the more_vert ContextMenu item list.
 *
 * ADR-1 (redesign-cards) §3.2: extracted action toolbar, independently testable.
 */

import React from 'react';

export interface CardActionMenuProps {
  /** Name of the status to the left, if there is one. */
  leftLabel?: string;
  /** Name of the status to the right, if there is one. */
  rightLabel?: string;
  isMutating: boolean;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  /**
   * Vertical (in-column) reorder — the pointer/keyboard alternative to
   * Alt+Arrow, shared by the keyboard-card-reorder and touch-reorder
   * features. Satisfies WCAG 2.5.7 (a non-drag alternative to the drag
   * gesture). Omit to hide the button entirely.
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
  /** Left out for someone who may not delete this card. */
  onDelete?: () => void;
}

/**
 * Inline action toolbar for a Kanban card.
 *
 * Renders a row of icon buttons: move-left (when applicable), move-right
 * (when applicable), and delete (if allowed).
 * Each button is 28×28 px per the design spec.
 */
export function CardActionMenu({
  leftLabel,
  rightLabel,
  isMutating,
  onMoveLeft,
  onMoveRight,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  onDelete,
}: CardActionMenuProps) {
  const showLeft = leftLabel !== undefined;
  const showRight = rightLabel !== undefined;
  // Vertical reorder buttons rendered when the parent wired the callback OR
  // it's a boundary (disabled). Absent only if the whole feature is off.
  const showVertical = onMoveUp !== undefined || onMoveDown !== undefined || canMoveUp || canMoveDown;
  const showColumnMoveGroup = showLeft || showRight;

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
            className="w-7 h-7 flex items-center justify-center rounded-sm text-text-secondary hover:text-primary hover:bg-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast"
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
            className="w-7 h-7 flex items-center justify-center rounded-sm text-text-secondary hover:text-primary hover:bg-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast"
          >
            <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
              arrow_downward
            </span>
          </button>
          {/* Thin divider — separates the vertical reorder pair from the
              horizontal column-move pair. Only rendered when a horizontal
              group actually follows (the first status has no ←, the last no →). */}
          {showColumnMoveGroup && (
            <div aria-hidden="true" className="w-px h-4 bg-border mx-0.5" />
          )}
        </>
      )}

      {showLeft && (
        <button
          type="button"
          onClick={onMoveLeft}
          disabled={isMutating}
          aria-label={`Move to ${leftLabel}`}
          title={`Move to ${leftLabel}`}
          className="w-7 h-7 flex items-center justify-center rounded-sm text-text-secondary hover:text-primary hover:bg-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast"
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
          aria-label={`Move to ${rightLabel}`}
          title={`Move to ${rightLabel}`}
          className="w-7 h-7 flex items-center justify-center rounded-sm text-text-secondary hover:text-primary hover:bg-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast"
        >
          <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
            arrow_forward
          </span>
        </button>
      )}

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={isMutating}
          aria-label="Delete issue"
          title="Delete issue"
          className="w-7 h-7 flex items-center justify-center rounded-sm text-text-secondary hover:text-error hover:bg-error/[0.08] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-fast"
        >
          <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
            delete
          </span>
        </button>
      )}
    </div>
  );
}
