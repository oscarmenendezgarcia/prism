/**
 * Space settings: the statuses of its board. Saved with the rest by the modal's Save button.
 */

import React, { useRef } from 'react';
import { Button } from '@/components/shared/Button';
import type { Status, StatusCategory } from '@/types';

export interface StatusRow {
  /** Stable across edits, for React. */
  rowKey: string;
  /** Absent in a status not saved yet. */
  id?: string;
  name: string;
  category: StatusCategory;
}

const CATEGORY_LABELS: { id: StatusCategory; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
];

const STATUSES_MAX = 12;
const fieldClass = 'bg-surface border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-ui duration-fast';
const iconButton = 'w-6 h-7 flex-shrink-0 flex items-center justify-center rounded-sm text-text-secondary hover:text-primary hover:bg-surface-variant disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-fast';

export function toStatusRows(statuses: Status[] | undefined): StatusRow[] {
  return (statuses ?? []).map((s) => ({ ...s, rowKey: s.id }));
}

interface StatusesEditorProps {
  rows: StatusRow[];
  onChange: (rows: StatusRow[]) => void;
  /** How many issues each saved status has now. */
  counts: Record<string, number>;
  /** Statuses removed in this edit, with where their issues go. */
  removed: Status[];
  moves: Record<string, string>;
  onRemove: (row: StatusRow) => void;
  onMoveChange: (statusId: string, targetId: string) => void;
}

export function StatusesEditor({ rows, onChange, counts, removed, moves, onRemove, onMoveChange }: StatusesEditorProps) {
  const nextKey = useRef(0);

  const update = (rowKey: string, patch: Partial<StatusRow>) =>
    onChange(rows.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));

  const moveRow = (from: number, to: number) => {
    if (from === to || to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    onChange(next);
  };

  const saved = rows.filter((r) => r.id);

  return (
    <fieldset className="flex flex-col gap-1.5 min-w-0" data-testid="statuses-editor">
      <legend className="block text-sm font-medium text-text-primary mb-0.5">Statuses</legend>
      <p className="text-xs text-text-disabled mb-1">
        The category says what a status means for dependencies and agents.
      </p>

      {rows.map((row, i) => (
        <div
          key={row.rowKey}
          className="flex items-center gap-1.5 px-2 py-1.5 border border-border rounded-lg bg-surface"
          data-testid="status-row"
        >
          <input
            type="text"
            value={row.name}
            maxLength={30}
            aria-label={`Status name ${i + 1}`}
            onChange={(e) => update(row.rowKey, { name: e.target.value })}
            className={`${fieldClass} flex-1 min-w-0`}
          />
          <select
            value={row.category}
            aria-label={`Category of ${row.name || 'this status'}`}
            onChange={(e) => update(row.rowKey, { category: e.target.value as StatusCategory })}
            className={`${fieldClass} w-[118px] flex-shrink-0`}
          >
            {CATEGORY_LABELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <button type="button" className={iconButton} disabled={i === 0} aria-label={`Move ${row.name} up`} onClick={() => moveRow(i, i - 1)}>
            <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">arrow_upward</span>
          </button>
          <button type="button" className={iconButton} disabled={i === rows.length - 1} aria-label={`Move ${row.name} down`} onClick={() => moveRow(i, i + 1)}>
            <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">arrow_downward</span>
          </button>
          <button
            type="button"
            className={`${iconButton} hover:text-error`}
            disabled={rows.length === 1}
            aria-label={`Remove ${row.name}`}
            onClick={() => onRemove(row)}
          >
            <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">delete</span>
          </button>
        </div>
      ))}

      {removed.filter((s) => (counts[s.id] ?? 0) > 0).map((status) => (
        <label key={status.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-warning/10 text-xs text-text-primary" data-testid="status-move">
          <span className="flex-1">
            «{status.name}» is being removed. Move its {counts[status.id]} issue{counts[status.id] === 1 ? '' : 's'} to
          </span>
          <select
            value={moves[status.id] ?? ''}
            onChange={(e) => onMoveChange(status.id, e.target.value)}
            aria-label={`Where the issues of ${status.name} go`}
            className={fieldClass}
          >
            <option value="" disabled>Choose…</option>
            {saved.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={rows.length >= STATUSES_MAX}
        onClick={() => onChange([...rows, { rowKey: `new-${nextKey.current++}`, name: '', category: 'in-progress' }])}
        data-testid="add-status"
        className="self-start"
      >
        <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">add</span>
        Add status
      </Button>
    </fieldset>
  );
}
