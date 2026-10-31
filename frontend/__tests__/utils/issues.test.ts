import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {keepUnchanged, allTasks, boardIndex, formatDueDate, isAwaitingReview, isOverdue, mapBoard, parentIssueOf, priorityOf, statusDotClass, typeOf } from '../../src/utils/issues';
import type { BoardTasks, Space, Status, Task } from '../../src/types';

const issue = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: id, type: 'feature', createdAt: '', updatedAt: '', ...over,
});

/**
 * epic ── a ── sub
 *      └─ b
 * other ── c
 * loose     orphan (its parent is not on the board)
 */
const EPIC = issue('epic', { type: 'epic' });
const OTHER = issue('other', { type: 'epic' });
const A = issue('a', { parentId: 'epic', number: 3, category: 'done' });
const B = issue('b', { parentId: 'epic', number: 2, category: 'in-progress' });
const C = issue('c', { parentId: 'other', number: 4 });
const SUB = issue('sub', { parentId: 'a', number: 5, category: 'todo' });
const LOOSE = issue('loose');
const ORPHAN = issue('orphan', { parentId: 'nowhere' });
const BOARD: BoardTasks = { todo: [EPIC, A, LOOSE], doing: [B, SUB, OTHER], done: [C, ORPHAN] };
const INDEX = boardIndex(BOARD);

describe('allTasks', () => {
  it('flattens every status', () => {
    expect(allTasks(BOARD).map((t) => t.id).sort()).toEqual(['a', 'b', 'c', 'epic', 'loose', 'orphan', 'other', 'sub']);
  });
});

describe('mapBoard', () => {
  it('applies the function and keeps each task in its status', () => {
    const mapped = mapBoard({ todo: [A], doing: [B] }, (t) => ({ ...t, title: t.title.toUpperCase() }));
    expect(mapped.todo.map((t) => t.title)).toEqual(['A']);
    expect(mapped.doing.map((t) => t.title)).toEqual(['B']);
  });
});

describe('boardIndex', () => {
  it('finds any task by id', () => {
    expect(INDEX.byId.get('sub')).toBe(SUB);
    expect(INDEX.byId.get('other')).toBe(OTHER);
    expect(INDEX.byId.has('nowhere')).toBe(false);
  });

  it('is computed once per version of the board', () => {
    expect(boardIndex(BOARD)).toBe(INDEX);
    const next = { ...BOARD, todo: [...BOARD.todo, issue('new')] };
    const nextIndex = boardIndex(next);
    expect(nextIndex).not.toBe(INDEX);
    expect(nextIndex.byId.has('new')).toBe(true);
    expect(INDEX.byId.has('new')).toBe(false);
  });
});

describe('parentIssueOf', () => {
  const base: Task = { id: 't', title: 'T', type: 'feature', createdAt: '', updatedAt: '' };

  it('is the issue a sub-task hangs from', () => {
    const parent = { id: 'p', key: 'WEB-1', title: 'P', type: 'feature' as const };
    expect(parentIssueOf({ ...base, parentId: 'p', parent })).toBe(parent);
  });

  it('is nothing for an issue directly in an epic', () => {
    expect(parentIssueOf({ ...base, parentId: 'e', parent: { id: 'e', title: 'E', type: 'epic' } })).toBeNull();
    expect(parentIssueOf({ ...base, parentId: 'e', parentKey: null })).toBeNull();
  });

  it('is nothing without a parent', () => {
    expect(parentIssueOf(base)).toBeNull();
  });

  it('is what a card knows of it, until the whole issue arrives', () => {
    expect(parentIssueOf({ ...base, parentId: 'p', parentKey: 'WEB-1' })).toEqual({ id: 'p', key: 'WEB-1', title: '' });
  });

  it('is not known when all there is is the id', () => {
    expect(parentIssueOf({ ...base, parentId: 'p' })).toBeUndefined();
  });
});

describe('priorityOf / typeOf', () => {
  it('finds a priority, and counts none as medium', () => {
    expect(priorityOf('urgent').label).toBe('Urgent');
    expect(priorityOf(undefined).id).toBe('medium');
  });

  it('finds a type, and falls back to chore on an unknown one', () => {
    expect(typeOf('tech-debt').label).toBe('Tech debt');
    expect(typeOf('legacy' as never).id).toBe('chore');
  });
});

describe('statusDotClass', () => {
  const statuses: Status[] = [
    { id: 'todo', name: 'Todo', category: 'todo' },
    { id: 'doing', name: 'Doing', category: 'in-progress' },
    { id: 'review', name: 'Review', category: 'in-progress' },
    { id: 'done', name: 'Done', category: 'done' },
  ];

  it('tells apart the categories, and the first in-progress status from the later ones', () => {
    expect(statuses.map((s) => statusDotClass(s, statuses))).toEqual(['bg-text-disabled', 'bg-primary', 'bg-warning', 'bg-success']);
  });
});

describe('isAwaitingReview', () => {
  const space: Space = { id: 's', name: 'S', finishStatusId: 'review', createdAt: '', updatedAt: '' };

  it('is true in the status where agents finish', () => {
    expect(isAwaitingReview(issue('t', { statusId: 'review' }), space)).toBe(true);
  });

  it('is false in any other status', () => {
    expect(isAwaitingReview(issue('t', { statusId: 'doing' }), space)).toBe(false);
  });

  it('is false with no space known', () => {
    expect(isAwaitingReview(issue('t', { statusId: 'review' }), undefined)).toBe(false);
  });

  it('is false when neither the issue nor the space has a status', () => {
    expect(isAwaitingReview(issue('t'), { ...space, finishStatusId: undefined })).toBe(false);
  });
});

describe('dates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatDueDate', () => {
    it('leaves out the year of a date this year', () => {
      expect(formatDueDate('2026-11-03')).toBe('Nov 3');
    });

    it('adds the year of a date in another year', () => {
      expect(formatDueDate('2027-01-09')).toBe('Jan 9, 2027');
      expect(formatDueDate('2025-12-31')).toBe('Dec 31, 2025');
    });

    it('reads the date as a local day, without shifting it by the time zone', () => {
      expect(formatDueDate('2026-03-01')).toBe('Mar 1');
    });
  });

  describe('isOverdue', () => {
    it('is true the day after the due date', () => {
      expect(isOverdue(issue('t', { dueDate: '2026-06-14' }))).toBe(true);
    });

    it('is false on the due date itself', () => {
      expect(isOverdue(issue('t', { dueDate: '2026-06-15' }))).toBe(false);
    });

    it('is false before the due date', () => {
      expect(isOverdue(issue('t', { dueDate: '2026-06-16' }))).toBe(false);
    });

    it('is false once done, however late', () => {
      expect(isOverdue(issue('t', { dueDate: '2020-01-01', category: 'done' }))).toBe(false);
    });

    it('is false with no due date', () => {
      expect(isOverdue(issue('t'))).toBe(false);
      expect(isOverdue(issue('t', { dueDate: null }))).toBe(false);
    });

    it('compares against the local day at the very start and end of it', () => {
      vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 1));
      expect(isOverdue(issue('t', { dueDate: '2026-01-01' }))).toBe(false);
      expect(isOverdue(issue('t', { dueDate: '2025-12-31' }))).toBe(true);
      vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59));
      expect(isOverdue(issue('t', { dueDate: '2026-12-31' }))).toBe(false);
    });
  });
});

describe('keepUnchanged', () => {
  const issue = (id: string, title = id) => ({ id, title, type: 'feature', createdAt: '', updatedAt: '' }) as Task;

  it('returns the old board when a poll brings the same thing', () => {
    const old = { todo: [issue('a')], done: [issue('b')] };
    expect(keepUnchanged(old, JSON.parse(JSON.stringify(old)))).toBe(old);
  });

  it('replaces only what changed', () => {
    const old = { todo: [issue('a'), issue('b')], done: [issue('c')] };
    const fresh = { todo: [issue('a'), issue('b', 'New title')], done: [issue('c')] };
    const board = keepUnchanged(old, fresh);
    expect(board).not.toBe(old);
    expect(board.todo[0]).toBe(old.todo[0]);
    expect(board.todo[1].title).toBe('New title');
    expect(board.done).toBe(old.done);
  });

  it('reuses the issue when it moves, in its new place', () => {
    const old = { todo: [issue('a')], done: [] as Task[] };
    const board = keepUnchanged(old, { todo: [], done: [issue('a')] });
    expect(board.done[0]).toBe(old.todo[0]);
    expect(board.todo).toEqual([]);
  });

  it('sees a reorder, a new column and a removed one', () => {
    const old = { todo: [issue('a'), issue('b')] };
    expect(keepUnchanged(old, { todo: [issue('b'), issue('a')] }).todo.map((t) => t.id)).toEqual(['b', 'a']);
    expect(keepUnchanged(old, { ...old, done: [] })).toHaveProperty('done');
    expect(keepUnchanged({ ...old, done: [] }, old)).not.toHaveProperty('done');
  });
});
