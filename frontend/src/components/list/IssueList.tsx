/**
 * The issues of a space as a table. The server filters and orders, and only the rows on screen
 * are in the page, so its size says nothing of how fast it goes.
 */

import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ListSortField, Status, Task } from '@/types';
import { useAppStore } from '@/stores/useAppStore';
import { useCanEdit } from '@/stores/useAuthStore';
import { BULK_MAX, useListStore } from '@/stores/useListStore';
import { agentOf, assigneeLabel } from '@/utils/agents';
import { getGradient, getInitials } from '@/utils/avatar';
import { formatDueDate, isOverdue, priorityOf, statusDotClass, typeOf } from '@/utils/issues';
import { hasFilters } from '@/utils/issueFilters';
import { BulkBar } from './BulkBar';

/** Must match the h-11 of a row. */
const ROW_HEIGHT = 44;
/** Rows kept in the page beyond those on screen. */
const OVERSCAN = 15;
const NO_STATUSES: Status[] = [];

const COLUMNS: { field: ListSortField; label: string; className: string }[] = [
  { field: 'key',      label: 'Key',      className: 'hidden sm:table-cell w-24' },
  { field: 'title',    label: 'Title',    className: '' },
  { field: 'status',   label: 'Status',   className: 'hidden sm:table-cell w-32' },
  { field: 'priority', label: 'Priority', className: 'hidden md:table-cell w-24' },
  { field: 'assignee', label: 'Assignee', className: 'w-12 md:w-40' },
  { field: 'type',     label: 'Type',     className: 'hidden lg:table-cell w-24' },
  { field: 'epic',     label: 'Epic',     className: 'hidden lg:table-cell w-36' },
  { field: 'estimate', label: 'Pts',      className: 'hidden xl:table-cell w-14' },
  { field: 'due',      label: 'Due',      className: 'hidden xl:table-cell w-24' },
];

function Assignee({ name }: { name?: string }) {
  if (!name) return <span className="text-xs text-text-tertiary"><span className="md:hidden" title="Unassigned">—</span><span className="hidden md:inline">Unassigned</span></span>;
  return (
    <span className="flex items-center gap-1.5 min-w-0" title={assigneeLabel(name)}>
      {agentOf(name) ? (
        <span className="w-5 h-5 rounded-[5px] bg-surface-variant flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-xs leading-none text-text-secondary" aria-hidden="true">smart_toy</span>
        </span>
      ) : (
        <span className={`w-5 h-5 rounded-full bg-gradient-to-br ${getGradient(name)} flex items-center justify-center text-[8px] font-semibold text-white flex-shrink-0`} aria-hidden="true">
          {getInitials(name)}
        </span>
      )}
      <span className="hidden md:inline truncate text-xs text-text-secondary">{assigneeLabel(name)}</span>
    </span>
  );
}

interface RowProps {
  task: Task;
  statuses: Status[];
  selectable: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onOpen: (task: Task) => void;
}

const Row = memo(function Row({ task, statuses, selectable, selected, onToggle, onOpen }: RowProps) {
  const status = statuses.find((s) => s.id === task.statusId);
  const priority = priorityOf(task.priority);
  const overdue = isOverdue(task);
  return (
    <tr
      data-testid="issue-row"
      onClick={() => onOpen(task)}
      className={`h-11 border-b border-border-subtle cursor-pointer transition-colors duration-fast ${selected ? 'bg-primary/10' : 'hover:bg-surface-variant'}`}
    >
      {selectable && (
        <td className="w-10 pl-4" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(task.id)}
            aria-label={`Select ${task.key ?? task.title}`}
            className="accent-primary align-middle"
          />
        </td>
      )}
      <td className="hidden sm:table-cell px-2 font-mono text-[11px] text-text-secondary whitespace-nowrap">{task.key}</td>
      <td className="px-2 min-w-0">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(task); }}
          className="block w-full text-left truncate text-sm text-text-primary rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {task.title}
        </button>
        <span className="sm:hidden flex items-center gap-1.5 text-[11px] text-text-secondary whitespace-nowrap overflow-hidden">
          <span className="font-mono">{task.key}</span>
          {status && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotClass(status, statuses)}`} aria-hidden="true" />}
          <span className="truncate">{status?.name}</span>
        </span>
      </td>
      <td className="hidden sm:table-cell px-2 text-xs text-text-primary">
        <span className="flex items-center gap-1.5 min-w-0">
          {status && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(status, statuses)}`} aria-hidden="true" />}
          <span className="truncate">{status?.name ?? task.statusId}</span>
        </span>
      </td>
      <td className="hidden md:table-cell px-2 text-xs text-text-primary">
        <span className="flex items-center gap-0.5 min-w-0">
          <span className={`material-symbols-outlined text-base leading-none flex-shrink-0 ${priority.className}`} aria-hidden="true">{priority.icon}</span>
          <span className="truncate">{priority.label}</span>
        </span>
      </td>
      <td className="px-2"><Assignee name={task.assigned} /></td>
      <td className="hidden lg:table-cell px-2 text-xs text-text-secondary"><span className="block truncate">{typeOf(task.type).label}</span></td>
      <td className="hidden lg:table-cell px-2 text-xs text-text-secondary" title={task.epic?.title}><span className="block truncate">{task.epic?.title}</span></td>
      <td className="hidden xl:table-cell px-2 font-mono text-[11px] text-text-secondary">{task.estimate}</td>
      <td className={`hidden xl:table-cell px-2 text-xs whitespace-nowrap ${overdue ? 'text-error' : 'text-text-secondary'}`}>{task.dueDate && formatDueDate(task.dueDate)}</td>
    </tr>
  );
});

function PlaceholderRow({ selectable }: { selectable: boolean }) {
  return (
    <tr data-testid="issue-row-loading" className="h-11 border-b border-border-subtle" aria-hidden="true">
      {selectable && <td />}
      <td className="hidden sm:table-cell" />
      <td className="px-2"><span className="block h-2.5 w-1/2 rounded bg-surface-variant" /></td>
    </tr>
  );
}

export function IssueList() {
  const statuses = useAppStore((s) => s.spaces.find((sp) => sp.id === s.activeSpaceId)?.statuses) ?? NO_STATUSES;
  const activeSpaceId = useAppStore((s) => s.activeSpaceId);
  const filters = useAppStore((s) => s.filters);
  const setFilters = useAppStore((s) => s.setFilters);
  const sort = useAppStore((s) => s.listSort);
  const setSort = useAppStore((s) => s.setListSort);
  const openDetailPanel = useAppStore((s) => s.openDetailPanel);
  const openCreateModal = useAppStore((s) => s.openCreateModal);
  const canEdit = useCanEdit();
  const rows = useListStore((s) => s.rows);
  const total = useListStore((s) => s.total);
  const failed = useListStore((s) => s.failed);
  const selected = useListStore((s) => s.selected);
  const toggleSelected = useListStore((s) => s.toggleSelected);
  const selectAll = useListStore((s) => s.selectAll);
  const clearSelection = useListStore((s) => s.clearSelection);
  const restart = useListStore((s) => s.restart);
  const showRange = useListStore((s) => s.showRange);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const beforeRef = useRef<HTMLTableCellElement>(null);
  const afterRef = useRef<HTMLTableCellElement>(null);
  const allRef = useRef<HTMLInputElement>(null);
  const [range, setRange] = useState({ first: 0, last: 40 });
  const frame = useRef(0);

  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.ceil((scroller.scrollTop + scroller.clientHeight) / ROW_HEIGHT) + OVERSCAN;
    setRange((was) => (was.first === first && was.last === last ? was : { first, last }));
  }, []);

  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(measure);
  }, [measure]);

  // A new query starts from the top.
  const query = JSON.stringify([activeSpaceId, filters, sort]);
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
    restart();
    measure();
  }, [query, restart, measure]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => { observer.disconnect(); cancelAnimationFrame(frame.current); };
  }, [measure]);

  useEffect(() => { showRange(range.first, range.last); }, [range, showRange, total]);

  // A selection does not outlive the view it was made in: what it holds is not on screen.
  useEffect(() => () => { clearSelection(); }, [clearSelection]);

  const count = total ?? 0;
  const first = Math.min(range.first, count);
  const last = Math.min(range.last, count);

  // Heights only known here, and the design system does not allow inline style attributes.
  useLayoutEffect(() => {
    if (beforeRef.current) beforeRef.current.style.height = `${first * ROW_HEIGHT}px`;
    if (afterRef.current) afterRef.current.style.height = `${(count - last) * ROW_HEIGHT}px`;
  }, [first, last, count]);

  const someSelected = selected.size > 0;
  const allSelected = someSelected && selected.size >= Math.min(count, BULK_MAX);
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  const onSort = (field: ListSortField) => setSort({
    field,
    dir: sort.field === field ? (sort.dir === 'asc' ? 'desc' : 'asc') : (field === 'key' || field === 'updated' || field === 'created' ? 'desc' : 'asc'),
  });

  const visible: React.ReactNode[] = [];
  for (let at = first; at < last; at++) {
    const task = rows[at];
    visible.push(task
      ? <Row key={task.id} task={task} statuses={statuses} selectable={canEdit} selected={selected.has(task.id)} onToggle={toggleSelected} onOpen={openDetailPanel} />
      : <PlaceholderRow key={`loading-${at}`} selectable={canEdit} />);
  }

  return (
    <main role="main" className="relative h-full bg-surface">
      <div ref={scrollerRef} onScroll={onScroll} data-testid="issue-list" className="h-full overflow-auto">
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">Issues</caption>
          <thead className="sticky top-0 z-10 bg-surface-elevated">
            <tr className="h-9 border-b border-border">
              {canEdit && (
                <th scope="col" className="w-10 pl-4 text-left">
                  <input
                    ref={allRef}
                    type="checkbox"
                    checked={allSelected}
                    disabled={count === 0}
                    onChange={() => { if (someSelected) clearSelection(); else void selectAll(); }}
                    aria-label="Select all"
                    data-testid="select-all"
                    className="accent-primary align-middle"
                  />
                </th>
              )}
              {COLUMNS.map(({ field, label, className }) => {
                const active = sort.field === field;
                return (
                  <th
                    key={field}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={`px-2 text-left font-medium ${className}`}
                  >
                    <button
                      type="button"
                      onClick={() => onSort(field)}
                      data-testid={`sort-${field}`}
                      className={`flex items-center gap-0.5 max-w-full text-xs rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-colors duration-fast ${active ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
                    >
                      <span className={`truncate ${field === 'assignee' ? 'hidden md:inline' : ''}`}>{label}</span>
                      {field === 'assignee' && <span className="material-symbols-outlined text-sm leading-none md:hidden" aria-label="Assignee">person</span>}
                      {active && <span className="material-symbols-outlined text-sm leading-none" aria-hidden="true">{sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* One cell is enough for the height, and a colSpan would count the hidden columns. */}
            <tr aria-hidden="true"><td ref={beforeRef} className="p-0" /></tr>
            {visible}
            <tr aria-hidden="true"><td ref={afterRef} className="p-0" /></tr>
          </tbody>
        </table>

        {failed && (
          <p role="alert" className="p-8 text-center text-sm text-error">The list could not be loaded. It will try again in a moment.</p>
        )}
        {total === 0 && !failed && (
          <div data-testid="list-empty" className="flex flex-col items-center gap-3 p-12 text-center">
            <p className="text-sm text-text-secondary">{hasFilters(filters) ? 'No issues match these filters.' : 'No issues yet.'}</p>
            {hasFilters(filters)
              ? <button type="button" onClick={() => setFilters({})} className="text-sm font-medium text-primary hover:underline">Clear filters</button>
              : canEdit && <button type="button" onClick={openCreateModal} className="text-sm font-medium text-primary hover:underline">New issue</button>}
          </div>
        )}
      </div>
      {canEdit && someSelected && <BulkBar />}
    </main>
  );
}
