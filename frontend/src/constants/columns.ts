import type { Column } from '@/types';

/**
 * Ordered kanban columns, left → right. The single source of truth for
 * column order. Iterate this for rendering; use indexOf for move logic.
 */
export const COLUMNS: readonly Column[] = ['todo', 'in-progress', 'done'] as const;

/**
 * Human-readable display label for each column. The single source of truth
 * for column labels — the one place a rename or i18n pass edits.
 * Typed Record<Column, string> so the map stays exhaustive at compile time.
 */
export const COLUMN_LABELS: Record<Column, string> = {
  'todo':        'Todo',
  'in-progress': 'In Progress',
  'done':        'Done',
};

/**
 * Label of the column adjacent to `column` in the given direction,
 * or undefined at a board edge (left of 'todo' / right of 'done').
 * Used for move-left / move-right button tooltips.
 */
export function adjacentColumnLabel(
  column: Column,
  direction: 'left' | 'right',
): string | undefined {
  const idx = COLUMNS.indexOf(column);
  const target = COLUMNS[direction === 'left' ? idx - 1 : idx + 1];
  return target ? COLUMN_LABELS[target] : undefined;
}
