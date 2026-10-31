import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/api/client';
import { useAppStore } from '@/stores/useAppStore';
import { LIST_PAGE, useListStore } from '@/stores/useListStore';
import { DEFAULT_SORT } from '@/utils/issueFilters';
import type { Task } from '@/types';

vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof api>()),
  getIssues: vi.fn(),
  getIssueIds: vi.fn(),
  updateIssues: vi.fn(),
  getBoard: vi.fn(async () => null),
}));

const task = (n: number): Task => ({ id: `t${n}`, title: `Issue ${n}`, type: 'chore', createdAt: '', updatedAt: '' });
const page = (from: number, count: number, total: number, etag = 'v1') => ({
  data: { tasks: Array.from({ length: count }, (_, i) => task(from + i)), total }, etag,
});
const flush = () => new Promise((resolve) => setTimeout(resolve));
const store = () => useListStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ activeSpaceId: 's', filters: {}, listSort: DEFAULT_SORT, spaces: [] });
  useListStore.setState({ rows: {}, total: null, failed: false, selected: new Set() });
});

describe('loading', () => {
  it('asks for the first page, and holds its rows by position', async () => {
    vi.mocked(api.getIssues).mockResolvedValue(page(0, LIST_PAGE, 1000));
    store().restart();
    await flush();
    expect(vi.mocked(api.getIssues).mock.calls[0][1]).toMatchObject({ offset: 0, limit: LIST_PAGE, etag: null });
    expect(store().total).toBe(1000);
    expect(store().rows[99].id).toBe('t99');
  });

  it('asks only for the pages it lacks', async () => {
    vi.mocked(api.getIssues).mockResolvedValue(page(0, LIST_PAGE, 1000));
    store().restart();
    await flush();
    vi.mocked(api.getIssues).mockClear();
    vi.mocked(api.getIssues).mockResolvedValue(page(500, LIST_PAGE, 1000));
    store().showRange(10, 50);
    expect(api.getIssues).not.toHaveBeenCalled();
    store().showRange(520, 560);
    await flush();
    expect(vi.mocked(api.getIssues).mock.calls.map((c) => c[1].offset)).toEqual([500]);
    expect(store().rows[510].id).toBe('t510');
  });

  it('forgets pages far from what is on screen, so a long scroll weighs the same', async () => {
    vi.mocked(api.getIssues).mockResolvedValue(page(0, LIST_PAGE, 5000));
    store().restart();
    await flush();
    vi.mocked(api.getIssues).mockResolvedValue(page(2000, LIST_PAGE, 5000));
    store().showRange(2010, 2050);
    await flush();
    expect(store().rows[0]).toBeUndefined();
    expect(store().rows[2010]).toBeDefined();
  });

  it('keeps showing the old rows until the first answer of a new query replaces them', async () => {
    vi.mocked(api.getIssues).mockResolvedValue(page(0, 3, 3));
    store().restart();
    await flush();
    let answer: (value: ReturnType<typeof page>) => void = () => {};
    vi.mocked(api.getIssues).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    useAppStore.setState({ filters: { q: 'x' } });
    store().restart();
    expect(store().rows[0].id).toBe('t0');
    answer({ data: { tasks: [task(9)], total: 1 }, etag: 'v2' });
    await flush();
    expect(Object.keys(store().rows)).toEqual(['0']);
    expect(store().rows[0].id).toBe('t9');
  });

  it('ignores an answer to a query that is not the current one any more', async () => {
    let late: (value: ReturnType<typeof page>) => void = () => {};
    vi.mocked(api.getIssues).mockReturnValueOnce(new Promise((resolve) => { late = resolve; }));
    store().restart();
    useAppStore.setState({ filters: { q: 'new' } });
    vi.mocked(api.getIssues).mockResolvedValueOnce(page(7, 1, 1, 'new'));
    store().restart();
    await flush();
    late(page(0, 50, 50, 'old'));
    await flush();
    expect(store().total).toBe(1);
    expect(store().rows[0].id).toBe('t7');
  });

  it('a poll sends what it has, and an answer of no change touches nothing', async () => {
    vi.mocked(api.getIssues).mockResolvedValue(page(0, 3, 3, 'v7'));
    store().restart();
    await flush();
    const before = store().rows;
    vi.mocked(api.getIssues).mockResolvedValue(null);
    await store().refresh();
    expect(vi.mocked(api.getIssues).mock.lastCall![1].etag).toBe('v7');
    expect(store().rows).toBe(before);
  });

  it('rows past a total that went down go away', async () => {
    vi.mocked(api.getIssues).mockResolvedValue(page(0, 3, 3));
    store().restart();
    await flush();
    vi.mocked(api.getIssues).mockResolvedValue(page(0, 1, 1, 'v2'));
    await store().refresh();
    expect(Object.keys(store().rows)).toEqual(['0']);
  });

  it('says so when there is nothing to show, and recovers', async () => {
    vi.mocked(api.getIssues).mockRejectedValue(new Error('down'));
    store().restart();
    await flush();
    expect(store().failed).toBe(true);
    vi.mocked(api.getIssues).mockResolvedValue(page(0, 1, 1));
    await store().refresh();
    expect(store().failed).toBe(false);
  });

  it('with rows on screen, a failed poll leaves them', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(api.getIssues).mockResolvedValue(page(0, 1, 1));
    store().restart();
    await flush();
    vi.mocked(api.getIssues).mockRejectedValue(new Error('down'));
    await store().refresh();
    expect(store().failed).toBe(false);
    expect(store().rows[0]).toBeDefined();
  });
});

describe('a new query that fails', () => {
  it('does not pass off the old rows as its own', async () => {
    vi.mocked(api.getIssues).mockResolvedValue(page(0, 3, 3));
    store().restart();
    await flush();
    useAppStore.setState({ filters: { q: 'x' } });
    vi.mocked(api.getIssues).mockRejectedValue(new Error('down'));
    store().restart();
    await flush();
    expect(store().failed).toBe(true);
    expect(store().rows).toEqual({});
  });

  it('another space drops the rows at once, before any answer', async () => {
    vi.mocked(api.getIssues).mockResolvedValue(page(0, 3, 3));
    store().restart();
    await flush();
    useAppStore.setState({ activeSpaceId: 'other' });
    vi.mocked(api.getIssues).mockReturnValue(new Promise(() => {}));
    store().restart();
    expect(store().rows).toEqual({});
    expect(store().total).toBeNull();
  });
});

describe('selecting', () => {
  it('a new query clears it', async () => {
    vi.mocked(api.getIssues).mockResolvedValue(page(0, 1, 1));
    store().toggleSelected('t0');
    expect(store().selected.has('t0')).toBe(true);
    store().restart();
    expect(store().selected.size).toBe(0);
  });

  it('all, and says when that is not all', async () => {
    const toast = vi.spyOn(useAppStore.getState(), 'showToast');
    vi.mocked(api.getIssueIds).mockResolvedValue({ ids: ['a', 'b'], total: 9000 });
    await store().selectAll();
    expect(store().selected.size).toBe(2);
    expect(useAppStore.getState().toast?.message ?? toast.mock.lastCall?.[0]).toMatch(/first 2 of 9,000/);
  });

  it('stops at what can be changed at once', () => {
    useListStore.setState({ selected: new Set(Array.from({ length: 500 }, (_, i) => `x${i}`)) });
    store().toggleSelected('one-more');
    expect(store().selected.size).toBe(500);
  });
});

describe('changing', () => {
  it('reads again rather than trust a poll from before the write', async () => {
    vi.mocked(api.getIssues).mockResolvedValue(page(0, 1, 1));
    store().restart();
    await flush();
    let oldPoll: (value: ReturnType<typeof page>) => void = () => {};
    vi.mocked(api.getIssues).mockReturnValueOnce(new Promise((resolve) => { oldPoll = resolve; }));
    void store().refresh();
    vi.mocked(api.updateIssues).mockResolvedValue({ updated: 1 });
    vi.mocked(api.getIssues).mockResolvedValue({ data: { tasks: [{ ...task(0), priority: 'low' }], total: 1 }, etag: 'after' });
    useListStore.setState({ selected: new Set(['t0']) });
    await store().changeSelected({ priority: 'low' });
    oldPoll(page(0, 1, 1, 'before'));
    await flush();
    expect(store().rows[0].priority).toBe('low');
  });

  it('what was ticked during the change stays ticked', async () => {
    let done: (value: { updated: number }) => void = () => {};
    vi.mocked(api.updateIssues).mockReturnValue(new Promise((resolve) => { done = resolve; }));
    vi.mocked(api.getIssues).mockResolvedValue(page(0, 1, 1));
    useListStore.setState({ selected: new Set(['a']) });
    const change = store().changeSelected({ priority: 'low' });
    store().toggleSelected('b');
    done({ updated: 1 });
    await change;
    expect([...store().selected]).toEqual(['b']);
  });

  it('what someone deleted leaves the selection, so the next try can work', async () => {
    vi.mocked(api.updateIssues).mockRejectedValue(new api.ApiError('not found', 404, 'TASK_NOT_FOUND', { missing: ['gone'] }));
    useListStore.setState({ selected: new Set(['a', 'gone']) });
    expect(await store().changeSelected({ priority: 'low' })).toBe(false);
    expect([...store().selected]).toEqual(['a']);
    expect(useAppStore.getState().toast?.message).toMatch(/1 of the selected issue no longer exists/);
  });

  it('sends the selection, clears it and reads again', async () => {
    vi.mocked(api.updateIssues).mockResolvedValue({ updated: 2 });
    vi.mocked(api.getIssues).mockResolvedValue(page(0, 1, 1));
    useListStore.setState({ selected: new Set(['a', 'b']) });
    expect(await store().changeSelected({ priority: 'low' })).toBe(true);
    expect(api.updateIssues).toHaveBeenCalledWith('s', ['a', 'b'], { priority: 'low' });
    expect(store().selected.size).toBe(0);
    expect(api.getIssues).toHaveBeenCalled();
  });

  it('if it fails, says why and keeps the selection to try again', async () => {
    vi.mocked(api.updateIssues).mockRejectedValue(new Error('An agent is running WEB-1'));
    useListStore.setState({ selected: new Set(['a']) });
    expect(await store().changeSelected({ statusId: 'done' })).toBe(false);
    expect(store().selected.has('a')).toBe(true);
    expect(useAppStore.getState().toast?.message).toMatch(/WEB-1/);
  });
});
