/**
 * The row above the board and the list: which of the two, what they are filtered by, and how
 * many issues that leaves.
 */

import { useRef, useState } from 'react';
import type { IssueFilters, Status, ViewName } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import { useListStore } from '@/stores/useListStore';
import { assigneeLabel } from '@/utils/agents';
import { PRIORITIES, TYPES } from '@/utils/issues';
import { filterCount, hasFilters } from '@/utils/issueFilters';
import { FilterPanel, DUE_OPTIONS } from './FilterPanel';
import { SavedFilters } from './SavedFilters';

const VIEWS: { id: ViewName; label: string; icon: string }[] = [
  { id: 'board', label: 'Board', icon: 'view_kanban' },
  { id: 'list', label: 'List', icon: 'table_rows' },
];

const NO_STATUSES: Status[] = [];

type FieldName = keyof IssueFilters;

/** What each active filter reads as, in the order of the panel. */
function useTokens(filters: IssueFilters): { field: FieldName; name: string; value: string }[] {
  const statuses = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId)?.statuses) ?? NO_STATUSES;
  const epics = useAppStore((s) => s.epics);
  const tokens: { field: FieldName; name: string; value: string }[] = [];
  const add = (field: FieldName, name: string, values: string[] | undefined) => {
    if (values && values.length > 0) tokens.push({ field, name, value: values.join(', ') });
  };
  if (filters.q) tokens.push({ field: 'q', name: 'Text', value: filters.q });
  add('status', 'Status', filters.status?.map((id) => statuses.find((s) => s.id === id)?.name ?? 'Deleted status'));
  add('assignee', 'Assignee', filters.assignee?.map((name) => (name === '' ? 'Unassigned' : assigneeLabel(name))));
  add('type', 'Type', filters.type?.map((id) => TYPES.find((t) => t.id === id)?.label ?? id));
  add('priority', 'Priority', filters.priority?.map((id) => PRIORITIES.find((p) => p.id === id)?.label ?? id));
  add('epic', 'Epic', filters.epic?.map((id) => (id === '' ? 'No epic' : epics.find((e) => e.id === id)?.title ?? 'Deleted epic')));
  add('label', 'Label', filters.label);
  if (filters.due) tokens.push({ field: 'due', name: 'Due', value: DUE_OPTIONS.find((o) => o.id === filters.due)?.label ?? filters.due });
  return tokens;
}

export function FilterBar() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const columnTotals = useAppStore((s) => s.columnTotals);
  const listTotal = useListStore((s) => s.total);
  // One at a time, by mouse or by keyboard: they take the same place on a phone.
  const [open, setOpen] = useState<'filter' | 'saved' | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const tokens = useTokens(filters);
  const count = filterCount(filters);
  const total = view === 'list' ? listTotal : Object.values(columnTotals).reduce((sum, n) => sum + n, 0);

  return (
    <div
      data-testid="filter-bar"
      className="relative z-20 flex items-center gap-2 h-10 px-4 flex-shrink-0 border-b border-border bg-surface-elevated"
    >
      <div role="group" aria-label="View" className="flex items-center gap-0.5 flex-shrink-0">
        {VIEWS.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            aria-pressed={view === id}
            data-testid={`view-${id}`}
            className={`flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-colors duration-fast ${
              view === id ? 'bg-primary/15 text-primary' : 'text-text-secondary hover:bg-surface-variant hover:text-text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      <span className="w-px h-5 bg-border flex-shrink-0" aria-hidden="true" />

      <div className="relative flex-shrink-0">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((was) => (was === 'filter' ? null : 'filter'))}
          aria-expanded={open === 'filter'}
          aria-haspopup="dialog"
          data-testid="filter-button"
          className={`flex items-center gap-1 h-7 px-2 rounded-md border text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-colors duration-fast ${
            count > 0
              ? 'bg-primary/15 border-primary/40 text-primary'
              : 'bg-surface border-border text-text-secondary hover:border-primary/30 hover:text-text-primary'
          }`}
        >
          <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">filter_list</span>
          Filter{count > 0 && <span> · {count}</span>}
        </button>
        {open === 'filter' && <FilterPanel onClose={() => setOpen(null)} anchorRef={buttonRef} />}
      </div>

      <SavedFilters open={open === 'saved'} onOpenChange={(now) => setOpen(now ? 'saved' : null)} />

      <div className="hidden sm:flex flex-1 min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
        {tokens.map(({ field, name, value }) => (
          <span
            key={field}
            data-testid={`filter-token-${field}`}
            className="flex items-center gap-1 h-6 pl-2 pr-1 rounded-md bg-surface border border-border text-xs text-text-primary whitespace-nowrap max-w-[16rem]"
          >
            <span className="text-text-secondary">{name}</span>
            <span className="truncate">{value}</span>
            <button
              type="button"
              aria-label={`Remove filter ${name}`}
              onClick={() => setFilters({ ...filters, [field]: undefined })}
              className="flex items-center text-text-secondary hover:text-error focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded transition-colors duration-fast"
            >
              <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">close</span>
            </button>
          </span>
        ))}
        {hasFilters(filters) && (
          <button
            type="button"
            onClick={() => setFilters({})}
            data-testid="filter-clear"
            className="h-6 px-1.5 rounded text-xs text-text-secondary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 whitespace-nowrap transition-colors duration-fast"
          >
            Clear
          </button>
        )}
      </div>

      <span className="sm:hidden flex-1" />
      {total !== null && (
        <span data-testid="filter-total" className="text-xs text-text-secondary whitespace-nowrap flex-shrink-0">
          {total.toLocaleString('en-US')}<span className="hidden min-[400px]:inline"> {total === 1 ? 'issue' : 'issues'}</span>
        </span>
      )}
    </div>
  );
}

