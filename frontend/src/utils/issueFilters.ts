/**
 * What a list or a board shows: the filters, how they read as a query, and how they read in
 * the address of the page, so that a link keeps them.
 */

import type { IssueFilters, ListSort, ListSortField, ViewName } from '@/types';
import { PRIORITIES, TYPES, localToday } from '@/utils/issues';

const LIST_FIELDS = ['status', 'assignee', 'type', 'priority', 'epic', 'label'] as const;
const DUE = ['overdue', 'week', 'none'] as const;
/** What the server takes as text. */
const TEXT_MAX = 200;
const SORT_FIELDS: ListSortField[] = ['key', 'title', 'status', 'priority', 'assignee', 'type', 'epic', 'estimate', 'due', 'updated', 'created'];

export const DEFAULT_SORT: ListSort = { field: 'key', dir: 'desc' };

/** The same filters without what does not filter, always in the same order. */
export function cleanFilters(filters: IssueFilters): IssueFilters {
  const clean: IssueFilters = {};
  for (const field of LIST_FIELDS) {
    const values = filters[field];
    if (values && values.length > 0) (clean[field] as string[]) = [...new Set<string>(values)];
  }
  if (filters.due) clean.due = filters.due;
  const q = filters.q?.trim();
  if (q) clean.q = q;
  return clean;
}

export const hasFilters = (filters: IssueFilters) => Object.keys(cleanFilters(filters)).length > 0;

/** How many fields filter, which is what the Filter button counts. */
export const filterCount = (filters: IssueFilters) => Object.keys(cleanFilters(filters)).length;

/** Add the filters to a query. An empty assignee or epic means having none. */
export function appendFilters(params: URLSearchParams, filters: IssueFilters): void {
  const clean = cleanFilters(filters);
  for (const field of LIST_FIELDS) for (const value of clean[field] ?? []) params.append(field, value);
  if (clean.due) {
    params.set('due', clean.due);
    // What is overdue depends on the day of whoever looks, not on that of the server.
    params.set('today', localToday());
  }
  if (clean.q) params.set('q', clean.q);
}

/** What the address of the page says. Whatever it cannot make sense of, it leaves out. */
export function readLocation(search: string): { space?: string; view: ViewName; filters: IssueFilters; sort: ListSort } {
  const params = new URLSearchParams(search);
  const filters: IssueFilters = {};
  for (const field of LIST_FIELDS) {
    if (params.has(field)) (filters[field] as string[]) = params.getAll(field);
  }
  // The server would refuse these, on every poll, and nothing on screen would say why.
  filters.type = filters.type?.filter((id) => TYPES.some((t) => t.id === id));
  filters.priority = filters.priority?.filter((id) => PRIORITIES.some((p) => p.id === id));
  const due = params.get('due') as IssueFilters['due'];
  if (due && DUE.includes(due)) filters.due = due;
  const q = params.get('q');
  if (q) filters.q = q.slice(0, TEXT_MAX);
  const field = params.get('sort') as ListSortField | null;
  const dir = params.get('dir');
  return {
    space: params.get('space') ?? undefined,
    view: params.get('view') === 'list' ? 'list' : 'board',
    filters: cleanFilters(filters),
    sort: field && SORT_FIELDS.includes(field) ? { field, dir: dir === 'asc' ? 'asc' : 'desc' } : DEFAULT_SORT,
  };
}

/** The address of the page for this state, keeping what is not about it. */
export function writeLocation(
  search: string,
  { space, view, filters, sort }: { space: string; view: ViewName; filters: IssueFilters; sort: ListSort },
): string {
  const params = new URLSearchParams(search);
  for (const name of [...LIST_FIELDS, 'due', 'today', 'q', 'view', 'space', 'sort', 'dir']) params.delete(name);
  const filtering = hasFilters(filters);
  if (view === 'list' || filtering) params.set('space', space);
  if (view === 'list') params.set('view', 'list');
  appendFilters(params, filters);
  params.delete('today');
  if (view === 'list' && (sort.field !== DEFAULT_SORT.field || sort.dir !== DEFAULT_SORT.dir)) {
    params.set('sort', sort.field);
    params.set('dir', sort.dir);
  }
  return params.size > 0 ? `?${params}` : '';
}
