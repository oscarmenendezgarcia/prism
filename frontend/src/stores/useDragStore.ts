/**
 * Lightweight Zustand store for drag-and-drop state.
 *
 * Rationale (drag-dnd-perf): `draggedTaskId` and `dragOverTaskId` previously
 * lived as React state in Board. Every drag-over event caused:
 *   Board re-render → 3× Column re-renders → O(n_cards) memo comparisons.
 *
 * By isolating drag state here:
 * - Board calls store actions via `useDragStore.getState()` — no subscription,
 *   no re-renders in Board or Column.
 * - TaskCard subscribes with per-card boolean selectors. Zustand only re-renders
 *   a component when its selected value changes, so at most 2 cards re-render
 *   per drag event (the card leaving drag-over and the card entering it).
 *
 * Result: O(1) re-renders per drag event instead of O(n_columns + n_cards).
 */

import { create } from 'zustand';
import type { Column } from '@/types';

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

interface DragState {
  /** ID of the card currently being dragged, or null. */
  draggedTaskId: string | null;
  /** Column currently under the drag cursor — highlights the whole column, not individual cards. */
  dragOverColumn: Column | null;
  /** Column the drag originated from — read in handleDrop to determine direction. */
  dragSourceColumn: Column | null;

  startDrag: (taskId: string, sourceColumn: Column) => void;
  setDragOver: (column: Column | null) => void;
  resetDrag: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useDragStore = create<DragState>((set) => ({
  draggedTaskId: null,
  dragOverColumn: null,
  dragSourceColumn: null,

  startDrag: (taskId, sourceColumn) =>
    set({ draggedTaskId: taskId, dragSourceColumn: sourceColumn }),

  setDragOver: (column) =>
    set({ dragOverColumn: column }),

  resetDrag: () =>
    set({ draggedTaskId: null, dragOverColumn: null, dragSourceColumn: null }),
}));
