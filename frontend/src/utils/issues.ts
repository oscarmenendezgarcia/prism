/**
 * What the board needs to know about issues beyond each one's own fields: who holds whom,
 * and how a status or a date reads.
 */

import type { BoardTasks, Priority, Space, Status, Task, TaskType } from '@/types';

export const PRIORITIES: { id: Priority; label: string; icon: string; className: string }[] = [
  { id: 'urgent', label: 'Urgent', icon: 'keyboard_double_arrow_up', className: 'text-error' },
  { id: 'high',   label: 'High',   icon: 'keyboard_arrow_up',        className: 'text-badge-tech-debt-text' },
  { id: 'medium', label: 'Medium', icon: 'drag_handle',              className: 'text-text-secondary' },
  { id: 'low',    label: 'Low',    icon: 'keyboard_arrow_down',      className: 'text-info' },
];

export const priorityOf = (id: Priority | undefined) =>
  PRIORITIES.find((p) => p.id === id) ?? PRIORITIES[2];

export const TYPES: { id: TaskType; label: string }[] = [
  { id: 'feature',   label: 'Feature' },
  { id: 'bug',       label: 'Bug' },
  { id: 'chore',     label: 'Chore' },
  { id: 'tech-debt', label: 'Tech debt' },
  { id: 'epic',      label: 'Epic' },
];

export const typeOf = (id: TaskType) => TYPES.find((t) => t.id === id) ?? TYPES[2];

export function allTasks(board: BoardTasks): Task[] {
  return Object.values(board).flat();
}

/** Apply a function to every task, keeping the statuses they are in. */
export function mapBoard(board: BoardTasks, fn: (task: Task) => Task): BoardTasks {
  return Object.fromEntries(Object.entries(board).map(([status, tasks]) => [status, tasks.map(fn)]));
}

export interface BoardIndex {
  byId: Map<string, Task>;
  children: Map<string, Task[]>;
}

const indexes = new WeakMap<BoardTasks, BoardIndex>();

/** Look-ups over the board, computed once per version of it. */
export function boardIndex(board: BoardTasks): BoardIndex {
  const cached = indexes.get(board);
  if (cached) return cached;
  const byId = new Map<string, Task>();
  const children = new Map<string, Task[]>();
  for (const task of allTasks(board)) {
    byId.set(task.id, task);
    if (task.parentId) children.set(task.parentId, [...(children.get(task.parentId) ?? []), task]);
  }
  for (const list of children.values()) list.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  const index = { byId, children };
  indexes.set(board, index);
  return index;
}

/** Today's date in the local time zone, as YYYY-MM-DD. */
export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * The new board, reusing the objects of the old one wherever nothing changed. Polling brings
 * a fresh copy every few seconds, and a new object would re-render a card that looks the same.
 */
export function keepUnchanged(old: BoardTasks, fresh: BoardTasks): BoardTasks {
  const oldById = boardIndex(old).byId;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const board: BoardTasks = {};
  for (const [statusId, tasks] of Object.entries(fresh)) {
    const list = tasks.map((task) => {
      const seen = oldById.get(task.id);
      return seen && same(seen, task) ? seen : task;
    });
    const before = old[statusId];
    board[statusId] = before?.length === list.length && list.every((t, i) => t === before[i]) ? before : list;
  }
  const keys = Object.keys(board);
  const unchanged = keys.length === Object.keys(old).length && keys.every((k, i) => board[k] === old[k] && Object.keys(old)[i] === k);
  return unchanged ? old : board;
}

/** The epic an issue is in, directly or through its parent. */
export function epicOf(task: Task, index: BoardIndex): Task | null {
  if (task.type === 'epic' || !task.parentId) return null;
  const parent = index.byId.get(task.parentId);
  if (!parent) return null;
  if (parent.type === 'epic') return parent;
  const grandparent = parent.parentId ? index.byId.get(parent.parentId) : null;
  return grandparent?.type === 'epic' ? grandparent : null;
}

/** The issue this one is a sub-task of, if it is one. */
export function parentIssueOf(task: Task, index: BoardIndex): Task | null {
  const parent = task.parentId ? index.byId.get(task.parentId) : null;
  return parent && parent.type !== 'epic' ? parent : null;
}

/** How many issues directly under this one are done. */
export function progressOf(taskId: string, index: BoardIndex): { done: number; total: number } {
  const children = index.children.get(taskId) ?? [];
  return { done: children.filter((c) => c.category === 'done').length, total: children.length };
}

/** Whether an issue shows when the board is filtered to an epic. */
export function isInEpic(task: Task, epicId: string, index: BoardIndex): boolean {
  return task.id === epicId || epicOf(task, index)?.id === epicId;
}

/** The dot of a status. An in-progress status after the first is one step further along. */
export function statusDotClass(status: Status, statuses: Status[]): string {
  if (status.category === 'done') return 'bg-success';
  if (status.category === 'todo') return 'bg-text-disabled';
  const first = statuses.find((s) => s.category === 'in-progress');
  return first?.id === status.id ? 'bg-primary' : 'bg-warning';
}

/** What a card in this status would show as Space settings' "move to" when none was chosen. */
export function defaultFinishStatus(statuses: { id?: string; category: string }[]): string | undefined {
  return statuses.find((s) => s.id === 'in-review' && s.category !== 'todo')?.id
    ?? statuses.find((s) => s.category === 'done' && s.id)?.id;
}

/** An agent finished this and a person has not moved it on yet. */
export function isAwaitingReview(task: Task, space: Space | undefined): boolean {
  return !!task.statusId && task.statusId === space?.finishStatusId;
}

/** A due date as "Nov 3", with the year if it is not this one. */
export function formatDueDate(dueDate: string): string {
  const [year, month, day] = dueDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(year !== new Date().getFullYear() && { year: 'numeric' }),
  });
}

export function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.category === 'done') return false;
  return task.dueDate < localToday();
}
